// « Créer une pipeline » on the new cloning engine, P0 → P10, as ONE screen that changes stage: the intake conversation,
// the progress while it works, the illustrated report. It owns no engine: everything comes in through `CloneEngine`
// (the assembler binds it to the API; previews and tests bind it to fakes) and the pictures through `CloneFiles`.
// Not wired to a route yet.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CloneProgress, IntakeState, IntakeTurn, Report } from '../../../../shared/clone'
import { tc } from '../../../../shared/fr-clone'
import { CloneFilesContext, type CloneFiles } from './files'
import { IntakePanel, type ChatLine } from './IntakePanel'
import { ProgressPanel } from './ProgressPanel'
import { ReportPanel } from './ReportPanel'

/** What the screen needs from the engine. `start` hands over the finished intake; `progress` and `report` are read again
 *  while it works (they come from the saved artefacts, so they survive a restart). */
export interface CloneEngine {
  startIntake(): IntakeState
  intakeTurn(state: IntakeState, message: string): Promise<IntakeTurn> | IntakeTurn
  start(state: IntakeState): Promise<void> | void
  progress(): Promise<CloneProgress | null> | CloneProgress | null
  report(): Promise<Report | null> | Report | null
  resume?(budgetUsd?: number): Promise<void> | void
  /** His answer to the clone's question (which of the channel's styles). */
  answer?(style: string): Promise<void> | void
}

export interface CloneFlowProps {
  engine: CloneEngine
  files: CloneFiles
  /** Ask again every N ms while it works. */
  pollMs?: number
  /** Show the stage straight away (a clone already running or finished, reopened later). */
  initial?: 'intake' | 'progress' | 'report'
  budgetUsd?: number | null
  onNew?: () => void
}

export function CloneFlow({ engine, files, pollMs = 4000, initial = 'intake', budgetUsd = null, onNew }: CloneFlowProps) {
  const [stage, setStage] = useState<'intake' | 'progress' | 'report'>(initial)
  const [state, setState] = useState<IntakeState>(() => engine.startIntake())
  const [lines, setLines] = useState<ChatLine[]>([])
  const [latest, setLatest] = useState<IntakeTurn | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<CloneProgress | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  /** The `createdAt` of a budget-stop report he chose to go on from: it is not shown again (a newer one will be). */
  const [dismissed, setDismissed] = useState<string | null>(null)
  const next = useRef(1)

  const send = useCallback(async (text: string) => {
    setBusy(true)
    setLines((l) => [...l, { id: next.current++, role: 'user', text }])
    try {
      const turn = await engine.intakeTurn(state, text)
      setState(turn.state)
      setLatest(turn)
      setLines((l) => [...l, { id: next.current++, role: 'agent', turn }])
    } catch {
      // never leave his line without an answer
      const failed: IntakeTurn = { state, changes: [], reply: [{ key: 'clone.intake.error', vars: {} }], missing: latest?.missing ?? [], question: null, ready: latest?.ready ?? false }
      setLines((l) => [...l, { id: next.current++, role: 'agent', turn: failed }])
    } finally { setBusy(false) }
  }, [engine, state, latest])

  const start = useCallback(async () => {
    setBusy(true)
    try { await engine.start(state); setStage('progress') } finally { setBusy(false) }
  }, [engine, state])

  // While it works: read the saved artefacts again; when the report is final, show it.
  useEffect(() => {
    if (stage === 'intake') return
    let live = true
    const read = async (): Promise<void> => {
      const [p, r] = await Promise.all([engine.progress(), engine.report()])
      if (!live) return
      setProgress(p)
      setReport(r)
      if (r && r.createdAt !== dismissed && stage === 'progress') setStage('report')
    }
    void read()
    const h = setInterval(() => void read(), pollMs)
    return () => { live = false; clearInterval(h) }
  }, [engine, stage, pollMs, dismissed])

  return (
    <CloneFilesContext.Provider value={files}>
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 px-4 py-6" data-testid="clone-flow" data-stage={stage}>
        <header className="flex flex-col gap-1">
          <h1 className="m-0 text-[22px] font-semibold tracking-tight text-fg">{tc('clone.title')}</h1>
          <p className="m-0 text-[13.5px] text-fg-3">{tc('clone.subtitle')}</p>
        </header>
        {stage === 'intake' && <IntakePanel lines={lines} state={state} latest={latest} onSend={(t) => void send(t)} onStart={() => void start()} busy={busy} />}
        {stage === 'progress' && !progress && <p className="m-0 text-fg-3" aria-busy="true">{tc('clone.frame.loading')}</p>}
        {stage === 'progress' && progress && <ProgressPanel progress={progress} onResume={engine.resume ? () => void engine.resume!() : undefined} onAnswer={engine.answer ? (s) => void engine.answer!(s) : undefined} />}
        {stage === 'report' && report && <ReportPanel report={report} budgetUsd={budgetUsd ?? progress?.budgetUsd ?? state.draft.testBudgetUsd} onNew={onNew} onAgain={engine.resume ? (b) => { setDismissed(report.createdAt); setStage('progress'); void engine.resume!(b) } : undefined} />}
        {stage === 'report' && !report && <p className="m-0 text-fg-3" aria-busy="true">{tc('clone.progress.fact.now.report')}</p>}
      </div>
    </CloneFilesContext.Provider>
  )
}
