// The theatre of one run: header and actions, the live node list (ShimmeringText on the running step) and, for the
// selected node, its review panel with the gate decision (approve, or send back with a note). Above them, the graph of
// the project's pipeline lit with the run's state (production-13). A « Moteur réel » run (production-16) shows, under each
// brick that bought something, the engines its Atelier Cloud jobs really used (real or the Cloud's demo) and their cost.
import { Ban, Check, CirclePlay, RefreshCw, RotateCcw, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { RunDetail, RunNode, RunNodeEngine } from '../../../../shared/runs'
import { ClaudeVideoUsage } from '@/components/atelier/ClaudeUsage'
import { DemoBadge } from '@/components/atelier/demo'
import { useConfirm } from '@/components/atelier/confirm'
import { ErrorLine, ExampleBadge, LoadingBlock, fmtCredits } from '@/components/atelier/kit'
import { Panel, StatusDot } from '@/components/atelier/primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { call, errText, useLoader } from '@/state/client'
import { ShimmeringText } from '@/vendor/elevenlabs-ui'
import { NODE_TONE, RunStatusChip, focusRun, fmtDuration } from '../shared'
import { RunGraph } from '../graphe/RunGraph'
import { OutputView } from './Reviews'

const HAS_OUTPUT = new Set(['done', 'cached', 'waiting_gate'])

function GatePanel({ run, node, onDone }: { run: RunDetail; node: RunNode; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'approve' | 'changes' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const act = async (kind: 'approve' | 'changes'): Promise<void> => {
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'approve') await call('production.approve', run.id, node.nodeId)
      else await call('production.requestChanges', run.id, node.nodeId, note.trim())
      toast.success(t(kind === 'approve' ? 'production.live.approved' : 'production.live.sentBack'))
      setNote('')
      onDone()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="flex flex-col gap-3 rounded-card border border-warn/40 bg-warn/5 p-4" data-testid="gate-panel">
      <p className="m-0 text-[13px] text-fg">{t(node.gateKind === 'owner' ? 'production.live.gateOwner' : 'production.live.gateReview', { name: node.label })}</p>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
        placeholder={t('production.live.notePlaceholder')}
        aria-label={t('production.live.note')}
        className="min-h-16"
      />
      {error && <ErrorLine message={error} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="brand" onClick={() => void act('approve')} disabled={busy !== null} data-testid="approve">
          <Check aria-hidden />
          {t('production.live.approve')}
        </Button>
        <Button variant="secondary" onClick={() => void act('changes')} disabled={busy !== null || note.trim() === ''} data-testid="request-changes">
          <Undo2 aria-hidden />
          {t('production.live.changes')}
        </Button>
        {note.trim() === '' && <span className="text-[11.5px] text-fg-3">{t('production.live.noteNeeded')}</span>}
      </div>
    </div>
  )
}

function NodePanel({ run, node, onChanged }: { run: RunDetail; node: RunNode; onChanged: () => void }) {
  const key = `${run.id}:${node.nodeId}:${node.fingerprint ?? ''}:${node.state}`
  const out = useLoader(() => call('production.output', run.id, node.nodeId), key, [])
  return (
    <Panel title={node.label} data-testid="node-panel" className="flex flex-col gap-4">
      {node.changeNote && <p className="m-0 text-[12px] text-fg-3">{t('production.live.lastNote', { note: node.changeNote })}</p>}
      {out.error && <ErrorLine message={out.error} onRetry={out.reload} />}
      {!out.data && !out.error && <LoadingBlock rows={3} />}
      {out.data && <OutputView runId={run.id} out={out.data} />}
      {node.gate === 'waiting' && <GatePanel run={run} node={node} onDone={onChanged} />}
    </Panel>
  )
}

/** `presenter:heygen-mcp` → `heygen-mcp`; the Cloud's demo ids stay as they are (`fake-avatar`). */
const engineName = (id: string): string => id.replace(/^[a-z]+:/, '')

function Engines({ engines }: { engines: readonly RunNodeEngine[] }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-fg-3" data-testid="node-engines">
      {engines.map((e) => (
        <span key={`${e.id}:${String(e.real)}`} data-real={e.real ? 'true' : 'false'}>
          {engineName(e.id)} · <span className={e.real ? 'text-ok' : 'text-warn'}>{t(e.real ? 'runs.real.engine.real' : 'runs.real.engine.demo')}</span> · {fmtCredits(e.credits)}
        </span>
      ))}
    </span>
  )
}

function NodeRow({ node, selected, onSelect }: { node: RunNode; selected: boolean; onSelect: () => void }) {
  const running = node.state === 'running'
  const openable = HAS_OUTPUT.has(node.state)
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={!openable}
        aria-current={selected ? 'true' : undefined}
        data-testid="node-row"
        data-state={node.state}
        className={cn(
          'flex w-full flex-col gap-1.5 rounded-field border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/60',
          selected ? 'border-brand/60 bg-brand-soft' : 'border-line bg-surface-1 enabled:hover:bg-surface-2',
          node.state === 'waiting_gate' && 'border-warn/50'
        )}
      >
        <span className="flex items-center gap-2">
          <StatusDot tone={NODE_TONE[node.state]} pulse={running} />
          <span className="flex-1 truncate text-[13px] font-medium text-fg">{node.label}</span>
          <span className="micro-label">{t(`runs.state.${node.state}` as MessageKey)}</span>
          {(node.credits > 0 || node.quoteCredits > 0) && (
            <span className="w-24 text-right text-[12px] text-fg-3 tabular-nums">{node.credits > 0 ? fmtCredits(node.credits) : `~ ${fmtCredits(node.quoteCredits)}`}</span>
          )}
        </span>
        {node.engines.length > 0 && <Engines engines={node.engines} />}
        {running && (
          <>
            <Progress value={Math.round(node.progress * 100)} className="h-1" aria-label={node.label} />
            <ShimmeringText text={node.step ?? t('production.live.working')} className="text-[12px]" />
          </>
        )}
        {node.error && (
          <span className="text-[12px] text-err" role="alert">
            {node.error.message}
          </span>
        )}
      </button>
    </li>
  )
}

export function RunDetailView({ runId, onRedone }: { runId: number; onRedone: (id: number) => void }) {
  const confirm = useConfirm()
  const detail = useLoader(() => call('production.get', runId), String(runId), ['production', 'credits', 'example'])
  const [picked, setPicked] = useState<string | null>(null)
  const run = detail.data

  const act = async (fn: () => Promise<RunDetail>, ok?: string): Promise<RunDetail | null> => {
    try {
      const r = await fn()
      if (ok) toast.success(ok)
      detail.reload()
      return r
    } catch (err) {
      toast.error(errText(err))
      return null
    }
  }

  if (detail.error && !run) return <ErrorLine message={detail.error} onRetry={detail.reload} />
  if (!run) return <LoadingBlock rows={5} />

  const waitingNode = run.nodes.find((n) => n.gate === 'waiting') ?? null
  const selected = run.nodes.find((n) => n.nodeId === (picked ?? waitingNode?.nodeId ?? '')) ?? null
  const active = run.status === 'queued' || run.status === 'running' || run.status === 'waiting'
  const canResume = run.status === 'interrupted' || (run.status === 'waiting' && !run.live)
  const canRetry = run.status === 'failed' || run.status === 'cancelled'

  const cancel = async (): Promise<void> => {
    const ok = await confirm({ title: t('production.live.cancelTitle'), description: t('production.live.cancelBody'), confirmLabel: t('production.live.cancelConfirm'), danger: true })
    if (ok) await act(() => call('production.cancel', run.id), t('production.live.cancelled'))
  }
  const redo = async (): Promise<void> => {
    const r = await act(() => call('production.redo', run.id), t('production.live.redone'))
    if (r) {
      focusRun(r.id)
      onRedone(r.id)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="run-detail">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate font-serif text-[26px] leading-tight text-fg">{run.videoTitle}</h2>
          <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-[12px] text-fg-3">
            <span>{run.channelName}</span>
            <span>·</span>
            <span>{t('production.live.pipeline', { name: run.pipelineLabel, version: run.pipelineVersion })}</span>
            <span>·</span>
            <span>{t(`runs.budget.${run.budgetMode}` as MessageKey)}</span>
            <span>·</span>
            <span>{t(`runs.gateMode.${run.gateMode}` as MessageKey)}</span>
            {run.demo && <DemoBadge title={t('runs.demo.reason')} />}
            {run.cloud && (
              <Badge variant="outline" title={t('runs.real.hint')} data-testid="run-real-badge">
                {t('runs.real.badge')}
              </Badge>
            )}
            {run.example && <ExampleBadge />}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canResume && (
            <Button variant="brand" size="sm" onClick={() => void act(() => call('production.resume', run.id), t('production.live.resumed'))} data-testid="resume">
              <CirclePlay aria-hidden />
              {t('production.live.resume')}
            </Button>
          )}
          {canRetry && (
            <Button variant="brand" size="sm" onClick={() => void act(() => call('production.retry', run.id), t('production.live.retried'))} data-testid="retry">
              <RefreshCw aria-hidden />
              {t('production.live.retry')}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => void redo()} data-testid="redo">
            <RotateCcw aria-hidden />
            {t('production.live.redo')}
          </Button>
          {active && (
            <Button variant="outline" size="sm" onClick={() => void cancel()} data-testid="cancel">
              <Ban aria-hidden />
              {t('production.live.cancel')}
            </Button>
          )}
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px] text-fg-2">
        <RunStatusChip status={run.status} />
        <span>{t('production.live.spent', { spent: run.demo ? t('production.live.demoSpent') : fmtCredits(run.spentCredits), quote: fmtCredits(run.quoteCredits) })}</span>
        {run.durationS !== null && <span>{t('production.live.length', { d: fmtDuration(run.durationS) })}</span>}
        <span className="min-w-40 flex-1">
          <Progress value={Math.round(run.progress * 100)} className="h-1.5" aria-label={t('production.live.progress')} />
        </span>
      </div>
      {run.status === 'succeeded' && <ClaudeVideoUsage videoId={run.videoId} reloadKey={String(run.id)} />}
      {run.current && (
        <p className="m-0 text-[13px]" data-testid="current-step">
          <ShimmeringText text={`${run.current.label}${run.current.step ? ` — ${run.current.step}` : ''}`} />
        </p>
      )}
      {run.error && <ErrorLine message={run.error} />}
      <RunGraph run={run} onPick={setPicked} />
      <div className="grid gap-4 xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t('production.live.steps')} data-testid="node-list">
          {run.nodes.map((n) => (
            <NodeRow key={n.nodeId} node={n} selected={selected?.nodeId === n.nodeId} onSelect={() => setPicked(n.nodeId)} />
          ))}
        </ol>
        {selected ? (
          <NodePanel key={selected.nodeId} run={run} node={selected} onChanged={detail.reload} />
        ) : (
          <Panel className="text-[13px] text-fg-3">{t('production.live.pickNode')}</Panel>
        )}
      </div>
      {detail.error && <ErrorLine message={detail.error} onRetry={detail.reload} />}
    </div>
  )
}
