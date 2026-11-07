// Starting a Builder session from a template, a pipeline of the library, or an analysis.
import { useState } from 'react'
import { t } from '../../../../shared/fr'
import type { BuilderDetail } from '../../../../shared/analysis'
import type { BuilderStart } from '../../../../shared/api/analysis'
import { Field } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { call, errText, useApi } from '@/state/client'

const SOURCES = ['template', 'pipeline', 'analysis'] as const
type Source = (typeof SOURCES)[number]

export function StartDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (d: BuilderDetail) => void }) {
  const templates = useApi('pipelines.templates')
  const pipelines = useApi('pipelines.list', ['pipelines'])
  const analyses = useApi('analysis.list', ['analysis'])
  const [source, setSource] = useState<Source>('template')
  const [pick, setPick] = useState<Record<Source, string>>({ template: '', pipeline: '', analysis: '' })
  const [busy, setBusy] = useState(false)

  const options: { value: string; label: string }[] =
    source === 'template'
      ? (templates.data ?? []).map((x) => ({ value: x.id, label: x.name }))
      : source === 'pipeline'
        ? (pipelines.data ?? []).map((x) => ({ value: String(x.id), label: x.name }))
        : (analyses.data ?? []).filter((a) => a.status === 'done').map((a) => ({ value: String(a.id), label: a.channelName }))
  const value = pick[source] !== '' && options.some((o) => o.value === pick[source]) ? pick[source] : (options[0]?.value ?? '')

  const start = async () => {
    const input: BuilderStart = source === 'template' ? { from: 'template', templateId: value } : source === 'pipeline' ? { from: 'pipeline', pipelineId: Number(value) } : { from: 'analysis', analysisId: Number(value) }
    setBusy(true)
    try {
      const detail = await call('builder.create', input)
      onOpenChange(false)
      onCreated(detail)
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('analysis.common.close')}>
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl leading-tight">{t('builder.start.title')}</DialogTitle>
          <DialogDescription className="text-[13px] text-fg-3">{t('builder.start.blurb')}</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label={t('builder.start.title')} className="inline-flex self-start rounded-full border border-line-2 p-0.5">
          {SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={source === s}
              onClick={() => setSource(s)}
              className={cn('rounded-full px-3.5 py-1 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-brand/60', source === s ? 'bg-brand text-ink-fg' : 'text-fg-2 hover:text-fg')}
            >
              {t(`builder.start.from.${s}`)}
            </button>
          ))}
        </div>
        {options.length === 0 ? (
          <p className="text-[13px] text-fg-3">{t(`builder.start.none.${source}`)}</p>
        ) : (
          <Field label={t(`builder.start.pick.${source}`)} htmlFor="builder-start-pick">
            <Select id="builder-start-pick" value={value} onChange={(e) => setPick((p) => ({ ...p, [source]: e.target.value }))}>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('analysis.common.cancel')}
          </Button>
          <Button variant="brand" data-testid="builder-start-confirm" disabled={busy || options.length === 0} onClick={() => void start()}>
            {busy ? t('builder.start.busy') : t('builder.start.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
