// The month view: a classic Monday-first grid, up to three chips a day and "+N". A stack of same-channel videos is one
// chip ("3 shorts") that opens into its videos; render deadlines are dashed chips. Days accept a dropped video.
import { useState, type DragEvent } from 'react'
import { t } from '../../../shared/fr'
import { cn } from '@/lib/utils'
import { channelColorVar } from '@/proto/store'
import { diffDays, fmtWeekdayShort, monthGrid, sameDay } from './dates'
import type { PlanGroup, RenderDeadline } from './planning-model'

const MAX_CHIPS = 3

type Chip =
  | { kind: 'group'; key: string; group: PlanGroup }
  | { kind: 'video'; key: string; group: PlanGroup; videoId: string; title: string }
  | { kind: 'render'; key: string; deadline: RenderDeadline }

export interface MonthViewProps {
  anchor: Date
  today: Date
  groups: PlanGroup[]
  deadlines: RenderDeadline[]
  selectedId: string | null
  onSelect: (videoId: string) => void
  onMove: (ids: string[], dayOffset: number, minutes: number | null) => void
}

function chipsOf(groups: PlanGroup[], deadlines: RenderDeadline[], openGroups: string[]): Chip[] {
  const out: Chip[] = []
  for (const g of groups) {
    if (g.items.length === 1 || openGroups.includes(g.key)) {
      for (const it of g.items) out.push({ kind: 'video', key: it.video.id, group: g, videoId: it.video.id, title: it.video.title })
    } else out.push({ kind: 'group', key: g.key, group: g })
  }
  for (const d of deadlines) out.push({ kind: 'render', key: `r-${d.key}`, deadline: d })
  return out
}

function ChipView({ chip, selectedId, onSelect, onToggle, onDragStart }: { chip: Chip; selectedId: string | null; onSelect: (id: string) => void; onToggle: (key: string) => void; onDragStart: (e: DragEvent, ids: string[]) => void }) {
  if (chip.kind === 'render') {
    const n = chip.deadline.videos.length
    const first = chip.deadline.videos[0]
    return (
      <button
        type="button"
        data-testid="planning-render"
        onClick={() => first && onSelect(first.id)}
        className="flex h-[22px] w-full min-w-0 items-center gap-1.5 rounded-[6px] border border-dashed border-line-3 px-1.5 text-left text-[11px] text-fg-2 hover:bg-hover"
      >
        <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: channelColorVar(chip.deadline.channel) }} />
        <span className="truncate">{n === 1 && first ? first.title : t('planning.renders', { n })}</span>
      </button>
    )
  }
  const color = channelColorVar(chip.group.channel)
  const done = chip.group.items.every((i) => i.video.stage === 'published')
  if (chip.kind === 'group') {
    const n = chip.group.items.length
    return (
      <button
        type="button"
        draggable
        data-testid="planning-stack"
        onClick={() => onToggle(chip.group.key)}
        onDragStart={(e) => onDragStart(e, chip.group.items.map((i) => i.video.id))}
        className={cn('relative flex h-[22px] w-full min-w-0 items-center overflow-hidden rounded-[6px] border border-line-2 bg-surface-2 pl-3 pr-1.5 text-left text-[11.5px] font-medium text-fg hover:bg-hover', done && 'opacity-65')}
      >
        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />
        <span className="truncate">{chip.group.format === 'short' ? t('planning.stack.shorts', { n }) : t('planning.stack.videos', { n })}</span>
      </button>
    )
  }
  return (
    <button
      type="button"
      draggable
      data-event="single"
      data-video={chip.videoId}
      onClick={() => onSelect(chip.videoId)}
      onDragStart={(e) => onDragStart(e, [chip.videoId])}
      className={cn(
        'relative flex h-[22px] w-full min-w-0 items-center overflow-hidden rounded-[6px] border bg-surface-2 pl-3 pr-1.5 text-left text-[11.5px] text-fg hover:bg-hover',
        selectedId === chip.videoId ? 'border-ink' : 'border-line',
        chip.group.items.every((i) => i.video.stage === 'published') && 'opacity-65'
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />
      <span className="truncate">{chip.title}</span>
    </button>
  )
}

export function MonthView({ anchor, today, groups, deadlines, selectedId, onSelect, onMove }: MonthViewProps) {
  const grid = monthGrid(anchor)
  const [openGroups, setOpenGroups] = useState<string[]>([])
  const [openDays, setOpenDays] = useState<number[]>([])
  const [over, setOver] = useState<number | null>(null)
  const [dragIds, setDragIds] = useState<string[] | null>(null)
  const weekdays = grid.slice(0, 7)

  const toggleGroup = (key: string) => setOpenGroups((o) => (o.includes(key) ? o.filter((k) => k !== key) : [...o, key]))

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-[16px] border border-line-2 bg-bg" data-testid="planning-month">
      <div className="flex min-h-full min-w-[760px] flex-col">
        <div className="sticky top-0 z-10 grid grid-cols-7 border-b border-line-2 bg-bg">
          {weekdays.map((d, i) => (
            <div key={i} className={cn('px-3 py-2 text-[12px] font-medium text-fg-3', i > 0 && 'border-l border-line')}>
              {fmtWeekdayShort(d)}
            </div>
          ))}
        </div>
        <div className="grid flex-1 auto-rows-fr grid-cols-7">
          {grid.map((d, i) => {
            const offset = diffDays(today, d)
            const inMonth = d.getMonth() === anchor.getMonth()
            const isToday = sameDay(d, today)
            const chips = chipsOf(
              groups.filter((g) => g.dayOffset === offset),
              deadlines.filter((x) => x.dayOffset === offset),
              openGroups
            )
            const expanded = openDays.includes(offset)
            const shown = expanded ? chips : chips.slice(0, MAX_CHIPS)
            return (
              <div
                key={i}
                data-testid="planning-cell"
                data-offset={offset}
                onDragOver={(e) => {
                  if (dragIds && offset >= 0) {
                    e.preventDefault()
                    setOver(offset)
                  }
                }}
                onDragLeave={() => over === offset && setOver(null)}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragIds && offset >= 0) onMove(dragIds, offset, null)
                  setDragIds(null)
                  setOver(null)
                }}
                className={cn('min-h-[112px] min-w-0 border-b border-line p-1.5', i % 7 > 0 && 'border-l', !inMonth && 'bg-surface-0/50', over === offset && 'bg-hover')}
              >
                <div className="mb-1 flex items-center justify-between px-0.5">
                  <span
                    className={cn(
                      'num flex size-6 items-center justify-center rounded-full text-[12.5px]',
                      isToday ? 'bg-brand font-medium text-brand-ink' : inMonth ? 'text-fg' : 'text-fg-3'
                    )}
                    data-today={isToday || undefined}
                  >
                    {d.getDate()}
                  </span>
                </div>
                <div className="space-y-1">
                  {shown.map((c) => (
                    <ChipView
                      key={c.key}
                      chip={c}
                      selectedId={selectedId}
                      onSelect={onSelect}
                      onToggle={toggleGroup}
                      onDragStart={(e, ids) => {
                        setDragIds(ids)
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', ids.join(','))
                      }}
                    />
                  ))}
                  {!expanded && chips.length > MAX_CHIPS && (
                    <button type="button" onClick={() => setOpenDays((o) => [...o, offset])} className="px-1.5 text-[11.5px] font-medium text-fg-3 hover:text-fg">
                      {t('planning.more', { n: chips.length - MAX_CHIPS })}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

