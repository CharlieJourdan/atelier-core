import { describe, expect, it } from 'vitest'
import { FakeProvider, type FakeReply } from '../../src/main/llm/fake'
import type { CompletionRequest } from '../../src/main/llm/types'
import type { DeliverableType } from '../../src/shared/workflow'
import type { CoreOptions } from '../../src/main/core'
import { memoryCore } from './helpers'

const TASK_RE = /^Make the (.+?) for the video "(.*?)"/

/** Answers task prompts with a recognisable body; anything else is plain chat. */
const teamResponder = (req: CompletionRequest): FakeReply => {
  const m = TASK_RE.exec(req.prompt)
  return m ? { text: `# ${m[1]}\n\nBODY OF ${m[1]!.toUpperCase()} for ${m[2]}` } : { text: 'chat reply' }
}

/** A provider whose calls wait until `release()` (keeps runs in flight). */
class GatedProvider extends FakeProvider {
  release: () => void = () => undefined
  private gate: Promise<void> = Promise.resolve()
  close(): void {
    this.gate = new Promise((res) => (this.release = res))
  }
  override async *stream(...args: Parameters<FakeProvider['stream']>) {
    await this.gate
    yield* super.stream(...args)
  }
}

function setup(provider: FakeProvider = new FakeProvider(teamResponder), extra: Partial<CoreOptions> = {}) {
  const core = memoryCore({ chatProvider: () => provider, retryDelayMs: 0, ...extra })
  const wf = core.context.workflow
  const channel = wf.channels.create({ name: 'History' })
  const newVideo = (title: string, channelId = channel.id) => wf.createVideo(channelId, { title, brief: `brief ${title}` }).video
  const video = newVideo('Atlantis')
  const d = (type: DeliverableType, v = video) => wf.listDeliverables(v.id).find((x) => x.type === type)!
  const t = (type: DeliverableType, v = video) => wf.listTasks({ videoId: v.id }).find((x) => x.deliverableId === d(type, v).id)!
  const messages = (v = video) => core.api['chat.messages'](core.chat.store.open({ kind: 'video', videoId: v.id }).id)
  const run = async () => {
    const started = core.runner.tick()
    await core.runner.idle()
    return started
  }
  return { core, wf, provider, channel, video, newVideo, d, t, messages, run }
}

const ledgerRows = (core: ReturnType<typeof setup>['core']) =>
  core.db.prepare('SELECT task_id, status, amount_usd FROM ledger ORDER BY id').all() as {
    task_id: number | null
    status: string
    amount_usd: number
  }[]

describe('a fresh video', () => {
  it('starts research only, books its cost on the version, then walks to the script', async () => {
    const { core, wf, provider, d, t, run, video } = setup()
    expect(await run()).toEqual([t('research').id])

    expect(d('research').status).toBe('done')
    const [v1, ...rest] = wf.listVersions(d('research').id)
    expect(rest).toHaveLength(0)
    expect(v1).toMatchObject({ number: 1, author: 'researcher', mime: 'text/markdown', taskId: t('research').id })
    expect(v1!.content).toContain('BODY OF RESEARCH')
    const rows = ledgerRows(core)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'settled', task_id: t('research').id })
    expect(rows[0]!.amount_usd).toBeGreaterThan(0)
    expect(v1!.costUsd).toBe(rows[0]!.amount_usd)

    expect(t('thumbnail_brief').status).toBe('ready')
    expect(t('script').status).toBe('blocked')

    expect(await run()).toEqual([t('thumbnail_brief').id])
    expect(d('thumbnail_brief').status).toBe('waiting_approval')
    const cards = (await core.api['chat.messages'](core.chat.store.open({ kind: 'video', videoId: video.id }).id)).filter(
      (m) => m.card?.type === 'approval'
    )
    expect(cards).toHaveLength(1)
    expect(cards[0]!.card).toMatchObject({ type: 'approval', deliverableId: d('thumbnail_brief').id, status: 'waiting_approval' })
    expect(t('script').status).toBe('blocked')
    expect(await run()).toEqual([]) // nothing ready, the owner has to decide

    await core.api['approvals.approve'](d('thumbnail_brief').id)
    // thumbnail is ready too, but it is a media deliverable: the runner never starts it
    expect(t('thumbnail').status).toBe('ready')
    expect(await run()).toEqual([t('script').id])
    expect(d('script').status).toBe('waiting_approval')
    expect(t('thumbnail').status).toBe('ready')
    expect(wf.listVersions(d('thumbnail').id)).toHaveLength(0)

    const scriptCall = provider.calls.find((c) => c.prompt.startsWith('Make the Script'))!
    expect(scriptCall.prompt).toContain('<input type="research" title="Research v1">')
    expect(scriptCall.prompt).toContain('BODY OF RESEARCH')
    expect(scriptCall.prompt).toContain('<input type="thumbnail_brief" title="Thumbnail brief v1">')
    expect(scriptCall.prompt).toContain('BODY OF THUMBNAIL BRIEF')
  })

  it('posts a task card (live status) and a done message in the video chat', async () => {
    const { run, messages, t } = setup()
    await run()
    const msgs = await messages()
    const card = msgs.find((m) => m.card?.type === 'task')!
    expect(card.authorId).toBe('researcher')
    expect(card.card).toMatchObject({ type: 'task', taskId: t('research').id, title: 'Research', status: 'done' })
    expect(msgs.some((m) => m.authorType === 'agent' && m.body.startsWith('Research v1 is done'))).toBe(true)
  })

  it('does not auto-start tasks of a finished waiting video twice', async () => {
    const { run, provider } = setup()
    await run()
    await run()
    await run() // thumbnail_brief now waits for approval
    const n = provider.calls.length
    expect(await run()).toEqual([])
    expect(provider.calls).toHaveLength(n)
  })
})

describe('failures and retries', () => {
  const failing = () => new FakeProvider(() => ({ text: '', error: 'boom' }))

  it('retries a failed attempt on the next ticks until the attempts are used up, then fails', async () => {
    const { core, wf, run, t, messages, provider } = setup(failing())
    await run()
    let task = wf.getTask(t('research').id)
    expect(task).toMatchObject({ status: 'ready', attempts: 1, lastError: 'boom' })
    expect((await messages()).some((m) => m.authorType === 'system' && m.body.includes('attempt 1 failed: boom'))).toBe(true)

    await run()
    await run()
    task = wf.getTask(t('research').id)
    expect(task).toMatchObject({ status: 'failed', attempts: 3, lastError: 'boom' })
    expect((await messages()).some((m) => m.body.includes('failed after 3 attempts'))).toBe(true)
    expect(provider.calls).toHaveLength(3)
    // failed calls are refunded, not billed
    expect(ledgerRows(core).every((r) => r.status === 'refunded' && r.amount_usd === 0)).toBe(true)

    expect(await run()).toEqual([]) // failed: no more tries by itself
    const again = await core.api['tasks.retry'](task.id)
    expect(again).toMatchObject({ attempts: 0, lastError: null })
    expect(wf.getTask(task.id).status).toBe('ready')
  })

  it('does not retry a failed attempt before the retry delay', async () => {
    const { wf, run, t, provider } = setup(failing(), { retryDelayMs: 60_000 })
    expect(await run()).toHaveLength(1)
    expect(await run()).toEqual([])
    expect(provider.calls).toHaveLength(1)
    expect(wf.getTask(t('research').id)).toMatchObject({ status: 'ready', attempts: 1 })
  })

  it('fails an empty deliverable instead of saving it', async () => {
    const { wf, run, t, d } = setup(new FakeProvider(() => ({ text: '   ' })))
    await run()
    expect(wf.getTask(t('research').id).lastError).toMatch(/empty deliverable/)
    expect(wf.listVersions(d('research').id)).toHaveLength(0)
  })
})

describe('budget hold', () => {
  it('holds a refused task without booking anything, then resumes when the cap is raised', async () => {
    const { core, wf, run, t, messages, provider } = setup()
    await core.api['spend.setGlobalCap'](0.000001)
    expect(await run()).toEqual([t('research').id])

    expect(wf.getTask(t('research').id)).toMatchObject({ status: 'ready', attempts: 0, holdReason: 'budget' })
    expect(provider.calls).toHaveLength(0)
    expect(ledgerRows(core)).toEqual([])
    const sys = (await messages()).filter((m) => m.card?.type === 'budget')
    expect(sys).toHaveLength(1)
    expect(sys[0]!.authorType).toBe('system')
    expect(sys[0]!.card).toMatchObject({ type: 'budget', scope: 'global', taskId: t('research').id, held: true })

    expect(await run()).toEqual([]) // held: not even tried
    expect(ledgerRows(core)).toEqual([])
    await expect(Promise.resolve().then(() => core.api['tasks.resume'](t('thumbnail_brief').id))).rejects.toThrow(/not on hold/)

    await core.api['spend.setGlobalCap'](null)
    expect(wf.getTask(t('research').id).holdReason).toBeNull()
    const card = (await messages()).find((m) => m.card?.type === 'budget')!.card
    expect(card).toMatchObject({ held: false })
    expect(await run()).toEqual([t('research').id])
    expect(wf.getTask(t('research').id).status).toBe('done')
  })

  it('tasks.resume takes a held task off hold; a still-too-low cap holds it again', async () => {
    const { core, wf, run, t } = setup()
    await core.api['spend.setGlobalCap'](0.000001)
    await run()
    const resumed = await core.api['tasks.resume'](t('research').id)
    expect(resumed.holdReason).toBeNull()
    await run()
    expect(wf.getTask(t('research').id)).toMatchObject({ holdReason: 'budget', status: 'ready', attempts: 0 })
  })
})

describe('limits', () => {
  it('respects agents.maxParallelPerChannel', async () => {
    const { core, t, newVideo, video } = setup()
    const second = newVideo('Troy')
    await core.api['settings.set']('agents.maxParallelPerChannel', 1)
    expect(core.runner.tick()).toEqual([t('research').id])
    expect(core.runner.inFlight).toEqual([t('research').id])
    await core.runner.idle()
    expect(t('research', second)).toMatchObject({ status: 'ready', attempts: 0 })
    expect(video.id).not.toBe(second.id)

    const fresh = setup()
    fresh.newVideo('Troy')
    await fresh.core.api['settings.set']('agents.maxParallelPerChannel', 2)
    expect(fresh.core.runner.tick()).toHaveLength(2)
    await fresh.core.runner.idle()
  })

  it('respects agents.maxParallel across channels', async () => {
    const { core, newVideo } = setup()
    const other = core.context.workflow.channels.create({ name: 'Space' })
    newVideo('Mars', other.id)
    await core.api['settings.set']('agents.maxParallel', 1)
    expect(core.runner.tick()).toHaveLength(1)
    await core.runner.idle()
    await core.api['settings.set']('agents.maxParallel', 2)
    // History's thumbnail brief and Space's research, on two channels
    expect(core.runner.tick()).toHaveLength(2)
    await core.runner.idle()
  })

  it('starts one run per channel slot when several videos are ready, never two for the same task', async () => {
    const { core, newVideo } = setup()
    newVideo('Troy')
    newVideo('Pompeii')
    const first = core.runner.tick()
    const again = core.runner.tick() // same tasks are already in flight
    expect(first).toHaveLength(2) // default per-channel limit 2
    expect(again).toEqual([])
    await core.runner.idle()
  })

  it('does not start a disabled agent', async () => {
    const { core, run, provider } = setup()
    await core.api['agents.update']('researcher', { enabled: false })
    expect(await run()).toEqual([])
    expect(provider.calls).toHaveLength(0)
    await core.api['agents.update']('researcher', { enabled: true })
    expect(await run()).toHaveLength(1)
  })

  it('starts nothing when agents.runnerEnabled is false', async () => {
    const { core, run } = setup()
    await core.api['settings.set']('agents.runnerEnabled', false)
    expect(await run()).toEqual([])
    await core.api['settings.set']('agents.runnerEnabled', true)
    expect(await run()).toHaveLength(1)
  })
})

describe('inputs change while a run is in flight', () => {
  it('discards the output of a run whose upstream was sent back', async () => {
    const gated = new GatedProvider(teamResponder)
    const { core, wf, run, t, d, messages } = setup(gated)
    await run() // research
    await run() // thumbnail brief
    await core.api['approvals.approve'](d('thumbnail_brief').id)

    gated.close()
    const started = core.runner.tick()
    expect(started).toEqual([t('script').id])
    expect(wf.getTask(t('script').id).status).toBe('running')
    await core.api['approvals.requestRevision'](d('thumbnail_brief').id, 'Different idea')
    expect(wf.getTask(t('script').id).status).toBe('blocked')
    gated.release()
    await core.runner.idle()

    expect(wf.listVersions(d('script').id)).toHaveLength(0)
    expect(d('script').status).toBe('pending')
    expect((await messages()).some((m) => m.authorType === 'system' && m.body.includes('discarded'))).toBe(true)
    // the revision is picked up: the brief is made again, with the note in its prompt
    await run()
    const again = gated.calls.at(-1)!
    expect(again.prompt).toContain('Different idea')
  })
})
