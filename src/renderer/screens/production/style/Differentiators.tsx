// « Comment veux-tu te différencier ? » (clonage-traduction; parcours-utilisateur): the few changes the agent proposes on the pipeline
// closest to the references, logical for the genre, each with what it does to the price of a minute, the render time and the
// likeness, whether it makes the channel recognisable, better or cheaper, and its « avant / après » side by side when the app ships
// them. The agent's own question heads them; the ones it (or a weak channel) recommends are marked. The owner ticks freely; nothing
// is applied until ticked. The owner's own channel gets two at most.
import { useEffect, useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import { Badge } from '@/components/ui/badge'
import type { PreviewItem } from '../../../../shared/previews'
import type { DifferentiatorView, StudyView } from '../../../../shared/style-agent'
import { call } from '@/state/client'
import { DiffSketch } from './DiffSketch'
import { PreviewMedia } from './Previews'

const eur = (credits: number, creditEur: number): string => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(credits * creditEur)
const min = (s: number): string => `${Math.max(1, Math.round(s / 60))} min`
const signed = (x: number): string => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x)}`

function useOptionPreviews(): PreviewItem[] {
  const [items, setItems] = useState<PreviewItem[]>([])
  useEffect(() => {
    let live = true
    call('previews.options').then(
      (x) => live && setItems(x),
      () => undefined
    )
    return () => {
      live = false
    }
  }, [])
  return items
}

/** « Avant » and « Après » side by side (only « après » when the « avant » is not saved). */
function BeforeAfter({ before, after, sketch }: { before: PreviewItem | undefined; after: PreviewItem | undefined; sketch: DifferentiatorView['sketch'] }) {
  const b = before?.files[0]
  const a = after?.files[0]
  if (!a || !after) return sketch ? (DiffSketch({ before: sketch.before, after: sketch.after }) ?? <span className="text-[11.5px] text-fg-3">{t('pdiff.noPreview')}</span>) : <span className="text-[11.5px] text-fg-3">{t('pdiff.noPreview')}</span>
  return (
    <span className={`grid gap-2 ${b ? 'grid-cols-2' : 'grid-cols-1'}`} data-testid="diff-before-after">
      {b && before && (
        <span className="flex flex-col gap-1">
          <span className="text-[10.5px] uppercase tracking-[0.05em] text-fg-3">{t('pdiff.before')}</span>
          <PreviewMedia item={before} file={b} />
        </span>
      )}
      <span className="flex flex-col gap-1">
        <span className="text-[10.5px] uppercase tracking-[0.05em] text-fg-3">{t('pdiff.after')}</span>
        <PreviewMedia item={after} file={a} />
      </span>
    </span>
  )
}

function Card({ d, s, preview, before, busy, onToggle }: { d: DifferentiatorView; s: StudyView; preview: PreviewItem | undefined; before: PreviewItem | undefined; busy: boolean; onToggle: () => void }) {
  return (
    <label
      className={`card flex cursor-pointer flex-col gap-2 p-4 ring-1 transition ${d.picked ? 'ring-accent' : 'ring-transparent'} ${busy ? 'opacity-60' : ''}`}
      data-testid={`diff-${d.id}`}
    >
      <span className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={d.picked} disabled={busy} onChange={onToggle} />
        <span className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13.5px] font-semibold text-fg">{d.title}</span>
            <Badge variant={d.effect === 'cheaper' ? 'ok' : d.effect === 'improve' ? 'brand' : 'default'}>{t(`pdiff.effect.${d.effect}` as MessageKey)}</Badge>
            {d.recommended && <Badge variant="warn">{t('pdiff.recommended')}</Badge>}
          </span>
          <span className="text-[12px] leading-[1.45] text-fg-2">{d.detail}</span>
        </span>
      </span>
      <BeforeAfter before={before} after={preview} sketch={d.sketch} />
      <span className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        {d.perMinute && (
          <span>
            {t('pstyle.diff.price', { before: eur(d.perMinute.before.avg, s.creditEur), after: eur(d.perMinute.after.avg, s.creditEur) })}
          </span>
        )}
        {!d.perMinute && <span>{t('pstyle.diff.noPrice')}</span>}
        {d.renderSeconds && min(d.renderSeconds.before) !== min(d.renderSeconds.after) && <span>{t('pstyle.diff.time', { before: min(d.renderSeconds.before), after: min(d.renderSeconds.after) })}</span>}
        {d.likeness && <span>{t('pstyle.diff.likeness', { delta: signed(d.likeness.after - d.likeness.before), after: d.likeness.after })}</span>}
      </span>
    </label>
  )
}

export function Differentiators({ study, busy, onPick }: { study: StudyView; busy: boolean; onPick: (ids: string[]) => void }) {
  const previews = useOptionPreviews()
  if (study.differentiators.length === 0) return study.own ? <p className="mb-9 text-[12.5px] text-fg-3" data-testid="style-own">{t('pstyle.diff.own')}</p> : null
  const picked = study.differentiators.filter((d) => d.picked).map((d) => d.id)
  const toggle = (id: string): void => onPick(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id])
  return (
    <section className="mb-9 flex flex-col gap-3" data-testid="style-differentiators">
      <h2 className="text-[15px] font-semibold text-fg" data-testid="style-ask">{study.ask || t('pstyle.diff.title')}</h2>
      <p className="max-w-[760px] text-[12.5px] text-fg-2">{t(study.own ? 'pstyle.diff.ownLead' : study.rework ? 'pstyle.diff.reworkLead' : 'pstyle.diff.lead')}</p>
      {picked.length > 0 && <p className="text-[12.5px] font-medium text-ok" data-testid="style-diff-applied">{t('pstyle.diff.applied', { n: picked.length })}</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {study.differentiators.map((d) => (
          <Card key={d.id} d={d} s={study} preview={d.previewKey ? previews.find((p) => p.key === d.previewKey) : undefined} before={d.beforeKey ? previews.find((p) => p.key === d.beforeKey) : undefined} busy={busy} onToggle={() => toggle(d.id)} />
        ))}
      </div>
    </section>
  )
}
