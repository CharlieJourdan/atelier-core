// Planning (route `planning`): a Google-Calendar-like schedule of the videos. Week (default) and month views, channel
// filters on top of the global scope, a side sheet per video, drag a video to another day to reschedule it.
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { t } from '../../../shared/fr'
import { cn } from '@/lib/utils'
import { channelColorVar, useProto, useProtoActions } from '@/proto/store'
import type { ScreenProps } from '../registry'
import { addDays, fmtMonthYear, fmtRange, startOfDay } from './dates'
import { MonthView } from './MonthView'
import { groupItems, planItems, renderDeadlines } from './planning-model'
import { VideoSheet } from './VideoSheet'
import { WeekView } from './WeekView'
import { UnscheduledTray, unscheduled } from './UnscheduledTray'

type Mode = 'week' | 'month'

/** The week view opens on yesterday so the last publications stay in sight and today is the second column. */
const WEEK_LEAD = 1

function ViewToggle({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const options: { value: Mode; label: string }[] = [
    { value: 'week', label: t('planning.view.week') },
    { value: 'month', label: t('planning.view.month') }
  ]
  return (
    <div role="radiogroup" aria-label={t('planning.view')} className="inline-flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5" data-testid="planning-view">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-testid={`planning-view-${o.value}`}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-8 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
              on ? 'bg-surface-pop text-fg shadow-[var(--shadow-1)] ring-1 ring-line-2' : 'text-fg-3 hover:text-fg'
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function NavButton({ label, onClick, testId, children }: { label: string; onClick: () => void; testId: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={testId}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-full text-fg-2 outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
    >
      {children}
    </button>
  )
}

export function PlanningScreen({ onRoute, now: nowProp }: ScreenProps & { now?: Date }) {
  const state = useProto()
  const { updateVideo } = useProtoActions()
  const [clock, setClock] = useState(() => nowProp ?? new Date())
  useEffect(() => {
    if (nowProp) return
    const id = window.setInterval(() => setClock(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [nowProp])
  const now = nowProp ?? clock
  const today = startOfDay(now)

  const [mode, setMode] = useState<Mode>('week')
  const [weekStart, setWeekStart] = useState(() => addDays(today, -WEEK_LEAD))
  const [monthAnchor, setMonthAnchor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [hidden, setHidden] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)

  const scopeChannels = state.scope === 'all' ? state.channels : state.channels.filter((c) => c.id === state.scope)
  const items = useMemo(() => planItems(state.videos, state.channels, state.scope, hidden), [state.videos, state.channels, state.scope, hidden])
  const groups = useMemo(() => groupItems(items), [items])
  const deadlines = useMemo(() => renderDeadlines(state.videos, state.scope, hidden, state.channels), [state.videos, state.scope, hidden, state.channels])

  const goToday = () => {
    setWeekStart(addDays(today, -WEEK_LEAD))
    setMonthAnchor(new Date(today.getFullYear(), today.getMonth(), 1))
  }
  const shift = (dir: 1 | -1) => {
    if (mode === 'week') setWeekStart((d) => addDays(d, 7 * dir))
    else setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() + dir, 1))
  }
  const label = mode === 'week' ? fmtRange(weekStart, addDays(weekStart, 6)) : fmtMonthYear(monthAnchor)

  const toggle = (id: string) => setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]))
  const select = (id: string) => setSelected((s) => (s === id ? null : id))

  /** Drag and drop: new day for every moved video; a single video also takes the dropped time. */
  const move = (ids: string[], dayOffset: number, minutes: number | null) => {
    for (const id of ids) {
      const patch: { publishInDays: number; publishTime?: string } = { publishInDays: dayOffset }
      if (minutes !== null) patch.publishTime = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
      updateVideo(id, patch)
    }
  }

  return (
    <section data-testid="view-planning" className="relative flex h-full min-h-0 flex-col">
      <div className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col px-8 pt-6 pb-6">
        <header className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="page-title mr-2">{t('section.planning')}</h1>
          <button
            type="button"
            data-testid="planning-today"
            onClick={goToday}
            className="h-8 rounded-full border border-line-2 px-3.5 text-[13px] font-medium text-fg outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring"
          >
            {t('common.today')}
          </button>
          <div className="flex items-center">
            <NavButton label={t('planning.prev')} testId="planning-prev" onClick={() => shift(-1)}>
              <ChevronLeft className="size-4" aria-hidden />
            </NavButton>
            <NavButton label={t('planning.next')} testId="planning-next" onClick={() => shift(1)}>
              <ChevronRight className="size-4" aria-hidden />
            </NavButton>
          </div>
          <p className="text-[15px] font-semibold tracking-[-0.014em] text-fg" data-testid="planning-label" aria-live="polite">
            {label}
          </p>
          <div className="ml-auto flex items-center gap-4">
            <ul className="hidden items-center gap-3 text-[12px] text-fg-3 lg:flex" aria-label={t('planning.legend')}>
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="h-3 w-[3px] rounded-full bg-fg-2" />
                {t('planning.legend.publish')}
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="h-3 w-5 rounded-[4px] border border-dashed border-line-3" />
                {t('planning.legend.render')}
              </li>
            </ul>
            <ViewToggle value={mode} onChange={setMode} />
          </div>
        </header>

        <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label={t('planning.filters')}>
          {scopeChannels.map((c) => {
            const on = !hidden.includes(c.id)
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                data-testid={`planning-chip-${c.id}`}
                onClick={() => toggle(c.id)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-medium outline-none transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                  on ? 'border-line-3 bg-selected text-fg' : 'border-line-2 text-fg-3 hover:text-fg'
                )}
              >
                <span aria-hidden className={cn('size-2 rounded-full', !on && 'opacity-40')} style={{ background: channelColorVar(c) }} />
                {c.name}
              </button>
            )
          })}
        </div>

        <UnscheduledTray videos={unscheduled(state.videos, state.scope, hidden)} today={today} />

        <div className="relative flex min-h-0 flex-1 flex-col">
          {mode === 'week' ? (
            <WeekView start={weekStart} today={today} now={now} groups={groups} deadlines={deadlines} selectedId={selected} onSelect={select} onMove={move} />
          ) : (
            <MonthView anchor={monthAnchor} today={today} groups={groups} deadlines={deadlines} selectedId={selected} onSelect={select} onMove={move} />
          )}
          {selected && <VideoSheet key={selected} videoId={selected} onClose={() => setSelected(null)} onRoute={onRoute} />}
        </div>
      </div>
    </section>
  )
}
