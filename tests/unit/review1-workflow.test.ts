// Review 1 fixes, workflow: a run whose task is reset or cancelled is aborted (#7); after 3 revision requests the
// task waits for the owner (#8). FakeProvider only.
import { describe, expect, it } from 'vitest'
import { FakeProvider, type FakeReply } from '../../src/main/llm/fake'
import type { CompletionRequest } from '../../src/main/llm/types'
import { MAX_AUTO_REVISIONS } from '../../src/main/workflow/tasks'
import type { DeliverableType } from '../../src/shared/workflow'
import { memoryCore } from './helpers'

const reply = (req: CompletionRequest): FakeReply => {
  const m = /^Make the (.+?) for/.exec(req.prompt)
  // Many small chunks: the stream yields between them, so an abort lands mid-run.
  return { text: m ? `BODY OF ${m[1]} `.repeat(40) : 'chat', chunkSize: 3 }
}

function setup() {
  const provider = new FakeProvider(reply)
  const core = memoryCore({ chatProvider: () => provider, retryDelayMs: 0 })
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
  const ledger = () => core.db.prepare('SELECT status, estimate_usd, amount_usd FROM ledger ORDER BY id').all() as { status: string; estimate_usd: number; amount_usd: number }[]
  return { core, wf, video, d, t, run, messages, ledger, provider }
}

describe('#7 a run whose task moved on is aborted', () => {
  it('cancelling the video stops the research run in flight: no version, booked at the estimate', async () => {
    const s = setup()
    expect(s.core.runner.tick()).toEqual([s.t('research').id])
    expect(s.t('research').status).toBe('running')
    s.core.api['videos.cancel'](s.video.id)
    // The next tick sees the task cancelled under the run and aborts it.
    expect(s.core.runner.abortSuperseded()).toEqual([s.t('research').id])
    await s.core.runner.idle()
    expect(s.wf.listVersions(s.d('research').id)).toEqual([])
    const [row] = s.ledger()
    expect(row).toMatchObject({ status: 'settled' })
    expect(row!.amount_usd).toBe(row!.estimate_usd)
    expect((await s.messages()).some((m) => m.body.includes('the run was stopped because its task changed'))).toBe(true)
    s.core.close()
  })

  it('a revision upstream aborts the downstream run (through tick); the reset task waits for its inputs', async () => {
    const s = setup()
    await s.run() // research done
    await s.run() // thumbnail brief waiting for approval
    s.wf.approve(s.d('thumbnail_brief').id, { by: 'owner' })
    expect(s.core.runner.tick()).toContain(s.t('script').id)
    s.wf.requestRevision(s.d('research').id, { by: 'owner', note: 'more sources' })
    s.core.runner.tick()
    await s.core.runner.idle()
    expect(s.wf.listVersions(s.d('script').id)).toEqual([])
    expect(s.t('script')).toMatchObject({ status: 'blocked', attempts: 0 })
    // The script call was stopped (booked at its estimate), not run to the end and thrown away.
    const scriptRow = s.core.db.prepare('SELECT estimate_usd, amount_usd FROM ledger WHERE task_id = ?').get(s.t('script').id) as { estimate_usd: number; amount_usd: number }
    expect(scriptRow.amount_usd).toBe(scriptRow.estimate_usd)
    expect(s.provider.calls.filter((c) => c.prompt.startsWith('Make the Script'))).toHaveLength(1)
    s.core.close()
  })

  it('a run whose task did not change is left alone', async () => {
    const s = setup()
    s.core.runner.tick()
    expect(s.core.runner.abortSuperseded()).toEqual([])
    await s.core.runner.idle()
    expect(s.t('research').status).toBe('done')
    s.core.close()
  })
})

describe('#8 revisions are not endless', () => {
  it(`after ${MAX_AUTO_REVISIONS} revision requests the task is held with a task card; "Try again" runs it`, async () => {
    const s = setup()
    await s.run()
    for (let i = 1; i <= MAX_AUTO_REVISIONS; i++) {
      expect(s.d('research').status).toBe('done')
      s.wf.requestRevision(s.d('research').id, { by: 'owner', note: `revision ${i}` })
      if (i < MAX_AUTO_REVISIONS) {
        expect(s.t('research').holdReason).toBeNull()
        await s.run()
      }
    }
    expect(s.t('research')).toMatchObject({ status: 'ready', holdReason: 'revisions' })
    const calls = s.provider.calls.length
    expect(await s.run()).toEqual([])
    expect(s.provider.calls.length).toBe(calls)
    const card = (await s.messages()).map((m) => m.card).find((c) => c?.type === 'task' && c.taskId === s.t('research').id)
    expect(card).toMatchObject({ type: 'task', holdReason: 'revisions' })
    s.core.runner.resume(s.t('research').id)
    await s.run()
    expect(s.wf.listVersions(s.d('research').id)).toHaveLength(MAX_AUTO_REVISIONS + 1)
    s.core.close()
  })
})
