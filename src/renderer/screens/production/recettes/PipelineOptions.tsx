// The options of a pipeline made from a base (production-3, decision 0022), each a switch, a choice or a slider, in two
// places (pipeline-ui, src/shared/option-previews.ts): the main ones first in the editor, each with its « Avant / après »
// (OptionPreview), and the ones a user may still change under « Avancé », with the pipeline's mix (read-only: the clip share
// is an option; the rest is the agent's, production-12). The internal options (how our technologies make the video) are
// never shown; the document keeps their values. A choice whose bricks are not built yet carries « bientôt » and cannot be
// picked. Changing an option edits the document (`options`); main checks it, and the compiler applies the option's
// operations before compiling. Beside each choice: what it changes to the average cost per finished minute (production-11).
import { t, type MessageKey } from '../../../../shared/fr'
import { OPTION_GROUPS, optionPlace } from '../../../../shared/option-previews'
import type { PreviewItem } from '../../../../shared/previews'
import { MIX_KINDS, type BasePipelineInfo, type OptionInfo, type RecipeDocument, type RecipeOptionValue } from '../../../../shared/recipes'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { signedEur } from './estimate-format'
import { OptionPreview } from './OptionPreview'

/** The Δ cost of each option choice (credits per finished minute) and the value of a credit. */
export interface OptionDeltas {
  byOption: Record<string, Record<string, number>>
  creditEur: number
}

const label = (key: string): string => t(key as MessageKey)
const soonText = (chantier: string): string => t('pipe.soonBy', { chantier })

/** The options of a base shown in one place (`main` or `advanced`); internal ones never. */
export const optionsIn = (base: BasePipelineInfo, place: 'main' | 'advanced'): OptionInfo[] => base.options.filter((o) => optionPlace(o.id) === place)

function Choice({ option, value, deltas, onPick }: { option: OptionInfo; value: RecipeOptionValue; deltas: OptionDeltas | null; onPick: (v: RecipeOptionValue) => void }) {
  const row = deltas?.byOption[option.id]
  return (
    <div className="flex flex-wrap gap-1.5">
      {option.choices.map((c) => {
        const soon = option.soon ?? c.soon
        const locked = soon !== null && c.value !== option.default
        return (
          <button
            key={String(c.value)}
            type="button"
            aria-pressed={value === c.value}
            disabled={locked}
            title={locked && soon ? soonText(soon) : undefined}
            onClick={() => onPick(c.value)}
            data-testid={`opt-${option.id}-${String(c.value)}`}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              value === c.value ? 'border-transparent bg-ink text-ink-fg' : 'border-line-2 text-fg-2 hover:bg-surface-2'
            )}
          >
            {label(c.labelKey)}
            {locked && <span className="ml-1 text-[10.5px] uppercase tracking-wide">{t('pipe.soon')}</span>}
            {!locked && value !== c.value && deltas && row?.[String(c.value)] !== undefined && (
              <span className="num ml-1.5 text-[10.5px] opacity-70" data-testid={`delta-${option.id}-${String(c.value)}`}>
                {signedEur(row[String(c.value)] as number, deltas.creditEur)}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function Slider({ option, value, deltas, onPick }: { option: OptionInfo; value: number; deltas: OptionDeltas | null; onPick: (v: number) => void }) {
  const step = deltas?.byOption[option.id]?.['+0.05']
  const s = option.slider ?? { min: 0, max: 1, step: 0.01 }
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={s.min}
        max={s.max}
        step={s.step}
        value={value}
        onChange={(e) => onPick(Number(e.target.value))}
        data-testid={`opt-${option.id}`}
        className="w-48 accent-[var(--color-ink)]"
        aria-label={label(option.labelKey)}
      />
      <span className="num w-12 text-[12.5px] text-fg-2">{Math.round(value * 100)} %</span>
      {step !== undefined && deltas && <span className="num text-[11px] text-fg-4">{t('pipe.delta.step', { delta: signedEur(step, deltas.creditEur) })}</span>}
    </div>
  )
}

/** The mix of the pipeline as a bar of screen-time shares, with its curve. */
export function MixBar({ mix }: { mix: RecipeDocument['mix'] }) {
  if (!mix) return null
  const parts = MIX_KINDS.filter((k) => (mix[k] ?? 0) > 0)
  const curve = typeof mix.curve === 'string' ? t(`pipe.curve.${mix.curve}` as MessageKey) : t('pipe.curve.custom')
  return (
    <div className="flex flex-col gap-1.5" data-testid="pipe-mix">
      <span className="text-[12.5px] font-medium text-fg-2">{t('pipe.mix')}</span>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        {parts.map((k, i) => (
          <span key={k} style={{ width: `${(mix[k] ?? 0) * 100}%`, opacity: 1 - i * 0.18 }} className="h-full bg-ink" />
        ))}
      </div>
      <p className="text-[12px] text-fg-3">
        {parts.map((k) => `${t(`pipe.mix.${k}` as MessageKey)} ${Math.round((mix[k] ?? 0) * 100)} %`).join(' · ')} — {curve}
      </p>
    </div>
  )
}

/** The options of one place, as a grid of fields. */
export function OptionFields({
  options,
  doc,
  deltas,
  previews,
  onChange
}: {
  options: readonly OptionInfo[]
  doc: RecipeDocument
  deltas: OptionDeltas | null
  previews: Map<string, PreviewItem>
  onChange: (doc: RecipeDocument) => void
}) {
  const set = (id: string, v: RecipeOptionValue, def: RecipeOptionValue): void => {
    const next = { ...doc.options }
    if (v === def) delete next[id]
    else next[id] = v
    onChange({ ...doc, options: next })
  }
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
      {options.map((o) => {
        const value = doc.options[o.id] ?? o.default
        return (
          <div key={o.id} className="flex flex-col gap-1.5" data-testid={`opt-${o.id}-field`}>
            <span className="flex items-center gap-2 text-[12.5px] font-medium text-fg-2">
              {label(o.labelKey)}
              {o.soon && <Badge variant="warn">{soonText(o.soon)}</Badge>}
            </span>
            {o.kind === 'slider' ? (
              <Slider option={o} value={typeof value === 'number' ? value : Number(o.default)} deltas={deltas} onPick={(v) => set(o.id, v, o.default)} />
            ) : (
              <Choice option={o} value={value} deltas={deltas} onPick={(v) => set(o.id, v, o.default)} />
            )}
            <OptionPreview option={o} previews={previews} />
          </div>
        )
      })}
    </div>
  )
}

/** The main options of a pipeline made from a base, each with its « Avant / après ». */
export function PipelineOptions({
  base,
  doc,
  deltas = null,
  previews,
  onChange
}: {
  base: BasePipelineInfo
  doc: RecipeDocument
  deltas?: OptionDeltas | null
  previews: Map<string, PreviewItem>
  onChange: (doc: RecipeDocument) => void
}) {
  return (
    <section className="card mb-6 flex flex-col gap-4 p-5" data-testid="pipe-options">
      <h2 className="text-[14px] font-semibold text-fg">{t('pipe.options')}</h2>
      <p className="text-[12px] text-fg-3">{t('pipe.options.hint')}</p>
      {/* by group (avatar-reglages-voix): the character, the voice, the offer, the editing, the script; an option of no group last */}
      {[...OPTION_GROUPS, { id: 'other', options: [] as readonly string[] }].map((g) => {
        const main = optionsIn(base, 'main')
        const listed = new Set(OPTION_GROUPS.flatMap((x) => x.options))
        const options = g.id === 'other' ? main.filter((o) => !listed.has(o.id)) : g.options.flatMap((id) => main.filter((o) => o.id === id))
        if (options.length === 0) return null
        return (
          <div key={g.id} className="flex flex-col gap-3" data-testid={`pipe-group-${g.id}`}>
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-fg-3">{t(`pipe.group.${g.id}` as MessageKey)}</h3>
            {(g.id === 'character' || g.id === 'voice') && <p className="-mt-2 text-[11.5px] text-fg-4">{t(`pipe.group.${g.id}.help` as MessageKey)}</p>}
            <OptionFields options={options} doc={doc} deltas={deltas} previews={previews} onChange={onChange} />
          </div>
        )
      })}
    </section>
  )
}
