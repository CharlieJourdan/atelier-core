// While a clone works for hours: nine stages down a rail, each with what was found and the pictures that prove it. The
// stage in progress is open (a strip of frames); finished ones keep one line of facts. Everything comes from the saved
// artefacts (`CloneProgress`), so it reads the same after a restart.
import { Check, CircleDashed, CircleOff, OctagonX } from 'lucide-react'
import type { CloneProgress, ProgressFact, ProgressStepView, StepStatus } from '../../../../shared/clone'
import { tc } from '../../../../shared/fr-clone'
import { cn } from '@/lib/utils'
import { Frame } from './files'
import { usd } from './format'
import './clone.css'

/** A fact in words; its values that are ids (an intent, an answer) are translated first. */
export function factText(f: ProgressFact): string {
  const v = { ...f.vars }
  if (typeof v['intent'] === 'string') v['intent'] = tc(`clone.intent.${v['intent']}.title`)
  if (typeof v['answer'] === 'string') v['answer'] = tc(`clone.answer.${v['answer']}`)
  if (f.key === 'clone.progress.fact.can' && typeof v['verdict'] === 'string') v['verdict'] = tc(`clone.verdict.${v['verdict']}.title`)
  return tc(f.key, v)
}

function Marker({ status, n }: { status: StepStatus; n: number }) {
  const base = 'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums ring-1'
  if (status === 'done') return <span className={cn(base, 'bg-brand text-brand-ink ring-brand')}><Check className="size-4" aria-hidden /></span>
  if (status === 'running') return <span className={cn(base, 'bg-brand-soft text-brand-fg ring-brand')}><span className="clone-beat size-2.5 rounded-full bg-brand" aria-hidden /></span>
  if (status === 'stopped') return <span className={cn(base, 'bg-err-soft text-err ring-err')}><OctagonX className="size-4" aria-hidden /></span>
  if (status === 'skipped') return <span className={cn(base, 'bg-surface-2 text-fg-3 ring-line-2')}><CircleOff className="size-4" aria-hidden /></span>
  return <span className={cn(base, 'bg-surface-2 text-fg-3 ring-line-2')}>{n}</span>
}

function StepRow({ s, n, open }: { s: ProgressStepView; n: number; open: boolean }) {
  const active = s.status === 'running' || s.status === 'stopped'
  return (
    <li className="clone-rail pb-3" data-done={s.status === 'done'} data-testid={`step-${s.step}`} data-status={s.status}>
      <div className="flex items-start gap-3">
        <Marker status={s.status} n={n} />
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className={cn('m-0 text-[14px] font-semibold', s.status === 'waiting' || s.status === 'skipped' ? 'text-fg-3' : 'text-fg')}>{tc(`clone.step.${s.step}.title`)}</h3>
            <span className={cn('text-[11px]', active ? 'font-medium text-brand-fg' : 'text-fg-3', s.status === 'stopped' && 'text-err')}>{tc(`clone.step.${s.status}`)}</span>
          </div>
          {s.facts.length > 0 && (
            <ul className="m-0 mt-1 flex list-none flex-wrap gap-x-4 gap-y-0.5 p-0 text-[12.5px] text-fg-2">
              {s.facts.map((f, i) => <li key={i}>{factText(f)}</li>)}
            </ul>
          )}
          {(open || active) && s.frames.length > 0 && (
            <div className="clone-strip clone-rise mt-2" data-testid={`frames-${s.step}`}>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                {s.frames.map((f, i) => <Frame key={f + i} rel={f} alt={`${tc(`clone.step.${s.step}.title`)} ${i + 1}`} />)}
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

/** The styles a « several styles » question offers (`s1 « description » (videos)`), parsed from the engine's question. */
export function styleChoices(question: string): { id: string; label: string }[] {
  return [...question.matchAll(/([\w-]+) « ([^»]+) »/g)].map((m) => ({ id: m[1]!, label: m[2]! }))
}

export function ProgressPanel({ progress, onResume, onAnswer }: { progress: CloneProgress; onResume?: () => void; onAnswer?: (style: string) => void }) {
  const pct = progress.budgetUsd ? Math.min(100, (progress.spentUsd / progress.budgetUsd) * 100) : 0
  const stoppedHere = progress.stoppedBecause !== null
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]" data-testid="progress-panel">
      <section className="rounded-card bg-surface-1 p-5 ring-1 ring-line-2 shadow-[var(--shadow-card)]">
        <header className="mb-4 flex flex-col gap-1">
          <h2 className="m-0 flex items-center gap-2 text-[16px] font-semibold text-fg">
            {stoppedHere ? <OctagonX className="size-4 text-err" aria-hidden /> : <CircleDashed className="clone-beat size-4 text-brand-fg" aria-hidden />}
            <span data-testid="now-line">{factText(progress.now)}</span>
          </h2>
          <p className="m-0 text-[12.5px] text-fg-3">{tc('clone.progress.lead')}</p>
        </header>
        <ol className="m-0 flex list-none flex-col p-0">
          {progress.steps.map((s, i) => <StepRow key={s.step} s={s} n={i + 1} open={s.status === 'done'} />)}
        </ol>
      </section>
      <aside className="flex flex-col gap-3 self-start">
        <div className="rounded-card bg-surface-1 p-4 ring-1 ring-line-2 shadow-[var(--shadow-card)]">
          <p className="m-0 text-[12px] text-fg-3">{progress.budgetUsd ? tc('clone.progress.spent', { spent: `${usd(progress.spentUsd)} $`, budget: `${usd(progress.budgetUsd)} $` }) : tc('clone.progress.spent.none', { spent: `${usd(progress.spentUsd)} $` })}</p>
          {progress.budgetUsd !== null && (
            <div role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={tc('clone.progress.spent', { spent: usd(progress.spentUsd), budget: usd(progress.budgetUsd) })} className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
              <div className={cn('h-full rounded-full transition-[width] duration-500', pct > 85 ? 'bg-warn' : 'bg-brand')} style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
          )}
        </div>
        {progress.stoppedBecause && (
          <div className="rounded-card bg-err-soft p-4 text-[12.5px] text-fg ring-1 ring-err" role="status" data-testid="stopped">
            <p className="m-0">{tc(progress.stoppedBecause.key, progress.stoppedBecause.vars)}</p>
            {progress.stoppedBecause.key === 'clone.progress.asking' && onAnswer && (
              <div className="mt-2 flex flex-col gap-1.5" data-testid="style-choices">
                {styleChoices(String(progress.stoppedBecause.vars['question'] ?? '')).map((c) => (
                  <button key={c.id} type="button" onClick={() => onAnswer(c.id)} className="rounded-[10px] bg-surface-1 px-3 py-1.5 text-left text-[12.5px] text-fg ring-1 ring-line-2 hover:bg-surface-2">{c.label}</button>
                ))}
              </div>
            )}
            {progress.stoppedBecause.key !== 'clone.progress.asking' && onResume && <button type="button" onClick={onResume} className="mt-2 rounded-full bg-ink px-3 py-1 text-[12px] font-medium text-ink-fg hover:opacity-90">{tc('clone.progress.resume')}</button>}
          </div>
        )}
      </aside>
    </div>
  )
}
