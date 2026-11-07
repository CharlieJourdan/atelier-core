// Step 7 in real mode: the test video is a real run of the pipeline the analysis made, stopping at its first gate (step by
// step). It starts when the user says so (it can cost credits when the Cloud is connected; with the demo services nothing
// is debited), shows the engine's own node states, and « Relancer » sends the gated node back with the remarks.
import { Check, Circle, Loader2, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { RunNode } from '../../../../shared/runs'
import { fmtNum, ProgressBar } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { TEST_FEEDBACK_CHIPS } from '@/proto/data-onboarding'
import { runSettled } from '@/proto/live/onboarding-live'
import { useLiveState } from '@/proto/live/use-onboarding-live'
import { useProto } from '@/proto/store'
import { sourceKind, type StepProps } from '../model'
import { Chip, Question } from '../parts'
import { liveDraftOf, testRunDraftOf } from './draft'

const POLL_MS = 1500

function NodeState({ node }: { node: RunNode }) {
  const state = node.state
  if (state === 'done' || state === 'cached') return <Check className="size-3.5 text-ok" aria-hidden />
  if (state === 'running' || state === 'queued') return <Loader2 className="size-3.5 animate-spin text-fg-2" aria-hidden />
  if (state === 'error') return <TriangleAlert className="size-3.5 text-err" aria-hidden />
  if (state === 'waiting_gate') return <Circle className="size-3.5 fill-warn text-warn" aria-hidden />
  return <Circle className="size-3.5 text-fg-4" aria-hidden />
}

export function LiveTestStep({ a, live, next, setReady }: StepProps) {
  const state = useLiveState(live)
  const { channels } = useProto()
  const [chips, setChips] = useState<MessageKey[]>([])
  const [note, setNote] = useState('')
  const [skipped, setSkipped] = useState(false)
  const run = state?.run ?? null
  const settled = runSettled(run)
  const draft = liveDraftOf(a, channels)
  const kind = sourceKind(a)
  const phase = state?.runPhase

  useEffect(() => {
    void live?.loadQuote()
  }, [live])
  useEffect(() => {
    setReady(settled || skipped)
  }, [settled, skipped, setReady])
  useEffect(() => {
    if (!live || phase !== 'started' || settled) return
    const id = setInterval(() => void live.refreshRun(), POLL_MS)
    return () => clearInterval(id)
  }, [live, phase, settled])

  if (!state || !live) return null
  const launching = state.runPhase === 'starting'
  const started = state.runPhase === 'started' && run !== null
  const quote = state.quote
  const mode = quote?.modes.usage_max
  const minutes = state.analysis?.cost?.minutes ?? 8
  const waitingNode = run?.nodes.find((n) => n.state === 'waiting_gate')
  const doneCount = run?.nodes.filter((n) => n.state === 'done' || n.state === 'cached').length ?? 0
  const hasFeedback = chips.length > 0 || note.trim().length > 0
  const launch = (): void => {
    const topic = draft.niche || state.analysis?.reference.niche || draft.name
    void live.startTest(testRunDraftOf(draft.name, topic)).catch(() => undefined)
  }
  const sendBack = (): void => {
    void live.sendBack([...chips.map((k) => t(k)), note.trim()].filter(Boolean).join(' · '))
    setChips([])
    setNote('')
  }
  return (
    <div data-live="true">
      <Question title={t('onb.test.title')} hint={t(`onb.test.intro.${kind === 'own' ? 'own' : kind === 'translate' ? 'translate' : 'new'}`)} />
      {!started && (
        <div className="rounded-[16px] border border-line-2 bg-surface-1 p-5" data-testid="test-run" data-state={launching ? 'starting' : 'idle'}>
          {quote && mode && (
            <p className="text-[14px] text-fg" data-testid="live-test-quote">
              {t('onb.live.test.cost', { credits: fmtNum(mode.totalCredits), min: minutes })}{' '}
              <span className="text-fg-3">{t(quote.debited ? 'onb.live.test.debited' : 'onb.live.test.demo')}</span>
            </p>
          )}
          {state.runPhase === 'error' && (
            <p role="alert" data-testid="live-test-error" className="mt-3 text-[13px] text-err">
              {t('onb.live.failed', { error: state.error ?? '' })}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <Button data-testid="live-test-launch" disabled={launching || !state.pipeline} onClick={launch}>
              {launching && <Loader2 className="animate-spin" aria-hidden />}
              {launching ? t('onb.live.test.starting') : t('onb.live.test.launch')}
            </Button>
            <Button variant="ghost" data-testid="live-test-skip" disabled={launching} onClick={() => setSkipped(true)}>
              {t('onb.live.test.skip')}
            </Button>
          </div>
        </div>
      )}
      {started && run && (
        <div className="rounded-[16px] border border-line-2 bg-surface-1 p-5" data-testid="test-run" data-state={run.status} data-run-id={run.id}>
          <p className="flex items-center gap-2 text-[14px] font-medium text-fg" data-testid="live-test-status">
            {run.status === 'waiting' && waitingNode ? (
              <>
                <Circle className="size-3.5 fill-warn text-warn" aria-hidden />
                {t('onb.live.test.waiting', { node: waitingNode.label })}
              </>
            ) : run.status === 'succeeded' ? (
              <>
                <Check className="size-4 text-ok" aria-hidden />
                {t('onb.live.test.succeeded')}
              </>
            ) : settled ? (
              <>
                <TriangleAlert className="size-4 text-err" aria-hidden />
                {t('onb.live.test.stopped', { error: run.error ?? t('onb.live.test.noError') })}
              </>
            ) : (
              <>
                <Loader2 className="size-4 animate-spin text-fg-3" aria-hidden />
                {run.current ? `${run.current.label}${run.current.step ? ` · ${run.current.step}` : ''}` : t('onb.live.test.starting')}
              </>
            )}
          </p>
          <ProgressBar className="mt-3" value={Math.round(run.progress * 100)} />
          <p className="num mt-2 text-[12.5px] text-fg-3">{t('onb.live.test.progress', { done: doneCount, total: run.nodes.length })}</p>
          <ul className="mt-4 grid gap-x-6 gap-y-1.5 sm:grid-cols-2" data-testid="live-test-nodes">
            {run.nodes.map((n) => (
              <li key={n.nodeId} data-state={n.state} className={cn('flex items-center gap-2 text-[13px]', n.state === 'pending' ? 'text-fg-3' : 'text-fg')}>
                <NodeState node={n} />
                <span className="min-w-0 truncate">{n.label}</span>
              </li>
            ))}
          </ul>
          {run.status === 'waiting' && <p className="mt-4 text-[12.5px] text-fg-3">{t('onb.live.test.inbox')}</p>}
          {run.demo && <p className="mt-2 text-[12.5px] text-fg-3">{t('onb.live.test.demo')}</p>}
          {settled && run.status !== 'waiting' && run.status !== 'succeeded' && (
            <Button variant="secondary" size="sm" className="mt-4" data-testid="live-test-retry" onClick={() => void live.retryRun()}>
              {t('onb.live.retry')}
            </Button>
          )}
        </div>
      )}
      {started && settled && (
        <div className="onb-rise mt-4 rounded-[16px] border border-line-2 bg-surface-1 p-5">
          {run?.status === 'waiting' && (
            <>
              <p className="mb-2.5 text-[13px] font-medium text-fg">{t('onb.test.feedback')}</p>
              <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={t('onb.test.feedback')}>
                {TEST_FEEDBACK_CHIPS.map((k) => (
                  <Chip key={k} on={chips.includes(k)} onClick={() => setChips(chips.includes(k) ? chips.filter((x) => x !== k) : [...chips, k])}>
                    {t(k)}
                  </Chip>
                ))}
              </div>
              <Textarea data-testid="test-feedback" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('onb.test.feedback.placeholder')} className="min-h-[72px] rounded-[14px] text-[13.5px]" />
            </>
          )}
          <div className="mt-3.5 flex flex-wrap items-center justify-end gap-2.5">
            {run?.status === 'waiting' && (
              <Button variant="secondary" data-testid="test-relaunch" disabled={!hasFeedback} onClick={sendBack}>
                {t('onb.test.relaunch')}
              </Button>
            )}
            <Button data-testid="test-approve" onClick={next}>
              {t('onb.test.approve')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
