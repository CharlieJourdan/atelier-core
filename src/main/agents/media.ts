// How a media module (the production engine, from the P lots on) plugs into the runner and the tools of an agent run.
// Without one, media deliverables wait for a file uploaded by the owner.
import type { DeliverableRow } from '../../shared/workflow'
import type { BudgetExceededError } from '../ledger'
import type { ToolSpec } from '../llm/types'
import type { RunScope } from './tools'

/** Tools added to one agent run (beside the Atelier tools). Handlers may throw: the error goes back to the model. */
export interface ExtraTools {
  specs: ToolSpec[]
  /** Calls allowed per run and tool (absent = no limit). */
  quota: Record<string, number>
  call(name: string, args: Record<string, unknown>): Promise<string>
  /** Lines added to the system prompt (how to use them), and what to deliver. */
  promptLines: string[]
  deliver: string
  finish: string
}

/** What happened in an agent turn whose deliverable a media job produces. */
export type MediaOutcome =
  | { kind: 'handed_off' }
  | { kind: 'budget'; error: BudgetExceededError }
  | { kind: 'missing'; message: string }

export interface MediaHooks {
  /** Media deliverables the runner starts (instead of waiting for an upload). */
  handles(deliverable: DeliverableRow): boolean
  /** Text saved as the version without any model call, or null when an agent runs. */
  direct(deliverable: DeliverableRow): string | null
  /** Extra tools for an agent run on this deliverable. */
  tools(scope: RunScope, deliverable: DeliverableRow): ExtraTools | null
  /**
   * Set when the module covers the deliverable but cannot make it now: the runner holds the task with this message,
   * without any model call (the owner may still upload the file).
   */
  unavailable?(deliverable: DeliverableRow): string | null
  /** After the agent's turn: a job now produces the version, or why not. */
  afterRun(taskId: number): MediaOutcome
  /** Tasks that stay `running` across a restart because a job is still producing their version. */
  activeTaskIds(): number[]
}
