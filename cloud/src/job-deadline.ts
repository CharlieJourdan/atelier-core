// The deadline of one provider call (solidite): no job is held forever by a provider that never answers.
import type { Usage } from '../../src/shared/cloud-api.ts'
import { CloudError } from './errors.ts'

/** A provider call never takes longer: the slowest adapters wait 45 min, a GPU render can take hours. */
export const jobDeadlineMs = (usage: Usage): number => (usage === 'submitGpuJob' ? 12 * 3600_000 : 2 * 3600_000)

/** A provider call bounded in time: past `ms` the job's controller aborts, and a call that ignores the abort is left
 *  behind 5 s later (its slot is given back; the job fails with the reason). Real time: a stuck call is stuck in real time. */
export function bounded<T>(p: Promise<T>, controller: AbortController, ms: number, onOver: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onOver()
      controller.abort(new CloudError('gone', 'deadline'))
      setTimeout(() => reject(controller.signal.reason as Error), 5_000).unref?.()
    }, ms)
    timer.unref?.()
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    )
  })
}
