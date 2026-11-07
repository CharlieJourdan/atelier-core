// The cards of a chat message (PLAN-V2 §2.2): validation, quality control, budget, proposal, task, goal, engine step,
// handoff. Pure presentation: decisions go up through `CardActions`.
import { ArrowRight, Check, CircleAlert, Clapperboard, Flag, ListChecks, Wallet, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { roleName } from '../../../shared/roles'
import type { ApprovalCard, BudgetCard, ProposalCard, QcCard, TaskCard } from '../../../shared/chat'
import type { AnyCard, EngineCard, GoalCard, HandoffCard } from '../../../shared/chat-rich'
import { StatusDot, type Tone } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

export interface CardActions {
  approve: (card: ApprovalCard) => Promise<void> | void
  requestRevision: (card: ApprovalCard, note: string) => Promise<void> | void
  decideProposal: (card: ProposalCard, accept: boolean) => Promise<void> | void
  resumeTask: (taskId: number) => Promise<void> | void
}

/** Runs an action with busy / error state, shared by the cards that have buttons. */
function useAction(): { busy: boolean; error: string | null; run: (fn: () => Promise<void> | void) => Promise<boolean> } {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<void> | void): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function CardFrame({
  testId,
  status,
  icon,
  kind,
  title,
  badge,
  children
}: {
  testId: string
  status?: string | undefined
  icon: ReactNode
  kind: string
  title: string
  badge?: ReactNode
  children?: ReactNode
}) {
  return (
    <article
      data-testid={testId}
      {...(status ? { 'data-status': status } : {})}
      className="w-full min-w-[260px] rounded-card border border-line-2 bg-surface-1 p-3.5 text-fg"
    >
      <header className="mb-2 flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-field bg-surface-2 text-fg-2">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="micro-label">{kind}</div>
          <div className="truncate text-[14px] font-medium">{title}</div>
        </div>
        {badge}
      </header>
      {children}
    </article>
  )
}

function Chip({ tone = 'off', children, testId }: { tone?: Tone; children: ReactNode; testId?: string }) {
  return (
    <span
      {...(testId ? { 'data-testid': testId } : {})}
      className="flex shrink-0 items-center gap-1.5 rounded-chip border border-line-2 bg-surface-2 px-2 py-0.5 text-[11px] text-fg-2"
    >
      <StatusDot tone={tone} />
      {children}
    </span>
  )
}

function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="mt-2 text-[12px] text-err">
      {message}
    </p>
  ) : null
}

const usd = (n: number): string => `$${n.toFixed(2)}`
const STATUS_KEYS = ['waiting_approval', 'approved', 'revision_requested', 'pending', 'in_progress', 'done', 'stale'] as const
const statusLabel = (s: string): string =>
  (STATUS_KEYS as readonly string[]).includes(s) ? t(`card.status.${s}` as MessageKey) : s.replace(/_/g, ' ')

function ApprovalView({ card, actions }: { card: ApprovalCard; actions: CardActions }) {
  const [revising, setRevising] = useState(false)
  const [note, setNote] = useState('')
  const { busy, error, run } = useAction()
  const open = card.status === 'waiting_approval' && !card.stale
  const state = card.stale ? 'stale' : (card.status ?? 'pending')
  return (
    <CardFrame
      testId={`card-approval-${card.deliverableId}`}
      status={state}
      icon={<Check className="size-4" aria-hidden />}
      kind={t('card.approval')}
      title={card.title}
      badge={
        <span className="flex items-center gap-1.5">
          {card.ownerGate && <Chip tone="warn">{t('card.ownerGate')}</Chip>}
          <Chip tone={open ? 'warn' : state === 'approved' ? 'ok' : 'off'} testId="card-status">
            {statusLabel(state)}
          </Chip>
        </span>
      }
    >
      {card.excerpt && (
        <pre className="max-h-40 overflow-auto rounded-field bg-bg p-2.5 font-mono text-[12px] leading-snug whitespace-pre-wrap text-fg-2">{card.excerpt}</pre>
      )}
      {open && !revising && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="brand" disabled={busy} onClick={() => void run(() => actions.approve(card))}>
            {t('card.approve')}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRevising(true)}>
            {t('card.requestChanges')}
          </Button>
        </div>
      )}
      {open && revising && (
        <div className="mt-3 space-y-2">
          <textarea
            rows={2}
            aria-label={t('card.revisionNote')}
            placeholder={t('card.revisionPlaceholder')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full resize-none rounded-field border border-line-2 bg-bg px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="brand"
              disabled={busy || note.trim() === ''}
              onClick={() =>
                void run(() => actions.requestRevision(card, note.trim())).then((ok) => {
                  if (ok) {
                    setRevising(false)
                    setNote('')
                  }
                })
              }
            >
              {t('card.sendBack')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRevising(false)}>
              {t('card.cancel')}
            </Button>
          </div>
        </div>
      )}
      <ErrorLine message={error} />
    </CardFrame>
  )
}

function BudgetView({ card, actions }: { card: BudgetCard; actions: CardActions }) {
  const { busy, error, run } = useAction()
  const taskId = card.taskId
  const pct = card.capUsd > 0 ? Math.min(100, (card.spentUsd / card.capUsd) * 100) : 100
  return (
    <CardFrame
      testId="card-budget"
      icon={<Wallet className="size-4" aria-hidden />}
      kind={t('section.monetisation')}
      title={t(card.scope === 'global' ? 'card.budget.global' : 'card.budget.channel')}
      badge={<Chip tone="err">{usd(card.spentUsd)}</Chip>}
    >
      <p className="text-[13px] text-fg-2">{card.message}</p>
      <Progress value={pct} className="my-2" />
      <p className="text-[12px] text-fg-3">{t('card.budget.detail', { spent: usd(card.spentUsd), cap: usd(card.capUsd), need: usd(card.requestedUsd) })}</p>
      {taskId !== undefined && card.held && (
        <div className="mt-3">
          <Button size="sm" variant="brand" disabled={busy} onClick={() => void run(() => actions.resumeTask(taskId))}>
            {t('card.retry')}
          </Button>
        </div>
      )}
      <ErrorLine message={error} />
    </CardFrame>
  )
}

function ProposalView({ card, actions }: { card: ProposalCard; actions: CardActions }) {
  const { busy, error, run } = useAction()
  const status = card.status ?? 'pending'
  return (
    <CardFrame
      testId="card-proposal"
      status={status}
      icon={<ListChecks className="size-4" aria-hidden />}
      kind={t('card.proposal')}
      title={card.title}
      badge={
        <Chip tone={status === 'pending' ? 'warn' : status === 'accepted' ? 'ok' : 'off'} testId="card-status">
          {t(`card.proposal.${status}` as MessageKey)}
        </Chip>
      }
    >
      <p className="text-[13px] text-fg-2">{card.detail}</p>
      {status === 'pending' && card.proposalId !== null && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="brand" disabled={busy} onClick={() => void run(() => actions.decideProposal(card, true))}>
            {t('card.confirm')}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => actions.decideProposal(card, false))}>
            {t('card.dismiss')}
          </Button>
        </div>
      )}
      <ErrorLine message={error} />
    </CardFrame>
  )
}

/** French name of a built-in agent (the id made readable for another one). */
const label = (id: string): string => roleName(id)

function TaskView({ card, actions }: { card: TaskCard; actions: CardActions }) {
  const { busy, error, run } = useAction()
  const tone: Tone = card.status === 'failed' ? 'err' : card.status === 'done' ? 'ok' : card.holdReason ? 'warn' : 'info'
  return (
    <CardFrame
      testId="card-task"
      status={card.status}
      icon={<Clapperboard className="size-4" aria-hidden />}
      kind={t('card.task')}
      title={card.title}
      badge={
        <Chip tone={tone} testId="card-status">
          {card.status.replace(/_/g, ' ')}
        </Chip>
      }
    >
      <p className="text-[12px] text-fg-3">{t('card.task.assigned', { who: label(card.assignee) })}</p>
      {card.holdReason && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[12.5px] text-fg-2">{t('card.task.hold', { reason: card.holdReason })}</span>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => actions.resumeTask(card.taskId))}>
            {t('card.retry')}
          </Button>
        </div>
      )}
      {card.status === 'failed' && card.lastError && <p className="mt-2 text-[12px] text-err">{card.lastError}</p>}
      <ErrorLine message={error} />
    </CardFrame>
  )
}

function QcView({ card }: { card: QcCard }) {
  return (
    <CardFrame
      testId="card-qc"
      status={card.passed ? 'passed' : 'failed'}
      icon={<CircleAlert className="size-4" aria-hidden />}
      kind={t('card.qc')}
      title={card.summary}
      badge={<Chip tone={card.passed ? 'ok' : 'err'}>{t(card.passed ? 'card.qc.passed' : 'card.qc.failed')}</Chip>}
    >
      <ul className="space-y-1 text-[13px]">
        {card.items.map((item, i) => (
          <li key={`${i}-${item.label}`} className="flex items-start gap-2">
            {item.ok ? <Check className="mt-0.5 size-3.5 text-ok" aria-hidden /> : <X className="mt-0.5 size-3.5 text-err" aria-hidden />}
            <span>
              {item.label}
              {item.note && <span className="text-fg-3"> — {item.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </CardFrame>
  )
}

function GoalView({ card }: { card: GoalCard }) {
  const pct = card.target > 0 ? Math.min(100, (card.progress / card.target) * 100) : 0
  return (
    <CardFrame
      testId="card-goal"
      icon={<Flag className="size-4" aria-hidden />}
      kind={t('card.goal')}
      title={card.title}
      badge={<Chip tone={pct >= 100 ? 'ok' : 'info'}>{`${Math.round(pct)} %`}</Chip>}
    >
      <Progress value={pct} className="mb-1.5" />
      <div className="flex justify-between text-[12px] text-fg-3">
        <span>{t('card.goal.progress', { done: card.progress, target: card.target, unit: card.unit })}</span>
        {card.deadline && <span>{t('card.goal.deadline', { date: card.deadline })}</span>}
      </div>
    </CardFrame>
  )
}

const ENGINE_TONE: Record<EngineCard['state'], Tone> = { queued: 'off', running: 'info', done: 'ok', error: 'err' }

function EngineView({ card }: { card: EngineCard }) {
  return (
    <CardFrame
      testId="card-engine"
      status={card.state}
      icon={<Clapperboard className="size-4" aria-hidden />}
      kind={t('card.engine')}
      title={card.title}
      badge={
        <Chip tone={ENGINE_TONE[card.state]} testId="card-status">
          {t(`card.engine.${card.state}` as MessageKey)}
        </Chip>
      }
    >
      <div className="mb-1.5 flex justify-between text-[12px] text-fg-3">
        <span>{card.stage}</span>
        <span className="font-mono">{Math.round(card.percent)} %</span>
      </div>
      <Progress value={card.percent} />
      {card.detail && <p className={cn('mt-2 text-[12.5px]', card.state === 'error' ? 'text-err' : 'text-fg-2')}>{card.detail}</p>}
    </CardFrame>
  )
}

function HandoffView({ card, nameOf }: { card: HandoffCard; nameOf: (id: string) => string }) {
  return (
    <CardFrame
      testId="card-handoff"
      status={card.state}
      icon={<ArrowRight className="size-4" aria-hidden />}
      kind={t('card.handoff')}
      title={t('card.handoff.line', { from: nameOf(card.from), to: nameOf(card.to) })}
      badge={
        <Chip tone={card.state === 'answered' ? 'ok' : card.state === 'refused' ? 'err' : 'info'} testId="card-status">
          {t(`card.handoff.${card.state}` as MessageKey)}
        </Chip>
      }
    >
      <p className="text-[13px] text-fg-2">{card.ask}</p>
      {card.reason && (
        <p data-testid="handoff-reason" className="mt-1.5 text-[12.5px] text-err">
          {card.reason}
        </p>
      )}
      {card.answerExcerpt && <p className="mt-2 border-l-2 border-line-2 pl-3 text-[12.5px] text-fg-3">{card.answerExcerpt}</p>}
    </CardFrame>
  )
}

export function CardView({
  card,
  actions,
  nameOf = label
}: {
  card: AnyCard
  actions: CardActions
  /** Name of an agent as this conversation shows it (the lead's name for the Supervisor's route). */
  nameOf?: (id: string) => string
}) {
  switch (card.type) {
    case 'approval':
      return <ApprovalView card={card} actions={actions} />
    case 'budget':
      return <BudgetView card={card} actions={actions} />
    case 'proposal':
      return <ProposalView card={card} actions={actions} />
    case 'task':
      return <TaskView card={card} actions={actions} />
    case 'qc':
      return <QcView card={card} />
    case 'goal':
      return <GoalView card={card} />
    case 'engine':
      return <EngineView card={card} />
    case 'handoff':
      return <HandoffView card={card} nameOf={nameOf} />
  }
}
