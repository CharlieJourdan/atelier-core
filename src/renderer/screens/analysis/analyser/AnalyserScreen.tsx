// Production › Analyser une chaîne (PLAN-V2-PRODUCTION §2). Real on the three reference channels (invented, so the gauge
// is testable offline). Reading a real channel from a link needs YouTube Data and video analysis through Atelier Cloud:
// that part is labelled DÉMO (features `youtube-research` and `video-analysis`) and answered « unavailable » by main.
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../../shared/fr'
import type { AnalysisSummary, ReferenceSummary } from '../../../../shared/analysis'
import { DemoBoundary } from '@/components/atelier/demo'
import { useConfirm } from '@/components/atelier/confirm'
import { ErrorLine, ExampleBadge, Field, LoadingBlock, fmtDate, fmtInt } from '@/components/atelier/kit'
import { PageShell } from '@/components/atelier/page'
import { Panel } from '@/components/atelier/primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { call, errText, useApi } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { gaugeTone } from '../shared/gauge-view'
import { AnalysisView } from './AnalysisView'

const TONE_BADGE = { ok: 'ok', info: 'brand', warn: 'warn', err: 'err' } as const

export function AnalyserScreen({ onRoute }: ScreenProps) {
  const list = useApi('analysis.list', ['analysis', 'example'])
  const [selected, setSelected] = useState<number | null>(null)
  const confirm = useConfirm()
  const rows = list.data ?? []
  const current = selected !== null && rows.some((r) => r.id === selected) ? selected : null

  const remove = async (row: AnalysisSummary) => {
    const ok = await confirm({ title: t('analysis.delete.title', { name: row.channelName }), description: t('analysis.delete.blurb'), confirmLabel: t('analysis.delete.confirm'), danger: true })
    if (!ok) return
    try {
      await call('analysis.delete', row.id)
      if (selected === row.id) setSelected(null)
    } catch (err) {
      toast.error(errText(err))
    }
  }

  return (
    <PageShell section="production" title={t('page.production.analyser')} subtitle={t('analysis.subtitle')}>
      <div className="grid min-h-0 grid-cols-1 gap-6 lg:grid-cols-[272px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-2" aria-label={t('analysis.past.title')} data-testid="analysis-list">
          <Button variant={current === null ? 'brand' : 'outline'} data-testid="new-analysis" onClick={() => setSelected(null)}>
            {t('analysis.new')}
          </Button>
          <p className="micro-label mt-3 mb-1">{t('analysis.past.title')}</p>
          {list.error ? (
            <ErrorLine message={list.error} onRetry={list.reload} />
          ) : list.data === null ? (
            <LoadingBlock rows={3} />
          ) : rows.length === 0 ? (
            <p className="text-[12.5px] text-fg-3">{t('analysis.past.empty')}</p>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="group relative">
                <button
                  type="button"
                  data-testid={`analysis-row-${r.id}`}
                  aria-current={r.id === current}
                  onClick={() => setSelected(r.id)}
                  className={cn(
                    'flex w-full flex-col gap-1 rounded-field border px-3 py-2.5 pr-9 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/60',
                    r.id === current ? 'border-brand/60 bg-brand-soft' : 'border-line bg-surface-1 hover:bg-surface-2'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium text-fg">{r.channelName}</span>
                    {r.example && <ExampleBadge />}
                  </span>
                  <span className="flex items-center gap-2 text-[11.5px] text-fg-3">
                    {r.score !== null ? <Badge variant={TONE_BADGE[gaugeTone(r.score)]}>{r.score}</Badge> : <Badge variant="outline">{t('analysis.past.pending')}</Badge>}
                    {fmtDate(r.createdAt)}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={t('analysis.delete.aria', { name: r.channelName })}
                  onClick={() => void remove(r)}
                  className="absolute top-2 right-2 rounded-chip p-1.5 text-fg-3 opacity-60 transition-opacity outline-none group-hover:opacity-100 hover:text-err focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-brand/60"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
            ))
          )}
        </aside>
        <div className="min-w-0">
          {current !== null ? <AnalysisView key={current} id={current} onPipelines={() => onRoute({ section: 'production', page: 'pipeline' })} /> : <StartPanel onStarted={setSelected} />}
        </div>
      </div>
    </PageShell>
  )
}

function StartPanel({ onStarted }: { onStarted: (id: number) => void }) {
  const refs = useApi('analysis.references')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState<string | null>(null)

  const start = async (input: { link?: string; referenceId?: string }, key: string) => {
    setBusy(key)
    setUnavailable(null)
    try {
      const res = await call('analysis.start', input)
      if (res.kind === 'started') onStarted(res.analysis.id)
      else setUnavailable(res.link)
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <DemoBoundary feature="youtube-research">
        <Panel title={t('analysis.start.linkTitle')}>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (link.trim()) void start({ link: link.trim() }, 'link')
            }}
          >
            <Field label={t('analysis.start.linkLabel')} htmlFor="analysis-link" className="min-w-72 flex-1">
              <Input id="analysis-link" value={link} placeholder="https://www.youtube.com/@…" onChange={(e) => setLink(e.target.value)} />
            </Field>
            <Button type="submit" variant="brand" data-testid="analysis-start-link" disabled={busy !== null || !link.trim()}>
              {busy === 'link' ? t('analysis.start.busy') : t('analysis.start.go')}
            </Button>
          </form>
          {unavailable && (
            <p role="status" data-testid="analysis-unavailable" className="mt-3 rounded-field border border-warn/30 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
              {t('analysis.start.unavailable', { link: unavailable })}
            </p>
          )}
        </Panel>
      </DemoBoundary>

      <section aria-label={t('analysis.start.refsTitle')} className="flex flex-col gap-3">
        <div>
          <h3 className="micro-label">{t('analysis.start.refsTitle')}</h3>
          <p className="mt-1 text-[12.5px] text-fg-3">{t('analysis.start.refsBlurb')}</p>
        </div>
        {refs.error ? (
          <ErrorLine message={refs.error} onRetry={refs.reload} />
        ) : refs.data === null ? (
          <LoadingBlock rows={3} />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3" data-testid="reference-cards">
            {refs.data.map((r) => (
              <ReferenceCard key={r.id} reference={r} busy={busy === r.id} disabled={busy !== null} onStart={() => void start({ referenceId: r.id }, r.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ReferenceCard({ reference, busy, disabled, onStart }: { reference: ReferenceSummary; busy: boolean; disabled: boolean; onStart: () => void }) {
  return (
    <article data-testid={`reference-${reference.id}`} className="flex flex-col gap-2 rounded-card border border-line bg-surface-1 p-4">
      <h4 className="font-serif text-[22px] leading-tight">{reference.name}</h4>
      <p className="text-[12.5px] text-fg-2">{reference.niche}</p>
      <p className="text-[12px] text-fg-3">{reference.format}</p>
      <p className="text-[12px] text-fg-3">{t('analysis.channel.subs', { subs: fmtInt(reference.subscribers) })}</p>
      <Button variant="outline" size="sm" className="mt-2 self-start" disabled={disabled} data-testid={`start-${reference.id}`} onClick={onStart}>
        {busy ? t('analysis.start.busy') : t('analysis.start.reference')}
      </Button>
    </article>
  )
}
