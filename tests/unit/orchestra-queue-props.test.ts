// Property-based tests of the durable queue (fast-check): whatever the interleaving of leases by several owners,
// heartbeats, completions, failures, expiries, restarts (recovery), parking, human waits, cancels and retries:
//   - a task is never leased twice at once: a lease only succeeds on a released task, and only the current holder can
//     heartbeat, complete or fail it;
//   - a done task never runs again (no lease, its status never changes);
//   - attempts never exceed max_attempts, and a dead task used them all.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db'
import { TaskQueue } from '../../src/main/orchestra/queue'
import { AgentTree } from '../../src/main/orchestra/tree'
import { EventLog } from '../../src/main/orchestra/util'

const OWNERS = ['sup-a', 'sup-b', 'sup-c'] as const
type Op =
  | { op: 'lease' | 'beat' | 'complete' | 'fail' | 'park' | 'human'; task: number; owner: number }
  | { op: 'resume' | 'cancel' | 'retry'; task: number }
  | { op: 'advance'; ms: number }
  | { op: 'sweep' }
  | { op: 'recover'; owner: number }

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constantFrom('lease', 'beat', 'complete', 'fail', 'park', 'human'), task: fc.nat(4), owner: fc.nat(2) }) as fc.Arbitrary<Op>,
  fc.record({ op: fc.constantFrom('resume', 'cancel', 'retry'), task: fc.nat(4) }) as fc.Arbitrary<Op>,
  fc.record({ op: fc.constant('advance'), ms: fc.integer({ min: 1, max: 20 * 60_000 }) }) as fc.Arbitrary<Op>,
  fc.record({ op: fc.constant('sweep') }) as fc.Arbitrary<Op>,
  fc.record({ op: fc.constant('recover'), owner: fc.nat(2) }) as fc.Arbitrary<Op>
)

function setup(maxAttempts: number) {
  let now = Date.parse('2026-10-26T08:00:00Z')
  const clock = (): number => now
  const db = openDatabase(':memory:')
  const events = new EventLog(db, clock)
  const tree = new AgentTree(db, clock, events)
  tree.seed()
  const q = new TaskQueue(db, clock, events, { leaseTtlMs: 10 * 60_000, backoffBaseMs: 1000, backoffCapMs: 60_000 })
  const ids = [0, 1, 2, 3, 4].map((i) => q.enqueue({ kind: 'task', title: `t${i}`, assigneeId: 1, maxAttempts }).id)
  return { q, ids, advance: (ms: number) => void (now += ms) }
}

describe('queue invariants (property-based)', () => {
  it('never two holders, done stays done, attempts bounded', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 80 }), fc.integer({ min: 1, max: 4 }), (ops, maxAttempts) => {
        const { q, ids, advance } = setup(maxAttempts)
        /** Who holds each task's lease right now, per our model of the operations that succeeded. */
        const holder = new Map<number, string | null>(ids.map((id) => [id, null]))
        const done = new Set<number>()
        for (const o of ops) {
          if (o.op === 'advance') {
            advance(o.ms)
            continue
          }
          if (o.op === 'sweep') {
            for (const t of q.expired()) {
              expect(q.fail(t.id, null, 'watchdog')).not.toBeNull()
              holder.set(t.id, null)
            }
            continue
          }
          if (o.op === 'recover') {
            for (const t of q.orphans(OWNERS[o.owner]!)) {
              q.fail(t.id, null, 'restart', { retryNow: true })
              holder.set(t.id, null)
            }
            continue
          }
          const id = ids[o.task]!
          const before = q.get(id)
          switch (o.op) {
            case 'lease': {
              const got = q.lease(id, OWNERS[o.owner]!, null)
              if (got) {
                // only a released, runnable task can be leased: never a second holder
                expect(holder.get(id)).toBeNull()
                expect(['queued', 'failed']).toContain(before.status)
                expect(done.has(id)).toBe(false)
                holder.set(id, OWNERS[o.owner]!)
              }
              break
            }
            case 'beat':
              expect(q.heartbeat(id, OWNERS[o.owner]!)).toBe(holder.get(id) === OWNERS[o.owner])
              break
            case 'complete': {
              const ok = q.complete(id, OWNERS[o.owner]!, 'r')
              expect(ok).toBe(holder.get(id) === OWNERS[o.owner])
              if (ok) {
                done.add(id)
                holder.set(id, null)
              }
              break
            }
            case 'fail': {
              const r = q.fail(id, OWNERS[o.owner]!, 'e')
              expect(r !== null).toBe(holder.get(id) === OWNERS[o.owner])
              if (r) holder.set(id, null)
              break
            }
            case 'park': {
              const ok = q.park(id, OWNERS[o.owner]!, 'accounts', null)
              expect(ok).toBe(holder.get(id) === OWNERS[o.owner])
              if (ok) holder.set(id, null)
              break
            }
            case 'human': {
              const ok = q.waitHuman(id, OWNERS[o.owner]!, 'asked')
              expect(ok).toBe(holder.get(id) === OWNERS[o.owner])
              if (ok) holder.set(id, null)
              break
            }
            case 'resume':
              q.resumeHuman(id, { text: 'ok' })
              if (before.status === 'waiting') q.wakeParked()
              break
            case 'cancel':
              q.cancel(id)
              holder.set(id, null)
              break
            case 'retry':
              try {
                q.retry(id)
              } catch {
                // only dead, failed or cancelled tasks can be retried
              }
              break
          }
          for (const tid of ids) {
            const t = q.get(tid)
            if (done.has(tid)) expect(t.status).toBe('done')
            expect(t.attempts).toBeLessThanOrEqual(t.maxAttempts)
            if (t.status === 'dead') expect(t.attempts).toBe(t.maxAttempts)
            if (t.status === 'leased' || t.status === 'running') expect(t.leaseOwner).toBe(holder.get(tid))
            else expect(t.leaseOwner).toBeNull()
          }
        }
      }),
      { numRuns: 200 }
    )
  }, 60_000)

  it('a done task is never leased again, whatever is tried', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.nat(2), fc.integer({ min: 0, max: 3_600_000 })), { maxLength: 30 }), (tries) => {
        const { q, ids, advance } = setup(3)
        const id = ids[0]!
        expect(q.lease(id, 'sup-a')).not.toBeNull()
        expect(q.complete(id, 'sup-a', 'r')).toBe(true)
        for (const [owner, ms] of tries) {
          advance(ms)
          expect(q.lease(id, OWNERS[owner]!)).toBeNull()
          q.wakeParked()
          q.bumpParents()
          expect(q.expired().map((t) => t.id)).not.toContain(id)
          expect(() => q.retry(id)).toThrow()
          expect(q.cancel(id)).toEqual([])
        }
        expect(q.get(id).status).toBe('done')
      })
    )
  }, 60_000)
})
