// Planning: the videos that have no publication slot yet (in real mode, the database's videos without a deadline), as
// a quiet tray above the calendar. « Programmer » opens a date + time picker; the chosen slot goes through
// `updateVideo` (real mode: the video's deadline in the database).
import { CalendarPlus } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../shared/fr'
import { ChannelTag, stageLabel } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { channelOf, useProto, useProtoActions } from '@/proto/store'
import type { ProtoVideo } from '@/proto/types'

const DAY = 86_400_000

function toInputDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Videos to schedule: no slot, not finished-and-published, in the channels shown. */
export function unscheduled(videos: readonly ProtoVideo[], scope: string, hidden: readonly string[]): ProtoVideo[] {
  return videos.filter(
    (v) => v.publishInDays === null && v.stage !== 'published' && (scope === 'all' || v.channelId === scope) && !(v.channelId && hidden.includes(v.channelId))
  )
}

function Row({ video, today }: { video: ProtoVideo; today: Date }) {
  const state = useProto()
  const { updateVideo } = useProtoActions()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(() => toInputDate(new Date(today.getTime() + 2 * DAY)))
  const [time, setTime] = useState('18:00')
  const apply = () => {
    const [y, m, d] = date.split('-').map(Number)
    const day = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
    const days = Math.round((day.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / DAY)
    updateVideo(video.id, { publishInDays: days, publishTime: time })
    setOpen(false)
  }
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 py-2" data-testid={`unscheduled-${video.id}`}>
      <ChannelTag channel={channelOf(state, video.channelId)} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{video.title}</span>
      <span className="shrink-0 text-[12px] text-fg-3">{stageLabel(video.stage)}</span>
      {open ? (
        <span className="flex items-center gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t('planning.tray.date')} className="h-8 w-[150px]" data-testid="unscheduled-date" />
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label={t('planning.tray.time')} className="h-8 w-[104px]" data-testid="unscheduled-time" />
          <Button size="sm" onClick={apply} disabled={!date} data-testid="unscheduled-apply">
            {t('common.save')}
          </Button>
        </span>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid={`unscheduled-open-${video.id}`}>
          <CalendarPlus aria-hidden />
          {t('planning.tray.schedule')}
        </Button>
      )}
    </li>
  )
}

export function UnscheduledTray({ videos, today }: { videos: readonly ProtoVideo[]; today: Date }) {
  const [expanded, setExpanded] = useState(false)
  if (videos.length === 0) return null
  const shown = expanded ? videos : videos.slice(0, 3)
  return (
    <section className="mb-4 rounded-[16px] border border-line-2 bg-surface-1 px-4 py-2" data-testid="planning-unscheduled" aria-label={t('planning.tray.title')}>
      <div className="flex items-center justify-between gap-3 pt-1">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-fg">
          {t('planning.tray.title')} <span className="num ml-1 rounded-full bg-surface-2 px-1.5 py-px text-[11px] font-medium text-fg-3">{videos.length}</span>
        </h2>
        {videos.length > 3 && (
          <button type="button" onClick={() => setExpanded((v) => !v)} className="text-[12px] font-medium text-fg-3 hover:text-fg">
            {expanded ? t('planning.tray.less') : videos.length - 3 === 1 ? t('planning.tray.more.one') : t('planning.tray.more', { n: videos.length - 3 })}
          </button>
        )}
      </div>
      <ul className="divide-y divide-line">
        {shown.map((v) => (
          <Row key={v.id} video={v} today={today} />
        ))}
      </ul>
    </section>
  )
}
