// IPC handlers, module "bricks": the channels' custom bricks (src/main/bricks). A decision is the answer to the proposal's inbox item (the
// same path as Accueil › À valider: the brick is validated or sent back, the agent's task resumes); a request is a message to Atlas.
import type { ApiHandlers } from '../../shared/api'
import type { BRICKS_METHODS } from '../../shared/api/bricks'
import type { ApiContext } from './context'

type BricksMethodKey = (typeof BRICKS_METHODS)[number]

const id = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error('A brick id is a positive integer')
  return v
}

export function bricksApi(ctx: ApiContext): Pick<ApiHandlers, BricksMethodKey> {
  const b = ctx.bricks
  return {
    'bricks.list': () => b.list().map((r) => b.view(r)),
    'bricks.decide': (brickId, decision) => {
      const row = b.byId(id(brickId))
      if (row.state !== 'review' || row.inboxId === null) throw new Error('This brick is not waiting for your decision')
      if (typeof decision !== 'object' || decision === null || typeof decision.approve !== 'boolean') throw new Error('A decision is { approve, note? }')
      const note = typeof decision.note === 'string' ? decision.note.trim().slice(0, 2000) : ''
      ctx.orchestra.answer(row.inboxId, decision.approve ? { choice: 'Valider' } : { choice: 'Refuser', ...(note ? { text: note } : {}) })
      return b.view(b.byId(row.id))
    },
    'bricks.setEnabled': (brickId, enabled) => b.view(b.setEnabled(id(brickId), enabled === true)),
    'bricks.request': (input) => {
      if (typeof input !== 'object' || input === null || typeof input.text !== 'string' || !input.text.trim()) throw new Error('Say what the brick should be')
      const atlas = ctx.orchestra.agents().find((a) => a.role === 'principal')
      if (!atlas) throw new Error('Atlas is not set up yet')
      const channel = typeof input.channelId === 'number' ? ctx.workflow.channels.list().find((c) => c.id === input.channelId) : undefined
      const text = `Fais-moi une brique sur mesure${channel ? ` pour la chaîne ${channel.name} (#${channel.id})` : ''} : ${input.text.trim().slice(0, 1500)}`
      return { conversationId: ctx.orchestra.say({ agentId: atlas.id, text }).conversationId }
    }
  }
}
