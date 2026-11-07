// The week view: seven day columns, an all-day row for render deadlines, an hour grid from 8 h to midnight, a thin
// "now" line, publications as events (same-channel videos of one day stacked), drag to move.
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { t } from '../../../shared/fr'
import { cn } from '@/lib/utils'
import { addDays, diffDays, fmtWeekdayShort, sameDay } from './dates'
import { EventCard, RenderChip, StackCard, type DragHandlers } from './Events'
import { GRID_H, HOUR_END, HOUR_H, HOUR_START, layoutDay, minutesAt, nowOffset, type PlanGroup, type PlanItem, type RenderDeadline } from './planning-model'

const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i)
const MAX_RENDER_CHIPS = 2

export interface WeekViewProps {
  start: Date
  today: Date
  now: Date
  groups: PlanGroup[]
  deadlines: RenderDeadline[]
  selectedId: string | null
  onSelect: (videoId: string) => void
  onMove: (ids: string[], dayOffset: number, minutes: number | null) => void
}

export function WeekView({ start, today, now, groups, deadlines, selectedId, onSelect, onMove }: WeekViewProps) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const [openStack, setOpenStack] = useState<string | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const dragRef = useRef<{ ids: string[]; grab: number; single: boolean } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  // Open on the working day: the grid starts at 10 h so the midday slots and the evening ones are both in sight.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 2 * HOUR_H - 24
  }, [])

  // The one single event that gets the stable test id (screenshots and e2e click it).
  const firstSingle = groups.find((g) => g.items.length === 1 && g.items[0]?.video.status === 'running' && g.items[0].video.stage !== 'published')
  const firstId = firstSingle?.items[0]?.video.id ?? null

  const drag: DragHandlers = {
    onDragStart: (e, ids) => {
      const rect = e.currentTarget.getBoundingClientRect()
      dragRef.current = { ids, grab: e.clientY - rect.top, single: ids.length === 1 }
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', ids.join(','))
    },
    onDragEnd: () => {
      dragRef.current = null
      setOver(null)
    }
  }

  const todayIdx = days.findIndex((d) => sameDay(d, now))
  const line = nowOffset(now)

  const onDragOver = (e: DragEvent, offset: number) => {
    if (!dragRef.current || offset < 0) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOver(offset)
  }
  const onDrop = (e: DragEvent<HTMLElement>, offset: number) => {
    const d = dragRef.current
    dragRef.current = null
    setOver(null)
    if (!d || offset < 0) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    onMove(d.ids, offset, d.single ? minutesAt(e.clientY - rect.top - d.grab) : null)
  }

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-auto rounded-[16px] border border-line-2 bg-bg" data-testid="planning-week">
      <div className="min-w-[860px]">
        {/* header: days + all-day row */}
        <div className="sticky top-0 z-20 border-b border-line-2 bg-bg">
          <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))]">
            <div />
            {days.map((d, i) => {
              const isToday = sameDay(d, today)
              return (
                <div key={i} className="flex items-center gap-2 border-l border-line px-3 py-2" data-day={diffDays(today, d)}>
                  <span className={cn('text-[12px] font-medium', isToday ? 'text-fg' : 'text-fg-3')}>{fmtWeekdayShort(d)}</span>
                  <span
                    className={cn(
                      'num flex size-7 items-center justify-center rounded-full text-[14px] font-medium',
                      isToday ? 'bg-brand text-brand-ink' : 'text-fg'
                    )}
                    data-today={isToday || undefined}
                  >
                    {d.getDate()}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))] border-t border-line">
            <div className="flex items-start justify-end pt-2 pr-2 text-[10.5px] text-fg-3">{t('planning.legend.render')}</div>
            {days.map((d, i) => {
              const offset = diffDays(today, d)
              const list = deadlines.filter((x) => x.dayOffset === offset)
              return (
                <div key={i} className="min-h-[34px] space-y-1 border-l border-line p-1" data-testid="planning-renders">
                  {list.slice(0, MAX_RENDER_CHIPS).map((x) => (
                    <RenderChip key={x.key} deadline={x} onSelect={() => onSelect((x.videos[0] as { id: string }).id)} />
                  ))}
                  {list.length > MAX_RENDER_CHIPS && <p className="px-1.5 text-[11px] text-fg-3">{t('planning.more', { n: list.length - MAX_RENDER_CHIPS })}</p>}
                </div>
              )
            })}
          </div>
        </div>

        {/* hour grid */}
        <div className="relative grid grid-cols-[52px_repeat(7,minmax(0,1fr))]" style={{ height: GRID_H }}>
          <div className="relative">
            {HOURS.map((h, i) => (
              <span key={h} className="num absolute right-2 -translate-y-1/2 text-[10.5px] text-fg-3" style={{ top: i * HOUR_H + (i === 0 ? 8 : 0) }}>
                {i === 0 ? '' : `${h} h`}
              </span>
            ))}
          </div>
          {days.map((d, i) => {
            const offset = diffDays(today, d)
            const placed = layoutDay(groups.filter((g) => g.dayOffset === offset))
            const isToday = i === todayIdx
            return (
              <div
                key={i}
                data-testid="planning-day"
                data-offset={offset}
                onDragOver={(e) => onDragOver(e, offset)}
                onDragLeave={() => over === offset && setOver(null)}
                onDrop={(e) => onDrop(e, offset)}
                className={cn('relative border-l border-line', over === offset && 'bg-hover', offset < 0 && 'bg-surface-0/40')}
                style={{ backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 55px, var(--line) 55px, var(--line) 56px)' }}
              >
                {isToday && line !== null && (
                  <div aria-hidden className="pointer-events-none absolute right-0 left-0 z-10 flex items-center" style={{ top: line }} data-testid="planning-now">
                    <span className="-ml-[4px] size-2 rounded-full bg-brand" />
                    <span className="h-px flex-1 bg-brand" />
                  </div>
                )}
                {placed.map(({ group, lane, lanes, top }) => {
                  const w = 100 / lanes
                  const single = group.items.length === 1
                  const item = group.items[0] as PlanItem
                  const open = openStack === group.key
                  return (
                    <div
                      key={group.key}
                      className={cn('absolute px-1', open && 'z-30')}
                      style={{ top, left: `${lane * w}%`, width: `${w}%` }}
                    >
                      {single ? (
                        <EventCard
                          item={item}
                          selected={selectedId === item.video.id}
                          testId={item.video.id === firstId ? 'planning-event-first' : undefined}
                          onSelect={() => onSelect(item.video.id)}
                          drag={drag}
                        />
                      ) : (
                        <StackCard
                          group={group}
                          open={open}
                          selectedId={selectedId}
                          onToggle={() => setOpenStack(open ? null : group.key)}
                          onSelect={(id) => {
                            setOpenStack(null)
                            onSelect(id)
                          }}
                          drag={drag}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
