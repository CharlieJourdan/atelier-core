// The style technologies of the team agents (production-15): the same path as the owner's « Reproduire un style » screen —
// measure 1 to 5 YouTube links and get the closest pipelines (`style.study`, the eyes' minutes billed in credits), read a
// study (`style.read`: proposals, the sample's likeness score and its gaps), quote a variant's sample (`style.quote`). Running
// the sample spends credits: only the owner's click on that quote runs it, never an agent.
import type { StudyView } from '../../shared/style-agent'
import type { Handler, ToolCtx } from './tool-args'
import { int, need } from './tool-args'

const pct = (x: number | null | undefined): string => (typeof x === 'number' ? `${Math.round(x * 100)} %` : '—')

/** A study in a few lines a model reads. */
export function studyText(v: StudyView): string {
  const lines = [
    `Style study #${v.id}: ${v.references.map((r) => `${r.title} (${r.videos} video(s)${r.problem ? `, not measured: ${r.problem}` : ''})`).join('; ')}${v.demo ? ' — DEMONSTRATION measures (Atelier Cloud not connected)' : ''}`,
    `Base ${v.base} (${v.reason}). References: presenter ${pct(v.profile?.presenterShare)}, shots ${v.profile?.shotS?.toFixed(1) ?? '—'} s, look ${v.profile?.lookFamily ?? '—'}, pace ${v.profile?.wordsPerMinute?.toFixed(0) ?? '—'} words/min.`,
    ...v.variants.map((x) => `- ${x.kind}${x.kind === v.recommended ? ' (recommended)' : ''}: ${x.perMinute ? `${x.perMinute.avg.toFixed(0)} credits/min` : 'unpriced'}, likeness estimate ${x.likeness ?? '—'}/100${x.edits ? `, ${x.edits} gap edit(s) applied` : ''}`)
  ]
  if (v.quote) lines.push(`Sample quote (${v.quote.variant}): ${v.quote.credits.avg} credits (max ${v.quote.credits.max}), ${v.quote.seconds} s — waiting for the owner's click.`)
  const s = v.sample
  if (s) {
    lines.push(`Sample (${s.variant}, run #${s.runId}): ${s.status}${s.stale ? ', to remake (the pipeline changed)' : ''}${s.score !== null ? `, likeness ${s.score}/100` : ''}${s.predicted !== null ? `, predicted after edits ${s.predicted}/100` : ''}${s.error ? ` — ${s.error}` : ''}`)
    s.gaps.forEach((g, i) => lines.push(`  gap ${i}: ${g.dimension} ${pct(g.score)}${g.ops.length ? ` → ${JSON.stringify(g.ops)} (score ${g.scoreAfter ?? '—'})` : ' (no setting closes it)'}`))
  }
  lines.push('The owner runs the sample from the « Reproduire un style » screen, and adopts a variant there.')
  return lines.join('\n')
}

function svc(c: ToolCtx) {
  const s = c.env.services.styles
  if (!s) throw new Error('Style studies are not available here')
  return s
}

export const STYLE_TOOLS: Record<string, Handler> = {
  'style.study': async (c, a) => {
    const raw = Array.isArray(a.links) ? a.links : [need(a.links, 'links', 3000)]
    return studyText(await svc(c).study({ links: raw.filter((x): x is string => typeof x === 'string') }, c.signal))
  },
  'style.read': async (c, a) => studyText(await svc(c).get(int(a.study, 'study'))),
  'style.quote': async (c, a) => studyText(await svc(c).quote(int(a.study, 'study'), need(a.variant, 'variant', 20)))
}
