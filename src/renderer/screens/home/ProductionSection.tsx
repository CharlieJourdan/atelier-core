// "En production": the videos being made, the ones publishing first at the top, each with how far it has come.
import { t } from '../../../shared/fr'
import { ChannelTag, fmtDay, ProgressBar, SectionHead, stageLabel, Thumb } from '@/components/proto/kit'
import { cn } from '@/lib/utils'
import { channelOf, useProto } from '@/proto/store'
import type { ProtoVideo } from '@/proto/types'
import type { Route } from '../../../shared/sections'
import { fmtTime } from '../planning/dates'

const SHOWN = 7

function StatusChip({ video }: { video: ProtoVideo }) {
  if (video.status === 'running') return null
  const label =
    video.status === 'waiting'
      ? (video.waitingFor?.label ?? t('home.dash.status.waiting'))
      : video.status === 'blocked'
        ? (video.waitingFor?.label ?? t('home.dash.status.blocked'))
        : t('home.dash.status.queued')
  const tone = video.status === 'queued' ? 'bg-fg-4' : video.status === 'blocked' ? 'bg-err' : 'bg-warn'
  return (
    <span className="inline-flex max-w-[190px] items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-medium text-fg-2" data-status={video.status}>
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', tone)} />
      <span className="truncate">{label}</span>
    </span>
  )
}

function Row({ video, onOpen }: { video: ProtoVideo; onOpen: () => void }) {
  const state = useProto()
  const channel = channelOf(state, video.channelId)
  const pipeline = state.pipelines.find((p) => p.id === video.pipelineId)
  const when =
    video.publishInDays === null ? t('home.dash.noSlot') : t('home.dash.publishes', { day: fmtDay(video.publishInDays).toLowerCase(), time: fmtTime(video.publishTime) })
  return (
    <li>
      <button
        type="button"
        data-testid="production-row"
        onClick={onOpen}
        className="grid w-full grid-cols-[88px_minmax(0,1fr)_minmax(150px,200px)] items-center gap-x-4 gap-y-1 px-4 py-3 text-left outline-none transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <span className="flex h-[50px] w-[88px] items-center justify-center">
          <Thumb hue={video.thumbHue} format={video.format} className={video.format === 'short' ? 'h-[50px]' : 'w-[88px]'} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-medium text-fg">{video.title}</span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-fg-3">
            <ChannelTag channel={channel} className="shrink-0" />
            <span aria-hidden>·</span>
            <span className="truncate">
              {stageLabel(video.stage)}
              {pipeline ? ` · ${pipeline.name}` : ''}
            </span>
          </span>
          {video.status !== 'running' && (
            <span className="mt-1.5 block">
              <StatusChip video={video} />
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="num font-medium text-fg">{Math.round(video.progress)} %</span>
            <span className="truncate text-fg-3">{when}</span>
          </span>
          <ProgressBar value={video.progress} tone={video.status === 'blocked' ? 'warn' : 'ink'} className="mt-1.5" />
        </span>
      </button>
    </li>
  )
}

export function ProductionSection({ videos, onRoute }: { videos: ProtoVideo[]; onRoute: (r: Route) => void }) {
  const open = () => onRoute({ section: 'production', page: 'apercu' })
  const shown = videos.slice(0, SHOWN)
  return (
    <section data-testid="home-production" aria-label={t('home.dash.production')}>
      <SectionHead
        title={t('home.dash.production')}
        count={videos.length}
        action={
          videos.length > SHOWN ? (
            <button type="button" onClick={open} className="text-[12.5px] font-medium text-fg-3 hover:text-fg">
              {t('home.dash.seeAllN', { n: videos.length })}
            </button>
          ) : undefined
        }
      />
      {videos.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-line-2 px-5 py-8 text-center text-[13px] text-fg-3">{t('home.dash.production.empty')}</div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[16px] border border-line-2 bg-surface-1">
          {shown.map((v) => (
            <Row key={v.id} video={v} onOpen={open} />
          ))}
        </ul>
      )}
    </section>
  )
}
