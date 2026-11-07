// The blocks drawn on the planning: a publication (one video), a stack (several videos of one channel on one day,
// fanned like a pile of cards, expandable) and a render-deadline marker (dashed outline).
import { Check } from 'lucide-react'
import type { DragEvent } from 'react'
import { t } from '../../../shared/fr'
import { fmtTime } from './dates'
import { ProgressBar, stageLabel } from '@/components/proto/kit'
import { cn } from '@/lib/utils'
import { channelColorVar } from '@/proto/store'
import type { ProtoVideo } from '@/proto/types'
import { EVENT_H, type PlanGroup, type PlanItem, type RenderDeadline } from './planning-model'

export interface DragHandlers {
  onDragStart: (e: DragEvent<HTMLElement>, ids: string[]) => void
  onDragEnd: () => void
}

function isDone(v: ProtoVideo): boolean {
  return v.stage === 'published'
}

function Rule({ color }: { color: string }) {
  return <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />
}

function ProgressLine({ video }: { video: ProtoVideo }) {
  if (isDone(video)) {
    return (
      <span className="mt-auto flex shrink-0 items-center gap-1 text-[11px] text-fg-3">
        <Check className="size-3" aria-hidden />
        {stageLabel('published')}
      </span>
    )
  }
  return (
    <span className="mt-auto flex shrink-0 items-center gap-2">
      <ProgressBar value={video.progress} className="h-[3px] flex-1" tone={video.status === 'blocked' ? 'warn' : 'ink'} />
      <span className="num shrink-0 text-[10.5px] text-fg-3">{Math.round(video.progress)} %</span>
    </span>
  )
}

export function EventCard({
  item,
  selected,
  testId,
  onSelect,
  drag
}: {
  item: PlanItem
  selected: boolean
  testId?: string
  onSelect: () => void
  drag: DragHandlers
}) {
  const v = item.video
  return (
    <button
      type="button"
      draggable
      data-testid={testId}
      data-event="single"
      data-video={v.id}
      aria-pressed={selected}
      onClick={onSelect}
      onDragStart={(e) => drag.onDragStart(e, [v.id])}
      onDragEnd={drag.onDragEnd}
      className={cn(
        'relative flex w-full cursor-grab flex-col overflow-hidden rounded-[8px] border bg-surface-1 py-1.5 pr-2 pl-3 text-left outline-none transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing',
        selected ? 'border-ink ring-1 ring-ink' : 'border-line-2',
        isDone(v) && 'opacity-65'
      )}
      style={{ height: EVENT_H }}
    >
      <Rule color={channelColorVar(item.channel)} />
      <span className="block shrink-0 truncate text-[12px] leading-[15px] font-medium text-fg">{v.title}</span>
      <span className="block shrink-0 truncate text-[11px] leading-[14px] text-fg-3">
        {item.channel?.name ?? '—'} · {stageLabel(v.stage)}
      </span>
      <ProgressLine video={v} />
    </button>
  )
}

export function StackCard({
  group,
  open,
  selectedId,
  onToggle,
  onSelect,
  drag
}: {
  group: PlanGroup
  open: boolean
  selectedId: string | null
  onToggle: () => void
  onSelect: (videoId: string) => void
  drag: DragHandlers
}) {
  const n = group.items.length
  const color = channelColorVar(group.channel)
  const label = group.format === 'short' ? t('planning.stack.shorts', { n }) : t('planning.stack.videos', { n })
  const allDone = group.items.every((i) => isDone(i.video))
  return (
    <div className="relative" style={{ height: EVENT_H }} data-event="stack" data-count={n}>
      {!open && (
        <>
          <span aria-hidden className="absolute inset-x-2 top-2 bottom-0 rounded-[8px] border border-line bg-surface-2" />
          <span aria-hidden className="absolute inset-x-1 top-1 bottom-1 rounded-[8px] border border-line-2 bg-surface-1 opacity-90" />
        </>
      )}
      <button
        type="button"
        draggable
        aria-expanded={open}
        data-testid="planning-stack"
        onClick={onToggle}
        onDragStart={(e) => drag.onDragStart(e, group.items.map((i) => i.video.id))}
        onDragEnd={drag.onDragEnd}
        className={cn(
          'absolute inset-x-0 top-0 flex cursor-grab flex-col overflow-hidden rounded-[8px] border border-line-2 bg-surface-1 py-1.5 pr-2 pl-3 text-left outline-none transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing',
          allDone && 'opacity-65'
        )}
        style={{ height: EVENT_H - 8 }}
      >
        <Rule color={color} />
        <span className="flex shrink-0 items-baseline justify-between gap-2">
          <span className="truncate text-[12px] leading-[15px] font-medium text-fg">{label}</span>
          <span className="num shrink-0 text-[10.5px] text-fg-3">{fmtTime(group.items[0]?.video.publishTime ?? '12:00')}</span>
        </span>
        <span className="block shrink-0 truncate text-[11px] leading-[14px] text-fg-3">{group.channel?.name ?? '—'}</span>
        <ProgressBar value={group.progress} className="mt-auto h-[3px] shrink-0" />
      </button>
      {open && (
        <div
          role="list"
          data-testid="planning-stack-list"
          className="absolute top-0 left-0 z-30 w-[max(100%,236px)] overflow-hidden rounded-[12px] border border-line-2 bg-surface-pop shadow-[var(--shadow-pop)]"
        >
          <button type="button" onClick={onToggle} className="relative flex w-full items-center justify-between gap-2 border-b border-line py-1.5 pr-2.5 pl-3 text-left hover:bg-hover">
            <Rule color={color} />
            <span className="truncate text-[12px] font-medium text-fg">{label}</span>
            <span className="truncate text-[11px] text-fg-3">{group.channel?.name}</span>
          </button>
          {group.items.map((it) => (
            <button
              key={it.video.id}
              type="button"
              role="listitem"
              data-video={it.video.id}
              aria-pressed={selectedId === it.video.id}
              onClick={() => onSelect(it.video.id)}
              className={cn('flex w-full flex-col gap-1 border-b border-line px-3 py-1.5 text-left last:border-b-0 hover:bg-hover', selectedId === it.video.id && 'bg-selected')}
            >
              <span className="flex items-baseline gap-2">
                <span className="num shrink-0 text-[11px] text-fg-3">{fmtTime(it.video.publishTime)}</span>
                <span className="truncate text-[12px] font-medium text-fg">{it.video.title}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="shrink-0 text-[11px] text-fg-3">{stageLabel(it.video.stage)}</span>
                <ProgressBar value={it.video.progress} className="h-[3px] flex-1" />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** « Rendu » marker: a dashed outline in the all-day row (the video is due, not published). */
export function RenderChip({ deadline, onSelect }: { deadline: RenderDeadline; onSelect: () => void }) {
  const n = deadline.videos.length
  const first = deadline.videos[0] as ProtoVideo
  return (
    <button
      type="button"
      data-testid="planning-render"
      data-count={n}
      onClick={onSelect}
      title={n === 1 ? first.title : t('planning.renders', { n })}
      className="flex h-[22px] w-full min-w-0 items-center gap-1.5 rounded-[6px] border border-dashed border-line-3 px-1.5 text-left text-[11px] text-fg-2 outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: channelColorVar(deadline.channel) }} />
      <span className="truncate">{n === 1 ? first.title : t('planning.renders', { n })}</span>
    </button>
  )
}
