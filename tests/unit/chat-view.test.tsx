import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Card, ConversationRow, MessageRow } from '../../src/shared/chat'
import { ConversationList } from '../../src/renderer/components/chat/ConversationList'
import { Thread } from '../../src/renderer/components/chat/Thread'

const actions = { approve: () => undefined, requestRevision: () => undefined, decideProposal: () => undefined, resumeTask: () => undefined }
const label = (id: string | null): string => `Agent ${id}`

function msg(id: number, over: Partial<MessageRow> = {}): MessageRow {
  return {
    id, conversationId: 1, authorType: 'agent', authorId: 'scriptwriter', body: `message ${id}`,
    card: null, attachments: [], tools: [], createdAt: '2026-10-19T10:00:00.000Z', ...over
  }
}

const approval = (over: Partial<Extract<Card, { type: 'approval' }>> = {}): Card => ({
  type: 'approval', deliverableId: 7, versionId: 3, deliverableType: 'script', title: 'Script v2',
  excerpt: 'Once upon a drowned city', ownerGate: false, status: 'waiting_approval', stale: false, ...over
})

describe('Thread', () => {
  it('renders owner, agent and system messages with their cards', () => {
    const html = renderToStaticMarkup(
      <Thread
        streaming={null}
        actions={actions}
        agentLabel={label}
        messages={[
          msg(1, { authorType: 'owner', authorId: null, body: 'Hi team' }),
          msg(2, { body: 'Script ready', card: approval() }),
          msg(3, { authorType: 'system', authorId: null, body: 'You approved script.' }),
          msg(4, { authorType: 'system', authorId: null, body: 'Budget', card: {
            type: 'budget', scope: 'global', capUsd: 5, spentUsd: 4.99, requestedUsd: 0.5, message: 'Global cap reached'
          } }),
          msg(5, { body: 'Look', attachments: [{ name: 'notes.txt', mime: 'text/plain', size: 3, path: 'C:/x/notes.txt' }] })
        ]}
      />
    )
    expect(html).toContain('Hi team')
    expect(html).toContain('Agent scriptwriter')
    expect(html).toContain('data-author="system"')
    expect(html).toContain('Script v2')
    expect(html).toContain('Once upon a drowned city')
    expect(html).toContain('Waiting for you')
    expect(html).toContain('>Approve<')
    expect(html).toContain('Request changes')
    expect(html).toContain('Global budget reached')
    expect(html).toContain('notes.txt')
  })

  it('hides the buttons once a card is decided or superseded', () => {
    const render = (card: Card) =>
      renderToStaticMarkup(<Thread streaming={null} actions={actions} agentLabel={label} messages={[msg(1, { card })]} />)
    const approved = render(approval({ status: 'approved' }))
    expect(approved).toContain('Approved')
    expect(approved).not.toContain('>Approve<')
    const stale = render(approval({ stale: true }))
    expect(stale).toContain('Superseded')
    expect(stale).not.toContain('>Approve<')
    expect(render(approval({ ownerGate: true }))).toContain('owner gate')
  })

  it('renders the other card types', () => {
    const render = (card: Card) =>
      renderToStaticMarkup(<Thread streaming={null} actions={actions} agentLabel={label} messages={[msg(1, { card })]} />)
    expect(render({ type: 'proposal', proposalId: 1, title: 'Make a video on Ys', detail: 'Channel History' })).toContain('Make a video on Ys')
    expect(render({ type: 'task', taskId: 1, title: 'Write script', status: 'waiting_approval', assignee: 'scriptwriter' })).toContain('waiting approval')
    const qc = render({ type: 'qc', passed: false, summary: '1 problem', items: [{ label: 'Length', ok: false, note: 'too short' }] })
    expect(qc).toContain('failed')
    expect(qc).toContain('too short')
  })

  it('shows the streaming bubble, or the typing dots before the first token', () => {
    const base = { messages: [], actions, agentLabel: label }
    expect(renderToStaticMarkup(<Thread {...base} streaming={{ streamId: 's', text: 'Hel' }} />)).toContain('Hel')
    expect(renderToStaticMarkup(<Thread {...base} streaming={{ streamId: 's', text: '' }} />)).toContain('Typing')
    expect(renderToStaticMarkup(<Thread {...base} streaming={null} />)).toContain('No messages yet')
  })
})

describe('ConversationList', () => {
  const conv = (id: number, over: Partial<ConversationRow>): ConversationRow => ({
    id, kind: 'agent', title: 'Scriptwriter', videoId: null, agentId: 'scriptwriter', channelId: null, department: null, unread: 0,
    lastMessage: null, updatedAt: '2026-10-19T10:00:00.000Z', ...over
  })

  it('shows previews, unread badges and the selection', () => {
    const html = renderToStaticMarkup(
      <ConversationList
        selectedId={2}
        videos={[]}
        onSelect={() => undefined}
        onOpen={() => undefined}
        conversations={[
          conv(1, { kind: 'supervisor', title: 'Supervisor', unread: 3, lastMessage: { body: 'Two scripts need you', authorType: 'agent', createdAt: '' } }),
          conv(2, { lastMessage: { body: 'ok', authorType: 'owner', createdAt: '' } })
        ]}
      />
    )
    expect(html).toContain('Two scripts need you')
    expect(html).toContain('data-testid="unread-1"')
    expect(html).not.toContain('data-testid="unread-2"')
    expect(html).toContain('You: ok')
    expect(html).toMatch(/chat-item selected[^>]*data-testid="conversation-2"/)
    expect(html).toContain('Chat with an agent')
  })
})
