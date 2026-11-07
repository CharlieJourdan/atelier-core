// agents-1 (A1): the team's switch (off / on / paused until a time / blocked before Claude), the red stop and the live
// « Activité » snapshot (docs/AGENT-RUNTIME.md §25). Fake providers and the fake clock only: never a real call.
import { trackTemp } from '../setup/track-temp'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { API_METHODS } from '../../src/shared/api'
import { AUTOPILOT_METHODS, type ActivitySnapshot } from '../../src/shared/api/autopilot'
import { createCore, type Core } from '../../src/main/core'
import { handleCall } from '../../src/main/ipc'
import { FakeProvider } from '../../src/main/llm/fake'
import { ProviderError, type CompletionRequest, type Provider, type StreamEvent } from '../../src/main/llm/types'
import { readPrompt, scriptedReply } from '../../src/main/orchestra/fake-team'
import { okTester, testCipher } from './helpers'
import { T0, agentBySlug, rig, type Rig } from './orchestra-helpers'

const block = (actions: unknown[]): string => `\n\n\`\`\`atelier\n${JSON.stringify({ actions })}\n\`\`\``
const HOUR = 3_600_000

/** Answers « OK » (the account check) until `hang.on`, then streams nothing until its run is aborted (a long turn). */
function switchable(hang: { on: boolean }): Provider {
  const ok = new FakeProvider(() => 'OK')
  return {
    id: 'switchable',
    complete: (req, opts) => ok.complete(req, opts),
    async *stream(req: CompletionRequest, opts = {}): AsyncGenerator<StreamEvent> {
      if (!hang.on) {
        yield* ok.stream(req, opts)
        return
      }
      await new Promise<void>((res) => opts.signal?.addEventListener('abort', () => res(), { once: true }))
      throw new ProviderError('Aborted', 'ABORTED')
    }
  }
}

/** « Vérifier » on the default account through the fake provider (the real path of Réglages › Claude). */
async function connectClaude(core: Core): Promise<void> {
  const account = core.orchestra.parts.accounts.list()[0]!
  const a = await core.orchestra.checkAccount(account.id)
  expect(a.state).toBe('ready')
}

const opened: Core[] = []
afterEach(() => {
  for (const c of opened.splice(0)) c.close()
})
function track(r: Rig): Rig {
  opened.push(r.core)
  return r
}

describe('autopilot IPC', () => {
  it('lists its 11 methods, all in the contract', () => {
    expect([...AUTOPILOT_METHODS]).toEqual([
      'autopilot.power', // off / on / paused until / blocked (no Claude account checked yet), and whether the loop runs
      'autopilot.setPower', // switch on, off, or pause until a time; on is refused before « Vérifier »
      'autopilot.stop', // « Tout arrêter »: kill the runs, requeue their tasks, switch off
      'autopilot.activity', // « Activité »: running, waiting on whom, queued, next routines, accounts, spend, events
      'autopilot.goals', // a channel's standing goals and approval level (null before any proposal)
      'autopilot.saveGoals', // Charlie edits and / or confirms them
      'autopilot.proposeGoals', // the baseline again (back to « proposed »)
      'autopilot.allowAlways', // « Toujours valider pour ce type »: a standing-allow rule from a question (agents-4)
      'autopilot.rules', // the rules that apply
      'autopilot.revokeRule', // Charlie takes one back
      'autopilot.report' // the daily digest or the weekly report
    ])
    for (const m of AUTOPILOT_METHODS) expect(API_METHODS).toContain(m)
  })
})

describe('the switch', () => {
  it('refuses to switch on before a Claude account passed « Vérifier », then starts the loop once one does', async () => {
    const r = track(rig())
    const o = r.core.orchestra
    const call = (m: string, ...args: unknown[]) => handleCall(r.core.api, m, args)
    // the account made by default was never checked: nothing may run in the background
    expect(o.power.view()).toMatchObject({ state: 'off', claudeConnected: false, loopRunning: false })
    const refused = await call('autopilot.setPower', { state: 'on' })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.message).toMatch(/Connecte d'abord Claude/)
    expect(r.core.context.settings.get('orchestra.enabled', false)).toBe(false)
    // switched on by an older build (the setting alone): blocked, the loop stays off
    r.core.context.settings.set('orchestra.enabled', true)
    expect(o.power.apply()).toMatchObject({ state: 'blocked', loopRunning: false })
    // « Vérifier » passes: the team starts by itself
    await connectClaude(r.core)
    expect(o.power.view()).toMatchObject({ state: 'on', claudeConnected: true, loopRunning: true })
    // off: the loop stops at once (no restart of the app needed)
    const off = await call('autopilot.setPower', { state: 'off' })
    expect(off.ok && off.value).toMatchObject({ state: 'off', loopRunning: false })
    const on = await call('autopilot.setPower', { state: 'on' })
    expect(on.ok && on.value).toMatchObject({ state: 'on', loopRunning: true })
  })

  it('pauses until a time: nothing starts, no routine fires; then work resumes by itself', async () => {
    const r = track(rig())
    const o = r.core.orchestra
    await connectClaude(r.core)
    expect(() => o.power.set({ state: 'paused', until: new Date(T0 - 1000).toISOString() })).toThrow(/dans le futur/)
    expect(() => o.power.set({ state: 'paused', until: new Date(T0 + 31 * 24 * HOUR).toISOString() })).toThrow(/30 jours/)
    const until = new Date(T0 + HOUR).toISOString()
    expect(o.power.set({ state: 'paused', until })).toMatchObject({ state: 'paused', pausedUntil: until })
    o.supervisor.stop() // the test ticks by hand
    const researcher = agentBySlug(r, `researcher-${r.channels[0]}`)
    const t = o.enqueue({ assigneeId: researcher.id, kind: 'research', title: 'Trois sujets' })
    // the competitor analysts' 07:00 routine and the 08:00 digest are due at T0 (08:00 UTC): held while paused
    expect(await o.tick({ wait: true })).toMatchObject({ started: 0, routines: 0 })
    expect(o.parts.queue.get(t.id).status).toBe('queued')
    r.clock.advance(HOUR + 1000)
    const res = await o.tick({ wait: true })
    expect(res.started).toBeGreaterThan(0)
    expect(res.routines).toBeGreaterThan(0)
    expect(o.parts.queue.get(t.id).status).toBe('done')
    expect(o.power.view()).toMatchObject({ state: 'on', pausedUntil: null })
    expect(o.events(0, 1000).some((e) => e.type === 'power' && /pause est finie/.test(e.text))).toBe(true)
  })

  it('« Tout arrêter » kills every run, puts the tasks back in the queue with their attempts, and switches off', async () => {
    const hang = { on: false }
    const r = track(rig({ providerFor: () => switchable(hang) }))
    const o = r.core.orchestra
    await connectClaude(r.core)
    o.power.set({ state: 'on' })
    o.supervisor.stop() // the test ticks by hand
    hang.on = true
    const a = o.enqueue({ assigneeId: agentBySlug(r, `researcher-${r.channels[0]}`).id, kind: 'research', title: 'long A', maxAttempts: 1 })
    const b = o.enqueue({ assigneeId: agentBySlug(r, `researcher-${r.channels[1]}`).id, kind: 'research', title: 'long B', maxAttempts: 1 })
    expect((await o.tick()).started).toBe(2)
    expect(o.parts.queue.get(a.id).status).toBe('running')
    const res = await handleCall(r.core.api, 'autopilot.stop', [])
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value).toMatchObject({ killed: 2, requeued: 2, power: { state: 'off', loopRunning: false } })
    await o.supervisor.idle()
    for (const id of [a.id, b.id]) {
      // one attempt each: a dead letter if the stop had counted it
      expect(o.parts.queue.get(id)).toMatchObject({ status: 'queued', attempts: 0, leaseOwner: null })
    }
    expect(o.events(0, 1000).filter((e) => e.type === 'stop')).toHaveLength(1)
    expect(r.core.context.settings.get('orchestra.enabled', true)).toBe(false)
  })

  it('keeps a pause across a restart of the app (or of the team computer)', async () => {
    const dir = trackTemp(mkdtempSync(path.join(tmpdir(), 'atelier-power-')))
    let now = T0
    const open = (): Core =>
      createCore({
        paths: { userData: dir },
        cipher: testCipher(),
        tester: okTester,
        now: () => new Date(now),
        orchestra: { cronUtc: true, providers: () => new FakeProvider((req) => scriptedReply(req.system ?? '', req.prompt)) }
      })
    const first = open()
    first.db.prepare("INSERT INTO channels (name) VALUES ('Histoire')").run()
    first.orchestra.seed()
    await connectClaude(first)
    first.orchestra.power.set({ state: 'paused', until: new Date(T0 + 2 * HOUR).toISOString() })
    const t = first.orchestra.enqueue({ assigneeId: first.orchestra.parts.tree.bySlug('researcher-1')!.id, kind: 'research', title: 'après la pause' })
    first.close()
    now += HOUR
    const second = open()
    opened.push(second)
    second.orchestra.supervisor.stop()
    expect(second.orchestra.power.view()).toMatchObject({ state: 'paused', claudeConnected: true })
    expect((await second.orchestra.tick({ wait: true })).started).toBe(0)
    now += 2 * HOUR
    await second.orchestra.tick({ wait: true })
    expect(second.orchestra.parts.queue.get(t.id).status).toBe('done')
  })
})

describe('« Activité »', () => {
  it('shows who waits on whom: the lead on its researcher, the researcher on Charlie; the next routines; the accounts', async () => {
    const r = track(
      rig({
        providerFor: () =>
          new FakeProvider((req) => {
            const s = readPrompt(req.system ?? '', req.prompt)
            if (s.role === 'channel_lead') return 'Je délègue.' + block([{ type: 'delegate', role: 'researcher', kind: 'research', title: 'Trois sujets' }])
            if (s.role === 'researcher' && !s.answered) return 'Une question.' + block([{ type: 'ask_human', kind: 'input', question: 'Quel siècle ?' }])
            return 'ok' + block([{ type: 'done', result: 'ok' }])
          })
      })
    )
    const o = r.core.orchestra
    const lead = agentBySlug(r, `lead-${r.channels[0]}`)
    const plan = o.enqueue({ assigneeId: lead.id, kind: 'plan', title: 'Semaine' })
    await o.tick({ wait: true })
    await o.tick({ wait: true })
    const res = await handleCall(r.core.api, 'autopilot.activity', [])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const snap = res.value as ActivitySnapshot
    expect(snap.power.state).toBe('off')
    expect(snap.running).toEqual([])
    const leadWait = snap.waiting.find((w) => w.taskId === plan.id)!
    expect(leadWait).toMatchObject({ on: 'team', channelName: 'Histoire' })
    expect(leadWait.who).toContain('Recherchiste')
    const asked = snap.waiting.find((w) => w.on === 'charlie')!
    expect(asked.who).toBe('Charlie')
    expect(asked.inboxId).toBe(o.inbox()[0]!.id)
    expect(snap.nextRoutines.length).toBeGreaterThan(0)
    expect(snap.nextRoutines.map((x) => x.at)).toEqual([...snap.nextRoutines.map((x) => x.at)].sort())
    expect(snap.accounts[0]).toMatchObject({ ready: false, state: 'ready' })
    expect(snap.spend.callsToday).toBeGreaterThanOrEqual(2)
    expect(snap.events[0]!.id).toBeGreaterThan(snap.events[snap.events.length - 1]!.id)
  })
})
