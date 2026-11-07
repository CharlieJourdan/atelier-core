// Gathers what a task run needs from the database: channel, video, the deliverable, its approved inputs, the
// revision note and the agent's memory. The prompt itself is built by prompt.ts (pure).
import type { AgentRow } from '../../shared/agents'
import { DELIVERABLE_GRAPH, type DeliverableType, type TaskRow } from '../../shared/workflow'
import type { WorkflowEngine } from '../workflow/engine'
import type { ApprovedInput, RevisionContext, TaskPromptInput } from './prompt'
import type { AgentsStore } from './store'

export function titleOf(type: DeliverableType): string {
  return DELIVERABLE_GRAPH.find((d) => d.type === type)?.title ?? type
}

/** Everything buildTaskPrompt needs except `toolsAvailable`. Throws when the task has no deliverable. */
export function taskContext(
  workflow: WorkflowEngine,
  agents: AgentsStore,
  agent: AgentRow,
  task: TaskRow
): Omit<TaskPromptInput, 'toolsAvailable'> {
  if (task.deliverableId === null || task.videoId === null) throw new Error(`Task ${task.id} has no deliverable`)
  const deliverable = workflow.getDeliverable(task.deliverableId)
  const video = workflow.getVideo(task.videoId)
  const channel = workflow.channels.get(video.channelId)
  const all = workflow.listDeliverables(video.id)

  const inputs: ApprovedInput[] = []
  for (const type of deliverable.dependsOn) {
    const dep = all.find((d) => d.type === type)
    const versionId = dep?.approvedVersionId ?? (dep?.status === 'done' ? dep.currentVersionId : null)
    if (!dep || versionId === null || versionId === undefined) continue
    const v = workflow.listVersions(dep.id).find((x) => x.id === versionId)
    if (!v) continue
    inputs.push({
      type,
      title: titleOf(type),
      versionNumber: v.number,
      content: v.content ?? `[file: ${v.filePath ?? 'unknown'}${v.mime ? `, ${v.mime}` : ''}]`
    })
  }

  let revision: RevisionContext | null = null
  if (deliverable.status === 'revision_requested') {
    const last = workflow
      .listApprovals(deliverable.id)
      .filter((a) => a.decision === 'revision_requested')
      .at(-1)
    const prev = last?.versionId ? workflow.listVersions(deliverable.id).find((v) => v.id === last.versionId) : undefined
    if (last && prev) {
      revision = { note: last.note, previousVersion: prev.number, previousContent: prev.content ?? `[file: ${prev.filePath}]` }
    }
  }

  return {
    agent: { role: agent.role, name: agent.name, instructions: agent.instructions, tools: agent.tools, webSearch: agent.webSearch },
    channel,
    video,
    deliverable: { type: deliverable.type, title: titleOf(deliverable.type) },
    inputs,
    memory: agents.recall(agent.id, channel.id).map((m) => m.content),
    revision
  }
}

/** get_brief text for a task run. */
export function briefText(ctx: Omit<TaskPromptInput, 'toolsAvailable'>): string {
  const lines = [
    `Deliverable: ${ctx.deliverable.title} (${ctx.deliverable.type})`,
    `Video #${ctx.video.id}: ${ctx.video.title}`,
    `Brief: ${ctx.video.brief || '(none)'}`,
    `Deadline: ${ctx.video.deadline ?? 'none'}`,
    `Channel: ${ctx.channel.name}${ctx.channel.niche ? ` (niche: ${ctx.channel.niche})` : ''}`,
    `Standards: ${ctx.channel.standards || '(none)'}`
  ]
  if (ctx.channel.scriptStyle) lines.push(`Script style: ${ctx.channel.scriptStyle}`)
  if (ctx.channel.thumbnailStyle) lines.push(`Thumbnail style: ${ctx.channel.thumbnailStyle}`)
  if (ctx.revision) lines.push(`Revision note on v${ctx.revision.previousVersion}: ${ctx.revision.note}`)
  return lines.join('\n')
}

/** get_inputs text for a task run. */
export function inputsText(ctx: Omit<TaskPromptInput, 'toolsAvailable'>): string {
  if (!ctx.inputs.length) return 'No approved inputs: this deliverable starts from the brief.'
  return ctx.inputs.map((i) => `## ${i.title} v${i.versionNumber}\n\n${i.content}`).join('\n\n')
}

/** get_brief text in a chat: the video and where its deliverables stand, or Charlie's channels. */
export function chatBriefText(workflow: WorkflowEngine, videoId: number | null): string {
  if (videoId !== null) {
    const { video, deliverables } = workflow.detail(videoId)
    const lines = [`Video #${video.id}: ${video.title} (status ${video.status})`, `Brief: ${video.brief || '(none)'}`]
    for (const d of deliverables) lines.push(`- ${titleOf(d.type)}: ${d.status.replace(/_/g, ' ')}`)
    return lines.join('\n')
  }
  const channels = workflow.channels.list()
  if (!channels.length) return 'No channel yet.'
  return channels
    .map((c) => {
      const open = workflow.listVideos({ channelId: c.id }).filter((v) => !['published', 'cancelled'].includes(v.status))
      return `#${c.id} ${c.name}${c.niche ? ` (niche: ${c.niche})` : ''}: ${open.length} video(s) in progress`
    })
    .join('\n')
}
