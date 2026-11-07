// The exit check shape every phase returns (decision 0095): a phase refuses to go on while its output is incomplete. Pure.
import type { z } from 'zod'

export interface ExitCheck { ok: boolean; problems: string[] }

export const pass = (): ExitCheck => ({ ok: true, problems: [] })

/** Build a check from a list of problems. */
export function verdict(problems: readonly string[]): ExitCheck {
  return { ok: problems.length === 0, problems: [...problems] }
}

/** The problems of a schema parse, as readable lines (`path: message`). */
export function schemaProblems(schema: z.ZodType, value: unknown): string[] {
  const r = schema.safeParse(value)
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
}

/** Thrown by the orchestrator when an exit check refuses (the problems are logged and saved). */
export class ExitRefused extends Error {
  constructor(readonly phase: string, readonly problems: string[]) {
    super(`${phase} refused: ${problems.join('; ')}`)
    this.name = 'ExitRefused'
  }
}
