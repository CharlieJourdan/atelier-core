// A conversation opened from the Agents screens (private message to an agent, department room, channel Manager):
// the same thread, composer and streaming hook as the Conversations screen (lot 12/13), shown in a dialog.
import { useCallback, useMemo } from 'react'
import type { ConversationRow } from '../../../shared/chat'
import { agentIndex } from '../../../shared/chat-folders'
import type { MentionTarget } from '../../../shared/chat-rich'
import { t, type MessageKey } from '../../../shared/fr'
import { Composer } from '@/components/conversations/composer'
import { Thread, type AuthorInfo } from '@/components/conversations/thread'
import { useThread } from '@/components/conversations/use-thread'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const prettify = (id: string): string => id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

function leadName(kind: ConversationRow['kind']): MessageKey | null {
  return kind === 'room' ? 'chat.persona.team_lead' : kind === 'channel' ? 'chat.persona.manager' : null
}

function Pane({ conversation, names, mentions }: { conversation: ConversationRow; names: Readonly<Record<string, string>>; mentions: readonly MentionTarget[] }) {
  const thread = useThread(conversation.id, conversation.unread)
  const lead = leadName(conversation.kind)
  const defaultAgent = conversation.kind === 'agent' ? (conversation.agentId ?? 'supervisor') : 'supervisor'
  const author = useCallback(
    (id: string | null): AuthorInfo => {
      const agent = id ?? defaultAgent
      return { name: agent === 'supervisor' && lead ? t(lead) : (names[agent] ?? prettify(agent)), index: agentIndex(agent) }
    },
    [names, defaultAgent, lead]
  )
  return (
    <div className="flex h-[min(560px,64vh)] min-h-0 flex-col overflow-hidden rounded-card border border-line bg-bg" data-testid="agents-chat-pane">
      {thread.error && (
        <p role="alert" className="px-4 pt-2 text-[12.5px] text-err">
          {thread.error}
        </p>
      )}
      <Thread messages={thread.messages} streaming={thread.streaming} actions={thread.actions} author={author} />
      <Composer mentions={conversation.kind === 'agent' ? [] : mentions} onSend={thread.send} busy={thread.busy} onStop={thread.stop} />
    </div>
  )
}

export function ChatDialog({
  conversation,
  title,
  agents,
  onClose
}: {
  conversation: ConversationRow | null
  title: string
  agents: readonly { id: string; name: string; enabled: boolean }[]
  onClose: () => void
}) {
  const names = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.name])), [agents])
  const mentions = useMemo<MentionTarget[]>(
    () => agents.filter((a) => a.enabled).map((a) => ({ id: a.id, name: a.name, index: agentIndex(a.id) })),
    [agents]
  )
  return (
    <Dialog open={conversation !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(720px,94vw)] max-w-none" closeLabel={t('agents.sheet.close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('agents.chat.hint')}</DialogDescription>
        </DialogHeader>
        {conversation && <Pane key={conversation.id} conversation={conversation} names={names} mentions={mentions} />}
      </DialogContent>
    </Dialog>
  )
}
