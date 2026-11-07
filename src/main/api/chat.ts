import type { ApiHandlers } from '../../shared/api'
import type { ApiContext } from './context'

type ChatMethods = 'chat.conversations' | 'chat.open' | 'chat.messages' | 'chat.send' | 'chat.markRead'

export function chatApi(ctx: ApiContext): Pick<ApiHandlers, ChatMethods> {
  const { chat } = ctx
  return {
    'chat.conversations': () => chat.store.list(),
    'chat.open': (input) => chat.store.open(input),
    'chat.messages': (conversationId, afterId) => chat.store.messages(conversationId, afterId),
    'chat.send': (conversationId, body, attachments) => chat.send(conversationId, body, attachments),
    'chat.markRead': (conversationId) => chat.store.markRead(conversationId)
  }
}
