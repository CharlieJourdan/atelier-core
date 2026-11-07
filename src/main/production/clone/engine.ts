// « Créer une pipeline » on the cloning engine (moteur-assemblage): the service behind the screen and `clone.*`. The intake
// conversation is pure (E); `start` turns its answers into a clone and runs P0→P10 in the background with the real
// services; the clone is resumable at any time (each phase's artefact is re-checked, never trusted blindly), and a clone
// that was working when the app stopped is resumed when it starts again. Nothing inside the loop waits for a person (decision
// 0110): several styles on the channel → the one his words name, else the dominant one, said in the decisions; only money
// beyond the test budget stops it (more budget resumes it). His later word on the style is an override. What the screen shows is read
// only from the saved artefacts (`cloneProgress`), so a restart loses nothing. At the end the intermediate files go.
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Brief, Report, type CloneProgress, type IntakeState, type IntakeTurn } from '../../../shared/clone'
import type { CloneFile, CloneRunState, CloneSummary } from '../../../shared/api/clone'
import { tc } from '../../../shared/fr-clone'
import { cleanIntermediates } from './create'
import { ExitRefused } from './exit-check'
import { changeLines } from './intake/change-lines'
import { intakeAnswers, intakeTurn, startIntake } from './intake/conversation'
import { cloneProgress } from './intake/progress'
import { CloudUnreachable } from './cloud-down'
import { DiskLow, runClone } from './orchestrator'
import type { IntakeAnswers } from './p0-intake'
import type { CloneServices } from './services'
import { ARTEFACTS, CloneStore } from './store'

/** Marks a clone the engine is working on (removed when it stops): found at start, the clone is resumed. */
export const ACTIVE_FILE = 'active.json'
/** What the engine last said about a clone outside the phases (a question, a stop, an error). */
export const STATE_FILE = 'engine-state.json'

export type { CloneFile, CloneRunState, CloneSummary }

export interface CloneEngineDeps {
  dataDir: string
  services(cloneId: string): CloneServices
  notify(): void
  now(): Date
  /** Resume the clones that were working when the app stopped (the real app; tests say no). */
  resumeOnStart?: boolean
  /** A clone deleted: its workspace objects go too (its own channel). */
  onRemove?(cloneId: string): void
  log?(line: string): void
}

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.json': 'application/json', '.txt': 'text/plain' }
const MAX_FILE_BYTES = 80 * 1024 * 1024

/** A readable clone id: date + the reference's handle (`2026-11-04-lemondeenpov`), unique in the folder. */
export function cloneIdFor(answers: IntakeAnswers, now: Date, taken: (id: string) => boolean): string {
  const url = answers.references[0]?.url ?? ''
  const handle = (/@([\w.-]+)/.exec(url)?.[1] ?? /[?&]v=([\w-]+)/.exec(url)?.[1] ?? /youtu\.be\/([\w-]+)/.exec(url)?.[1] ?? 'clone').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'clone'
  const base = `${now.toISOString().slice(0, 10)}-${handle}`
  let id = base
  for (let i = 2; taken(id); i++) id = `${base}-${i}`
  return id
}

export class CloneEngine {
  private readonly active = new Map<string, Promise<void>>()
  private readonly root: string

  constructor(private readonly d: CloneEngineDeps) {
    this.root = path.join(d.dataDir, 'clones')
    if (d.resumeOnStart) {
      for (const id of this.ids()) if (existsSync(path.join(this.root, id, ACTIVE_FILE))) { d.log?.(`clone ${id}: resumed after a restart`); this.launch(id) }
    }
  }

  // ---- the intake (pure, E) --------------------------------------------------------------------------------------------

  startIntake(): IntakeState { return startIntake() }

  /** One turn of the conversation, with its French text (the screen renders the keys itself; brain-run prints `text`). */
  intakeTurn(state: unknown, message: unknown): IntakeTurn & { text: string } {
    if (typeof message !== 'string') throw new Error('Message invalide.')
    const turn = intakeTurn(checkState(state), message.slice(0, 4000))
    const lines = [
      ...turn.reply.map((r) => tc(r.key, r.vars)),
      ...changeLines(turn.changes).map((l) => `· ${l}`),
      ...(turn.question ? [tc(turn.question)] : turn.ready ? [tc('clone.intake.ready')] : [])
    ]
    return { ...turn, text: lines.join('\n') }
  }

  /** The brief is complete: a new clone starts (P0 → P10 in the background). */
  start(state: unknown): { cloneId: string } {
    const answers = intakeAnswers(checkState(state))
    const id = cloneIdFor(answers, this.d.now(), (x) => existsSync(path.join(this.root, x)))
    const store = new CloneStore(this.d.dataDir, id)
    store.save('p0-answers.json', answers)
    this.launch(id)
    return { cloneId: id }
  }

  /** A clone from a written brief, without the intake conversation (reverse-pipeline: `reverse.start`): `files` are saved in
   *  its folder first (the reverse request it comes from), then P0 → P10 runs in the background like `start`. */
  startAnswers(answers: IntakeAnswers, files: Readonly<Record<string, unknown>> = {}): { cloneId: string } {
    const id = cloneIdFor(answers, this.d.now(), (x) => existsSync(path.join(this.root, x)))
    const store = new CloneStore(this.d.dataDir, id)
    for (const [name, value] of Object.entries(files)) store.save(name, value)
    store.save('p0-answers.json', answers)
    this.launch(id)
    return { cloneId: id }
  }

  /** Where the clones live, the services a clone runs with and the clock (reverse-pipeline: a transform writes a new clone). */
  get dataDir(): string { return this.d.dataDir }
  servicesFor(cloneId: string): CloneServices { return this.d.services(cloneId) }
  clock(): Date { return this.d.now() }
  changed(): void { this.d.notify() }

  // ---- following a clone ------------------------------------------------------------------------------------------------

  list(): CloneSummary[] {
    return this.ids().map((id) => this.summary(id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  summary(id: string): CloneSummary {
    const store = this.store(id)
    const brief = safe(() => store.load(ARTEFACTS.brief, Brief))
    const answers = this.answers(store)
    return {
      id,
      title: brief?.references[0]?.url ?? answers?.references[0]?.url ?? id,
      createdAt: brief?.createdAt ?? statSync(store.dir).birthtime.toISOString(),
      state: this.state(id),
      spentUsd: Math.round(store.spent() * 1000) / 1000,
      budgetUsd: brief?.testBudgetUsd ?? answers?.testBudgetUsd ?? null
    }
  }

  state(id: string): CloneRunState {
    if (this.active.has(id)) return { kind: 'running' }
    const store = this.store(id)
    const report = safe(() => store.load(ARTEFACTS.report, Report))
    const saved = safe(() => JSON.parse(readFileSync(store.file(STATE_FILE), 'utf8')) as CloneRunState)
    // « running » saved by a process that is not running it any more (a crash), or a question saved by an older engine (it
    // paused on several styles or its free demo; nothing waits for a person now): it waits to be resumed
    if (saved?.kind === 'running' || (saved as { kind: string } | null)?.kind === 'asking') return { kind: 'idle' }
    if (report && report.outcome !== 'stopped-budget') return { kind: 'done', outcome: report.outcome }
    return saved ?? { kind: 'idle' }
  }

  progress(id: string): CloneProgress & { state: CloneRunState } {
    const store = this.store(id)
    return { ...cloneProgress(store, { active: this.active.has(id) }), state: this.state(id) }
  }

  report(id: string): Report | null { return safe(() => this.store(id).load(ARTEFACTS.report, Report)) }

  /** A file of the clone (frames, renders, artefacts), refused outside its folder. */
  async file(id: string, rel: unknown): Promise<CloneFile> {
    if (typeof rel !== 'string' || rel.includes('..') || path.isAbsolute(rel) || !/^[\w./ -]+$/.test(rel)) throw new Error('Fichier inconnu.')
    const abs = this.store(id).file(rel)
    const mime = MIME[path.extname(abs).toLowerCase()]
    if (!mime || !existsSync(abs)) throw new Error('Fichier absent.')
    if (statSync(abs).size > MAX_FILE_BYTES) throw new Error('Fichier trop lourd pour l’écran.')
    return { mime, bytes: new Uint8Array(await readFile(abs)) }
  }

  // ---- acting on a clone ------------------------------------------------------------------------------------------------

  /** Goes on from the last saved artefact (after a stop: more budget, disk freed, an error fixed). */
  resume(id: string, budgetUsd?: unknown): CloneSummary {
    const store = this.store(id)
    if (budgetUsd !== undefined && budgetUsd !== null) {
      if (typeof budgetUsd !== 'number' || !(budgetUsd > 0) || budgetUsd > 1000) throw new Error('Budget invalide.')
      const brief = store.load(ARTEFACTS.brief, Brief)
      if (brief) store.save(ARTEFACTS.brief, { ...brief, testBudgetUsd: budgetUsd })
      const answers = this.answers(store)
      if (answers) store.save('p0-answers.json', { ...answers, testBudgetUsd: budgetUsd })
      store.decide({ at: this.d.now().toISOString(), phase: 'p0', decision: 'budget', why: `the user set the test budget to ${budgetUsd} $` })
    }
    this.launch(id)
    return this.summary(id)
  }

  /**
   * An optional override of the style P2 picked (it never waits for this): the style his words name goes into the brief and,
   * while no paid round has run on the old pick, the synthesis is made again from it (the old one kept as evidence); after that
   * it is too late for this clone (a new clone takes the new style). Not while the clone works.
   */
  answer(id: string, style: unknown): CloneSummary {
    if (typeof style !== 'string' || !style.trim()) throw new Error('Réponse vide.')
    const store = this.store(id)
    if (this.active.has(id)) throw new Error('Ce clonage travaille encore : attends qu’il s’arrête.')
    if (store.has(ARTEFACTS.feasibility)) throw new Error('Ce clonage a déjà choisi son style et avancé : lance un nouveau clonage avec ce style.')
    const said = style.trim()
    const brief = store.load(ARTEFACTS.brief, Brief)
    if (brief) store.save(ARTEFACTS.brief, { ...brief, style: said.slice(0, 200), said: [...brief.said, said.slice(0, 280)] })
    const answers = this.answers(store)
    if (answers) store.save('p0-answers.json', { ...answers, style: said.slice(0, 200) })
    const synthesis = store.file(ARTEFACTS.synthesis)
    if (existsSync(synthesis)) renameSync(synthesis, store.file(ARTEFACTS.synthesis.replace(/\.json$/, `.before-style-${this.d.now().getTime()}.json`)))
    store.decide({ at: this.d.now().toISOString(), phase: 'p2', decision: 'style named by the user', why: `« ${said.slice(0, 200)} »: the synthesis is made again from it` })
    this.setState(store, { kind: 'idle' })
    this.launch(id)
    return this.summary(id)
  }

  /** Deletes a clone and everything it saved (not while it works). */
  remove(id: string): { removed: boolean } {
    if (this.active.has(id)) throw new Error('Ce clonage travaille encore : attends qu’il s’arrête.')
    const dir = this.store(id).dir
    this.d.onRemove?.(id)
    rmSync(dir, { recursive: true, force: true })
    this.d.notify()
    return { removed: true }
  }

  /** Resolves when a clone stops (tests, brain-run). */
  async settled(id: string): Promise<void> { await this.active.get(id) }

  // ---- inside ------------------------------------------------------------------------------------------------------------

  private launch(id: string): void {
    if (this.active.has(id)) return
    const store = this.store(id)
    const answers = this.answers(store)
    if (!answers) throw new Error('Ce clonage n’a pas de brief.')
    writeFileSync(store.file(ACTIVE_FILE), JSON.stringify({ since: this.d.now().toISOString(), pid: process.pid }) + '\n')
    this.setState(store, { kind: 'running' })
    const job = (async () => {
      try {
        const report = await runClone({ dataDir: this.d.dataDir, cloneId: id, services: this.d.services(id), answers })
        this.setState(store, report.outcome === 'stopped-budget' ? { kind: 'stopped', why: tc('clone.progress.stopped.budget') } : { kind: 'done', outcome: report.outcome })
        if (report.outcome !== 'stopped-budget') {
          const gone = cleanIntermediates(store, this.d.dataDir)
          store.decide({ at: this.d.now().toISOString(), phase: 'cleanup', decision: 'intermediates removed', why: gone.join(', ') || 'nothing to remove' })
        }
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e)
        if (e instanceof CloudUnreachable) store.decide({ at: this.d.now().toISOString(), phase: 'engine', decision: 'cloud-unreachable', why: e.detail.slice(0, 500) })
        else if (!(e instanceof ExitRefused) && !(e instanceof DiskLow)) store.decide({ at: this.d.now().toISOString(), phase: 'engine', decision: 'error', why: why.slice(0, 2000) })
        this.setState(store, { kind: 'stopped', why: why.slice(0, 2000) })
        this.d.log?.(`clone ${id} stopped: ${why}`)
      } finally {
        rmSync(store.file(ACTIVE_FILE), { force: true })
        this.active.delete(id)
        this.d.notify()
      }
    })()
    this.active.set(id, job)
    this.d.notify()
  }

  private setState(store: CloneStore, s: CloneRunState): void { writeFileSync(store.file(STATE_FILE), JSON.stringify(s) + '\n', 'utf8') }

  private answers(store: CloneStore): IntakeAnswers | null {
    return safe(() => (store.has('p0-answers.json') ? (JSON.parse(readFileSync(store.file('p0-answers.json'), 'utf8')) as IntakeAnswers) : null))
  }

  private store(id: unknown): CloneStore {
    if (typeof id !== 'string' || !/^[a-z0-9-]+$/i.test(id) || !existsSync(path.join(this.root, id))) throw new Error('Clonage introuvable.')
    return new CloneStore(this.d.dataDir, id)
  }

  private ids(): string[] {
    if (!existsSync(this.root)) return []
    return readdirSync(this.root, { withFileTypes: true }).filter((e) => e.isDirectory() && /^[a-z0-9-]+$/i.test(e.name) && existsSync(path.join(this.root, e.name, 'p0-answers.json'))).map((e) => e.name)
  }
}

function checkState(state: unknown): IntakeState {
  const s = state as Partial<IntakeState> | null
  if (!s || typeof s !== 'object' || !s.draft || typeof s.draft !== 'object' || !Array.isArray(s.said)) throw new Error('Conversation invalide.')
  return s as IntakeState
}

function safe<T>(f: () => T): T | null {
  try { return f() } catch { return null }
}
