// The side sheet of one video: thumbnail, pipeline, stage stepper, progress, credits, publication slot, and the
// publication kit (download / copy) when the channel posts by hand. Demo: downloads confirm inline, nothing is written.
// Real mode: the kit is the run's real package (livePackage.ts): open its folder, copy its title and description.
import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../../../shared/fr'
import type { Route } from '../../../shared/sections'
import { AgentAvatar, ChannelTag, fmtDay, fmtDuration, fmtNum, ProgressBar, stageLabel, Thumb } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { channelOf, useProto } from '@/proto/store'
import { STAGES, type ProtoVideo } from '@/proto/types'
import { fmtTime } from './dates'
import { appKitApi, runKitAction, useCloudKit, type KitFileAction } from './cloudKit'
import { KitPanel } from './KitPanel'
import { hasThumbnail, packageDescription, useLivePackage } from './livePackage'

function StageStepper({ video }: { video: ProtoVideo }) {
  const current = STAGES.indexOf(video.stage)
  const finished = video.stage === 'published'
  return (
    <ol className="relative" data-testid="stage-stepper">
      {STAGES.map((s, i) => {
        const done = finished || i < current
        const now = !finished && i === current
        return (
          <li key={s} data-state={done ? 'done' : now ? 'current' : 'todo'} className="relative flex items-center gap-3 py-[5px]">
            {i < STAGES.length - 1 && <span aria-hidden className={cn('absolute top-[22px] left-[8px] h-[10px] w-px', done ? 'bg-ink' : 'bg-line-2')} />}
            <span
              aria-hidden
              className={cn(
                'relative z-10 flex size-[17px] shrink-0 items-center justify-center rounded-full border',
                done ? 'border-ink bg-ink text-ink-fg' : now ? 'border-ink bg-bg' : 'border-line-3 bg-bg'
              )}
            >
              {done ? <Check className="size-2.5" strokeWidth={3.4} /> : now ? <span className="size-[7px] rounded-full bg-ink" /> : null}
            </span>
            <span className={cn('text-[13px]', now ? 'font-medium text-fg' : done ? 'text-fg-2' : 'text-fg-3')}>{stageLabel(s)}</span>
            {now && <span className="num ml-auto text-[12px] text-fg-3">{Math.round(video.progress)} %</span>}
          </li>
        )
      })}
    </ol>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-fg-3">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-medium text-fg">{children}</dd>
    </div>
  )
}

export function VideoSheet({ videoId, onClose, onRoute }: { videoId: string; onClose: () => void; onRoute: (r: Route) => void }) {
  const state = useProto()
  const video = state.videos.find((v) => v.id === videoId)
  // what the last kit action did (copied, saved, sent, failed), shown under the buttons for a moment
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [showKit, setShowKit] = useState(false)
  const pkg = useLivePackage(video)
  const ids = pkg && video?.liveRun ? { videoId: video.liveRun.videoId, runId: video.liveRun.runId } : null
  const cloudKit = useCloudKit(ids)

  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(null), 2400)
    return () => window.clearTimeout(id)
  }, [notice])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!video) return null
  const channel = channelOf(state, video.channelId)
  const pipeline = state.pipelines.find((p) => p.id === video.pipelineId)
  const agent = state.agents.find((a) => a.id === video.agentId)
  const mode = channel?.automation.publishing ?? 'human'
  const manual = mode === 'human'
  const kitOpen = manual || showKit
  const stageIdx = STAGES.indexOf(video.stage)
  const rendered = stageIdx >= STAGES.indexOf('ready')
  const packaged = stageIdx >= STAGES.indexOf('packaging')
  const live = video.liveRun !== undefined
  // real mode: the thumbnail is `thumbnail.png` in the run's package folder, when the pipeline has a thumbnail step
  const hasThumb = hasThumbnail(pkg)
  const title = pkg?.title ?? video.title
  const description = pkg ? packageDescription(pkg) : [video.title, video.brief || channel?.niche || '', channel?.handle ?? ''].filter(Boolean).join('\n\n')

  const kitState = cloudKit.state
  const say = (text: string, error = false): void => setNotice({ text, error })
  /** The platform's kit when it is there, else the package folder; a failure is said, never swallowed. */
  const download = (action: KitFileAction): void => {
    if (!ids) return
    runKitAction(appKitApi, ids, kitState, action).then(
      (out) => {
        if (out.via === 'folder') say(t(action === 'thumb' ? 'planning.kit.done.thumb.folder' : 'planning.kit.done.folder'))
        else say(out.dir ? t('planning.kit.cloud.saved', { dir: out.dir }) : t('planning.kit.cloud.savedBrowser'))
      },
      (e: unknown) => say(t('planning.kit.cloud.failed', { message: e instanceof Error ? e.message : String(e) }), true)
    )
  }
  const copy = (what: 'title' | 'description'): void => {
    try {
      void navigator.clipboard?.writeText(what === 'title' ? title : description)
    } catch {
      /* clipboard unavailable: the confirmation still shows */
    }
    say(t(what === 'title' ? 'planning.kit.done.title' : 'planning.kit.done.description'))
  }
  /** Demo videos: nothing is written, the button only confirms. */
  const demo = (what: 'video' | 'thumb'): void => say(t(what === 'video' ? 'planning.kit.done.video' : 'planning.kit.done.thumb'))
  const downloadVideo = (): void => (live ? download('video') : demo('video'))
  const downloadThumb = (): void => (live ? download('thumb') : demo('thumb'))
  const modeLabel = mode === 'auto' ? t('planning.publication.auto') : mode === 'validate' ? t('planning.publication.validate') : t('planning.publication.manual')
  const modeHint = mode === 'auto' ? t('planning.publication.auto.hint') : mode === 'validate' ? t('planning.publication.validate.hint') : t('planning.publication.manual.hint')

  return (
    <aside
      data-testid="planning-sheet"
      aria-label={video.title}
      className="fade-in absolute inset-y-0 right-0 z-40 flex w-[min(400px,100%)] flex-col border-l border-line-2 bg-surface-pop shadow-[var(--shadow-pop)]"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 px-5 pt-4 pb-1">
        <p className="text-[12px] text-fg-3">{video.format === 'short' ? t('format.short') : t('format.long')}</p>
        <button type="button" aria-label={t('common.close')} onClick={onClose} className="flex size-7 items-center justify-center rounded-[8px] text-fg-3 hover:bg-hover hover:text-fg" data-testid="planning-sheet-close">
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <div className="flex justify-center">
          <Thumb hue={video.thumbHue} format={video.format} className={video.format === 'short' ? 'h-[210px]' : 'w-full'} />
        </div>
        <h2 className="mt-4 text-[17px] leading-[1.3] font-semibold tracking-[-0.012em] text-fg">{video.title}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-3">
          <ChannelTag channel={channel} />
          {pipeline && (
            <>
              <span aria-hidden>·</span>
              <span>{pipeline.name}</span>
            </>
          )}
        </div>

        <div className="mt-5">
          <div className="mb-1.5 flex items-baseline justify-between text-[12.5px]">
            <span className="text-fg-3">{t('planning.sheet.progress')}</span>
            <span className="num font-medium text-fg">{Math.round(video.progress)} %</span>
          </div>
          <ProgressBar value={video.progress} tone={video.status === 'blocked' ? 'warn' : 'ink'} />
          {video.waitingFor && (
            <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-fg-2">
              <span aria-hidden className={cn('size-1.5 rounded-full', video.status === 'blocked' ? 'bg-err' : 'bg-warn')} />
              {video.waitingFor.label}
            </p>
          )}
        </div>

        <div className="mt-5">
          <StageStepper video={video} />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3.5 border-t border-line pt-4">
          <Fact label={t('planning.sheet.publication')}>
            {video.publishInDays === null ? t('home.dash.noSlot') : `${fmtDay(video.publishInDays)} · ${fmtTime(video.publishTime)}`}
          </Fact>
          <Fact label={t('planning.sheet.render')}>{fmtDay(video.dueInDays)}</Fact>
          <Fact label={t('planning.sheet.credits')}>
            <span className="num">
              {fmtNum(video.creditsSpent)} / {fmtNum(video.creditsEstimate)}
            </span>
          </Fact>
          <Fact label={t('planning.sheet.duration')}>{video.durationSec > 0 ? <span className="num">{fmtDuration(video.durationSec)}</span> : t('planning.sheet.durationTbd')}</Fact>
          {agent && (
            <div className="col-span-2 flex items-center gap-2 text-[12.5px] text-fg-2">
              <AgentAvatar agent={agent} size={20} />
              <span className="min-w-0 truncate">{t('planning.sheet.carriedBy', { name: agent.name })}</span>
            </div>
          )}
        </dl>

        <section className="mt-5 rounded-[12px] border border-line-2 bg-surface-1 p-3.5" data-testid="publication-block" data-mode={mode}>
          <p className="text-[13px] font-medium text-fg">{modeLabel}</p>
          <p className="mt-0.5 text-[12.5px] leading-[1.45] text-fg-3">{modeHint}</p>
          {!manual && (
            <button type="button" onClick={() => setShowKit((s) => !s)} aria-expanded={kitOpen} className="mt-2 text-[12.5px] font-medium text-fg-2 underline-offset-4 hover:text-fg hover:underline">
              {kitOpen ? t('planning.kit.hide') : t('planning.kit.show')}
            </button>
          )}
          {kitOpen && (
            <KitPanel
              live={live}
              packageReady={pkg !== null}
              localThumb={hasThumb}
              rendered={rendered}
              packaged={packaged}
              kit={kitState}
              sending={cloudKit.sending}
              notice={notice}
              onVideo={downloadVideo}
              onThumb={downloadThumb}
              onAll={() => download('all')}
              onFolder={() => {
                if (!ids) return
                appKitApi.reveal(ids.runId).then(
                  () => say(t('planning.kit.done.folder')),
                  (e: unknown) => say(e instanceof Error ? e.message : String(e), true)
                )
              }}
              onSend={() => void cloudKit.send().then((err) => (err ? say(err, true) : say(t('planning.kit.cloud.sent'))))}
              onCopyTitle={() => copy('title')}
              onCopyDescription={() => copy('description')}
            />
          )}
        </section>
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-5 py-3">
        <p className="text-[12px] text-fg-3">{t('planning.sheet.dragHint')}</p>
        <Button size="sm" variant="outline" onClick={() => onRoute({ section: 'production', page: 'apercu' })}>
          {t('planning.sheet.openProduction')}
        </Button>
      </footer>
    </aside>
  )
}
