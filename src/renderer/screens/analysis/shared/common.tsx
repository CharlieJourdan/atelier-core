// Shared bits of the analysis screens: the channel list, the coloured line diff, the cost per mode, validation problems.
import { t, type MessageKey } from '../../../../shared/fr'
import type { DiffLine, PipelineCostReport, PipelineProblem } from '../../../../shared/analysis'
import { BUDGET_MODE_IDS } from '../../../../shared/gauge'
import { diffStats } from '../../../../shared/line-diff'
import { fmtCredits } from '@/components/atelier/kit'
import { cn } from '@/lib/utils'
import { call, useApi, useLoader } from '@/state/client'

/** Workflow channels and the ids of the example ones (they carry the EXEMPLE chip). */
export function useChannelList() {
  const channels = useLoader(() => call('channels.list'), 'channels-list', ['channels', 'example'])
  const example = useApi('example.status', ['example'])
  return { channels: channels.data ?? [], exampleIds: new Set(example.data?.channelIds ?? []), loading: channels.data === null && channels.error === null, error: channels.error }
}

const DIFF_ROW: Record<DiffLine['kind'], string> = {
  same: 'text-fg-3',
  add: 'bg-ok/10 text-ok',
  del: 'bg-err/10 text-err'
}
const DIFF_MARK: Record<DiffLine['kind'], string> = { same: ' ', add: '+', del: '−' }

/** A line diff with green added lines and red removed ones; the unchanged ones stay faint. */
export function DiffView({ lines, className }: { lines: readonly DiffLine[]; className?: string }) {
  const stats = diffStats(lines)
  if (stats.added === 0 && stats.removed === 0) return <p className="text-[13px] text-fg-3">{t('analysis.diff.same')}</p>
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <p className="micro-label" data-testid="diff-stats">
        {t('analysis.diff.label')} · {t('analysis.diff.stats', stats)}
      </p>
      <pre data-testid="diff-view" className="max-h-96 overflow-auto rounded-field border border-line bg-surface-1 py-2 font-mono text-[11.5px] leading-[1.55]">
        {lines.map((l, i) => (
          <div key={i} data-kind={l.kind} className={cn('flex gap-2 px-3 whitespace-pre-wrap', DIFF_ROW[l.kind])}>
            <span aria-hidden className="w-3 shrink-0 select-none">
              {DIFF_MARK[l.kind]}
            </span>
            <span className="min-w-0 break-words">{l.text === '' ? ' ' : l.text}</span>
          </div>
        ))}
      </pre>
    </div>
  )
}

/** Credits per mode for a video, from `pipelines.estimate` or the analysis cost block. */
export function CostBlock({
  minutes,
  modes
}: {
  minutes: number
  modes: Record<(typeof BUDGET_MODE_IDS)[number], { credits: number; perMinute: number }>
}) {
  return (
    <div data-testid="cost-block" className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        {BUDGET_MODE_IDS.map((m) => (
          <div key={m} className="rounded-field border border-line bg-surface-2 p-3">
            <p className="micro-label">{t(`analysis.mode.${m}`)}</p>
            <p className="mt-1 font-serif text-[26px] leading-none">{fmtCredits(modes[m].credits)}</p>
            <p className="mt-1 text-[11.5px] text-fg-3">
              {modes[m].credits === 0 ? t('analysis.cost.free') : t('analysis.cost.perMinute', { n: Math.round(modes[m].perMinute * 10) / 10 })}
            </p>
          </div>
        ))}
      </div>
      <p className="text-[11.5px] text-fg-3">{t('analysis.cost.video', { m: minutes, n: Math.round(modes.qualite_max.credits) })}</p>
      <p className="text-[11.5px] text-fg-3">{t('analysis.cost.note')}</p>
    </div>
  )
}

export function costNodes(report: PipelineCostReport, mode: (typeof BUDGET_MODE_IDS)[number]) {
  return report.modes[mode].nodes
}

/** Validation problems as sentences with their path. */
export function ProblemList({ problems }: { problems: readonly PipelineProblem[] }) {
  if (problems.length === 0) return null
  return (
    <div role="alert" data-testid="problem-list" className="rounded-field border border-err/30 bg-err/10 px-3 py-2 text-[12.5px] text-err">
      <p className="font-medium">{t('analysis.val.title', { n: problems.length })}</p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {problems.slice(0, 12).map((p, i) => (
          <li key={i}>
            <span className="font-mono text-[11px]">{p.path || t('analysis.val.root')}</span> · {problemText(p.code)}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function problemText(code: string): string {
  const key = `analysis.val.${code}` as MessageKey
  const text = t(key) as string | undefined
  return text ?? t('analysis.val.unknown')
}

/** Downloads a text as a file through a Blob and a link click (no filesystem access from the renderer). */
export function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
