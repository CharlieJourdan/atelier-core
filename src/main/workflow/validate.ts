// Input checks of the workflow engine (values come from the renderer or from agents).
import type { VideoInput } from '../../shared/workflow'

function checkDeadline(deadline: string | null | undefined): void {
  if (deadline === null || deadline === undefined) return
  if (typeof deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(deadline) || Number.isNaN(Date.parse(deadline))) {
    throw new Error('deadline must be an ISO date (YYYY-MM-DD)')
  }
}

export function checkVideoFields(input: VideoInput | null): void {
  if (typeof input !== 'object' || input === null) throw new Error('A video input must be an object')
  for (const k of ['title', 'brief'] as const) {
    if (input[k] !== undefined && typeof input[k] !== 'string') throw new Error(`${k} must be a string`)
  }
  if (input.goalId !== undefined && input.goalId !== null && !Number.isInteger(input.goalId)) {
    throw new Error('goalId must be an integer')
  }
  checkDeadline(input.deadline)
}

export function checkNote(note: unknown): string {
  if (note !== undefined && typeof note !== 'string') throw new Error('note must be a string')
  return note ?? ''
}
