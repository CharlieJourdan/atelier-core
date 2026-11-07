// IPC contract, module "chat": Conversations and messages.
import type { AttachmentUpload, ConversationInput, ConversationRow, MessageRow, SendResult } from '../chat'

export interface ChatContract {
  'chat.conversations': { args: []; result: ConversationRow[] }

  /** Finds or creates the conversation (one Supervisor, one per video, one per agent). */
  'chat.open': { args: [input: ConversationInput]; result: ConversationRow }

  'chat.messages': { args: [conversationId: number, afterId?: number]; result: MessageRow[] }

  'chat.send': { args: [conversationId: number, body: string, attachments?: AttachmentUpload[]]; result: SendResult }

  'chat.markRead': { args: [conversationId: number]; result: void }
}

export const CHAT_METHODS = [
  'chat.conversations',
  'chat.open',
  'chat.messages',
  'chat.send',
  'chat.markRead'
] as const satisfies readonly (keyof ChatContract)[]
