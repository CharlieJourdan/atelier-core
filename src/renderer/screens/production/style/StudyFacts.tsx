// What a study says beyond its pipelines (parcours-utilisateur): what the reference channels' numbers say (formats, the best-viewed
// one, an honest verdict on their reach, « Prendre ce format » to measure another), what each inspiration gave, and how long it
// takes (the analysis just made, a sample, one video).
import { t, type MessageKey } from '../../../../shared/fr'
import type { ChannelFormatId, StudyView } from '../../../../shared/style-agent'
import { SectionHead } from '@/components/proto/kit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const views = (n: number | null): string => (n === null ? '—' : new Intl.NumberFormat('fr-FR').format(Math.round(n)))

export function Insights({ study, busy, onFormat }: { study: StudyView; busy: boolean; onFormat: (f: ChannelFormatId) => void }) {
  if (study.insights.length === 0) return null
  return (
    <section className="mb-9 flex flex-col gap-3" data-testid="style-insights">
      <SectionHead title={t('pinsight.title')} />
      {study.insights.map((i) => (
        <article key={i.title} className="card flex flex-col gap-3 p-4" data-testid="style-insight">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-fg">{i.title}</span>
            {i.verdict !== 'unknown' && <Badge variant={i.verdict === 'weak' ? 'warn' : i.verdict === 'strong' ? 'ok' : 'default'}>{t(`pinsight.verdict.${i.verdict}` as MessageKey)}</Badge>}
          </div>
          {i.lines.map((l) => (
            <p key={l} className={`max-w-[820px] text-[13px] leading-[1.55] ${i.verdict === 'weak' && /ouf|décollent/.test(l) ? 'font-medium text-fg' : 'text-fg-2'}`}>
              {l}
            </p>
          ))}
          {i.formats.length > 1 && (
            <div className="flex flex-wrap gap-2" data-testid="style-formats">
              {i.formats.map((f) => (
                <span key={f.id} className="flex items-center gap-2 rounded-field bg-surface-2 px-3 py-1.5 text-[12px] ring-1 ring-line">
                  <span className="font-medium text-fg">{t(`pinsight.format.${f.id}` as MessageKey)}</span>
                  <span className="text-fg-3">{t('pinsight.format.views', { n: f.count, views: views(f.medianViews) })}</span>
                  {i.best === f.id ? (
                    <Badge variant="brand">{t('pinsight.format.measured')}</Badge>
                  ) : (
                    <Button size="sm" variant="link" className="h-auto p-0 text-[12px]" disabled={busy} onClick={() => onFormat(f.id)} data-testid={`style-format-${f.id}`}>
                      {t('pinsight.format.use')}
                    </Button>
                  )}
                </span>
              ))}
            </div>
          )}
        </article>
      ))}
    </section>
  )
}

export function Inspirations({ study }: { study: StudyView }) {
  if (study.inspirations.length === 0) return null
  return (
    <section className="mb-9 flex flex-col gap-2" data-testid="style-inspirations">
      <SectionHead title={t('pinspire.title')} />
      <ul className="flex max-w-[860px] flex-col gap-1.5">
        {study.inspirations.map((a) => (
          <li key={`${a.axis}-${a.url}`} className="flex items-start gap-2 text-[13px] leading-[1.5]">
            <Badge variant={a.taken ? 'ok' : 'default'}>{t(`ppath.axis.${a.axis}` as MessageKey)}</Badge>
            <span className={a.taken ? 'text-fg' : 'text-fg-3'}>{a.said}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A duration in plain French: « 45 s », « 12 min », « 1 h 05 ». */
export function duration(s: number): string {
  if (s < 90) return t('ptime.seconds', { n: Math.max(1, Math.round(s)) })
  const m = Math.round(s / 60)
  return m < 60 ? t('ptime.minutes', { n: m }) : t('ptime.hours', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') })
}

export function Timing({ study }: { study: StudyView }) {
  const x = study.timing
  const parts = [
    x.analysisS !== null ? t('ptime.analysis', { t: duration(x.analysisS) }) : null,
    x.sampleS !== null ? t('ptime.sample', { t: duration(x.sampleS) }) : null,
    x.videoS !== null ? t('ptime.video', { m: String(x.minutes).replace('.', ','), t: duration(x.videoS) }) : null
  ].filter((p): p is string => p !== null)
  if (parts.length === 0) return null
  return (
    <p className="mb-9 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-fg-2" data-testid="style-timing">
      <span className="font-semibold text-fg">{t('ptime.title')}</span>
      {parts.map((p) => (
        <span key={p}>{p}</span>
      ))}
    </p>
  )
}
