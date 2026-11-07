import { describe, expect, it } from 'vitest'
import { taskContext } from '../../src/main/agents/context'
import {
  buildChatSystem,
  buildTaskPrompt,
  MAX_INPUT_CHARS,
  type ChatPromptInput,
  type PromptAgent,
  type TaskPromptInput
} from '../../src/main/agents/prompt'
import type { ChannelRow, DeliverableType, VideoRow } from '../../src/shared/workflow'
import { memoryCore } from './helpers'

const agent = (over: Partial<PromptAgent> = {}): PromptAgent => ({
  role: 'scriptwriter',
  name: 'Scriptwriter',
  instructions: 'INSTRUCTIONS-MARKER write well',
  tools: ['get_brief', 'save_version'],
  webSearch: false,
  ...over
})

const channel = { id: 1, name: 'Lost Cities', niche: 'history', standards: 'STANDARDS-MARKER', scriptStyle: 'SCRIPT-STYLE', thumbnailStyle: 'THUMB-STYLE' } as ChannelRow
const video = { id: 7, channelId: 1, title: 'Atlantis', brief: 'Why it sank', status: 'in_progress', deadline: null } as VideoRow

function task(type: DeliverableType, over: Partial<TaskPromptInput> = {}): TaskPromptInput {
  return {
    agent: agent(),
    channel,
    video,
    deliverable: { type, title: type === 'script' ? 'Script' : type },
    inputs: [],
    memory: [],
    revision: null,
    toolsAvailable: false,
    ...over
  }
}

describe('buildTaskPrompt', () => {
  it('puts instructions and channel info in the system prompt and the brief in the prompt', () => {
    const { system, prompt } = buildTaskPrompt(task('research'))
    expect(system).toContain('You are the Scriptwriter of Atelier')
    expect(system).toContain('INSTRUCTIONS-MARKER')
    expect(system).toContain('Channel: Lost Cities (niche: history).')
    expect(system).toContain('STANDARDS-MARKER')
    expect(prompt.startsWith('Make the research for the video "Atlantis".')).toBe(true)
    expect(prompt).toContain('<brief>\nWhy it sank\n</brief>')
    expect(prompt).toContain('What to deliver: A research dossier')
  })

  it('adds the script style only for script and qc_report, the thumbnail style only for thumbnail_brief', () => {
    const has = (type: DeliverableType, s: string) => buildTaskPrompt(task(type)).system.includes(s)
    for (const type of ['script', 'qc_report'] as const) {
      expect(has(type, 'SCRIPT-STYLE')).toBe(true)
      expect(has(type, 'THUMB-STYLE')).toBe(false)
    }
    expect(has('thumbnail_brief', 'THUMB-STYLE')).toBe(true)
    expect(has('thumbnail_brief', 'SCRIPT-STYLE')).toBe(false)
    for (const type of ['research', 'metadata', 'publish_package'] as const) {
      expect(has(type, 'SCRIPT-STYLE')).toBe(false)
      expect(has(type, 'THUMB-STYLE')).toBe(false)
    }
  })

  it('lists memory notes', () => {
    const { system } = buildTaskPrompt(task('script', { memory: ['prefers short intros', 'avoid dates'] }))
    expect(system).toContain('Notes you saved earlier:')
    expect(system).toContain('- prefers short intros')
    expect(system).toContain('- avoid dates')
    expect(buildTaskPrompt(task('script')).system).not.toContain('Notes you saved earlier')
  })

  it('inlines approved inputs in <input> tags with type, title and version', () => {
    const { prompt } = buildTaskPrompt(
      task('script', {
        inputs: [
          { type: 'research', title: 'Research', versionNumber: 2, content: 'RESEARCH BODY' },
          { type: 'thumbnail_brief', title: 'Thumbnail brief', versionNumber: 1, content: 'BRIEF BODY' }
        ]
      })
    )
    expect(prompt).toContain('<input type="research" title="Research v2">\nRESEARCH BODY\n</input>')
    expect(prompt).toContain('<input type="thumbnail_brief" title="Thumbnail brief v1">\nBRIEF BODY\n</input>')
  })

  it('truncates a long input and says how much was cut', () => {
    const content = 'a'.repeat(MAX_INPUT_CHARS) + 'TAIL-CUT'
    const { prompt } = buildTaskPrompt(task('script', { inputs: [{ type: 'research', title: 'Research', versionNumber: 1, content }] }))
    expect(prompt).not.toContain('TAIL-CUT')
    expect(prompt).toContain('[… truncated, 8 more characters]')
    // exactly at the limit is kept whole
    const exact = buildTaskPrompt(task('script', { inputs: [{ type: 'research', title: 'R', versionNumber: 1, content: 'b'.repeat(MAX_INPUT_CHARS) }] }))
    expect(exact.prompt).not.toContain('truncated')
  })

  it('includes the revision note and the previous version', () => {
    const { prompt } = buildTaskPrompt(task('script', { revision: { note: 'Shorter hook', previousVersion: 3, previousContent: 'OLD TEXT' } }))
    expect(prompt).toContain('Charlie sent back version 3 with this note: Shorter hook')
    expect(prompt).toContain('<previous version="3">\nOLD TEXT\n</previous>')
    expect(prompt).toContain('Write a new complete version that addresses the note.')
    expect(buildTaskPrompt(task('script')).prompt).not.toContain('<previous')
  })

  it('names the tools only when they are available, WebSearch only for web-search agents', () => {
    const none = buildTaskPrompt(task('script', { toolsAvailable: false }))
    expect(none.system).not.toContain('Atelier tools')
    expect(none.prompt).toContain('Reply with the deliverable only')
    expect(none.prompt).not.toContain('save_version')

    const withTools = buildTaskPrompt(task('script', { toolsAvailable: true }))
    expect(withTools.system).toContain('You can use these Atelier tools:')
    expect(withTools.system).toContain('- get_brief:')
    expect(withTools.system).toContain('- save_version:')
    expect(withTools.system).not.toContain('post_message:')
    expect(withTools.system).not.toContain('WebSearch')
    expect(withTools.prompt).toContain('save it with save_version')
    expect(withTools.prompt).not.toContain('Reply with the deliverable only')

    const web = buildTaskPrompt(task('research', { toolsAvailable: true, agent: agent({ webSearch: true }) }))
    expect(web.system).toContain('- WebSearch: search the web')
    // web search without the bridge is not offered
    expect(buildTaskPrompt(task('research', { toolsAvailable: false, agent: agent({ webSearch: true }) })).system).not.toContain('WebSearch')
  })

  it('shows the deadline and falls back for a missing brief and title', () => {
    const { prompt } = buildTaskPrompt(task('script', { video: { ...video, title: '', brief: '', deadline: '2026-11-01' } }))
    expect(prompt).toContain('for the video "#7"')
    expect(prompt).toContain('(no brief given)')
    expect(prompt).toContain('Deadline: 2026-11-01.')
  })
})

describe('buildChatSystem', () => {
  const chat = (over: Partial<ChatPromptInput> = {}): ChatPromptInput => ({
    agent: agent({ role: 'supervisor', name: 'Supervisor', tools: ['get_brief', 'create_video'] }),
    kind: 'supervisor',
    video: null,
    channel: null,
    channels: [{ id: 1, name: 'History', niche: 'lost cities' }, { id: 2, name: 'Space', niche: '' }],
    memory: [],
    toolsAvailable: true,
    ...over
  })

  it('lists the channels for the supervisor and the tools when available', () => {
    const s = buildChatSystem(chat())
    expect(s).toContain('You are the Supervisor of Atelier')
    expect(s).toContain("Charlie's channels:\n- #1 History (lost cities)\n- #2 Space")
    expect(s).toContain('- create_video:')
    expect(s).not.toContain('Tools are not available')
  })

  it('says tools are unavailable when they are not (create_video agents)', () => {
    const s = buildChatSystem(chat({ toolsAvailable: false }))
    expect(s).toContain('Tools are not available with this model provider')
    expect(s).not.toContain('You can use these Atelier tools')
  })

  it('tells the supervisor when there is no channel, and skips the list for other agents', () => {
    expect(buildChatSystem(chat({ channels: [] }))).toContain('Charlie has no channel yet')
    const other = buildChatSystem(chat({ kind: 'agent', agent: agent({ tools: ['get_brief'] }) }))
    expect(other).not.toContain("Charlie's channels")
    expect(other).not.toContain('Tools are not available')
  })

  it('describes the video, channel and memory of a video chat', () => {
    const s = buildChatSystem(chat({ kind: 'video', video, channel, memory: ['likes maps'] }))
    expect(s).toContain('This chat is about the video "Atlantis" (status: in_progress).')
    expect(s).toContain('<brief>\nWhy it sank\n</brief>')
    expect(s).toContain('STANDARDS-MARKER')
    expect(s).not.toContain('SCRIPT-STYLE')
    expect(s).toContain('Notes you saved earlier:')
    expect(s).toContain('- likes maps')
  })
})

describe('taskContext', () => {
  function setup() {
    const core = memoryCore()
    const wf = core.context.workflow
    const ch = wf.channels.create({ name: 'History', niche: 'lost cities', standards: 'cite sources' })
    const { video } = wf.createVideo(ch.id, { title: 'Atlantis', brief: 'Why it sank' })
    const d = (type: DeliverableType) => wf.listDeliverables(video.id).find((x) => x.type === type)!
    const t = (type: DeliverableType) => wf.listTasks({ videoId: video.id }).find((x) => x.deliverableId === d(type).id)!
    const produce = (type: DeliverableType, content: string) => {
      wf.claimTask(t(type).id)
      return wf.submitVersion(d(type).id, { content, author: 'test' })
    }
    const ctx = (type: DeliverableType, role: string) => taskContext(wf, core.agents, core.agents.get(role), t(type))
    return { core, wf, ch, video, d, t, produce, ctx }
  }

  it('takes inputs only from approved or done dependencies', () => {
    const { wf, produce, ctx, d } = setup()
    expect(ctx('research', 'researcher').inputs).toEqual([])

    produce('research', 'RESEARCH v1') // no approval needed: done
    produce('thumbnail_brief', 'BRIEF v1') // waiting for approval
    // script depends on research (done) and thumbnail_brief (not approved yet)
    expect(ctx('script', 'scriptwriter').inputs.map((i) => [i.type, i.content])).toEqual([['research', 'RESEARCH v1']])

    wf.approve(d('thumbnail_brief').id, { by: 'owner' })
    const inputs = ctx('script', 'scriptwriter').inputs
    expect(inputs.map((i) => [i.type, i.title, i.versionNumber, i.content])).toEqual([
      ['research', 'Research', 1, 'RESEARCH v1'],
      ['thumbnail_brief', 'Thumbnail brief', 1, 'BRIEF v1']
    ])
  })

  it('adds the revision context after requestRevision, with the previous content', () => {
    const { wf, produce, ctx, d } = setup()
    produce('research', 'FIRST DRAFT')
    expect(ctx('research', 'researcher').revision).toBeNull()
    wf.requestRevision(d('research').id, { by: 'owner', note: 'Add dates' })
    const c = ctx('research', 'researcher')
    expect(c.revision).toEqual({ note: 'Add dates', previousVersion: 1, previousContent: 'FIRST DRAFT' })
  })

  it('recalls memory of the channel and the general notes, not other channels', () => {
    const { core, ch, ctx } = setup()
    const other = core.context.workflow.channels.create({ name: 'Other' })
    core.agents.remember('researcher', null, 'general note')
    core.agents.remember('researcher', ch.id, 'history note')
    core.agents.remember('researcher', other.id, 'other channel note')
    core.agents.remember('scriptwriter', ch.id, 'not mine')
    expect(ctx('research', 'researcher').memory).toEqual(['general note', 'history note'])
  })

  it('carries the agent, channel, video and deliverable title', () => {
    const { ctx } = setup()
    const c = ctx('research', 'researcher')
    expect(c.agent).toMatchObject({ role: 'researcher', webSearch: true })
    expect(c.channel).toMatchObject({ name: 'History', standards: 'cite sources' })
    expect(c.video).toMatchObject({ title: 'Atlantis', brief: 'Why it sank' })
    expect(c.deliverable).toEqual({ type: 'research', title: 'Research' })
  })
})
