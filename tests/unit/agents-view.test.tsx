import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentRow, MemoryRow } from '../../src/shared/agents'
import type { Card } from '../../src/shared/chat'
import { AgentList } from '../../src/renderer/components/settings/AgentsPanel'
import { CardView } from '../../src/renderer/components/chat/Cards'

const actions = { approve: () => undefined, requestRevision: () => undefined, decideProposal: () => undefined, resumeTask: () => undefined }
const show = (card: Card): string => renderToStaticMarkup(<CardView card={card} actions={actions} />)

const agent = (over: Partial<AgentRow> = {}): AgentRow => ({
  id: 'researcher', role: 'researcher', name: 'Researcher', instructions: 'Find facts.', customized: false,
  tools: ['get_brief', 'save_version'], webSearch: true, tier: 'balanced', cadence: 'on_task', enabled: true,
  updatedAt: '2026-10-19T10:00:00.000Z', ...over
})

describe('AgentList', () => {
  it('renders names, tools, web search and the reset control when customized', () => {
    const html = renderToStaticMarkup(
      <AgentList
        agents={[agent(), agent({ id: 'scriptwriter', name: 'Scriptwriter', customized: true, webSearch: false, tools: ['remember'] })]}
        openId="scriptwriter"
      />
    )
    expect(html).toContain('agent-row-researcher')
    expect(html).toContain('Researcher')
    expect(html).toContain('get_brief, save_version, web search')
    expect(html).toContain('Instructions for Scriptwriter')
    expect(html).toContain('Reset to default')
  })

  it('hides reset when closed or default, and lists memory with Forget and errors', () => {
    const closed = renderToStaticMarkup(<AgentList agents={[agent({ customized: true })]} />)
    expect(closed).not.toContain('Reset to default')
    const mem: MemoryRow[] = [{ id: 1, agentId: 'researcher', channelId: null, content: 'Prefers short intros', createdAt: '' }]
    const open = renderToStaticMarkup(<AgentList agents={[agent()]} openId="researcher" memory={mem} errors={{ researcher: 'boom' }} />)
    expect(open).not.toContain('Reset to default')
    expect(open).toContain('Prefers short intros')
    expect(open).toContain('Forget')
    expect(open).toContain('boom')
  })
})

describe('cards (lot 5)', () => {
  const proposal = (status: 'pending' | 'accepted', proposalId: number | null = 4): Card => ({
    type: 'proposal', proposalId, title: 'New video', detail: 'About reefs', status
  })

  it('pending proposal shows Confirm and Dismiss', () => {
    const html = show(proposal('pending'))
    expect(html).toContain('Waiting for you')
    expect(html).toContain('Confirm')
    expect(html).toContain('Dismiss')
  })

  it('accepted proposal shows Confirmed without buttons; null id has none', () => {
    const html = show(proposal('accepted'))
    expect(html).toContain('Confirmed')
    expect(html).not.toContain('<button')
    expect(show(proposal('pending', null))).not.toContain('<button')
  })

  const budget = (over: Partial<Extract<Card, { type: 'budget' }>>): Card => ({
    type: 'budget', scope: 'global', capUsd: 5, spentUsd: 5, requestedUsd: 1, message: 'Cap reached', ...over
  })

  it('budget card offers Try again only for a held task', () => {
    expect(show(budget({ taskId: 9, held: true }))).toContain('Try again')
    expect(show(budget({ taskId: 9, held: false }))).not.toContain('Try again')
    expect(show(budget({}))).not.toContain('Try again')
  })

  it('task card shows the hold reason and last error', () => {
    const held = show({ type: 'task', taskId: 1, title: 'Write', status: 'pending', assignee: 'scriptwriter', holdReason: 'budget' })
    expect(held).toContain('On hold: budget')
    const failed = show({ type: 'task', taskId: 1, title: 'Write', status: 'failed', assignee: 'scriptwriter', lastError: 'tool crashed' })
    expect(failed).toContain('tool crashed')
    expect(failed).toContain('data-status="failed"')
  })
})
