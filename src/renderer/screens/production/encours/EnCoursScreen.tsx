// Production › En cours: the theatre. Runs on the left (active first), the selected run on the right with its live
// nodes and the review of the node waiting at its gate. Everything is read from the real runs (`production.*`).
import { useEffect, useState } from 'react'
import { t } from '../../../../shared/fr'
import type { RunSummary } from '../../../../shared/runs'
import { DemoBadge } from '@/components/atelier/demo'
import { ErrorLine, ExampleBadge, LoadingBlock, fmtDate } from '@/components/atelier/kit'
import { PageShell } from '@/components/atelier/page'
import { EmptyState } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { call, useLoader } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { ACTIVE_STATUSES, RUN_TOPICS, RunStatusChip, focusRun, useFocusedRun } from '../shared'
import { RunDetailView } from './RunDetailView'

function RunItem({ run, selected, onSelect }: { run: RunSummary; selected: boolean; onSelect: () => void }) {
  const active = ACTIVE_STATUSES.includes(run.status)
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        data-testid="run-item"
        className={cn(
          'flex w-full flex-col gap-1.5 rounded-field border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/60',
          selected ? 'border-brand/60 bg-brand-soft' : 'border-line bg-surface-1 hover:bg-surface-2'
        )}
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{run.videoTitle}</span>
          {run.demo && <DemoBadge />}
          {run.example && <ExampleBadge />}
        </span>
        <span className="truncate text-[11.5px] text-fg-3">{run.channelName}</span>
        <span className="flex items-center justify-between gap-2">
          <RunStatusChip status={run.status} />
          <span className="text-[11px] text-fg-3">{fmtDate(run.createdAt)}</span>
        </span>
        {active && <Progress value={Math.round(run.progress * 100)} className="h-1" aria-label={run.videoTitle} />}
      </button>
    </li>
  )
}

export function EnCoursScreen({ onRoute }: ScreenProps) {
  const runs = useLoader(() => call('production.list', { limit: 200 }), 'list', RUN_TOPICS)
  const focused = useFocusedRun()
  const [picked, setPicked] = useState<number | null>(null)

  // a run handed over by the composer or the library is selected once (adjusting state while rendering, not in an effect)
  const [seen, setSeen] = useState<number | null>(null)
  if (focused !== null && focused !== seen) {
    setSeen(focused)
    setPicked(focused)
  }
  useEffect(() => {
    if (focused !== null) focusRun(null) // consumed: coming back later opens the first active run
  }, [focused])

  const all = runs.data ?? []
  const sorted = [...all.filter((r) => ACTIVE_STATUSES.includes(r.status)), ...all.filter((r) => !ACTIVE_STATUSES.includes(r.status))]
  const current = sorted.find((r) => r.id === picked) ?? sorted[0] ?? null

  return (
    <PageShell
      section="production"
      title={t('page.production.encours')}
      subtitle={t('production.live.subtitle')}
      actions={
        <Button variant="brand" size="sm" onClick={() => onRoute({ section: 'production', page: 'nouvelle' })}>
          {t('production.live.new')}
        </Button>
      }
    >
      {runs.error && <ErrorLine message={runs.error} onRetry={runs.reload} />}
      {!runs.data && !runs.error && <LoadingBlock rows={4} />}
      {runs.data && sorted.length === 0 && (
        <EmptyState
          title={t('production.live.empty.title')}
          blurb={t('production.live.empty.blurb')}
          action={
            <Button variant="brand" onClick={() => onRoute({ section: 'production', page: 'nouvelle' })}>
              {t('production.live.new')}
            </Button>
          }
        />
      )}
      {sorted.length > 0 && current && (
        <div className="grid min-h-0 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t('production.live.runs')} data-testid="run-list">
            {sorted.map((r) => (
              <RunItem key={r.id} run={r} selected={r.id === current.id} onSelect={() => setPicked(r.id)} />
            ))}
          </ul>
          <RunDetailView
            key={current.id}
            runId={current.id}
            onRedone={(id) => {
              focusRun(id)
              setPicked(id)
            }}
          />
        </div>
      )}
    </PageShell>
  )
}
