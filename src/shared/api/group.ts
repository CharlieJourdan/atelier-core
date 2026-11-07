// IPC contract, module "group" (lot 13): the group-chat engine — department rooms and channel Managers for the
// conversation list, and Stop.
import type { RoomInfo } from '../chat-rich'

export interface GroupContract {
  /** The channel Manager and the department rooms of every active channel (opened with `chat.open`). */
  'chat.rooms': { args: []; result: RoomInfo[] }

  /** Stops the conversation: the turn in flight, its handoff, the mentions not reached yet, the queued messages. */
  'chat.stop': { args: [conversationId: number]; result: { stopped: boolean } }
}

export const GROUP_METHODS = ['chat.rooms', 'chat.stop'] as const satisfies readonly (keyof GroupContract)[]
