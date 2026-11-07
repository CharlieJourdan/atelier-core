// Runner fixes from the lot 5 review: holds are cleared by a revision and a retry, an error hold has a card and is
// resumed by a route/price change, a lowered cap does not release budget holds, an interrupted run gets its
// attempt back, a throwing chat post after the claim releases the reservation, tick() never throws.
import { describe, expect, it, vi } from 'vitest'
import { FakeProvider, type FakeReply } from '../../src/main/llm/fake'
import type { CompletionRequest } from '../../src/main/llm/types'
import type { DeliverableType } from '../../src/shared/workflow'
import { memoryCore } from './helpers'

const reply = (req: CompletionRequest): FakeReply => {
  const m = /^Make the (.+?) for/.exec(req.prompt)
  return { text: m ? `BODY OF ${m[1]}` : 'chat' }
}

function setup(provider: (id: string) => FakeProvider = () => new FakeProvider(reply)) {
  const core = memoryCore({ chatProvider: provider, retryDelayMs: 0 })
  const wf = core.context.workflow
  const channel = wf.channels.create({ name: 'History' })
  const video = wf.createVideo(channel.id, { title: 'Atlantis', brief: 'b' }).video
  const d = (type: DeliverableType) => wf.listDeliverables(video.id).find((x) => x.type === type)!
  const t = (type: DeliverableType) => wf.listTasks({ videoId: video.id }).find((x) => x.deliverableId === d(type).id)!
  const run = async () => {
    const started = core.runner.tick()
    await core.runner.idle()
    return started
  }
  const messages = () => core.api['chat.messages'](core.chat.store.open({ kind: 'video', videoId: video.id }).id)
  const reservedRows = () => (core.db.prepare(`SELECT COUNT(*) AS n FROM ledger WHERE status = 'reserved'`).get() as { n: number }).n
  return { core, wf, channel, video, d, t, run, messages, reservedRows }
}

describe('holds', () => {
  it('a revision upstream and a retry clear a hold', async () => {
    const { core, wf, d, t, run } = setup()
    await run() // research done
    await run() // thumbnail brief waiting
    wf.approve(d('thumbnail_brief').id, { by: 'owner' })
    await core.api['spend.setGlobalCap'](0.000001)
    await run()
    expect(t('script').holdReason).toBe('budget')
    await core.api['approvals.requestRevision'](d('research').id, 'more sources')
    expect(t('script')).toMatchObject({ status: 'blocked', holdReason: null })

    core.db.prepare(`UPDATE tasks SET status = 'failed', hold_reason = 'error' WHERE id = ?`).run(t('research').id)
    expect(wf.retryTask(t('research').id).holdReason).toBeNull()
  })

  it('a lowered cap keeps budget holds; a raised one releases them', async () => {
    const { core, t, run } = setup()
    await core.api['spend.setGlobalCap'](0.000002)
    await run()
    expect(t('research').holdReason).toBe('budget')
    await core.api['spend.setGlobalCap'](0.000001)
    expect(t('research').holdReason).toBe('budget')
    await core.api['spend.setGlobalCap'](5)
    expect(t('research').holdReason).toBeNull()
  })

  it('a task that cannot start is held with a task card, and a route change resumes it', async () => {
    const { core, t, run, messages } = setup()
    // An API model without a price cannot be tracked: the run refuses to start.
    await core.api['routes.set']('researcher', { providerId: 'anthropic', model: 'claude-unpriced-x' })
    expect(await run()).toEqual([t('research').id])
    expect(t('research')).toMatchObject({ status: 'ready', holdReason: 'error', attempts: 0 })
    const card = (await messages()).map((m) => m.card).find((c) => c?.type === 'task')
    expect(card).toMatchObject({ type: 'task', taskId: t('research').id, holdReason: 'error' })
    expect(await run()).toEqual([]) // held: not retried every tick

    await core.api['routes.set']('researcher', { providerId: null, model: null })
    expect(t('research').holdReason).toBeNull()
    await run()
    expect(t('research').status).toBe('done')
  })
})

describe('robustness', () => {
  it('an interrupted run goes back to ready with its attempt given back', () => {
    const { core, wf, t } = setup()
    wf.claimTask(t('research').id)
    expect(t('research')).toMatchObject({ status: 'running', attempts: 1 })
    expect(core.runner.recoverInterrupted()).toBe(1)
    expect(t('research')).toMatchObject({ status: 'ready', attempts: 0 })
  })

  it('a chat post failing after the claim releases the reservation', async () => {
    const { core, t, run, reservedRows } = setup()
    const post = core.chat.store.post.bind(core.chat.store)
    vi.spyOn(core.chat.store, 'post').mockImplementation((id, msg) => {
      if (msg.card?.type === 'task') throw new Error('disk full')
      return post(id, msg)
    })
    await run()
    expect(reservedRows()).toBe(0)
    expect(t('research').status).toBe('ready') // failed attempt, retried later
    expect(t('research').lastError).toContain('disk full')
  })

  it('tick() never throws', () => {
    const { core } = setup()
    vi.spyOn(core.context.workflow, 'readyTasks').mockImplementation(() => {
      throw new Error('database is closed')
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(core.runner.tick()).toEqual([])
  })
})
