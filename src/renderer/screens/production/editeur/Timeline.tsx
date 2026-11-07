// The timeline of an edit plan, read-only: ruler with chapters, tracks (voice with its waveform, visuals with the
// stills, captions, music) and a playhead you can drag; « Lecture » plays the run's voice along the playhead.
import { Pause, Play } from 'lucide-react'
import { useRef, useState } from 'react'
import { t } from '../../../../shared/fr'
import type { RunFileRef, RunOutput, RunPlanShot } from '../../../../shared/runs'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Still } from '../encours/Reviews'
import { fmtClock } from '../shared'
import { PEAKS, type Voice } from './useVoice'

type Plan = Extract<RunOutput, { kind: 'editplan' }>

export interface TimelineProps {
  runId: number
  plan: Plan
  voice: Voice
  voiceDurationS: number | null
  /** Still of each generated item (`itemId` → file). */
  stills: Map<string, RunFileRef>
  captions: { preset: string | null; cues: number; burn: boolean } | null
  music: { durationS: number | null } | null
}

const pct = (s: number, total: number): number => (total > 0 ? Math.min(100, Math.max(0, (s / total) * 100)) : 0)
const MAX_THUMBS = 60

function Waveform({ peaks, widthPct }: { peaks: number[]; widthPct: number }) {
  const bw = 100 / PEAKS
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-full" style={{ width: `${widthPct}%` }} role="img" aria-label={t('production.editor.waveform')} data-testid="waveform">
      {peaks.map((p, i) => {
        const h = Math.max(1, p * 36)
        return <rect key={i} x={i * bw} y={20 - h / 2} width={bw * 0.7} height={h} rx={0.3} className="fill-brand" />
      })}
    </svg>
  )
}

function TrackRow({ label, children, height = 44 }: { label: string; children: React.ReactNode; height?: number }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] items-stretch gap-3">
      <span className="micro-label self-center">{label}</span>
      <div className="relative overflow-hidden rounded-field border border-line bg-surface-2" style={{ height }}>
        {children}
      </div>
    </div>
  )
}

function ShotBlock({ runId, shot, total, still, thumb }: { runId: number; shot: RunPlanShot; total: number; still: RunFileRef | undefined; thumb: boolean }) {
  const left = pct(shot.start, total)
  const width = Math.max(0.4, pct(shot.end, total) - left)
  return (
    <div
      className="absolute inset-y-0.5 overflow-hidden rounded-chip border border-line-3 bg-surface-pop"
      style={{ left: `${left}%`, width: `${width}%` }}
      title={`${shot.kind} · ${fmtClock(shot.start)}–${fmtClock(shot.end)} · ${shot.label}`}
      data-testid="shot"
    >
      {still && thumb ? <Still runId={runId} file={still} alt={shot.label} /> : <span className="block truncate px-1 text-[10px] leading-4 text-fg-3">{shot.kind}</span>}
    </div>
  )
}

export function Timeline({ runId, plan, voice, voiceDurationS, stills, captions, music }: TimelineProps) {
  const total = plan.durationS
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const audio = useRef<HTMLAudioElement>(null)
  const area = useRef<HTMLDivElement>(null)

  const seekTo = (clientX: number): void => {
    const r = area.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    const s = Math.min(total, Math.max(0, ((clientX - r.left) / r.width) * total))
    setTime(s)
    if (audio.current) audio.current.currentTime = s
  }
  const lanes: ('base' | 'overlay' | 'labels')[] = ['base', 'overlay', 'labels']
  const visual = lanes.filter((l) => plan.shots.some((s) => s.track === l))
  let thumbs = 0
  const here = plan.shots.filter((s) => time >= s.start && time < s.end)
  const tick = total > 600 ? 120 : total > 180 ? 30 : total > 60 ? 10 : 5
  const ticks = Array.from({ length: Math.floor(total / tick) + 1 }, (_, i) => i * tick)

  return (
    <div className="flex flex-col gap-3" data-testid="timeline">
      <div className="flex items-center gap-3">
        <Button
          variant="default"
          size="icon"
          disabled={!voice.url}
          aria-label={playing ? t('production.editor.pause') : t('production.editor.play')}
          onClick={() => {
            const a = audio.current
            if (!a) return
            if (playing) a.pause()
            else void a.play()
          }}
        >
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
        <span className="font-mono text-[13px] text-fg tabular-nums" data-testid="clock">
          {fmtClock(time)} / {fmtClock(total)}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.round(total * 10))}
          value={Math.round(time * 10)}
          onChange={(e) => {
            const s = Number(e.target.value) / 10
            setTime(s)
            if (audio.current) audio.current.currentTime = s
          }}
          aria-label={t('production.editor.playhead')}
          className="ml-auto w-48 accent-brand"
        />
        {voice.url && (
          <audio
            ref={audio}
            src={voice.url}
            preload="auto"
            className="hidden"
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
        )}
      </div>
      <div className="relative flex flex-col gap-2">
        <div ref={area} className="absolute top-0 right-0 bottom-0 left-[104px] z-10 cursor-col-resize" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seekTo(e.clientX) }} onPointerMove={(e) => { if (e.buttons === 1) seekTo(e.clientX) }}>
          <div className="pointer-events-none absolute inset-y-0 w-px bg-brand" style={{ left: `${pct(time, total)}%` }} data-testid="playhead" />
        </div>
        <TrackRow label={t('production.editor.ruler')} height={28}>
          {ticks.map((s) => (
            <span key={s} className="absolute top-1 -translate-x-px border-l border-line-3 pl-1 font-mono text-[10px] text-fg-3" style={{ left: `${pct(s, total)}%` }}>
              {fmtClock(s)}
            </span>
          ))}
          {plan.chapters.map((c) => (
            <span key={`${c.start}-${c.title}`} className="absolute bottom-0 h-1.5 w-1.5 rounded-full bg-warn" style={{ left: `${pct(c.start, total)}%` }} title={`${fmtClock(c.start)} ${c.title}`} />
          ))}
        </TrackRow>
        <TrackRow label={t('production.editor.voice')}>
          {voice.peaks ? (
            <Waveform peaks={voice.peaks} widthPct={voiceDurationS ? pct(voiceDurationS, total) : 100} />
          ) : (
            <span className="px-2 text-[11.5px] leading-[44px] text-fg-3">{voice.error ?? t('production.editor.noVoice')}</span>
          )}
        </TrackRow>
        <TrackRow label={t('production.editor.visuals')} height={Math.max(1, visual.length) * 52}>
          {visual.length === 0 && <span className="px-2 text-[11.5px] leading-[44px] text-fg-3">{t('production.editor.noShots')}</span>}
          {visual.map((lane, row) => (
            <div key={lane} className="absolute inset-x-0" style={{ top: row * 52, height: 52 }}>
              {plan.shots
                .filter((s) => s.track === lane)
                .map((s) => {
                  const still = s.itemId ? stills.get(s.itemId) : undefined
                  const thumb = still !== undefined && thumbs++ < MAX_THUMBS
                  return <ShotBlock key={s.id} runId={runId} shot={s} total={total} still={still} thumb={thumb} />
                })}
            </div>
          ))}
        </TrackRow>
        <TrackRow label={t('production.editor.captions')} height={32}>
          {captions ? (
            <div className="absolute inset-y-1 right-0 left-0 truncate rounded-chip bg-surface-pop px-2 text-[11.5px] leading-6 text-fg-2">
              {[captions.preset, t('production.review.captions.cues', { n: captions.cues }), captions.burn ? t('production.review.captions.burn') : t('production.review.captions.srt')].filter(Boolean).join(' · ')}
            </div>
          ) : (
            <span className="px-2 text-[11.5px] leading-8 text-fg-3">{t('production.editor.notReady')}</span>
          )}
        </TrackRow>
        <TrackRow label={t('production.editor.music')} height={32}>
          {music ? (
            <div className={cn('absolute inset-y-1 left-0 rounded-chip bg-info/25 px-2 text-[11.5px] leading-6 text-fg-2')} style={{ width: `${music.durationS ? pct(music.durationS, total) : 100}%` }}>
              {t('production.editor.musicBed')}
            </div>
          ) : (
            <span className="px-2 text-[11.5px] leading-8 text-fg-3">{t('production.editor.notReady')}</span>
          )}
        </TrackRow>
      </div>
      <div className="min-h-10 rounded-field border border-line bg-surface-1 px-3 py-2 text-[12.5px] text-fg-2" data-testid="at-playhead">
        {here.length === 0 ? (
          t('production.editor.nothingHere')
        ) : (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {here.map((s) => (
              <li key={s.id}>
                <span className="micro-label mr-2">{s.kind}</span>
                {s.label}
                {s.credits > 0 && <span className="ml-2 text-fg-3">{t('production.editor.price', { n: s.credits })}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
