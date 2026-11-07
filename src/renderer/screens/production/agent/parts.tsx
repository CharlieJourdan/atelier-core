// Small pieces of the pipeline agent's screens (production-12): a choice chip, a change of the pipeline in plain French (the
// diff of an edit, decision 0024), and the price per minute / fit line.
import { t, type MessageKey } from '../../../../shared/fr'
import type { EstimateRange } from '../../../../shared/estimates'
import type { PipelineChangeView } from '../../../../shared/pipeline-agent'
import { cn } from '@/lib/utils'
import { eurOf } from '../recettes/estimate-format'

export function Chip({ on, onClick, children, testId, disabled }: { on: boolean; onClick: () => void; children: React.ReactNode; testId?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1 text-[12px] ring-1 transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50',
        on ? 'bg-ink text-ink-fg ring-ink' : 'bg-surface text-fg-2 ring-line hover:bg-surface-2'
      )}
    >
      {children}
    </button>
  )
}

const has = (key: string): boolean => t(key as MessageKey) !== key

/** An option's value in words (`pipe.opt.<id>.<value>`, the quality words, a slider as a percent). */
function optionValue(option: string, v: unknown): string {
  if (v === null || v === undefined) return t('pdiff.none')
  if (typeof v === 'number') return option === 'clipShare' ? `${Math.round(v * 100)} %` : String(v)
  const key = option.startsWith('quality.') ? `pipe.opt.quality.${String(v)}` : `pipe.opt.${option}.${String(v)}`
  return has(key) ? t(key as MessageKey) : String(v)
}

function mixWords(v: unknown): string {
  if (typeof v !== 'object' || v === null) return t('pdiff.none')
  return Object.entries(v as Record<string, unknown>)
    .filter(([k, x]) => typeof x === 'number' && x > 0 && has(`pipe.mix.${k}`))
    .map(([k, x]) => `${t(`pipe.mix.${k}` as MessageKey)} ${Math.round((x as number) * 100)} %`)
    .join(', ')
}

const plain = (v: unknown): string => (v === null || v === undefined ? t('pdiff.none') : typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : JSON.stringify(v))

/** One change of a pipeline: what, then before → after. */
export function changeWords(c: PipelineChangeView): { what: string; before: string; after: string } {
  if (c.kind === 'option' && c.key) {
    const label = has(`pipe.opt.${c.key}`) ? t(`pipe.opt.${c.key}` as MessageKey) : c.key
    return { what: label, before: optionValue(c.key, c.before), after: optionValue(c.key, c.after) }
  }
  if (c.kind === 'mix') return { what: t('pdiff.mix'), before: mixWords(c.before), after: mixWords(c.after) }
  // what makes a brick is ours (pipeline-ui: we never name a provider or a model): only that it changes
  if (c.kind === 'engine' || c.kind === 'fallbacks') {
    const brick = c.brick && has(`tech.${c.brick}`) ? t(`tech.${c.brick}` as MessageKey) : ''
    return { what: [t('pdiff.maker'), brick].filter(Boolean).join(' · '), before: t('pdiff.maker.before'), after: t('pdiff.maker.after') }
  }
  const brick = c.brick ? (has(`tech.${c.brick}`) ? t(`tech.${c.brick}` as MessageKey) : c.brick) : ''
  const what = [t(`pdiff.${c.kind}` as MessageKey), brick, c.key ?? ''].filter(Boolean).join(' · ')
  return { what, before: plain(c.before), after: plain(c.after) }
}

export function DiffLines({ changes, testId }: { changes: readonly PipelineChangeView[]; testId?: string }) {
  return (
    <ul className="flex flex-col gap-1" data-testid={testId}>
      {changes.map((c, i) => {
        const w = changeWords(c)
        return (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
            <span className="font-medium text-fg">{w.what}</span>
            <span className="text-fg-4 line-through decoration-fg-4/60">{w.before}</span>
            <span aria-hidden className="text-fg-4">→</span>
            <span className="text-fg">{w.after}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** « 0,41 € / min » and « ≈ 5,74 € la vidéo de 14 min », or the unknown price. */
export function PriceLine({ perMinute, perVideo, minutes, creditEur }: { perMinute: EstimateRange | null; perVideo: EstimateRange | null; minutes: number; creditEur: number }) {
  if (!perMinute) return <span className="text-[12px] text-fg-3">{t('pagent.noPrice')}</span>
  return (
    <span className="flex flex-col">
      <span className="num text-[18px] font-semibold tracking-[-0.02em] text-fg">{t('pagent.perMinute', { eur: eurOf(perMinute.avg, creditEur) })}</span>
      {perVideo && <span className="num text-[11.5px] text-fg-3">{t('pagent.perVideo', { eur: eurOf(perVideo.avg, creditEur), min: minutes })}</span>}
    </span>
  )
}
