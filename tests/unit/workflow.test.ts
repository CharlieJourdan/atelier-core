import { describe, expect, it } from 'vitest'
import { DELIVERABLE_GRAPH, DELIVERABLE_TYPES, type DeliverableType } from '../../src/shared/workflow'
import { memoryCore } from './helpers'

function setup(channel: Parameters<ReturnType<typeof memoryCore>['api']['channels.create']>[0] = { name: 'Lost Cities' }) {
  const core = memoryCore()
  const wf = core.context.workflow
  const ch = wf.channels.create(channel)
  const detail = wf.createVideo(ch.id, { title: 'Atlantis', brief: 'Why it matters' })
  const d = (type: DeliverableType) => wf.listDeliverables(detail.video.id).find((x) => x.type === type)!
  const task = (type: DeliverableType) => wf.listTasks({ videoId: detail.video.id }).find((t) => t.deliverableId === d(type).id)!
  const ready = () =>
    wf
      .readyTasks()
      .map((t) => wf.listDeliverables(detail.video.id).find((x) => x.id === t.deliverableId)?.type)
      .sort()
  /** Runs the producer's task for a deliverable and submits a version. */
  const produce = (type: DeliverableType, content = `${type} v`) => {
    wf.claimTask(task(type).id)
    return wf.submitVersion(d(type).id, { content, costUsd: 0.1, author: 'test' })
  }
  const approve = (type: DeliverableType, by = 'owner') => wf.approve(d(type).id, { by })
  return { core, wf, ch, video: detail.video, d, task, ready, produce, approve }
}

describe('channels', () => {
  it('creates with defaults, validates and updates', async () => {
    const { api } = memoryCore()
    const ch = await api['channels.create']({ name: ' Lost Cities ', niche: 'history', monthlyBudgetUsd: 50, autoApprove: ['metadata'] })
    expect(ch).toMatchObject({ name: 'Lost Cities', niche: 'history', monthlyBudgetUsd: 50, autoApprove: ['metadata'], ownerGates: ['publish_package'], archived: false })
    await expect(Promise.resolve().then(() => api['channels.create']({ name: '  ' }))).rejects.toThrow(/name/)
    await expect(Promise.resolve().then(() => api['channels.update'](ch.id, { autoApprove: ['nope' as DeliverableType] }))).rejects.toThrow(/unknown deliverable/)
    await expect(Promise.resolve().then(() => api['channels.update'](ch.id, { monthlyBudgetUsd: -1 }))).rejects.toThrow(/non-negative/)
    const up = await api['channels.update'](ch.id, { scriptStyle: 'punchy', thumbnailStyle: 'dark', standards: 'no clickbait', autopilotOn: true, monthlyBudgetUsd: null })
    expect(up).toMatchObject({ scriptStyle: 'punchy', thumbnailStyle: 'dark', standards: 'no clickbait', autopilotOn: true, monthlyBudgetUsd: null })
    await expect(Promise.resolve().then(() => api['channels.get'](999))).rejects.toThrow(/not found/)
  })

  it('archives and hides from the default list; archived channels take no new video', async () => {
    const { api } = memoryCore()
    const ch = await api['channels.create']({ name: 'A' })
    await api['channels.archive'](ch.id)
    expect(await api['channels.list']()).toHaveLength(0)
    expect(await api['channels.list'](true)).toHaveLength(1)
    await expect(Promise.resolve().then(() => api['videos.create'](ch.id))).rejects.toThrow(/archived/)
    await api['channels.archive'](ch.id, false)
    expect(await api['channels.list']()).toHaveLength(1)
  })
})

describe('deliverable graph', () => {
  it('has the 9 SPEC types, acyclic, with the SPEC approval flags', () => {
    expect(DELIVERABLE_GRAPH.map((g) => g.type)).toEqual([...DELIVERABLE_TYPES])
    const needs = DELIVERABLE_GRAPH.filter((g) => g.needsApproval).map((g) => g.type)
    expect(needs).toEqual(['thumbnail_brief', 'script', 'metadata', 'thumbnail', 'edit', 'publish_package'])
    const seen = new Set<string>()
    for (const g of DELIVERABLE_GRAPH) {
      for (const dep of g.dependsOn) expect(seen.has(dep)).toBe(true) // listed in topological order
      seen.add(g.type)
    }
  })

  it('creates a video with 9 deliverables, edges and blocked tasks; only research is ready', () => {
    const { wf, video, ready, core } = setup()
    expect(video.status).toBe('idea')
    expect(wf.listDeliverables(video.id)).toHaveLength(9)
    expect(wf.listTasks({ videoId: video.id })).toHaveLength(9)
    const edges = core.db.prepare('SELECT COUNT(*) AS n FROM deliverable_edges').get() as { n: number }
    expect(edges.n).toBe(DELIVERABLE_GRAPH.reduce((n, g) => n + g.dependsOn.length, 0))
    expect(ready()).toEqual(['research'])
  })
})

describe('walking a video from research to publish_package', () => {
  it('respects dependency order and ends ready, then published by hand', () => {
    const { wf, video, ready, produce, approve, d } = setup()
    produce('research')
    expect(d('research').status).toBe('done') // no approval needed
    expect(ready()).toEqual(['thumbnail_brief'])

    produce('thumbnail_brief')
    expect(wf.getVideo(video.id).status).toBe('waiting_approval')
    expect(ready()).toEqual([]) // waiting on the owner
    approve('thumbnail_brief')
    expect(ready()).toEqual(['script', 'thumbnail'])

    produce('script')
    approve('script')
    expect(ready()).toEqual(['metadata', 'narration', 'thumbnail'])
    produce('narration')
    produce('metadata')
    approve('metadata')
    expect(ready()).toEqual(['edit', 'qc_report', 'thumbnail'])
    produce('qc_report')
    produce('thumbnail')
    approve('thumbnail')
    produce('edit')
    expect(ready()).toEqual([])
    approve('edit')
    expect(ready()).toEqual(['publish_package'])

    produce('publish_package')
    expect(d('publish_package').status).toBe('waiting_approval')
    expect(wf.getVideo(video.id).status).toBe('waiting_approval')
    approve('publish_package')
    expect(wf.getVideo(video.id).status).toBe('ready')
    expect(wf.listTasks({ videoId: video.id }).every((t) => t.status === 'done')).toBe(true)

    expect(wf.markPublished(video.id).status).toBe('published')
    expect(() => wf.cancelVideo(video.id)).toThrow(/published/)
  })

  it('refuses a version while a dependency is unapproved, and an empty version', () => {
    const { wf, d } = setup()
    expect(() => wf.submitVersion(d('script').id, { content: 'x' })).toThrow(/blocked/)
    expect(() => wf.submitVersion(d('research').id, {})).toThrow(/content or a file/)
    expect(() => wf.submitVersion(d('research').id, { content: 'x', costUsd: -1 })).toThrow(/costUsd/)
  })

  it('stores file versions with their cost', () => {
    const { wf, d } = setup()
    const v = wf.submitVersion(d('research').id, { filePath: 'C:\\x\\r.md', mime: 'text/markdown', costUsd: 0.42 })
    expect(v).toMatchObject({ number: 1, content: null, filePath: 'C:\\x\\r.md', costUsd: 0.42 })
  })
})

describe('revisions', () => {
  it('creates a new version, re-opens dependants and keeps history', () => {
    const { wf, ready, produce, approve, d, task } = setup()
    produce('research')
    produce('thumbnail_brief')
    approve('thumbnail_brief')
    produce('script', 'script v1')
    approve('script')
    produce('narration')
    expect(d('narration').status).toBe('done')
    expect(ready()).toEqual(['edit', 'metadata', 'thumbnail'])

    const script1 = d('script').currentVersionId
    wf.requestRevision(d('script').id, { by: 'owner', note: 'Shorter intro' })
    expect(d('script')).toMatchObject({ status: 'revision_requested', approvedVersionId: null, currentVersionId: script1 })
    // Dependants fall back to pending and blocked; the thumbnail branch (not downstream of script) is untouched.
    expect(d('narration').status).toBe('pending')
    expect(task('narration').status).toBe('blocked')
    expect(d('metadata').status).toBe('pending')
    expect(ready()).toEqual(['script', 'thumbnail'])
    expect(task('script').attempts).toBe(0)

    const v2 = produce('script', 'script v2')
    expect(v2.number).toBe(2)
    expect(d('script').currentVersionId).toBe(v2.id)
    expect(d('script').status).toBe('waiting_approval')
    expect(ready()).toEqual(['thumbnail']) // dependants stay blocked until the new version is approved
    approve('script')
    expect(ready()).toEqual(['metadata', 'narration', 'thumbnail'])

    expect(wf.listVersions(d('script').id).map((v) => v.content)).toEqual(['script v1', 'script v2'])
    expect(wf.listApprovals(d('script').id).map((a) => [a.decision, a.versionId === script1])).toEqual([
      ['approved', true],
      ['revision_requested', true],
      ['approved', false]
    ])
    expect(wf.listApprovals(d('script').id)[1]!.note).toBe('Shorter intro')
  })

  it('needs a note, a revisable status, and a current version', () => {
    const { wf, produce, d } = setup()
    expect(() => wf.requestRevision(d('research').id, { by: 'owner', note: 'x' })).toThrow(/nothing to revise/)
    produce('research')
    produce('thumbnail_brief')
    expect(() => wf.requestRevision(d('thumbnail_brief').id, { by: 'owner', note: '  ' })).toThrow(/note/)
    expect(() => wf.requestRevision(d('thumbnail_brief').id, { by: 'owner', note: 'x', versionId: 9999 })).toThrow(/current version/)
    expect(() => wf.approve(d('thumbnail_brief').id, { by: 'owner', versionId: 9999 })).toThrow(/current version/)
    expect(() => wf.submitVersion(d('thumbnail_brief').id, { content: 'again' })).toThrow(/request a revision/)
  })

  it('can send back an already approved deliverable, reaching deep dependants', () => {
    const { wf, produce, approve, d, ready } = setup()
    produce('research')
    produce('thumbnail_brief')
    approve('thumbnail_brief')
    produce('script')
    approve('script')
    produce('thumbnail')
    approve('thumbnail')
    wf.requestRevision(d('thumbnail_brief').id, { by: 'owner', note: 'new angle' })
    expect(d('thumbnail_brief').status).toBe('revision_requested')
    expect(d('script').status).toBe('pending')
    expect(d('thumbnail').status).toBe('pending')
    expect(ready()).toEqual(['thumbnail_brief'])
  })

  it('refuses decisions on a cancelled video', () => {
    const { wf, video, produce, d } = setup()
    produce('research')
    produce('thumbnail_brief')
    wf.cancelVideo(video.id)
    expect(wf.listTasks({ videoId: video.id }).filter((t) => t.status !== 'done').every((t) => t.status === 'cancelled')).toBe(true)
    expect(() => wf.approve(d('thumbnail_brief').id, { by: 'owner' })).toThrow(/cancelled/)
  })
})

describe('auto-approve and owner gates', () => {
  it('auto-approves configured types without asking, and records it', () => {
    const { wf, produce, d, ready, video } = setup({ name: 'Auto', autoApprove: ['thumbnail_brief'] })
    produce('research')
    produce('thumbnail_brief')
    expect(d('thumbnail_brief')).toMatchObject({ status: 'approved' })
    expect(d('thumbnail_brief').approvedVersionId).toBe(d('thumbnail_brief').currentVersionId)
    expect(wf.listApprovals(d('thumbnail_brief').id)[0]).toMatchObject({ decision: 'auto_approved', decidedBy: 'auto' })
    expect(ready()).toEqual(['script', 'thumbnail'])
    expect(wf.getVideo(video.id).status).toBe('in_progress')
    expect(wf.pendingApprovals()).toHaveLength(0)
  })

  it('never auto-approves an owner-gated deliverable, and only the owner may approve it', () => {
    const { wf, produce, approve, d } = setup({ name: 'Gate', autoApprove: DELIVERABLE_TYPES.filter((t) => t !== 'publish_package') })
    for (const t of ['research', 'thumbnail_brief', 'script', 'narration', 'metadata', 'qc_report', 'thumbnail', 'edit'] as const) produce(t)
    expect(DELIVERABLE_TYPES.filter((t) => t !== 'publish_package').every((t) => ['approved', 'done'].includes(d(t).status))).toBe(true)
    produce('publish_package')
    expect(d('publish_package')).toMatchObject({ status: 'waiting_approval', ownerGate: true, needsApproval: true })
    expect(() => approve('publish_package', 'agent:supervisor')).toThrow(/owner-gated/)
    expect(() => wf.requestRevision(d('publish_package').id, { note: 'x', by: 'agent:qc' })).toThrow(/owner-gated/)
    expect(wf.pendingApprovals().map((p) => p.deliverable.type)).toEqual(['publish_package'])
    approve('publish_package')
    expect(d('publish_package').status).toBe('approved')
  })

  it('makes any type owner-gated through the channel, and applies later changes to open deliverables', () => {
    const { wf, ch, video, d } = setup({ name: 'Strict', ownerGates: ['publish_package', 'script'] })
    expect(d('script')).toMatchObject({ ownerGate: true, needsApproval: true })
    wf.updateChannel(ch.id, { ownerGates: ['publish_package'] })
    expect(d('script').ownerGate).toBe(false)
    wf.updateChannel(ch.id, { ownerGates: ['publish_package', 'research'] })
    expect(d('research')).toMatchObject({ ownerGate: true, needsApproval: true })
    expect(wf.getVideo(video.id).channelId).toBe(ch.id)
  })
})

describe('tasks and attempts', () => {
  it('runs ready → running → ready (retry) → failed at the cap, then retry resets', () => {
    const { wf, task, video } = setup()
    const id = task('research').id
    expect(task('research').maxAttempts).toBe(3)
    expect(() => wf.claimTask(task('script').id)).toThrow(/blocked/)

    for (let i = 1; i <= 3; i++) {
      expect(wf.claimTask(id)).toMatchObject({ status: 'running', attempts: i })
      expect(wf.getVideo(video.id).status).toBe('in_progress')
      const t = wf.failTask(id, `boom ${i}`)
      expect(t.lastError).toBe(`boom ${i}`)
      expect(t.status).toBe(i < 3 ? 'ready' : 'failed')
    }
    expect(wf.getTask(id).finishedAt).not.toBeNull()
    expect(() => wf.claimTask(id)).toThrow(/failed/)
    expect(() => wf.failTask(id, 'x')).toThrow(/not running/)
    expect(wf.readyTasks()).toHaveLength(0) // dependants stay blocked behind a failed task

    expect(wf.retryTask(id)).toMatchObject({ status: 'ready', attempts: 0 })
    expect(() => wf.retryTask(id)).toThrow(/not failed/)
  })

  it('marks the deliverable in progress on claim and links the version to its task', () => {
    const { wf, task, d } = setup()
    wf.claimTask(task('research').id)
    expect(d('research').status).toBe('in_progress')
    const v = wf.submitVersion(d('research').id, { content: 'r' })
    expect(v.taskId).toBe(task('research').id)
    expect(task('research').status).toBe('done')
  })

  it('shows a waiting task while the owner reviews', () => {
    const { wf, task, produce, d } = setup()
    produce('research')
    produce('thumbnail_brief')
    expect(task('thumbnail_brief').status).toBe('waiting_approval')
    wf.approve(d('thumbnail_brief').id, { by: 'owner' })
    expect(task('thumbnail_brief').status).toBe('done')
  })
})

describe('api surface', () => {
  it('drives the workflow over the typed api as the owner and notifies', async () => {
    const topics: string[] = []
    const core = memoryCore({ notify: (t) => topics.push(t) })
    const { api } = core
    const ch = await api['channels.create']({ name: 'Api' })
    const created = await api['videos.create'](ch.id, { title: 'T', deadline: '2026-12-01' })
    expect(created.video.deadline).toBe('2026-12-01')
    await expect(Promise.resolve().then(() => api['videos.create'](ch.id, { deadline: 'soon' }))).rejects.toThrow(/deadline/)
    const research = created.deliverables.find((x) => x.type === 'research')!
    const brief = created.deliverables.find((x) => x.type === 'thumbnail_brief')!
    await api['versions.add'](research.id, { content: 'findings' })
    await api['versions.add'](brief.id, { content: 'brief' })

    const pending = await api['approvals.pending']()
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ version: { content: 'brief', author: 'owner' }, video: { id: created.video.id } })

    await api['approvals.requestRevision'](brief.id, 'more contrast')
    expect((await api['approvals.history'](brief.id))[0]).toMatchObject({ decision: 'revision_requested', decidedBy: 'owner' })
    await api['versions.add'](brief.id, { content: 'brief 2' })
    const done = await api['approvals.approve'](brief.id, 'ok')
    expect(done.status).toBe('approved')
    expect(await api['versions.list'](brief.id)).toHaveLength(2)

    expect((await api['tasks.list']({ videoId: created.video.id, status: 'ready' })).map((t) => t.title).sort()).toEqual(['Script', 'Thumbnail'])
    expect((await api['videos.get'](created.video.id)).video.status).toBe('in_progress')
    expect((await api['videos.list']({ channelId: ch.id }))).toHaveLength(1)
    expect((await api['videos.update'](created.video.id, { title: 'Renamed' })).title).toBe('Renamed')
    expect((await api['videos.cancel'](created.video.id)).status).toBe('cancelled')
    expect(topics).toContain('channels')
    expect(topics).toContain('videos')
  })
})

describe('review fixes', () => {
  it('always gates publish_package and refuses to auto-approve it', async () => {
    const { api } = memoryCore()
    const ch = await api['channels.create']({ name: 'G', ownerGates: [] })
    expect(ch.ownerGates).toEqual(['publish_package'])
    expect((await api['channels.update'](ch.id, { ownerGates: ['script'] })).ownerGates).toEqual(['script', 'publish_package'])
    await expect(Promise.resolve().then(() => api['channels.update'](ch.id, { autoApprove: ['publish_package'] }))).rejects.toThrow(/auto-approved/)
  })

  it('applies a gate added after approval once the deliverable is revised and resubmitted', () => {
    const { wf, ch, produce, approve, d } = setup({ name: 'Late', autoApprove: ['script'] })
    produce('research')
    produce('thumbnail_brief')
    approve('thumbnail_brief')
    produce('script')
    expect(d('script').status).toBe('approved') // auto
    wf.updateChannel(ch.id, { ownerGates: ['publish_package', 'script'] })
    wf.requestRevision(d('script').id, { by: 'owner', note: 'redo' })
    produce('script')
    expect(d('script')).toMatchObject({ status: 'waiting_approval', ownerGate: true })
    expect(() => wf.approve(d('script').id, { by: 'agent:supervisor' })).toThrow(/owner-gated/)
  })

  it('drops cancelled videos from the approval queue and validates inputs', () => {
    const { wf, ch, video, produce } = setup()
    produce('research')
    produce('thumbnail_brief')
    expect(wf.pendingApprovals()).toHaveLength(1)
    wf.cancelVideo(video.id)
    expect(wf.pendingApprovals()).toHaveLength(0)
    expect(() => wf.createVideo(ch.id, { title: 42 as unknown as string })).toThrow(/title/)
    expect(() => wf.createVideo(ch.id, { deadline: '1' })).toThrow(/deadline/)
    expect(() => wf.createVideo(ch.id, { goalId: 77 })).toThrow(/Goal 77/)
    const fresh = setup()
    expect(() => fresh.wf.submitVersion(fresh.d('research').id, { content: 'x', taskId: fresh.task('script').id })).toThrow(/does not belong/)
    const other = setup()
    other.produce('research')
    expect(() => other.wf.requestRevision(other.d('research').id, { by: 'owner', note: 5 as unknown as string })).toThrow(/note must be a string/)
  })
})
