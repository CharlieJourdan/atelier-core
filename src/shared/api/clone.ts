// IPC contract, module "clone" (moteur-assemblage): « Créer une pipeline » on the cloning engine P0→P10
// (`src/main/production/clone/engine.ts`). Artefact types: `src/shared/clone/`. Every method added here must also be
// listed in CLONE_METHODS.
import type { CloneProgress, IntakeState, IntakeTurn, Report } from '../clone'

/** Where a clone stands outside its phases (nothing waits for a person: a clone runs, stops, or is done). */
export type CloneRunState =
  | { kind: 'running' }
  | { kind: 'stopped'; why: string }
  | { kind: 'done'; outcome: Report['outcome'] }
  | { kind: 'idle' }

export interface CloneSummary {
  id: string
  /** The reference link the clone started from. */
  title: string
  createdAt: string
  state: CloneRunState
  spentUsd: number
  budgetUsd: number | null
}

export interface CloneFile { mime: string; bytes: Uint8Array }

export interface CloneContract {
  /** A fresh intake conversation (nothing saved). */
  'clone.intakeStart': { args: []; result: IntakeState }
  /** One message of the intake: what changed in the brief, the next question (and its French text). */
  'clone.intakeTurn': { args: [state: IntakeState, message: string]; result: IntakeTurn & { text: string } }
  /** The brief is ready: the clone starts P0→P10 in the background, within the test budget it says. */
  'clone.start': { args: [state: IntakeState]; result: { cloneId: string } }
  'clone.list': { args: []; result: CloneSummary[] }
  'clone.progress': { args: [cloneId: string]; result: CloneProgress & { state: CloneRunState } }
  'clone.report': { args: [cloneId: string]; result: Report | null }
  /** Goes on from the last saved artefact; a budget raises the test budget first (the only stop a person settles: money). */
  'clone.resume': { args: [cloneId: string, budgetUsd?: number]; result: CloneSummary }
  /** An optional override of the style P2 picked by itself (which of the channel's styles), before the clone went past P2. */
  'clone.answer': { args: [cloneId: string, style: string]; result: CloneSummary }
  /** A picture or a video of the clone (frames, side by side, renders), by its path under the clone folder. */
  'clone.file': { args: [cloneId: string, rel: string]; result: CloneFile }
  'clone.remove': { args: [cloneId: string]; result: { removed: boolean } }
}

export const CLONE_METHODS = [
  'clone.intakeStart',
  'clone.intakeTurn',
  'clone.start',
  'clone.list',
  'clone.progress',
  'clone.report',
  'clone.resume',
  'clone.answer',
  'clone.file',
  'clone.remove'
] as const satisfies readonly (keyof CloneContract)[]
