import type { ApiHandlers } from '../../shared/api'
import type { ApiContext } from './context'

type GroupMethods = 'chat.rooms' | 'chat.stop'

/** Rooms of the group chat and Stop (lot 13). */
export function groupApi(ctx: ApiContext): Pick<ApiHandlers, GroupMethods> {
  const { chat } = ctx
  return {
    'chat.rooms': () => chat.store.rooms(),
    'chat.stop': (conversationId) => {
      if (!Number.isInteger(conversationId)) throw new Error('Conversation invalide : numéro entier attendu.')
      return { stopped: chat.stop(conversationId) }
    }
  }
}
