// The proposed pipeline of an analysis: the closest template (rules, PLAN-V2-PRODUCTION §2.1 step 4) adapted from the
// format profile and the answers. Only `simple-video` exists in the catalogue today, so every format starts from it;
// lot P6 adds more templates and the rules that choose between them.
import type { Pipeline } from '../../engine/pipeline-schema'
import { simpleVideoPipeline } from '../../engine/pipelines/simple-video'
import type { ComponentId, GaugeMode, InputId } from '../../shared/gauge'
import type { ReferenceChannel } from './references'

export interface AdaptOptions {
  mode: GaugeMode
  answers: Partial<Record<InputId, boolean>>
  minutes?: number
  maxCreditsPerVideo?: number
  shares: { component: ComponentId; share: number }[]
}

const INPUT_HELP: Record<InputId, { label: string; help: string }> = {
  camera: { label: 'Tes images face caméra', help: 'Tes prises face caméra, en 1080p, son propre, une prise par partie.' },
  gameplay: { label: 'Ton gameplay', help: '10 à 30 min de gameplay sans voix, en 1080p.' }
}

const slug = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'pipeline'

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

export function adaptTemplate(ref: ReferenceChannel, opts: AdaptOptions): Pipeline {
  const minutes = clamp(opts.minutes ?? ref.template.minutes, 1, 30)
  const base = simpleVideoPipeline(minutes)
  const share = (c: ComponentId): number => opts.shares.find((s) => s.component === c)?.share ?? 0
  // base track mix: stock against generated images (other components are drawn by the animation kit)
  const stock = share('stock')
  const image = share('ai_image') + share('ai_video')
  const total = stock + image
  const mix = total > 0 ? { stock: Math.round((stock / total) * 100) / 100, image: Math.round((image / total) * 100) / 100 } : { stock: 0.6, image: 0.4 }
  const inputs = [...base.inputs]
  for (const input of ['camera', 'gameplay'] as const) {
    if (opts.answers[input] === true) inputs.push({ id: input, kind: 'video', required: true, label: INPUT_HELP[input].label, help: INPUT_HELP[input].help })
  }
  const nodes = base.nodes.map((n) => {
    if (n.id === 'director') {
      return { ...n, params: { ...(n.params ?? {}), cpm: clamp(ref.template.cutsPerMinute, 4, 40), mix } }
    }
    if (n.id === 'script') {
      return { ...n, params: { ...(n.params ?? {}), wpm: clamp(ref.scriptCard.wpm, 60, 300), skills: ref.scriptCard.skills.filter((s) => s !== 'factcheck') } }
    }
    return n
  })
  return {
    ...base,
    id: slug(`${ref.id}-analyse`),
    name: `${ref.format} (d’après l’analyse)`,
    format: { ...base.format, minutes: { default: minutes, min: 1, max: 30 } },
    inputs,
    budget: { default: opts.mode, ...(opts.maxCreditsPerVideo !== undefined ? { capCredits: opts.maxCreditsPerVideo } : {}) },
    nodes
  }
}
