// « Pipelines prêtes » as a browser (production-lab): the categories on top (one per family of ready pipelines: Avatar
// today, more later), the form (Long format first and by default, Short beside it: Charlie 01/11), the order (« Les plus utilisées » first, then the cheapest, the fastest), then the cards — a row that
// scrolls sideways on the Lab, a grid on the full page.
import { useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { EstimateCardsView } from '../../../../shared/estimates'
import { PIPELINE_FORMS, type BasePipelineInfo, type PipelineForm } from '../../../../shared/recipes'
import { Select } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { categoriesOf, READY_SORTS, sortReady, type ReadySort } from './lab-model'
import { ReadyCard, type ReadyActions } from './ReadyCard'

/** A category's name: its own string, else the name of its first ready pipeline. */
function categoryLabel(cat: string, bases: readonly BasePipelineInfo[]): string {
  const own = t(`lab.cat.${cat}` as MessageKey) as string | undefined
  if (own) return own
  const first = bases.find((b) => b.id.startsWith(`${cat}@`))
  return first ? t(first.labelKey as MessageKey) : cat
}

export function ReadyBrowser({
  bases,
  estimates,
  actions,
  layout
}: {
  bases: readonly BasePipelineInfo[]
  estimates: EstimateCardsView | null
  actions: ReadyActions
  layout: 'row' | 'grid'
}) {
  const [category, setCategory] = useState<string | null>(null)
  const [sort, setSort] = useState<ReadySort>('used')
  const [form, setForm] = useState<PipelineForm>('long')
  const cats = categoriesOf(bases)
  const shown = sortReady(bases, sort, estimates, category, form)
  const chip = (on: boolean): string =>
    cn(
      'h-7 rounded-full px-3 text-[12.5px] whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-ring',
      on ? 'bg-ink font-medium text-ink-fg' : 'border border-line-2 text-fg-2 hover:bg-hover hover:text-fg'
    )
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label={t('lab.ready')} className="flex flex-wrap items-center gap-1.5" data-testid="ready-categories">
          <button type="button" role="tab" aria-selected={category === null} className={chip(category === null)} onClick={() => setCategory(null)} data-testid="ready-cat-all">
            {t('lab.cat.all')}
          </button>
          {cats.map((c) => (
            <button key={c} type="button" role="tab" aria-selected={category === c} className={chip(category === c)} onClick={() => setCategory(c)} data-testid={`ready-cat-${c}`}>
              {categoryLabel(c, bases)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label={t('lab.spec.form')} className="flex items-center rounded-full border border-line-2 p-0.5" data-testid="ready-forms">
            {PIPELINE_FORMS.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={form === f}
                onClick={() => setForm(f)}
                data-testid={`ready-form-${f}`}
                className={cn('h-7 rounded-full px-3 text-[12.5px] whitespace-nowrap transition-colors', form === f ? 'bg-surface-3 font-medium text-fg' : 'text-fg-3 hover:text-fg')}
              >
                {t(`lab.form.${f}` as MessageKey)}
              </button>
            ))}
          </div>
        <Select aria-label={t('lab.sort')} value={sort} onChange={(e) => setSort(e.target.value as ReadySort)} className="h-8 w-auto min-w-[170px] text-[12.5px]" data-testid="ready-sort">
          {READY_SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`lab.sort.${s}` as MessageKey)}
            </option>
          ))}
        </Select>
        </div>
      </div>
      {shown.length === 0 && <p className="text-[12.5px] text-fg-3" data-testid="ready-none">{t(form === 'short' ? 'lab.ready.noShort' : 'lab.ready.noneHere')}</p>}
      <div
        data-testid="ready-list"
        className={cn(
          layout === 'row'
            ? '-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pt-1 pb-3'
            : 'grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-4'
        )}
      >
        {shown.map((b) => (
          <ReadyCard key={b.id} base={b} estimates={estimates} actions={actions} className={layout === 'row' ? 'w-[300px] shrink-0 snap-start' : undefined} />
        ))}
      </div>
    </div>
  )
}
