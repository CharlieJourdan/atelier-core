// Production › Pipelines (PLAN-V2-PRODUCTION §5): the library (templates, mine, per channel), import / export of
// `atelier.pipeline/1` documents, the node graph of the selected pipeline with its inspector, versions and diff. All real.
import { FileDown, FileUp, Star } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../../shared/fr'
import type { LibraryPipelineRow, TemplateInfo } from '../../../../shared/analysis'
import { ErrorLine, ExampleBadge, LoadingBlock } from '@/components/atelier/kit'
import { PageShell } from '@/components/atelier/page'
import { EmptyState } from '@/components/atelier/primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useApi } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { ImportDialog, TemplateDialog } from './Dialogs'
import { PipelineDetail } from './PipelineDetail'

/** Pipelines grouped by channel (those without one first), in the order the list gives them. */
export function groupByChannel(rows: readonly LibraryPipelineRow[]): { key: string; channel: string | null; rows: LibraryPipelineRow[] }[] {
  const groups = new Map<string, { key: string; channel: string | null; rows: LibraryPipelineRow[] }>()
  for (const r of rows) {
    const key = r.channelId === null ? 'none' : `c${r.channelId}`
    const g = groups.get(key) ?? { key, channel: r.channelName, rows: [] }
    g.rows.push(r)
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => (a.channel === null ? -1 : 0) - (b.channel === null ? -1 : 0))
}

export function PipelineScreen(_props: ScreenProps) {
  const list = useApi('pipelines.list', ['pipelines', 'example'])
  const templates = useApi('pipelines.templates')
  const [selected, setSelected] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const [template, setTemplate] = useState<TemplateInfo | null>(null)
  const rows = list.data ?? []
  const current = selected !== null && rows.some((r) => r.id === selected) ? selected : (rows[0]?.id ?? null)

  return (
    <PageShell
      section="production"
      title={t('page.production.pipeline')}
      subtitle={t('pipelines.subtitle')}
      actions={
        <Button variant="outline" data-testid="pipeline-import" onClick={() => setImporting(true)}>
          <FileUp aria-hidden /> {t('pipelines.import.button')}
        </Button>
      }
    >
      <div className="grid min-h-0 grid-cols-1 gap-6 lg:grid-cols-[288px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-5" data-testid="pipeline-library">
          <section aria-label={t('pipelines.templates.title')} className="flex flex-col gap-2">
            <h3 className="micro-label">{t('pipelines.templates.title')}</h3>
            {templates.error ? (
              <ErrorLine message={templates.error} />
            ) : (
              (templates.data ?? []).map((tpl) => (
                <div key={tpl.id} data-testid={`template-${tpl.id}`} className="flex flex-col gap-1.5 rounded-field border border-dashed border-line-2 bg-surface-1 px-3 py-2.5">
                  <p className="text-[13px] font-medium text-fg">{tpl.name}</p>
                  <p className="text-[11.5px] text-fg-3">{tpl.description}</p>
                  <Button variant="outline" size="sm" className="self-start" data-testid={`use-template-${tpl.id}`} onClick={() => setTemplate(tpl)}>
                    <FileDown aria-hidden /> {t('pipelines.templates.use')}
                  </Button>
                </div>
              ))
            )}
          </section>
          <section aria-label={t('pipelines.mine.title')} className="flex flex-col gap-3">
            <h3 className="micro-label">{t('pipelines.mine.title')}</h3>
            {list.error ? (
              <ErrorLine message={list.error} onRetry={list.reload} />
            ) : list.data === null ? (
              <LoadingBlock rows={3} />
            ) : rows.length === 0 ? (
              <p className="text-[12.5px] text-fg-3">{t('pipelines.mine.empty')}</p>
            ) : (
              groupByChannel(rows).map((g) => (
                <div key={g.key} className="flex flex-col gap-1.5">
                  <p className="text-[11.5px] text-fg-3">{g.channel ?? t('pipelines.mine.noChannel')}</p>
                  {g.rows.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      data-testid={`pipeline-row-${r.id}`}
                      aria-current={r.id === current}
                      onClick={() => setSelected(r.id)}
                      className={cn(
                        'flex flex-col gap-1 rounded-field border px-3 py-2.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/60',
                        r.id === current ? 'border-brand/60 bg-brand-soft' : 'border-line bg-surface-1 hover:bg-surface-2'
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium text-fg">{r.name}</span>
                        {r.isDefault && <Star className="size-3.5 shrink-0 fill-brand text-brand" aria-label={t('pipelines.default.star')} />}
                        {r.example && <ExampleBadge />}
                      </span>
                      <span className="flex items-center gap-2 text-[11.5px] text-fg-3">
                        <Badge variant="outline">{t(`analysis.origin.${r.origin}`)}</Badge>
                        {t('analysis.common.version', { n: r.latestVersion })}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </section>
        </aside>
        <div className="min-w-0">
          {current !== null ? (
            <PipelineDetail key={current} id={current} onDeleted={() => setSelected(null)} />
          ) : list.data !== null ? (
            <EmptyState title={t('pipelines.empty.title')} blurb={t('pipelines.empty.blurb')} />
          ) : null}
        </div>
      </div>
      <ImportDialog open={importing} onOpenChange={setImporting} onImported={(row) => setSelected(row.id)} />
      <TemplateDialog template={template} onClose={() => setTemplate(null)} onCreated={(row) => setSelected(row.id)} />
    </PageShell>
  )
}
