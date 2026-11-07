// Typed cards inside chat bubbles. Pure presentation: the approval card reports the owner's decision upward.
import { useState } from 'react'
import type { ApprovalCard, BudgetCard, Card, ProposalCard, QcCard, TaskCard } from '../../../shared/chat'

export interface CardActions {
  approve: (card: ApprovalCard) => Promise<void> | void
  requestRevision: (card: ApprovalCard, note: string) => Promise<void> | void
  decideProposal: (card: ProposalCard, accept: boolean) => Promise<void> | void
  resumeTask: (taskId: number) => Promise<void> | void
}

/** Runs an action with busy/error state, shared by the cards that have buttons. */
function useAction(): { busy: boolean; error: string | null; run: (fn: () => Promise<void> | void) => Promise<void> } {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<void> | void): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

const PROPOSAL_LABEL: Record<string, string> = {
  pending: 'Waiting for you',
  accepted: 'Confirmed',
  rejected: 'Dismissed',
  expired: 'Expired'
}

const STATUS_LABEL: Record<string, string> = {
  waiting_approval: 'Waiting for you',
  approved: 'Approved',
  revision_requested: 'Sent back',
  pending: 'Reopened',
  in_progress: 'In progress',
  done: 'Done'
}

export function CardView({ card, actions }: { card: Card; actions: CardActions }) {
  switch (card.type) {
    case 'approval':
      return <ApprovalCardView card={card} actions={actions} />
    case 'budget':
      return <BudgetCardView card={card} actions={actions} />
    case 'proposal':
      return <ProposalCardView card={card} actions={actions} />
    case 'task':
      return <TaskCardView card={card} actions={actions} />
    case 'qc':
      return <QcCardView card={card} />
  }
}

function ApprovalCardView({ card, actions }: { card: ApprovalCard; actions: CardActions }) {
  const [revising, setRevising] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const open = card.status === 'waiting_approval' && !card.stale

  const run = async (fn: () => Promise<void> | void): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setRevising(false)
      setNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const state = card.stale ? 'Superseded' : (STATUS_LABEL[card.status ?? ''] ?? card.status ?? '')
  return (
    <div className="chat-card" data-testid={`card-approval-${card.deliverableId}`} data-status={card.stale ? 'stale' : card.status}>
      <div className="chat-card-head">
        <strong>{card.title}</strong>
        {card.ownerGate && <span className="badge">owner gate</span>}
        <span className={`badge status-${card.stale ? 'stale' : (card.status ?? 'unknown')}`} data-testid="card-status">
          {state}
        </span>
      </div>
      {card.excerpt && <pre className="chat-card-excerpt">{card.excerpt}</pre>}
      {open && !revising && (
        <div className="chat-card-actions">
          <button className="button primary" disabled={busy} onClick={() => void run(() => actions.approve(card))}>
            Approve
          </button>
          <button className="button" disabled={busy} onClick={() => setRevising(true)}>
            Request changes
          </button>
        </div>
      )}
      {open && revising && (
        <div className="chat-card-revise">
          <textarea
            className="input"
            rows={2}
            placeholder="What should change?"
            aria-label="Revision note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="chat-card-actions">
            <button
              className="button primary"
              disabled={busy || note.trim() === ''}
              onClick={() => void run(() => actions.requestRevision(card, note.trim()))}
            >
              Send back
            </button>
            <button className="button" disabled={busy} onClick={() => setRevising(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

const usd = (n: number): string => `$${n.toFixed(2)}`

function BudgetCardView({ card, actions }: { card: BudgetCard; actions: CardActions }) {
  const { busy, error, run } = useAction()
  const taskId = card.taskId
  return (
    <div className="chat-card" data-testid="card-budget">
      <div className="chat-card-head">
        <strong>{card.scope === 'global' ? 'Global budget reached' : 'Channel budget reached'}</strong>
      </div>
      <p className="small">{card.message}</p>
      <p className="muted small">
        Spent {usd(card.spentUsd)} of {usd(card.capUsd)}; this call needed about {usd(card.requestedUsd)}. Raise the cap
        in the Spend view to continue.
      </p>
      {taskId !== undefined && card.held && (
        <div className="chat-card-actions">
          <button className="button primary" disabled={busy} onClick={() => void run(() => actions.resumeTask(taskId))}>
            Try again
          </button>
        </div>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function ProposalCardView({ card, actions }: { card: ProposalCard; actions: CardActions }) {
  const { busy, error, run } = useAction()
  const status = card.status ?? 'pending'
  return (
    <div className="chat-card" data-testid="card-proposal" data-status={status}>
      <div className="chat-card-head">
        <strong>{card.title}</strong>
        <span className="badge">proposal</span>
        <span className={`badge status-${status}`} data-testid="card-status">
          {PROPOSAL_LABEL[status] ?? status}
        </span>
      </div>
      <p className="small">{card.detail}</p>
      {status === 'pending' && card.proposalId !== null && (
        <div className="chat-card-actions">
          <button className="button primary" disabled={busy} onClick={() => void run(() => actions.decideProposal(card, true))}>
            Confirm
          </button>
          <button className="button" disabled={busy} onClick={() => void run(() => actions.decideProposal(card, false))}>
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function TaskCardView({ card, actions }: { card: TaskCard; actions: CardActions }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resume = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await actions.resumeTask(card.taskId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="chat-card" data-testid="card-task" data-status={card.status}>
      <div className="chat-card-head">
        <strong>{card.title}</strong>
        <span className="badge" data-testid="card-status">
          {card.status.replace(/_/g, ' ')}
        </span>
      </div>
      <p className="muted small">Assigned to {card.assignee.replace(/_/g, ' ')}</p>
      {card.holdReason && (
        <div className="chat-card-actions">
          <span className="small">On hold: {card.holdReason}</span>
          <button className="button" disabled={busy} onClick={() => void resume()}>
            Try again
          </button>
        </div>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {card.status === 'failed' && card.lastError && <p className="error small">{card.lastError}</p>}
    </div>
  )
}

function QcCardView({ card }: { card: QcCard }) {
  return (
    <div className="chat-card" data-testid="card-qc">
      <div className="chat-card-head">
        <strong>Quality check</strong>
        <span className={card.passed ? 'badge ok' : 'badge error'}>{card.passed ? 'passed' : 'failed'}</span>
      </div>
      <p className="small">{card.summary}</p>
      <ul className="chat-card-list">
        {card.items.map((item) => (
          <li key={item.label} className={item.ok ? 'ok' : 'error'}>
            {item.ok ? '✓' : '✗'} {item.label}
            {item.note ? <span className="muted"> — {item.note}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
