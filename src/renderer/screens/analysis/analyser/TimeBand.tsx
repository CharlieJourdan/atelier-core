// An example video of the analysis: its facts and the coloured time band (what we can remake, second by second).
import { useState } from 'react'
import { t } from '../../../../shared/fr'
import type { ReferenceVideo, TimelineSegment } from '../../../../shared/analysis'
import type { GaugeState, SegmentTone } from '../../../../shared/gauge'
import { fmtInt } from '@/components/atelier/kit'
import { cn } from '@/lib/utils'
import { bandSegments, clock, toneShares, type BandSegment } from './band'

const TONE_BG: Record<SegmentTone, string> = { green: 'bg-ok/75', amber: 'bg-warn/75', red: 'bg-err/75' }
const TONE_DOT: Record<SegmentTone, string> = { green: 'bg-ok', amber: 'bg-warn', red: 'bg-err' }

function describe(s: BandSegment): string {
  const parts = [`${clock(s.startS)} – ${clock(s.endS)}`, t(`analysis.comp.${s.component}`)]
  if (s.footage) parts.push(t('analysis.band.yourFootage'))
  else if (s.replaced) parts.push(t('analysis.band.replacedBy', { by: t(`analysis.comp.${s.by}`) }))
  parts.push(t(`analysis.band.tone.${s.tone}`))
  return parts.join(' · ')
}

export function ExampleVideoBand({ video, segments, state }: { video: ReferenceVideo; segments: readonly TimelineSegment[]; state: GaugeState }) {
  const segs = bandSegments(segments, state)
  const [active, setActive] = useState<number | null>(null)
  const shares = toneShares(segs)
  const current = segs.find((s) => s.index === active) ?? null
  return (
    <article data-testid={`example-video-${video.id}`} className="flex flex-col gap-3 rounded-card border border-line bg-surface-1 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="min-w-0 truncate text-[14px] font-medium text-fg">{video.title}</h4>
        <p className="text-[11.5px] text-fg-3">
          {t('analysis.video.facts', { views: fmtInt(video.views), duration: clock(video.durationS), days: video.publishedDaysAgo })}
        </p>
      </header>
      <div role="group" aria-label={t('analysis.band.label')} data-testid="time-band" className="relative h-9 overflow-hidden rounded-field bg-surface-2">
        {segs.map((s) => (
          <button
            key={s.index}
            type="button"
            data-tone={s.tone}
            title={describe(s)}
            aria-label={describe(s)}
            aria-pressed={active === s.index}
            onClick={() => setActive(active === s.index ? null : s.index)}
            className={cn(
              'absolute inset-y-0 border-r border-bg/70 outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-fg',
              TONE_BG[s.tone],
              active === s.index && 'ring-2 ring-fg ring-inset'
            )}
            style={{ left: `${s.left}%`, width: `${s.width}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono text-[10.5px] text-fg-3">
        <span>0:00</span>
        <span>{clock(video.durationS)}</span>
      </div>
      <p className="min-h-5 text-[12.5px] text-fg-2" data-testid="band-detail" aria-live="polite">
        {current ? `${describe(current)}${current.note ? ` : ${current.note}` : ''}` : t('analysis.band.hint')}
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-fg-3">
        {(['green', 'amber', 'red'] as const).map((tone) => (
          <li key={tone} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn('size-2 rounded-full', TONE_DOT[tone])} />
            {t(`analysis.band.tone.${tone}`)} · {Math.round(shares[tone] * 100)} %
          </li>
        ))}
      </ul>
    </article>
  )
}
