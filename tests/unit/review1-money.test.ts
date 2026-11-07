// Review 1 fixes, money and quitting: a CLI error result is booked (#1), a cancelled call is booked at the estimate
// (#2), tool runs reserve several turns, get a turn limit and a settle past a cap holds the channel (#3), a $0
// estimate cannot pass a used-up cap (#5), Claude children are killed synchronously before the database closes
// (#9). Fake child processes and FakeProvider only: no real CLI, no real model call.
import { trackTemp } from '../setup/track-temp'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { runReserved } from '../../src/main/agents/call'
import { createCore } from '../../src/main/core'
import { BudgetExceededError } from '../../src/main/ledger'
import { agentArgs, ClaudeCodeProvider, type SpawnFn, type SpawnedProcess } from '../../src/main/llm/claude-code'
import { FakeProvider, type FakeReply } from '../../src/main/llm/fake'
import { killTreeSync } from '../../src/main/platform/process'
import { ProviderError, type CompletionRequest, type Provider } from '../../src/main/llm/types'
import type { DeliverableType } from '../../src/shared/workflow'
import { memoryCore, okTester, testCipher } from './helpers'

class FakeChild extends EventEmitter implements SpawnedProcess {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode: number | null = null
  constructor(readonly pid: number) {
    super()
    this.stdin.resume()
  }
  line(ev: object): void {
    this.stdout.write(JSON.stringify(ev) + '\n')
  }
  finish(code: number): void {
    if (this.exitCode !== null) return
    this.exitCode = code
    this.stdout.end()
    this.stderr.end()
    setImmediate(() => this.emit('close', code))
  }
}

const delta = (text: string) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })

/** A ClaudeCodeProvider over fake children; `script` drives each child. Kills finish the child like taskkill. */
function cli(script: (c: FakeChild) => void) {
  const children: FakeChild[] = []
  const killed: number[] = []
  const killedSync: number[] = []
  const spawn: SpawnFn = () => {
    const child = new FakeChild(5000 + children.length)
    children.push(child)
    setImmediate(() => script(child))
    return child
  }
  const finish = (pid: number) => children.find((c) => c.pid === pid)?.finish(1)
  const provider = new ClaudeCodeProvider({
    platform: 'win32',
    findBinary: () => 'C:\\bin\\claude.exe',
    spawn,
    killTree: (pid) => {
      killed.push(pid)
      finish(pid)
    },
    killTreeSync: (pid) => {
      killedSync.push(pid)
      finish(pid)
    },
    removeDir: (d: string) => void trackTemp(d),
    exitWaitMs: 100,
    env: {}
  })
  return { provider, children, killed, killedSync }
}

const ledgerRows = (core: ReturnType<typeof memoryCore>) =>
  core.db.prepare('SELECT status, estimate_usd, amount_usd, input_tokens, output_tokens, task_id FROM ledger ORDER BY id').all() as {
    status: string
    estimate_usd: number
    amount_usd: number
    input_tokens: number
    output_tokens: number
    task_id: number | null
  }[]

const reserve = (core: ReturnType<typeof memoryCore>, usd = 0.5) =>
  core.ledger.reserve({ providerId: 'claude-code', model: 'claude-haiku-5-5', estimate: { usd } })

describe('#1 a Claude CLI error result is booked, not refunded', () => {
  it('settles the turn-limit error at the usage and cost the CLI reported', async () => {
    const core = memoryCore()
    const { provider } = cli((c) => {
      c.line({ type: 'system', subtype: 'init', session_id: 's-1', model: 'claude-haiku-5-5' })
      c.line(delta('partial'))
      c.line({
        type: 'result',
        subtype: 'error_max_turns',
        is_error: true,
        usage: { input_tokens: 1200, output_tokens: 340 },
        total_cost_usd: 0.0123,
        session_id: 's-1'
      })
      c.finish(1)
    })
    const handle = reserve(core)
    const err = await runReserved(core.ledger, handle, provider, { model: 'claude-haiku-5-5', prompt: 'x' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).code).toBe('TURN_LIMIT')
    expect((err as ProviderError).message).toContain('turn limit')
    expect(ledgerRows(core)).toEqual([
      { status: 'settled', estimate_usd: 0.5, amount_usd: 0.0123, input_tokens: 1200, output_tokens: 340, task_id: null }
    ])
    core.close()
  })
})

describe('#2 a cancelled call is booked at the estimate, never refunded', () => {
  it('FakeProvider: abort mid-stream settles at the estimate', async () => {
    const core = memoryCore()
    const provider = new FakeProvider(() => ({ text: 'one two three four five six', chunkSize: 4 }))
    const ac = new AbortController()
    const handle = reserve(core, 0.25)
    const err = await runReserved(core.ledger, handle, provider, { model: 'claude-haiku-5-5', prompt: 'x' }, () => ac.abort(), ac.signal).catch(
      (e: unknown) => e
    )
    expect((err as ProviderError).code).toBe('ABORTED')
    expect(ledgerRows(core)[0]).toMatchObject({ status: 'settled', amount_usd: 0.25 })
    core.close()
  })

  it('Claude Code: a cancelled run (process tree killed) settles at the estimate', async () => {
    const core = memoryCore()
    const { provider, killed } = cli((c) => c.line(delta('thinking about it')))
    const ac = new AbortController()
    const handle = reserve(core, 0.4)
    const err = await runReserved(core.ledger, handle, provider, { model: 'claude-haiku-5-5', prompt: 'x' }, () => ac.abort(), ac.signal).catch(
      (e: unknown) => e
    )
    expect((err as ProviderError).code).toBe('ABORTED')
    expect(killed).toEqual([5000])
    expect(ledgerRows(core)[0]).toMatchObject({ status: 'settled', amount_usd: 0.4 })
    core.close()
  })

  it('a CLI that dies without a result after silent tool turns is booked at the estimate, not refunded', async () => {
    const core = memoryCore()
    const { provider } = cli((c) => {
      // The model ran a turn that only called a tool: no text was streamed, then the CLI died.
      c.line({ type: 'stream_event', event: { type: 'message_start', message: { model: 'claude-haiku-5-5' } } })
      c.line({ type: 'assistant', message: { model: 'claude-haiku-5-5', content: [{ type: 'tool_use', id: 't1', name: 'mcp__atelier__get_brief', input: {} }] } })
      c.finish(3)
    })
    const handle = reserve(core, 0.3)
    const err = await runReserved(core.ledger, handle, provider, { model: 'claude-haiku-5-5', prompt: 'x' }).catch((e: unknown) => e)
    expect((err as ProviderError).message).toContain('without a result')
    expect(ledgerRows(core)[0]).toMatchObject({ status: 'settled', amount_usd: 0.3 })
    core.close()
  })

  it('a CLI that never reached the model (no event at all) is refunded', async () => {
    const core = memoryCore()
    const { provider } = cli((c) => c.finish(1))
    const handle = reserve(core, 0.3)
    await expect(runReserved(core.ledger, handle, provider, { model: 'claude-haiku-5-5', prompt: 'x' })).rejects.toThrow('without a result')
    expect(ledgerRows(core)[0]).toMatchObject({ status: 'refunded', amount_usd: 0 })
    core.close()
  })

  it('only a call cancelled before it reached the model is refunded', async () => {
    const core = memoryCore()
    const { provider, children } = cli(() => undefined)
    const ac = new AbortController()
    ac.abort()
    const handle = reserve(core)
    await expect(runReserved(core.ledger, handle, provider, { model: 'claude-haiku-5-5', prompt: 'x' }, undefined, ac.signal)).rejects.toThrow('Aborted')
    expect(children).toHaveLength(0)
    expect(ledgerRows(core)[0]).toMatchObject({ status: 'refunded', amount_usd: 0 })
    core.close()
  })
})

const taskReply = (costUsd?: number) => (req: CompletionRequest): FakeReply => {
  const m = /^Make the (.+?) for/.exec(req.prompt)
  return { text: m ? `BODY OF ${m[1]}` : 'chat', ...(costUsd !== undefined ? { costUsd } : {}) }
}

function runnerSetup(provider: FakeProvider) {
  const core = memoryCore({ chatProvider: () => provider, retryDelayMs: 0 })
  const wf = core.context.workflow
  const channel = wf.channels.create({ name: 'History' })
  const video = wf.createVideo(channel.id, { title: 'Atlantis', brief: 'b' }).video
  const d = (type: DeliverableType, videoId = video.id) => wf.listDeliverables(videoId).find((x) => x.type === type)!
  const t = (type: DeliverableType, videoId = video.id) => wf.listTasks({ videoId }).find((x) => x.deliverableId === d(type, videoId).id)!
  const run = async () => {
    const started = core.runner.tick()
    await core.runner.idle()
    return started
  }
  const messages = (videoId = video.id) => core.api['chat.messages'](core.chat.store.open({ kind: 'video', videoId }).id)
  return { core, wf, channel, video, d, t, run, messages }
}

describe('#3 tool runs cannot run away from the caps', () => {
  it('passes a turn limit to the CLI on tool runs (the caller’s, else 12)', () => {
    const dir = trackTemp(mkdtempSync(path.join(os.tmpdir(), 'atelier-args-')))
    try {
      const tools = { specs: [], webSearch: false, mcp: { command: 'node', args: ['mcp.js'], env: {} }, call: async () => ({ text: '', isError: false }) }
      const withLimit = agentArgs({ model: 'm', prompt: 'p', tools, maxTurns: 7 }, dir)
      expect(withLimit[withLimit.indexOf('--max-turns') + 1]).toBe('7')
      const byDefault = agentArgs({ model: 'm', prompt: 'p', tools }, dir)
      expect(byDefault[byDefault.indexOf('--max-turns') + 1]).toBe('12')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a task tool run reserves 4x the one-turn estimate and gets the turn limit; both are settings', async () => {
    const estimates: number[] = []
    for (const settings of [{}, { 'agents.toolRunEstimateMultiplier': 1, 'agents.maxTurns': 5 }]) {
      const provider = new FakeProvider(taskReply())
      const s = runnerSetup(provider)
      for (const [k, v] of Object.entries(settings)) s.core.context.settings.set(k, v)
      await s.run()
      expect(provider.calls[0]!.tools).toBeDefined()
      expect(provider.calls[0]!.maxTurns).toBe('agents.maxTurns' in settings ? 5 : 12)
      estimates.push(ledgerRows(s.core)[0]!.estimate_usd)
      s.core.close()
    }
    expect(estimates[0]! / estimates[1]!).toBeCloseTo(4, 2)
  })

  it('a settle that crosses the channel cap puts that channel’s next tasks on budget hold, with a budget card', async () => {
    const s = runnerSetup(new FakeProvider(taskReply(3)))
    const other = s.wf.createVideo(s.wf.channels.create({ name: 'Space' }).id, { title: 'Mars', brief: 'b' }).video
    await s.core.api['spend.setChannelCap'](s.channel.id, 1)
    s.core.context.settings.set('agents.maxParallel', 1)
    await s.run() // research of Atlantis: reserved under $1, really cost $3
    expect(s.t('research')).toMatchObject({ status: 'done' })
    expect(ledgerRows(s.core)[0]).toMatchObject({ status: 'settled', amount_usd: 3 })
    // Every task of the channel not started yet is held; the other channel is untouched.
    const held = s.wf.listTasks({ videoId: s.video.id }).filter((t) => t.status === 'ready' || t.status === 'blocked')
    expect(held.length).toBeGreaterThan(0)
    expect(held.every((t) => t.holdReason === 'cap')).toBe(true)
    expect(s.t('research', other.id).holdReason).toBeNull()
    const card = (await s.messages()).map((m) => m.card).find((c) => c?.type === 'budget')
    expect(card).toMatchObject({ type: 'budget', scope: 'channel', capUsd: 1, spentUsd: 3 })
    // Nothing more starts in that channel (no new reservation); raising the cap releases the holds.
    await s.run()
    expect(ledgerRows(s.core).filter((r) => r.task_id !== null && r.task_id !== s.t('research').id && r.task_id !== s.t('research', other.id).id)).toEqual([])
    await s.core.api['spend.setChannelCap'](s.channel.id, 50)
    expect(s.t('thumbnail_brief').holdReason).toBeNull()
    s.core.close()
  })
})

describe('#3 the cap hold counts settled spend only and lifts by itself', () => {
  it('open reservations of other runs do not put the channel on hold', () => {
    const s = runnerSetup(new FakeProvider(taskReply()))
    s.core.ledger.setChannelCap(s.channel.id, 1)
    // Three runs reserve $0.40 + $0.30 + $0.30; the first settles at $0.45. Settled + still open = $1.05 (over the
    // $1 cap), but settled spend is only $0.45: no hold.
    const r = (usd: number) => s.core.ledger.reserve({ providerId: 'claude-code', model: 'claude-haiku-5-5', channelId: s.channel.id, estimate: { usd } })
    const first = r(0.4)
    r(0.3)
    r(0.3)
    s.core.ledger.settle(first, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, { costUsd: 0.45 })
    expect(s.core.ledger.capReached(s.channel.id)).toBeNull()
    expect(s.core.runner.holdIfCapReached(s.channel.id, null)).toBe(0)
    s.core.close()
  })

  it('the hold lifts on the next tick once there is room again (here: a new month)', async () => {
    const clock = { t: new Date('2026-10-30T12:00:00.000Z') }
    const core = memoryCore({ chatProvider: () => new FakeProvider(taskReply(3)), retryDelayMs: 0, now: () => clock.t })
    const wf = core.context.workflow
    const channel = wf.channels.create({ name: 'History' })
    const video = wf.createVideo(channel.id, { title: 'Atlantis', brief: 'b' }).video
    core.ledger.setChannelCap(channel.id, 1)
    const tick = async () => {
      core.runner.tick()
      await core.runner.idle()
    }
    const held = () => wf.listTasks({ videoId: video.id }).filter((t) => t.holdReason === 'cap').length
    await tick()
    expect(held()).toBeGreaterThan(0)
    await tick()
    expect(held()).toBeGreaterThan(0) // same month: still held
    clock.t = new Date('2026-11-01T00:00:01.000Z')
    core.runner.tick() // releases the holds, then starts what is ready
    expect(held()).toBe(0)
    await core.runner.idle()
    core.close()
  })

  it('a run that hits its turn limit is booked and held (error), not retried at full cost', async () => {
    let calls = 0
    const provider: Provider = {
      id: 'claude-code',
      acceptsTools: () => true,
      complete: () => Promise.reject(new Error('unused')),
      // eslint-disable-next-line require-yield
      async *stream() {
        calls++
        const used = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }
        throw new ProviderError('Claude Code stopped at its turn limit before finishing', 'TURN_LIMIT', used, 0.02)
      }
    }
    const core = memoryCore({ chatProvider: () => provider, retryDelayMs: 0 })
    const wf = core.context.workflow
    const video = wf.createVideo(wf.channels.create({ name: 'History' }).id, { title: 'Atlantis', brief: 'b' }).video
    const research = () => wf.listTasks({ videoId: video.id }).find((t) => t.assignee === 'researcher')!
    core.runner.tick()
    await core.runner.idle()
    expect(research()).toMatchObject({ status: 'ready', holdReason: 'error', attempts: 1 })
    core.runner.tick()
    await core.runner.idle()
    expect(calls).toBe(1)
    expect(ledgerRows(core)).toEqual([expect.objectContaining({ status: 'settled', amount_usd: 0.02 })])
    core.close()
  })
})

describe('#5 a used-up cap refuses even a $0 estimate', () => {
  it('reserve refuses when spend already equals the cap', () => {
    const core = memoryCore()
    core.ledger.setGlobalCap(1)
    core.ledger.settle(reserve(core, 1), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, { costUsd: 1 })
    expect(() => reserve(core, 0)).toThrow(BudgetExceededError)
    core.close()
  })
})

describe('#9 quitting kills Claude children synchronously, before the database closes', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('killAll kills every live CLI with the synchronous kill and returns once done', async () => {
    const { provider, killedSync } = cli((c) => c.line(delta('working')))
    const stream = provider.stream({ model: 'claude-haiku-5-5', prompt: 'x' })[Symbol.asyncIterator]()
    await stream.next() // the child is live and talking
    expect(provider.killAll()).toBe(1)
    expect(killedSync).toEqual([5000])
    await expect(stream.next()).rejects.toThrow(/exited/)
    expect(provider.killAll()).toBe(0)
  })

  it('core.close(): sync kill while the database is open, no ledger write after; the next start books the estimate', async () => {
    const userData = trackTemp(mkdtempSync(path.join(os.tmpdir(), 'atelier-quit-')))
    dirs.push(userData)
    const order: string[] = []
    let dbOpen = (): boolean => false
    const core = createCore({
      paths: { userData },
      cipher: testCipher(),
      tester: okTester,
      providerDeps: {
        claudeCode: {
          platform: 'win32',
          findBinary: () => 'C:\\bin\\claude.exe',
          spawn: () => {
            const child = new FakeChild(7000)
            setImmediate(() => child.line(delta('researching')))
            children.push(child)
            return child
          },
          killTree: (pid) => order.push(`async-kill ${pid}`),
          killTreeSync: (pid) => {
            order.push(`sync-kill ${pid} db-open=${dbOpen()}`)
            for (const c of children) c.finish(1)
          },
          removeDir: (d: string) => void trackTemp(d),
          exitWaitMs: 50,
          env: {}
        }
      }
    })
    const children: FakeChild[] = []
    dbOpen = () => core.db.isOpen
    const wf = core.context.workflow
    const video = wf.createVideo(wf.channels.create({ name: 'History' }).id, { title: 'Atlantis', brief: 'b' }).video
    expect(core.runner.tick()).toHaveLength(1)
    await new Promise((r) => setTimeout(r, 30))
    expect(children).toHaveLength(1)
    const errors: unknown[] = []
    const onError = (e: unknown) => errors.push(e)
    process.on('unhandledRejection', onError)
    try {
      core.close()
      expect(order).toContain('sync-kill 7000 db-open=true')
      expect(core.db.isOpen).toBe(false)
      await core.runner.idle()
      await new Promise((r) => setTimeout(r, 50))
    } finally {
      process.off('unhandledRejection', onError)
    }
    expect(errors).toEqual([])
    // The reservation was left open by the quit: the next start settles it at its estimate.
    const next = createCore({ paths: { userData }, cipher: testCipher(), tester: okTester })
    const rows = next.db.prepare('SELECT status, estimate_usd, amount_usd FROM ledger').all() as { status: string; estimate_usd: number; amount_usd: number }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('settled')
    expect(rows[0]!.amount_usd).toBe(rows[0]!.estimate_usd)
    expect(rows[0]!.amount_usd).toBeGreaterThan(0)
    expect(next.context.workflow.getVideo(video.id).id).toBe(video.id)
    next.close()
  })

  it('killTreeSync runs taskkill /T /F through the given runner', () => {
    const runs: string[][] = []
    killTreeSync(42, 'win32', (cmd, args) => runs.push([cmd, ...args]))
    expect(runs[0]!.slice(1)).toEqual(['/PID', '42', '/T', '/F'])
    expect(runs[0]![0]).toMatch(/\\System32\\taskkill\.exe$/i)
  })
})
