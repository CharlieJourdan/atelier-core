// Lot Z1, Agents screens: the grid, the profile and the rooms render on the real data of the backend (roles seed,
// routes, example workspace rooms), in French, with no raw placeholder text.
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NO_FEATURES } from '../../src/shared/features'
import { fr } from '../../src/shared/fr'
import { frAgents } from '../../src/shared/fr-agents'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { FeaturesProvider } from '../../src/renderer/lib/features'
import { AGENTS_SCREENS } from '../../src/renderer/screens/agents'
import { TeamScreen } from '../../src/renderer/screens/team/TeamScreen'
import { AgentOrb } from '../../src/renderer/screens/agents/AgentOrb'
import { AgentProfile, excerpt } from '../../src/renderer/screens/agents/AgentSheet'
import { AgentsScreen, TeamGrid } from '../../src/renderer/screens/agents/AgentsScreen'
import { buildAgentCards, buildRoomCards, groupByDepartment } from '../../src/renderer/screens/agents/model'
import { RoomsPanel } from '../../src/renderer/screens/agents/RoomsPanel'
import type { TaskRow } from '../../src/shared/workflow'
import { memoryCore } from './helpers'

const noop = (): void => undefined
const render = (el: ReactElement): string =>
  renderToStaticMarkup(
    <FeaturesProvider value={NO_FEATURES}>
      <TooltipProvider>{el}</TooltipProvider>
    </FeaturesProvider>
  )
const clean = (html: string): void => {
  expect(html).not.toContain('undefined')
  expect(html).not.toContain('NaN')
  expect(html).not.toContain('[object Object]')
}

function task(over: Partial<TaskRow>): TaskRow {
  return {
    id: 1,
    videoId: null,
    deliverableId: null,
    title: 'Écrire le script',
    assigneeType: 'agent',
    assignee: 'scriptwriter',
    status: 'done',
    attempts: 1,
    maxAttempts: 3,
    estCostUsd: null,
    lastError: null,
    holdReason: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-10-19T10:00:00.000Z',
    updatedAt: '2026-10-19T10:00:00.000Z',
    ...over
  }
}

async function team(tasks: TaskRow[] = []) {
  const core = memoryCore()
  const agents = await core.api['agents.list']()
  const routes = await core.api['routes.list']()
  const defaults = await core.api['llm.defaults']()
  const cards = buildAgentCards({ agents, routes, defaults, tasks })
  return { core, agents, cards }
}

describe('Agents screens', () => {
  it('registers the proto team screen under the section key; the old grid stays available as a component', () => {
    expect(AGENTS_SCREENS.agents).toBe(TeamScreen)
    expect(AgentsScreen).toBeTypeOf('function')
  })

  it('shell: one h1, French title, both tabs, loading state', () => {
    const html = render(<AgentsScreen route={{ section: 'agents' }} onRoute={noop} />)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('data-testid="view-agents"')
    expect(html).toMatch(/<h1[^>]*>Équipe<\/h1>/)
    expect(html).toContain('Équipe')
    expect(html).toContain('Salons')
    clean(html)
  })

  it('has a French message for every agents.* key and no key shared with another file', () => {
    const keys = Object.keys(frAgents)
    expect(keys.length).toBeGreaterThan(60)
    for (const k of keys) expect(fr[k as keyof typeof fr].trim()).not.toBe('')
    expect(keys.every((k) => k.startsWith('agents.'))).toBe(true)
  })

  it('builds one card per seeded agent, grouped by department in the fixed order', async () => {
    const { agents, cards } = await team()
    expect(agents.length).toBeGreaterThanOrEqual(27)
    expect(cards).toHaveLength(agents.length)
    const groups = groupByDepartment(cards, '', 'all', (d) => d)
    expect(groups.map((g) => g.department)).toEqual(['direction', 'production', 'operations'])
    expect(groups.reduce((n, g) => n + g.cards.length, 0)).toBe(agents.length)
    expect(cards.every((c) => c.model.startsWith('claude-'))).toBe(true)
  })

  it('state comes from the tasks: running = working, waiting approval = waiting, disabled = off', async () => {
    const { agents } = await team()
    const core = memoryCore()
    const routes = await core.api['routes.list']()
    const defaults = await core.api['llm.defaults']()
    const disabled = agents.map((a) => (a.id === 'qc' ? { ...a, enabled: false } : a))
    const cards = buildAgentCards({
      agents: disabled,
      routes,
      defaults,
      tasks: [
        task({ id: 1, assignee: 'scriptwriter', status: 'running' }),
        task({ id: 2, assignee: 'researcher', status: 'waiting_approval' })
      ]
    })
    const by = (id: string) => cards.find((c) => c.agent.id === id)!
    expect(by('scriptwriter').state).toBe('working')
    expect(by('scriptwriter').runningCount).toBe(1)
    expect(by('researcher').state).toBe('waiting')
    expect(by('qc').state).toBe('off')
    expect(by('supervisor').state).toBe('idle')
    expect(groupByDepartment(cards, '', 'working', (d) => d).flatMap((g) => g.cards.map((c) => c.agent.id))).toEqual(['scriptwriter'])
  })

  it('search ignores accents and case', async () => {
    const { cards } = await team()
    const found = groupByDepartment(cards, 'scenariste', 'all', (d) => d).flatMap((g) => g.cards.map((c) => c.agent.role))
    expect(found).toContain('scriptwriter')
    expect(groupByDepartment(cards, 'zzzzzz', 'all', (d) => d)).toEqual([])
  })

  it('grid: departments, names, tiers and counts in French', async () => {
    const { cards } = await team([task({ assignee: 'scriptwriter', status: 'running', title: 'Premier jet du script' })])
    const html = render(<TeamGrid cards={cards} query="" state="all" onQuery={noop} onState={noop} onOpen={noop} />)
    for (const label of ['Direction', 'Production', 'Opérations', 'Superviseur', 'Scénariste', 'Au travail', 'Disponibles', 'Premier jet du script']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('data-testid="agents-count"')
    expect(html).toContain('1 au travail')
    expect(html.match(/data-testid="agent-card"/g)).toHaveLength(cards.length)
    // no WebGL context in a static render, even for the agent at work
    expect(html).toContain('data-slot="orb-fallback"')
    clean(html)
  })

  it('grid: empty states for no agents and for no match', async () => {
    const { cards } = await team()
    const none = render(<TeamGrid cards={[]} query="" state="all" onQuery={noop} onState={noop} onOpen={noop} />)
    expect(none).toContain('L’équipe n’est pas encore chargée')
    const nomatch = render(<TeamGrid cards={cards} query="zzzz" state="all" onQuery={noop} onState={noop} onOpen={noop} />)
    expect(nomatch).toContain('Aucun agent trouvé')
    clean(none + nomatch)
  })

  it('profile: role, route, Claude settings link, write button, recent tasks, memory', async () => {
    const { cards } = await team([task({ title: 'Relire la structure', status: 'failed' })])
    const card = cards.find((c) => c.agent.id === 'scriptwriter')!
    const html = render(
      <AgentProfile
        card={card}
        memory={[{ id: 1, agentId: 'scriptwriter', channelId: null, content: 'Préfère les intros courtes', createdAt: '2026-10-19T10:00:00.000Z' }]}
        actions={{ write: noop, setEnabled: noop, forget: noop, openClaudeSettings: noop }}
      />
    )
    for (const label of ['Écrire à Scénariste', 'Changer dans Réglages › Claude', 'Rôle et consignes', 'Relire la structure', 'Échouée', 'Préfère les intros courtes', 'Oublier', 'Quand une tâche est prête']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('claude-opus-5-5')
    expect(html).toContain('role="switch"')
    clean(html)
  })

  it('profile: loading memory and empty memory', async () => {
    const { cards } = await team()
    const card = cards[0]!
    const actions = { write: noop, setEnabled: noop, forget: noop, openClaudeSettings: noop }
    expect(render(<AgentProfile card={card} memory={null} actions={actions} />)).toContain('Chargement…')
    expect(render(<AgentProfile card={card} memory={[]} actions={actions} />)).toContain('Rien en mémoire pour l’instant.')
    expect(render(<AgentProfile card={card} memory={null} memoryError="Panne" actions={actions} />)).toContain('Panne')
  })

  it('excerpt cuts long instructions', () => {
    expect(excerpt('abc', 10)).toBe('abc')
    expect(excerpt('a'.repeat(50), 10)).toBe(`${'a'.repeat(10)}…`)
  })

  it('orb: static render always uses the CSS stand-in, even when asked to be live', () => {
    const html = render(<AgentOrb index={2} live thinking />)
    expect(html).toContain('data-slot="orb-fallback"')
    expect(html).toContain('data-live="false"')
  })

  it('rooms: example workspace rooms with members and channel names', async () => {
    const core = memoryCore()
    await core.api['example.load']()
    const agents = await core.api['agents.list']()
    const rooms = await core.api['chat.rooms']()
    const conversations = await core.api['chat.conversations']()
    expect(rooms.length).toBeGreaterThan(0)
    const channels = await core.api['channels.list']()
    const names = Object.fromEntries(channels.map((c) => [c.id, c.name]))
    const data = buildRoomCards({ rooms, agents, conversations })
    expect(data).toHaveLength(rooms.length)
    expect(data.some((d) => d.members.length > 0)).toBe(true)
    const html = render(<RoomsPanel rooms={data} channelNames={names} onOpen={noop} />)
    expect(html.match(/data-testid="room-card"/g)).toHaveLength(rooms.length)
    expect(html).toContain('Ouvrir le salon')
    for (const name of Object.values(names)) expect(html).toContain(name.replace(/&/g, '&amp;'))
    clean(html)
  })

  it('rooms: empty state', () => {
    const html = render(<RoomsPanel rooms={[]} channelNames={{}} onOpen={noop} />)
    expect(html).toContain('Pas encore de salon')
  })
})
