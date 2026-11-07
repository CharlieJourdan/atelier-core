// Step 5 in real mode: the report of the real analysis (reproducibility note, format, what is on screen, script structure)
// and the pipeline it proposes with the engine's own estimate of cost and time.
import { TriangleAlert } from 'lucide-react'
import { t } from '../../../../shared/fr'
import type { NodeCost } from '../../../../shared/analysis'
import { fmtNum, ProgressBar, ProgressRing } from '@/components/proto/kit'
import { useLiveState } from '@/proto/live/use-onboarding-live'
import { pipelineFromNodes } from '@/proto/live/mapping-production'
import { nodeLabelOf } from '@/proto/live/node-labels'
import { sourceKind, type StepProps } from '../model'
import { Question } from '../parts'
import { Card, Metric, NodeStrip } from '../steps/Report'

export function LiveReportStep({ a, live }: StepProps) {
  const state = useLiveState(live)
  const kind = sourceKind(a)
  const analysis = state?.analysis
  if (!state || !analysis || !analysis.gauge || !analysis.profile) return null
  const { gauge, profile, scriptCard } = analysis
  const mode = state.estimate?.modes[analysis.mode]
  const nodes = (mode?.nodes ?? []).map((n: NodeCost) => ({
    nodeId: n.nodeId,
    type: n.type,
    label: nodeLabelOf(n.nodeId, n.type),
    gate: false,
    credits: n.credits,
    durationS: n.durationS,
    where: n.where as 'local' | 'cloud' | 'gpu'
  }))
  const pipeline = nodes.length > 0 ? pipelineFromNodes({ pipelineId: 'proposal', label: analysis.reference.format, version: 1 }, nodes, []) : null
  const components = [...profile.components].sort((x, y) => y.share - x.share).slice(0, 5)
  return (
    <div data-live="true">
      <Question title={t(`onb.report.title.${kind}`)} hint={t('onb.report.hint')} />
      <Card title={t('onb.report.pipeline')} className="mb-4" testId="report-pipeline">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border-b border-line pb-5">
          <div className="flex items-center gap-4">
            <ProgressRing value={gauge.score} size={76} stroke={5}>
              <span className="num text-[19px] font-semibold tracking-[-0.02em] text-fg" data-testid="report-score">
                {gauge.score} %
              </span>
            </ProgressRing>
            <div>
              <p className="text-[12px] text-fg-3">{t('onb.report.replicability')}</p>
              <p className="text-[15px] font-medium text-fg" data-testid="report-tier">
                {t(`analysis.tier.${gauge.tier}`)}
              </p>
            </div>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <Metric label={t('onb.report.cost')} value={mode ? `≈ ${fmtNum(mode.credits)}` : '—'} sub={t('onb.report.cost.unit')} />
            <Metric label={t('onb.report.time')} value={mode ? `≈ ${Math.max(1, Math.round(mode.durationS / 60))} min` : '—'} sub={t('onb.live.report.length', { n: state.estimate?.minutes ?? analysis.cost?.minutes ?? 0 })} />
            <Metric label={t('onb.live.report.steps')} value={nodes.length} />
          </div>
        </div>
        <div className="pt-5">
          {pipeline && <NodeStrip pipeline={pipeline} />}
          <p className="mt-3.5 text-[12px] text-fg-3" data-testid="report-pipeline-note">
            {state.pipeline ? t('onb.live.report.created', { name: state.pipeline.name }) : t('onb.live.report.pending')}
          </p>
        </div>
      </Card>
      {(gauge.l < 1 || gauge.supportSuggested) && (
        <div data-testid="report-limits" className="mb-4 rounded-[16px] border border-[color-mix(in_oklab,var(--warn)_35%,transparent)] bg-[var(--warn-soft)] p-5">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-fg">
            <TriangleAlert className="size-4 text-warn" aria-hidden />
            {t('onb.report.limits.title')}
          </h2>
          <p className="mt-3 text-[13px] leading-[1.5] text-fg-2">{t('analysis.gauge.clipLimit')}</p>
          <p className="mt-3 text-[13px] text-fg-2">{t('onb.report.limits.advice')}</p>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card title={t('onb.live.report.summary')} testId="report-format">
            <p className="text-[13.5px] leading-[1.55] text-fg-2">{profile.summary}</p>
            <p className="num mt-3 text-[12.5px] text-fg-3">
              {t('onb.live.report.cuts', { n: profile.cutsPerMinute })} · {profile.voice.wpm} {t('onb.live.wpm')}
            </p>
          </Card>
          {scriptCard && (
            <Card title={t('onb.report.structure')} testId="report-structure">
              <ol className="space-y-2.5">
                {scriptCard.structure.map((s, i) => (
                  <li key={s} className="flex items-start gap-3 text-[13px] leading-[1.45] text-fg-2">
                    <span className="num flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-medium text-fg-2">{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>
        <Card title={t('onb.live.report.components')} testId="report-styles">
          <ul className="space-y-3.5">
            {components.map((c) => (
              <li key={c.component}>
                <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
                  <span className="font-medium text-fg">{t(`analysis.comp.${c.component}`)}</span>
                  <span className="num text-fg-3">{Math.round(c.share * 100)} %</span>
                </div>
                <ProgressBar value={Math.round(c.share * 100)} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
