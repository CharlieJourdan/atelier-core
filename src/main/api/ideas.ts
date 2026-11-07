// IPC handlers, module "ideas" (lot Z1): ideas and automations of the Production section.
import type { ApiHandlers } from '../../shared/api'
import type { IdeasContract } from '../../shared/api/ideas'
import { IDEAS_SYSTEM, ideasPrompt } from '../ideas/agent'
import { parseAgentIdeas, positiveId } from '../ideas/store'
import type { ApiContext } from './context'

export function ideasApi(ctx: ApiContext): Pick<ApiHandlers, keyof IdeasContract> {
  const { ideas, automations } = ctx
  const changed = (): void => {
    ctx.notify('ideas')
    ctx.notify('videos')
  }
  return {
    'ideas.list': (channelId) => ideas.list(channelId),
    'ideas.create': (input) => {
      const row = ideas.create(input)
      ctx.notify('ideas')
      return row
    },
    'ideas.update': (id, patch) => {
      const row = ideas.update(id, patch)
      ctx.notify('ideas')
      return row
    },
    'ideas.delete': (id) => {
      ideas.delete(id)
      ctx.notify('ideas')
    },
    'ideas.generate': async (channelId, count = 5) => {
      const channel = ctx.workflow.channels.get(positiveId(channelId, 'chaîne'))
      if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('Demande entre 1 et 10 idées.')
      const existing = ideas.list(channel.id).map((i) => i.title)
      const reply = await ctx.ask({ role: 'ideas_manager', system: IDEAS_SYSTEM, prompt: ideasPrompt(channel, existing, count, ctx.eyes.inspirationFor(channel.id, { includeDemo: true, lang: 'fr', limit: 6 })), channelId: channel.id })
      const found = parseAgentIdeas(reply.text)
      if (!found) throw new Error('L’agent n’a pas rendu de liste d’idées lisible. Réessaie.')
      const rows = found.slice(0, count).map((i) => ideas.create({ channelId: channel.id, title: i.title, angle: i.angle }, 'agent', i.score ?? null))
      ctx.notify('ideas')
      return rows
    },
    'ideas.toVideo': (id) => {
      const row = ideas.toVideo(id)
      changed()
      return row
    },
    'automations.list': () => automations.list(),
    'automations.create': (input) => {
      const row = automations.create(input)
      ctx.notify('ideas')
      return row
    },
    'automations.update': (id, patch) => {
      const row = automations.update(id, patch)
      ctx.notify('ideas')
      return row
    },
    'automations.delete': (id) => {
      automations.delete(id)
      ctx.notify('ideas')
    },
    'automations.runNow': async (id) => {
      const row = await automations.fire(id)
      changed()
      ctx.notify('production')
      return row
    },
    'automations.history': (id) => automations.history(id)
  }
}
