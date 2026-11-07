// Review 2 fixes: an unpriced Claude Code model reserves a default price under a cap (#1), an upstream reset keeps
// the revisions hold (#2), the hold counts the revisions since the last "Try again" (#3). FakeProvider only.
import { describe, expect, it } from 'vitest'
import { FakeProvider, type FakeReply } from '../../src/main/llm/fake'
import type { CompletionRequest } from '../../src/main/llm/types'
import { MAX_AUTO_REVISIONS } from '../../src/main/workflow/tasks'
import type { DeliverableType } from '../../src/shared/workflow'
import { memoryCore } from './helpers'

const reply = (req: CompletionRequest): FakeReply => {
  const m = /^Make the (.+?) for/.exec(req.prompt)
  return { text: m ? `BODY OF ${m[1]}` : 'chat' }
}

function setup() {
  const core = memoryCore({ chatProvider: () => new FakeProvider(reply), retryDelayMs: 0 })
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
  const estimates = () => (core.db.prepare('SELECT estimate_usd FROM ledger ORDER BY id').all() as { estimate_usd: number }[]).map((r) => r.estimate_usd)
  return { core, wf, channel, d, t, run, estimates }
}

describe('#1 an unpriced Claude Code model under a cap', () => {
  it('reserves the balanced tier price instead of $0 when a cap is set', async () => {
    const s = setup()
    await s.core.api['routes.set']('researcher', { model: 'claude-mystery-9' })
    await s.core.api['spend.setGlobalCap'](50)
    await s.run()
    expect(s.estimates()[0]).toBeGreaterThan(0)
    s.core.close()
  })

  it('a channel cap alone is enough; without any cap the reservation stays $0', async () => {
    const a = setup()
    await a.core.api['routes.set']('researcher', { model: 'claude-mystery-9' })
    await a.run()
    expect(a.estimates()[0]).toBe(0)
    a.core.close()

    const b = setup()
    await b.core.api['routes.set']('researcher', { model: 'claude-mystery-9' })
    await b.core.api['spend.setChannelCap'](b.channel.id, 50)
    await b.run()
    expect(b.estimates()[0]).toBeGreaterThan(0)
    b.core.close()
  })

  it('the reservation counts against the cap: a tiny cap holds the task', async () => {
    const s = setup()
    await s.core.api['routes.set']('researcher', { model: 'claude-mystery-9' })
    await s.core.api['spend.setGlobalCap'](0.000001)
    await s.run()
    expect(s.t('research')).toMatchObject({ status: 'ready', holdReason: 'budget' })
    s.core.close()
  })
})

describe('#2 an upstream reset keeps a revisions hold', () => {
  it('clears a budget hold but not a revisions hold', async () => {
    const s = setup()
    await s.run()
    await s.run()
    s.core.db.prepare(`UPDATE tasks SET hold_reason = 'revisions' WHERE id = ?`).run(s.t('script').id)
    s.core.db.prepare(`UPDATE tasks SET hold_reason = 'budget' WHERE id = ?`).run(s.t('thumbnail_brief').id)
    s.wf.requestRevision(s.d('research').id, { by: 'owner', note: 'more' })
    expect(s.t('script')).toMatchObject({ status: 'blocked', holdReason: 'revisions' })
    expect(s.t('thumbnail_brief').holdReason).toBeNull()
    s.core.close()
  })
})

describe('#3 the revision count restarts at "Try again"', () => {
  it('holds again only after another full set of revisions', async () => {
    const s = setup()
    await s.run()
    const revise = async (i: number) => {
      s.wf.requestRevision(s.d('research').id, { by: 'owner', note: `n${i}` })
    }
    for (let i = 1; i <= MAX_AUTO_REVISIONS; i++) {
      await revise(i)
      if (i < MAX_AUTO_REVISIONS) await s.run()
    }
    expect(s.t('research').holdReason).toBe('revisions')
    s.core.runner.resume(s.t('research').id)
    await s.run()
    for (let i = 1; i < MAX_AUTO_REVISIONS; i++) {
      await revise(10 + i)
      expect(s.t('research').holdReason).toBeNull() // not held straight away
      await s.run()
    }
    await revise(99)
    expect(s.t('research').holdReason).toBe('revisions')
    s.core.close()
  })
})
