// IPC contract, module "runs" (lot Z1): Production runs of our engine in the app (quote, start, gates, cancel, retry,
// outputs, files, library) and the local credits wallet. Types and field docs: `src/shared/runs.ts`.
// Every method added here must also be listed in RUNS_METHODS and counted, with a comment, in its area's unit test.
// Change topics: 'production' after every run write (throttled to ~4/s while a run progresses), 'credits' after every
// wallet movement. Errors are thrown with a French message (`err.message`).
import type {
  CreditEntry,
  CreditPack,
  CreditsBalance,
  EngineStatus,
  LibraryItem,
  PurchaseResult,
  RunDetail,
  RunFile,
  RunListFilter,
  RunOutput,
  RunQuote,
  RunQuoteInput,
  RunStartInput,
  RunSummary,
  RunVoices
} from '../runs'

export type * from '../runs'

export interface RunsContract {
  /** Validates the pipeline and quotes it in both budget modes (credits per node, totals, duration, demo flag). */
  'production.quote': { args: [input: RunQuoteInput]; result: RunQuote }
  /** Creates a run (and the video when `channelId` + `title` are given) and starts the engine. */
  'production.start': { args: [input: RunStartInput]; result: RunDetail }
  /** Runs, newest first, filtered by video, channel or status. */
  'production.list': { args: [filter?: RunListFilter]; result: RunSummary[] }
  /** One run with its nodes. */
  'production.get': { args: [runId: number]; result: RunDetail }
  /** Approves the node waiting at its gate (resumes the engine first when it is not live). */
  'production.approve': { args: [runId: number, nodeId: string]; result: RunDetail }
  /** Sends the gated node back with a note (1..2000 chars): that node reruns with it, then what follows. */
  'production.requestChanges': { args: [runId: number, nodeId: string, note: string]; result: RunDetail }
  /** Stops the run: running nodes are killed, finished results stay, unspent credits are released. */
  'production.cancel': { args: [runId: number]; result: RunDetail }
  /** Relaunches a failed / cancelled / interrupted run: finished nodes come back `cached`, the others rerun. */
  'production.retry': { args: [runId: number]; result: RunDetail }
  /** "Refaire pareil": a new run with the same settings on a NEW video of the same channel. */
  'production.redo': { args: [runId: number]; result: RunDetail }
  /** Reattaches an `interrupted` or engine-less `waiting` run (after a restart, or an example row). */
  'production.resume': { args: [runId: number]; result: RunDetail }
  /** What one node produced, typed for its review screen (or `unavailable` with a French message). */
  'production.output': { args: [runId: number, nodeId: string]; result: RunOutput }
  /** Bytes + mime of one artefact file (`ref` from an output); refused outside the run's artefact folder, max 300 MB. */
  'production.file': { args: [runId: number, ref: string]; result: RunFile }
  /** Finished videos (succeeded runs), newest first. */
  'production.library': { args: [filter?: { channelId?: number }]; result: LibraryItem[] }
  /** Voices the engine can use on this computer (system voices in demo). */
  'production.voices': { args: []; result: RunVoices }
  /** Réglages › Moteur: ffmpeg, folders, active runs. */
  'production.engineStatus': { args: []; result: EngineStatus }
  /** Opens the run's package folder in Finder / Explorer. */
  'production.revealPackage': { args: [runId: number]; result: { opened: boolean; path: string } }
  /** Wallet balance. */
  'credits.balance': { args: []; result: CreditsBalance }
  /** Wallet movements, newest first (default 100, max 500). */
  'credits.entries': { args: [limit?: number]; result: CreditEntry[] }
  /** Credit packs on sale (prices in euros; buying is simulated in v2). */
  'credits.packs': { args: []; result: CreditPack[] }
  /** Simulated purchase of a pack: a grant recorded as `simulated_purchase`, never real money. `key` dedupes double clicks. */
  'credits.simulatePurchase': { args: [packId: string, key?: string]; result: PurchaseResult }
}

export const RUNS_METHODS = [
  'production.quote',
  'production.start',
  'production.list',
  'production.get',
  'production.approve',
  'production.requestChanges',
  'production.cancel',
  'production.retry',
  'production.redo',
  'production.resume',
  'production.output',
  'production.file',
  'production.library',
  'production.voices',
  'production.engineStatus',
  'production.revealPackage',
  'credits.balance',
  'credits.entries',
  'credits.packs',
  'credits.simulatePurchase'
] as const satisfies readonly (keyof RunsContract)[]
