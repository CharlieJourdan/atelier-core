// Agent runtime: the watchdog (a hung CLI is killed with its process tree and the task retried with backoff; dead
// letter after the last attempt) and recovery after a restart (leases left by a previous run are taken back). The real
// ClaudeCodeProvider runs on a fake child process; the kill is the fake stand-in for the platform's killTree.
import { trackTemp } from '../setup/track-temp'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCore } from '../../src/main/core'
import { ClaudeCodeProvider } from '../../src/main/llm/claude-code'
import { FakeProvider } from '../../src/main/llm/fake'
import { ProviderError, type CompletionRequest, type Provider, type StreamEvent } from '../../src/main/llm/types'
import { fakeClaudeCli, scriptedReply, type FakeCliReply } from '../../src/main/orchestra/fake-team'
import { agentBySlug, rig, T0 } from './orchestra-helpers'
import { okTester, testCipher } from './helpers'

const flush = async (n = 10): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

function cliRig(decide: (i: number) => 'hang' | 'ok') {
  const cli = fakeClaudeCli((call, i): FakeCliReply => (decide(i) === 'hang' ? { hang: true } : { text: scriptedReply(call.system, call.prompt) }))
  const provider = new ClaudeCodeProvider({
    platform: 'win32',
    findBinary: () => 'C:\\fake\\claude.exe',
    spawn: cli.spawn,
    killTree: cli.kill,
    exitWaitMs: 50,
    removeDir: (d: string) => void trackTemp(d),
    env: {}
  })
  return { cli, r: rig({ providerFor: () => provider }) }
}

describe('watchdog', () => {
  it('kills a hung run (process tree) when its lease expires without heartbeat, then retries it after the backoff', async () => {
    const { cli, r } = cliRig((i) => (i === 0 ? 'hang' : 'ok'))
    const o = r.core.orchestra
    const researcher = agentBySlug(r, `researcher-${r.channels[0]}`)
    const task = o.enqueue({ assigneeId: researcher.id, kind: 'research', title: 'Sujets' })
    expect((await o.tick()).started).toBe(1)
    await flush()
    expect(o.parts.queue.get(task.id).status).toBe('running')
    expect(o.agents().find((a) => a.id === researcher.id)).toMatchObject({ status: 'working', currentTaskId: task.id })
    // nothing happens before the lease expires (10 min without heartbeat)
    r.clock.advance(9 * 60_000)
    expect((await o.tick()).expired).toBe(0)
    r.clock.advance(2 * 60_000)
    const res = await o.tick()
    expect(res.expired).toBe(1)
    expect(cli.killed).toEqual([cli.calls[0]!.pid])
    await o.supervisor.idle()
    const failed = o.parts.queue.get(task.id)
    expect(failed).toMatchObject({ status: 'failed', attempts: 1, leaseOwner: null })
    expect(failed.error).toMatch(/Watchdog: no heartbeat/)
    expect(Date.parse(failed.notBefore!)).toBe(r.clock.now() + 30_000)
    // not before the backoff
    expect((await o.tick()).started).toBe(0)
    r.clock.advance(30_000)
    await o.tick({ wait: true })
    expect(o.parts.queue.get(task.id)).toMatchObject({ status: 'done', attempts: 2 })
    expect(o.events(0, 500).filter((e) => e.type === 'kill')).toHaveLength(1)
    // the killed attempt reached the model (the CLI started): booked at its estimate, the second one settled
    const rows = r.core.db.prepare('SELECT status FROM ledger WHERE orch_task_id = ? ORDER BY id').all(task.id) as { status: string }[]
    expect(rows.map((x) => x.status)).toEqual(['settled', 'settled'])
  })

  it('dead-letters after the last attempt: alert in the inbox, a line in the principal chat, the agent in error', async () => {
    const { r } = cliRig(() => 'hang')
    const o = r.core.orchestra
    const researcher = agentBySlug(r, `researcher-${r.channels[0]}`)
    const task = o.enqueue({ assigneeId: researcher.id, kind: 'research', title: 'Toujours bloqué', maxAttempts: 2 })
    for (let i = 0; i < 2; i++) {
      await o.tick()
      await flush()
      r.clock.advance(11 * 60_000)
      await o.tick()
      await o.supervisor.idle()
      r.clock.advance(60_000)
    }
    expect(o.parts.queue.get(task.id)).toMatchObject({ status: 'dead', attempts: 2 })
    expect(o.agents().find((a) => a.id === researcher.id)?.status).toBe('error')
    const alert = o.inbox().find((i) => i.kind === 'alert')
    expect(alert?.title).toContain('Toujours bloqué')
    const sup = r.core.chat.store.open({ kind: 'supervisor' })
    expect(r.core.chat.store.messages(sup.id).some((m) => m.authorType === 'system' && m.body.includes(`#${task.id}`))).toBe(true)
    // a retry by hand gives fresh attempts and clears the error
    const again = o.retryTask(task.id)
    expect(again).toMatchObject({ status: 'queued', attempts: 0 })
    expect(o.agents().find((a) => a.id === researcher.id)?.status).toBe('idle')
  })

  it('kills a run that goes on past orchestra.maxRunMs even while it streams', async () => {
    let n = 0
    const chatty: Provider = {
      id: 'chatty',
      complete: () => Promise.reject(new Error('unused')),
      async *stream(_req: CompletionRequest, opts = {}): AsyncGenerator<StreamEvent> {
        n++
        for (;;) {
          await new Promise((res) => setTimeout(res, 5))
          if (opts.signal?.aborted) throw new ProviderError('Aborted', 'ABORTED')
          yield { type: 'text', text: '.' }
        }
      }
    }
    const r = rig({ providerFor: () => chatty })
    const o = r.core.orchestra
    r.core.context.settings.set('orchestra.maxRunMs', 60_000)
    const a = agentBySlug(r, `researcher-${r.channels[0]}`)
    const t = o.enqueue({ assigneeId: a.id, kind: 'research', title: 'x', maxAttempts: 1 })
    await o.tick()
    await new Promise((res) => setTimeout(res, 30))
    r.clock.advance(61_000)
    expect((await o.tick()).expired).toBe(1)
    await o.supervisor.idle()
    expect(o.parts.queue.get(t.id)).toMatchObject({ status: 'dead' })
    expect(o.parts.queue.get(t.id).error).toMatch(/longer than 1 min/)
    expect(n).toBe(1)
  })
})

describe('recovery after a restart', () => {
  it('takes back the tasks a previous run left running: retried at once, or dead when no attempt is left', async () => {
    const dir = trackTemp(mkdtempSync(path.join(tmpdir(), 'atelier-orch-restart-')))
    let now = T0
    const hang: Provider = {
      id: 'hang',
      complete: () => Promise.reject(new Error('unused')),
      // eslint-disable-next-line require-yield
      async *stream(_req: CompletionRequest, opts = {}): AsyncGenerator<StreamEvent> {
        await new Promise<void>((res) => opts.signal?.addEventListener('abort', () => res(), { once: true }))
        throw new ProviderError('Aborted', 'ABORTED')
      }
    }
    const open = (p: () => Provider) =>
      createCore({ paths: { userData: dir }, cipher: testCipher(), tester: okTester, now: () => new Date(now), orchestra: { cronUtc: true, providers: p } })
    const first = open(() => hang)
    first.db.prepare("INSERT INTO channels (name) VALUES ('Histoire')").run()
    first.orchestra.seed()
    const researcher = first.orchestra.parts.tree.bySlug('researcher-1')!
    const lead = first.orchestra.parts.tree.bySlug('lead-1')!
    const a = first.orchestra.enqueue({ assigneeId: researcher.id, kind: 'research', title: 'interrupted' })
    const b = first.orchestra.enqueue({ assigneeId: lead.id, kind: 'plan', title: 'last chance', maxAttempts: 1 })
    expect((await first.orchestra.tick()).started).toBe(2)
    expect(first.orchestra.parts.queue.get(a.id).status).toBe('running')
    first.close() // quit (or crash) mid-run: the leases stay in the database
    now += 5_000
    const second = open(() => new FakeProvider((req) => scriptedReply(req.system ?? '', req.prompt)))
    const q = second.orchestra.parts.queue
    expect(q.get(a.id)).toMatchObject({ status: 'failed', attempts: 1, leaseOwner: null })
    expect(q.get(a.id).error).toMatch(/Interrupted/)
    expect(q.get(b.id).status).toBe('dead')
    expect(second.orchestra.events(0, 500).some((e) => e.type === 'recover')).toBe(true)
    await second.orchestra.tick({ wait: true })
    expect(q.get(a.id).status).toBe('done')
    second.close()
  })
})
