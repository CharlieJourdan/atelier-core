// The sample of a style study (production-15): its film, the likeness score out of 100 with each dimension, and the three
// biggest gaps, each with the edit that closes it (its diff, Δ score, Δ cost per minute) and « Corriger ». After an edit the
// sample is « à refaire »: the predicted score is shown until « Refaire l'exemple » measures it again.
import { useEffect, useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { RunFileRef } from '../../../../shared/runs'
import type { StudyView } from '../../../../shared/style-agent'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { call } from '@/state/client'
import { DiffLines } from '../agent/parts'
import { VideoPlayer } from '../encours/Reviews'
import { eurOf } from '../recettes/estimate-format'

type Sample = NonNullable<StudyView['sample']>

function useSampleFilm(sample: Sample): RunFileRef | null {
  const [film, setFilm] = useState<{ runId: number; file: RunFileRef } | null>(null)
  useEffect(() => {
    if (sample.status !== 'done') return
    let live = true
    call('production.output', sample.runId, 'render').then(
      (o) => live && o.kind === 'video' && setFilm({ runId: sample.runId, file: o.file }),
      () => undefined
    )
    return () => {
      live = false
    }
  }, [sample.runId, sample.status])
  return sample.status === 'done' && film?.runId === sample.runId ? film.file : null
}

const tone = (score: number): string => (score >= 80 ? 'text-ok' : score >= 60 ? 'text-fg' : 'text-warn')

export function StyleSample({ study, busy, onGap, onRedo }: { study: StudyView; busy: boolean; onGap: (index: number) => void; onRedo: () => void }) {
  const sample = study.sample as Sample
  const film = useSampleFilm(sample)
  const variant = t(`pagent.variant.${sample.variant}` as MessageKey)
  return (
    <section className="card mb-9 flex flex-col gap-5 p-5" data-testid="style-sample">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.014em] text-fg">
          {t('pstyle.sample')} · {variant}
        </h2>
        {sample.credits > 0 && <span className="num text-[12px] text-fg-3">{t('pstyle.sample.spent', { credits: sample.credits })}</span>}
      </div>
      {sample.status === 'running' && (
        <p className="text-[13px] text-fg-2" data-testid="sample-running">
          {t('pstyle.sample.running')}
        </p>
      )}
      {sample.status === 'failed' && <p className="text-[13px] text-warn">{t('pstyle.sample.failed', { why: sample.error ?? '' })}</p>}
      {sample.status === 'done' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            {film ? <VideoPlayer runId={sample.runId} file={film} /> : <div className="aspect-video w-full rounded-card bg-surface-2" />}
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-end gap-3" data-testid="sample-score">
              <span className={cn('num text-[44px] font-semibold leading-none tracking-[-0.03em]', tone(sample.score ?? 0))}>{sample.score ?? '—'}</span>
              <span className="pb-1 text-[13px] text-fg-3">/ 100 · {t('pstyle.score')}</span>
            </div>
            {sample.stale && (
              <div className="flex flex-wrap items-center gap-2 rounded-field bg-surface-2 px-3 py-2 ring-1 ring-line" data-testid="sample-stale">
                <span className="text-[12.5px] text-fg-2">{t('pstyle.sample.stale')}</span>
                {sample.predicted !== null && <Badge variant="brand">{t('pstyle.score.predicted', { n: sample.predicted })}</Badge>}
                <Button size="sm" disabled={busy} onClick={onRedo} data-testid="sample-redo">
                  {t('pstyle.sample.redo')}
                </Button>
              </div>
            )}
            <ul className="flex flex-col gap-1.5" aria-label={t('pstyle.score')}>
              {sample.dimensions.map((d) => (
                <li key={d.id} className="grid grid-cols-[140px_1fr_36px] items-center gap-2 text-[12px]">
                  <span className="text-fg-2">{t(`pstyle.score.dim.${d.id}` as MessageKey)}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    {d.score !== null && <span className="block h-full rounded-full bg-ink" style={{ width: `${Math.round(d.score * 100)}%` }} />}
                  </span>
                  <span className="num text-right text-fg-3">{d.score === null ? '—' : Math.round(d.score * 100)}</span>
                </li>
              ))}
            </ul>
            {sample.lookFromStyle && <p className="text-[11.5px] text-fg-4">{t('pstyle.score.lookFromStyle')}</p>}
          </div>
        </div>
      )}
      {sample.gaps.length > 0 && (
        <div className="flex flex-col gap-2.5" data-testid="sample-gaps">
          <h3 className="text-[13px] font-semibold text-fg">{t('pstyle.gaps')}</h3>
          {sample.gaps.map((g, i) => (
            <article key={`${g.dimension}-${i}`} className="flex flex-col gap-2 rounded-field px-3 py-2.5 ring-1 ring-line" data-testid={`gap-${g.dimension}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-fg">
                  {t(`pstyle.score.dim.${g.dimension}` as MessageKey)} <span className="num ml-1 text-fg-3">{Math.round(g.score * 100)} / 100</span>
                </span>
                {g.ops.length > 0 && (
                  <span className="flex flex-wrap items-center gap-2">
                    {g.scoreAfter !== null && <Badge variant="ok">{t('pstyle.gap.after', { n: g.scoreAfter })}</Badge>}
                    {g.perMinute && (
                      <span className="num text-[11.5px] text-fg-3" data-testid={`gap-cost-${g.dimension}`}>
                        {t('pstyle.gap.cost', { before: eurOf(g.perMinute.before.avg, study.creditEur), after: eurOf(g.perMinute.after.avg, study.creditEur) })}
                      </span>
                    )}
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => onGap(i)} data-testid={`gap-apply-${g.dimension}`}>
                      {t('pstyle.gap.apply')}
                    </Button>
                  </span>
                )}
              </div>
              {g.ops.length > 0 ? <DiffLines changes={g.changes} /> : <p className="text-[12px] text-fg-3">{t('pstyle.gap.none')}</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
