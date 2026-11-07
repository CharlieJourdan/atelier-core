// Shared set-up of the agent-runtime tests: an in-memory core with an injectable clock, two channels, and account
// providers the test chooses (FakeProvider or the real ClaudeCodeProvider on a fake child process). Never a real call.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CoreOptions } from '../../src/main/core'
import { FakeProvider } from '../../src/main/llm/fake'
import type { Provider } from '../../src/main/llm/types'
import type { AccountRecord } from '../../src/main/orchestra/accounts'
import { scriptedResponder } from '../../src/main/orchestra/fake-team'
import { trackTemp } from '../setup/track-temp'
import { memoryCore } from './helpers'

/** Monday 26 October 2026, 08:00 UTC. */
export const T0 = Date.parse('2026-10-26T08:00:00.000Z')

export interface Rig {
  core: ReturnType<typeof memoryCore>
  clock: { now: () => number; advance: (ms: number) => void; set: (ms: number) => void }
  channels: number[]
  dataDir: string
  /** Provider used for an account (default: one scripted FakeProvider per account). */
  providers: Map<number, Provider>
}

export function rig(opts: { providerFor?: (a: AccountRecord) => Provider; seed?: boolean; core?: Partial<CoreOptions> } = {}): Rig {
  let t = T0
  const clock = { now: () => t, advance: (ms: number) => void (t += ms), set: (ms: number) => void (t = ms) }
  const providers = new Map<number, Provider>()
  const dataDir = trackTemp(mkdtempSync(path.join(tmpdir(), 'atelier-orch-test-')))
  const core = memoryCore({
    now: () => new Date(clock.now()),
    ...opts.core,
    orchestra: {
      cronUtc: true,
      dataDir,
      providers: (a) => {
        const p = opts.providerFor?.(a) ?? new FakeProvider((req) => scriptedResponder(req), `fake-${a.id}`)
        providers.set(a.id, p)
        return p
      },
      ...opts.core?.orchestra
    }
  })
  const add = core.db.prepare("INSERT INTO channels (name, niche, standards) VALUES (?, ?, '')")
  const channels = [Number(add.run('Histoire', 'histoire').lastInsertRowid), Number(add.run('Mystères', 'mystères').lastInsertRowid)]
  if (opts.seed !== false) core.orchestra.seed()
  return { core, clock, channels, dataDir, providers }
}

/** Ticks (waiting for the runs) until nothing is runnable or `max` passes. */
export async function drain(r: Rig, max = 30): Promise<number> {
  let passes = 0
  for (; passes < max; passes++) {
    const res = await r.core.orchestra.tick({ wait: true })
    const runnable = r.core.orchestra.parts.queue.runnable(1).length
    if (res.started === 0 && res.bumped === 0 && runnable === 0) break
  }
  return passes
}

export function agentBySlug(r: Rig, slug: string) {
  const a = r.core.orchestra.parts.tree.bySlug(slug)
  if (!a) throw new Error(`no agent ${slug}`)
  return a
}
