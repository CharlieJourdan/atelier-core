// Real mode: the published blueprint (the founder's pipelines and agent templates, read through `cloud.blueprint`) as what
// the screens show: its pipelines become Atelier templates (« Modèles Atelier » of Production > Pipelines), its unmapped
// agents become templates to recruit. Pure: the main process already decided each step's kind (or guessed it, flagged).
import { t } from '../../../shared/fr'
import type { BlueprintAgentView, BlueprintPipelineView, BlueprintStatus } from '../../../shared/blueprint'
import type { PipelineNode, PipelineKind, ModelTier, NodeKind, ProtoPipeline } from '../types'

/** Ids of the blueprint's templates in the store (replaced as a group by every snapshot). */
export const BLUEPRINT_PREFIX = 'bp-'
export const isBlueprintPipeline = (id: string): boolean => id.startsWith(BLUEPRINT_PREFIX)

/** Rough minutes a step takes on the team computer, until the engine has measured it (shown as estimates). */
const MINUTES: Record<NodeKind, number> = {
  idea: 2,
  script: 6,
  director: 3,
  avatar: 10,
  stock: 4,
  'image-gen': 5,
  'video-gen': 8,
  motion: 4,
  voice: 2,
  music: 1,
  gameplay: 0,
  card: 1,
  captions: 1,
  edit: 10,
  thumbnail: 3,
  qc: 3,
  publish: 1,
  translate: 5,
  'human-input': 0,
  code: 3
}
/** Cloud rendering takes about this share of the team-computer time. */
const CLOUD_SHARE = 0.45

/** Which recipe family a blueprint pipeline looks like, from its id and name (for the card's label). */
function pipelineKind(p: BlueprintPipelineView): PipelineKind {
  const key = `${p.id} ${p.name}`.toLowerCase()
  if (/reddit/.test(key)) return 'reddit'
  if (/top[- ]?\d|classement/.test(key)) return 'top10'
  if (/avatar/.test(key)) return 'avatar'
  if (/sms|conversation|message/.test(key)) return 'sms-story'
  if (/traduit|traduction|translat/.test(key)) return 'translated'
  if (/commentaire|commentary|r[ée]action/.test(key)) return 'commentary'
  return 'documentary'
}

/** Share of the machine work an agent does (so it runs on the user's subscription), in %: a paid API step weighs double. */
function agentPercent(nodes: readonly PipelineNode[]): number {
  const work = nodes.filter((n) => n.runner !== 'human')
  const weight = (n: PipelineNode): number => Math.max(1, n.minutes) * (n.runner === 'api' ? 2 : 1)
  const total = work.reduce((sum, n) => sum + weight(n), 0)
  const agent = work.filter((n) => n.runner === 'agent').reduce((sum, n) => sum + Math.max(1, n.minutes), 0)
  return total === 0 ? 0 : Math.round((agent / total) * 100)
}

const isShort = (k: PipelineKind): boolean => k === 'reddit' || k === 'sms-story'

export function blueprintPipelines(status: BlueprintStatus | null): ProtoPipeline[] {
  if (!status || status.state !== 'ok' || status.version === null) return []
  const version = status.version
  return status.pipelines.map((p) => {
    const nodes: PipelineNode[] = p.steps.map((s, i) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      runner: s.runner,
      provider: s.provider,
      detail: '',
      credits: s.credits,
      minutes: MINUTES[s.kind],
      col: i,
      row: 1,
      ...(s.gate ? { gate: true } : {})
    }))
    const kind = pipelineKind(p)
    const minutes = nodes.reduce((sum, n) => sum + n.minutes, 0)
    return {
      id: `${BLUEPRINT_PREFIX}${p.id}`,
      name: p.name,
      description: t('prod.pipeline.blueprintDesc', { version }),
      kind,
      format: isShort(kind) ? 'short' : 'long',
      nodes,
      edges: nodes.slice(1).map((n, i) => [(nodes[i] as PipelineNode).id, n.id] as [string, string]),
      replicability: 90,
      creditsPerVideo: p.credits,
      minutesPerVideo: minutes,
      minutesCloud: Math.round(minutes * CLOUD_SHARE),
      channelIds: [],
      preset: true,
      version,
      subscriptionShare: agentPercent(nodes)
    }
  })
}

/** The store's pipelines with the blueprint's templates swapped in (a demo template of the same name gives way). */
export function withBlueprintPipelines(current: readonly ProtoPipeline[], status: BlueprintStatus | null): ProtoPipeline[] {
  const own = blueprintPipelines(status)
  const names = new Set(own.map((p) => p.name))
  return [...current.filter((p) => !isBlueprintPipeline(p.id) && !(p.preset && names.has(p.name))), ...own]
}

export interface BlueprintRecruit {
  id: string
  name: string
  model: ModelTier
  instructions: string
}

const MODEL_OF: Record<BlueprintAgentView['tier'], ModelTier> = { fast: 'haiku', balanced: 'sonnet', deep: 'opus' }

/** The blueprint's agents the runtime has no role for: templates the user can recruit (« recrutable »). */
export function blueprintRecruits(status: BlueprintStatus | null): BlueprintRecruit[] {
  if (!status || status.state !== 'ok') return []
  return status.recruitable.map((a) => ({ id: a.id, name: a.role, model: MODEL_OF[a.tier], instructions: a.instructions }))
}
