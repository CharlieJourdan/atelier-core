// Shared pieces of the runtime's tool handlers (toolbox.ts, tools-work.ts): what a handler gets and the argument checks.
// Arguments come from a model: every one is checked here before it reaches a service.
import type { OrchTask } from '../../shared/api/orchestra'
import type { ToolboxEnv } from './toolbox'
import type { AgentRecord } from './tree'

/** A handler's answer: text, or text plus images the agent's model sees (eyes.look's frames). */
export type ToolOut = string | { text: string; images: { path: string; mimeType: 'image/jpeg' }[] }

export interface ToolCtx {
  env: ToolboxEnv
  agent: AgentRecord
  task: OrchTask
  signal: AbortSignal
  /** The channel the agent works for (its own, else the task's). */
  channelId: number | null
  /** Charlie approved something in this task (his answer to the agent's ask_human was a yes). */
  approved: () => boolean
  /** A side effect already made for this task, or null; `remember` keeps one. */
  effect: (key: string) => unknown
  remember: (key: string, result: unknown) => void
  /** The turn ends waiting for Charlie (a tool put something in his inbox for this task: bricks.propose). */
  waitForHuman: () => void
}

export type Handler = (c: ToolCtx, a: Record<string, unknown>) => Promise<ToolOut> | ToolOut

export function need(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${field} must be non-empty text`)
  if (v.length > max) throw new Error(`${field} is limited to ${max} characters`)
  return v.trim()
}

export function opt(v: unknown, field: string, max: number): string | undefined {
  return v === undefined || v === null || v === '' ? undefined : need(v, field, max)
}

export function int(v: unknown, field: string): number {
  const n = typeof v === 'string' && /^#?\d+$/.test(v.trim()) ? Number(v.trim().replace('#', '')) : v
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw new Error(`${field} must be a positive integer`)
  return n
}

export function num(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`${field} must be a number from ${min} to ${max}`)
  return v
}
