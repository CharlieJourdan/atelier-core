// Step 5: the report. What the agent understood (format, rhythm, voice, visuals, script structure, styles, strengths,
// what competitors do better) and the pipeline it proposes with its replicability score, cost and time. Honest about
// what it cannot do when the style is hard to replicate.
import { ArrowUpRight, Bot, Check, ChevronRight, Cloud, Code2, TriangleAlert, User } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { t } from '../../../../shared/fr'
import { fmtNum, ProgressBar, ProgressRing } from '@/components/proto/kit'
import { cn } from '@/lib/utils'
import { useProto } from '@/proto/store'
import type { NodeRunner, PipelineNode, ProtoPipeline } from '@/proto/types'
import { reportOf, sourceKind, type StepProps } from '../model'
import { Question } from '../parts'

const RUNNER_ICON: Record<NodeRunner, typeof Bot> = { agent: Bot, api: Cloud, human: User, code: Code2 }

export function Card({ title, children, className, testId }: { title: string; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section data-testid={testId} className={cn('rounded-[16px] border border-line-2 bg-surface-1 p-5', className)}>
      <h2 className="mb-3.5 text-[14px] font-semibold tracking-[-0.01em] text-fg">{title}</h2>
      {children}
    </section>
  )
}

/** The nodes of a pipeline grouped by column: what runs side by side stacks up. */
export function columnsOf(nodes: PipelineNode[]): PipelineNode[][] {
  const cols = [...new Set(nodes.map((n) => n.col))].sort((x, y) => x - y)
  return cols.map((c) => nodes.filter((n) => n.col === c).sort((x, y) => x.row - y.row))
}

export function NodeStrip({ pipeline }: { pipeline: ProtoPipeline }) {
  const cols = columnsOf(pipeline.nodes)
  return (
    <div data-testid="report-strip" className="flex items-stretch gap-0.5">
      {cols.map((col, i) => (
        <Fragment key={i}>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
            {col.map((n) => {
              const Icon = RUNNER_ICON[n.runner]
              return (
                <div key={n.id} className="flex items-start gap-1.5 rounded-[10px] bg-surface-2 px-2 py-1.5" title={n.provider}>
                  <Icon className="mt-px size-3 shrink-0 text-fg-3" aria-hidden />
                  <span className="min-w-0 text-[11.5px] leading-[1.25] font-medium text-fg-2">{n.label}</span>
                </div>
              )
            })}
          </div>
          {i < cols.length - 1 && <ChevronRight aria-hidden className="size-3.5 shrink-0 self-center text-fg-4" />}
        </Fragment>
      ))}
    </div>
  )
}

export function Metric({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-fg-3">{label}</p>
      <p className="num mt-0.5 text-[20px] leading-tight font-medium tracking-[-0.02em] text-fg">{value}</p>
      {sub && <p className="num mt-0.5 text-[12px] text-fg-3">{sub}</p>}
    </div>
  )
}

function verdictKey(score: number) {
  return score >= 80 ? 'onb.report.verdict.high' : score >= 60 ? 'onb.report.verdict.mid' : 'onb.report.verdict.low'
}

const BAR_TONES = ['bg-ink', 'bg-fg-3', 'bg-line-3']

export function ReportStep({ a }: StepProps) {
  const { pipelines } = useProto()
  const report = reportOf(a)
  const pipeline = pipelines.find((p) => p.id === report.pipelineId)
  const kind = sourceKind(a)
  return (
    <div>
      <Question title={t(`onb.report.title.${kind}`)} hint={t('onb.report.hint')} />
      {pipeline && (
        <Card title={t('onb.report.pipeline')} className="mb-4" testId="report-pipeline">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border-b border-line pb-5">
            <div className="flex items-center gap-4">
              <ProgressRing value={pipeline.replicability} size={76} stroke={5}>
                <span className="num text-[19px] font-semibold tracking-[-0.02em] text-fg" data-testid="report-score">
                  {pipeline.replicability} %
                </span>
              </ProgressRing>
              <div>
                <p className="text-[12px] text-fg-3">{t('onb.report.replicability')}</p>
                <p className="text-[15px] font-medium text-fg">{t(verdictKey(pipeline.replicability))}</p>
              </div>
            </div>
            <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              <Metric label={t('onb.report.cost')} value={`≈ ${fmtNum(pipeline.creditsPerVideo)}`} sub={t('onb.report.cost.unit')} />
              <Metric label={t('onb.report.time')} value={`≈ ${pipeline.minutesPerVideo} min`} sub={t('onb.report.time.cloud', { n: pipeline.minutesCloud })} />
              <Metric label={t('onb.report.share')} value={`${pipeline.subscriptionShare} %`} sub={t('onb.report.share.hint')} />
            </div>
          </div>
          <div className="pt-5">
            <NodeStrip pipeline={pipeline} />
            <p className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-fg-3">
              {(['agent', 'api', 'code', 'human'] as const).map((r) => {
                const Icon = RUNNER_ICON[r]
                return (
                  <span key={r} className="inline-flex items-center gap-1.5">
                    <Icon className="size-3" aria-hidden />
                    {t(`onb.report.runner.${r}`)}
                  </span>
                )
              })}
            </p>
          </div>
        </Card>
      )}
      {report.limits.length > 0 && (
        <div data-testid="report-limits" className="mb-4 rounded-[16px] border border-[color-mix(in_oklab,var(--warn)_35%,transparent)] bg-[var(--warn-soft)] p-5">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-fg">
            <TriangleAlert className="size-4 text-warn" aria-hidden />
            {t('onb.report.limits.title')}
          </h2>
          <ul className="mt-3 space-y-2 text-[13px] leading-[1.5] text-fg-2">
            {report.limits.map((k) => (
              <li key={k} className="flex gap-2.5">
                <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-warn" />
                {t(k)}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-fg-2">{t('onb.report.limits.advice')}</p>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card title={t('onb.report.format')} testId="report-format">
            <dl className="grid grid-cols-3 gap-4">
              <div>
                <dt className="text-[12px] text-fg-3">{t('onb.report.duration')}</dt>
                <dd className="mt-0.5 text-[14px] font-medium text-fg">{t(report.durationKey)}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-fg-3">{t('onb.report.pace')}</dt>
                <dd className="mt-0.5 text-[14px] font-medium text-fg">{t(report.paceKey)}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-fg-3">{t('onb.report.voice')}</dt>
                <dd className="mt-0.5 text-[14px] font-medium text-fg">{t(report.voiceKey)}</dd>
              </div>
            </dl>
            <p className="mt-5 mb-2 text-[12px] text-fg-3">{t('onb.report.visuals')}</p>
            <div className="flex h-2 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={t('onb.report.visuals')}>
              {report.visuals.map((v, i) => (
                <span key={v.labelKey} className={BAR_TONES[i] ?? 'bg-line-3'} style={{ width: `${v.pct}%` }} />
              ))}
            </div>
            <ul className="mt-3 space-y-1.5">
              {report.visuals.map((v, i) => (
                <li key={v.labelKey} className="flex items-center gap-2 text-[13px] text-fg-2">
                  <span aria-hidden className={cn('size-2 rounded-full', BAR_TONES[i] ?? 'bg-line-3')} />
                  <span className="flex-1">{t(v.labelKey)}</span>
                  <span className="num text-fg-3">{v.pct} %</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={t('onb.report.structure')} testId="report-structure">
            <ol className="space-y-2.5">
              {report.structure.map((k, i) => (
                <li key={k} className="flex items-start gap-3 text-[13px] leading-[1.45] text-fg-2">
                  <span className="num flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-medium text-fg-2">{i + 1}</span>
                  {t(k)}
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title={t('onb.report.styles')} testId="report-styles">
            <ul className="space-y-3.5">
              {report.styles.map((s) => (
                <li key={s.nameKey}>
                  <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
                    <span className="font-medium text-fg">{t(s.nameKey)}</span>
                    <span className="num text-fg-3">{s.pct} %</span>
                  </div>
                  <ProgressBar value={s.pct} />
                </li>
              ))}
            </ul>
            <p className="mt-3.5 text-[12.5px] text-fg-3">{t('onb.report.styles.hint')}</p>
          </Card>
          <Card title={t('onb.report.strengths')} testId="report-strengths">
            <ul className="space-y-2.5">
              {report.strengths.map((k) => (
                <li key={k} className="flex items-start gap-2.5 text-[13px] leading-[1.45] text-fg-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
                  {t(k)}
                </li>
              ))}
            </ul>
          </Card>
          <Card title={t('onb.report.better')} testId="report-better">
            <ul className="space-y-2.5">
              {report.competitorsDoBetter.map((k) => (
                <li key={k} className="flex items-start gap-2.5 text-[13px] leading-[1.45] text-fg-2">
                  <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-fg-3" aria-hidden />
                  {t(k)}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}
