// Proto refresh, team area: Équipe (org chart, per-channel table, load, agent sheet, engine strip), Messages (folding
// tree, group / DM / video threads, mentions, demo replies) and Ordinateur (machine, files, browsers, accounts, render).
// Static renders like the other screen tests, plus the pure helpers and the demo chat engine under fake timers.
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NO_FEATURES } from '../../src/shared/features'
import { fr, setLocale, t } from '../../src/shared/fr'
import { en } from '../../src/shared/en'
import { frPTeam } from '../../src/shared/fr-p-team'
import { enPTeam } from '../../src/shared/en-p-team'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { FeaturesProvider } from '../../src/renderer/lib/features'
import { createProtoStore, initialState, ProtoProvider, type Scope } from '../../src/renderer/proto/store'
import { EFFORT_MODEL, RECRUIT_TEMPLATES, effortOf, hourlyLoad } from '../../src/renderer/proto/data-team-agents'
import { feedbackKind } from '../../src/renderer/proto/data-team-chat'
import { AGENTS_SCREENS } from '../../src/renderer/screens/agents'
import { COMPUTERS_SCREENS } from '../../src/renderer/screens/computers'
import { AgentsScreen } from '../../src/renderer/screens/agents/AgentsScreen'
import { ConversationsScreen } from '../../src/renderer/screens/ConversationsScreen'
import { ComputersScreen } from '../../src/renderer/screens/computers/ComputersScreen'
import { SectionScreen } from '../../src/renderer/screens/SectionScreen'
import { AgentSheet } from '../../src/renderer/screens/team/AgentSheet'
import { ByChannel } from '../../src/renderer/screens/team/ByChannel'
import { responderFor, sendLocal } from '../../src/renderer/screens/team/chat-engine'
import { buildTree, firstMentioned, mentionables, messagesFor, resolveThread } from '../../src/renderer/screens/team/chat-model'
import { ComputerScreen } from '../../src/renderer/screens/team/ComputerScreen'
import { LoadView } from '../../src/renderer/screens/team/LoadView'
import { MessagesScreen } from '../../src/renderer/screens/team/MessagesScreen'
import { balanceSentence, buildTeamAgents, detailOf, dmThreadId, leadOf, withLeadsAsParents } from '../../src/renderer/screens/team/model'
import { OrgChart } from '../../src/renderer/screens/team/OrgChart'
import { getTeamState, resetTeamStore, teamActions } from '../../src/renderer/screens/team/store'
import { TeamScreen } from '../../src/renderer/screens/team/TeamScreen'

const noop = (): void => undefined

function render(el: ReactElement, scope: Scope = 'all'): string {
  const store = createProtoStore(initialState({ scope }))
  return renderToStaticMarkup(
    <FeaturesProvider value={NO_FEATURES}>
      <TooltipProvider>
        <ProtoProvider store={store}>{el}</ProtoProvider>
      </TooltipProvider>
    </FeaturesProvider>
  )
}

function clean(html: string): void {
  for (const bad of ['undefined', 'NaN', '[object Object]', '{n}', '{name}']) expect(html, bad).not.toContain(bad)
}

const props = (section: 'agents' | 'conversations' | 'ordinateurs') => ({ route: { section }, onRoute: noop })

function world(scope: Scope = 'all') {
  const state = initialState({ scope })
  const team = getTeamState()
  const agents = buildTeamAgents(state.agents, team)
  return { state, team, agents }
}

beforeEach(() => resetTeamStore())
afterEach(() => {
  setLocale('fr')
  vi.useRealTimers()
})

describe('registration', () => {
  it('routes the three sections to the team screens and keeps the old components', () => {
    expect(AGENTS_SCREENS.agents).toBe(TeamScreen)
    expect(COMPUTERS_SCREENS.ordinateurs).toBe(ComputerScreen)
    for (const old of [AgentsScreen, ComputersScreen, ConversationsScreen]) expect(old).toBeTypeOf('function')
  })

  it('SectionScreen sends conversations to the new Messages screen', () => {
    const html = render(<SectionScreen route={{ section: 'conversations' }} onRoute={noop} />)
    expect(html).toContain('data-testid="conv-tree"')
    expect(html).toContain('data-testid="msg-pane"')
  })
})

describe('Équipe', () => {
  it('shows the header, the three views, the main agent, every channel lead and the engine strip', () => {
    const html = render(<TeamScreen {...props('agents')} />)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('data-testid="view-agents"')
    expect(html).toContain('data-testid="agents-recruit"')
    for (const k of ['Équipe', 'Recruter un agent', 'Organigramme', 'Par chaîne', 'Charge', 'Atlas', 'Agent principal', 'Hugo', 'Inès', 'Malo', 'June', 'Moteur', 'Chien de garde']) {
      expect(html, k).toContain(k)
    }
    expect(html).toContain('data-testid="org-chart"')
    expect(html).toContain('data-testid="org-col-shared"')
    expect(html).toContain('2 relances automatiques ces 24 h, 0 tâche perdue.')
    clean(html)
  })

  it('draws one column per channel with the specialists under their lead', () => {
    const { state, agents } = world()
    const principalAgent = agents.find((a) => a.role === 'principal')!
    const html = render(<OrgChart agents={agents} channels={state.channels} principalAgent={principalAgent} activeId={null} onOpen={noop} videosRunning={5} waitingForUser={3} showShared />)
    for (const ch of state.channels) expect(html).toContain(`data-testid="org-col-${ch.id}"`)
    expect(html).toContain('data-testid="agent-card-ag-enigmes-edit"')
    expect(html).toContain('Axel')
    expect(html).toContain('82 %')
    // an agent waiting for the user shows the warn dot
    expect(html).toMatch(/data-testid="agent-card-ag-enigmes-script"[^>]*data-status="waiting"/)
    expect(html).toContain('bg-warn')
    clean(html)
  })

  it('filters by the channel scope: other channels and their agents disappear', () => {
    const html = render(<TeamScreen {...props('agents')} />, 'ch-top')
    expect(html).toContain('data-testid="org-col-ch-top"')
    expect(html).toContain('Malo')
    expect(html).not.toContain('data-testid="org-col-ch-enigmes"')
    expect(html).not.toContain('Hugo')
    expect(html).not.toContain('data-testid="org-col-shared"')
    clean(html)
  })

  it('Par chaîne lists every agent in a table grouped by channel', () => {
    const { state, agents } = world()
    const html = render(<ByChannel agents={agents} channels={state.channels} principalAgent={agents[0]!} activeId={null} onOpen={noop} showShared />)
    for (const ch of state.channels) expect(html).toContain(`data-testid="group-${ch.id}"`)
    for (const k of ['Tâche en cours', 'Modèle', 'Tâches 7 j', 'Mémoire', 'Opus', 'Sonnet', 'Haiku', 'Codex', 'Charge moyenne']) expect(html, k).toContain(k)
    expect(html.match(/data-testid="agent-row-/g)!.length).toBe(agents.length)
    clean(html)
  })

  it('Charge shows the main agent’s balance message and a 24 h grid per agent', () => {
    const { state, agents } = world()
    const html = render(<LoadView agents={agents} channels={state.channels} principalAgent={agents[0]!} />)
    expect(html).toContain('Axel est à 82 % : je lui retire les shorts de demain.')
    expect(html).toContain('data-testid="load-apply"')
    expect(html.match(/data-testid="load-row-/g)!.length).toBe(agents.length - 1)
    expect(html.match(/role="cell"/g)!.length).toBe((agents.length - 1) * 24)
    clean(html)
  })

  it('the balance names the busiest agent and a rested colleague of the same channel', () => {
    const { agents } = world()
    const { busy, rested } = balanceSentence(agents)
    expect(busy?.name).toBe('Axel')
    expect(rested?.channelId).toBe(busy?.channelId)
    expect(rested!.load).toBeLessThan(busy!.load)
  })

  it('the agent sheet holds profile, now, instructions, effort mapping, budget and access', () => {
    const { state, agents } = world()
    const hugo = agents.find((a) => a.id === 'ag-enigmes-lead')!
    const html = render(<AgentSheet agent={hugo} agents={agents} channels={state.channels} edit={undefined} onClose={noop} onOpenAgent={noop} onWrite={noop} />)
    for (const k of ['Hugo', 'Responsable de chaîne', 'Rend compte à', 'Atlas', 'En ce moment', 'Écrire à Hugo', 'Réglages', 'Routines', 'Mémoire', 'Journal', 'Instructions', 'Rapide', 'Équilibré', 'Max', 'Utilise le modèle Sonnet', 'Budget par jour', 'Navigateur', 'Ordinateur de l’équipe', 'Publication']) {
      expect(html, k).toContain(k)
    }
    expect(html).toContain('data-testid="agent-sheet-write"')
    expect(html).toContain('responsable de la chaîne Les Grandes Énigmes')
    clean(html)
  })

  it('details merge the user’s edits: effort, routine toggles, forgotten memory, permissions', () => {
    const { state, agents } = world()
    const lea = agents.find((a) => a.id === 'ag-enigmes-research')!
    const base = detailOf(lea, agents, state.channels, undefined)
    expect(base.routines.length).toBeGreaterThan(1)
    const edited = detailOf(lea, agents, state.channels, {
      routines: { [base.routines[0]!.id]: false },
      deletedMemory: [base.memory[0]!.id],
      permissions: { publish: true },
      budget: 500,
      instructions: 'Autre consigne'
    })
    expect(edited.routines[0]!.on).toBe(false)
    expect(edited.memory.length).toBe(base.memory.length - 1)
    expect(edited.permissions.publish).toBe(true)
    expect(edited.budgetPerDay).toBe(500)
    expect(edited.instructions).toBe('Autre consigne')
    expect(base.instructions).toContain('Les Grandes Énigmes')
  })

  it('effort maps to a model tier both ways', () => {
    expect(EFFORT_MODEL).toEqual({ fast: 'haiku', balanced: 'sonnet', max: 'opus' })
    expect(effortOf('opus')).toBe('max')
    expect(effortOf('haiku')).toBe('fast')
    expect(effortOf('codex')).toBe('balanced')
    teamActions.editAgent('ag-enigmes-lead', { effort: 'max', name: 'Hugues' })
    const { agents } = world()
    const lead = agents.find((a) => a.id === 'ag-enigmes-lead')!
    expect(lead.name).toBe('Hugues')
    expect(lead.model).toBe('opus')
  })

  it('a recruited agent is tagged « Nouveau » in the chart, under its lead', () => {
    const state = initialState()
    const newbie = { id: 'ag-new', name: 'Mina', role: 'custom' as const, channelId: 'ch-enigmes', parentId: 'ag-enigmes-lead', status: 'idle' as const, task: 'Prend ses marques', model: 'sonnet' as const, load: 0, memoryItems: 0, tasksDone7d: 0, colorIndex: 3 }
    teamActions.markRecruited('ag-new', 'Community manager')
    const agents = buildTeamAgents([...state.agents, newbie], getTeamState())
    const principalAgent = agents.find((a) => a.role === 'principal')!
    const html = render(<OrgChart agents={agents} channels={state.channels} principalAgent={principalAgent} activeId={null} onOpen={noop} videosRunning={1} waitingForUser={1} showShared />)
    expect(html).toContain('Mina')
    expect(html).toContain('Community manager')
    expect(html).toContain('data-testid="agent-new-tag"')
  })

  it('an agent that reports to the main agent but works on a channel hangs under that channel’s lead', () => {
    const { agents } = world()
    const odd = { ...agents.find((a) => a.id === 'ag-enigmes-edit')!, id: 'ag-odd', parentId: 'ag-principal' }
    const fixed = withLeadsAsParents([...agents, odd])
    expect(fixed.find((a) => a.id === 'ag-odd')!.parentId).toBe(leadOf(agents, 'ch-enigmes')!.id)
  })

  it('hourly load is deterministic, bounded and 24 long', () => {
    const { agents } = world()
    const a = agents.find((x) => x.id === 'ag-enigmes-edit')!
    const h = hourlyLoad(a, a.load, 15)
    expect(h).toHaveLength(24)
    expect(h).toEqual(hourlyLoad(a, a.load, 15))
    for (const v of h) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('has six recruiting templates, each with French copy', () => {
    expect(RECRUIT_TEMPLATES.map((x) => x.id)).toEqual(['community', 'clipper', 'translator', 'seo', 'partner', 'custom'])
    for (const tpl of RECRUIT_TEMPLATES) {
      expect(fr[`team.recruit.tpl.${tpl.id}.name` as keyof typeof fr]).toBeTruthy()
      expect(tpl.instructions.length).toBeGreaterThan(20)
    }
  })
})

describe('Messages', () => {
  it('shows the tree: the main agent, then channel branches (the first one unfolded) and the search field', () => {
    const html = render(<MessagesScreen {...props('conversations')} />)
    expect(html).toContain('data-testid="view-conversations"')
    expect(html.match(/<h1/g)).toHaveLength(1)
    for (const k of ['Messages', 'Rechercher', 'Atlas', 'Les Grandes Énigmes', 'Histoires Vraies', 'Top Savoirs', 'Mystery Files', 'Groupe Les Grandes Énigmes', 'Hugo', 'Vidéos', 'Équipe', 'Moteur réel (bêta)']) {
      expect(html, k).toContain(k)
    }
    expect(html).toContain('data-testid="conv-row-th-group-ch-enigmes"')
    expect(html).toContain('data-testid="conv-row-th-video-templiers"')
    expect(html).toContain('data-testid="conv-row-th-video-v-voynich"')
    // a collapsed channel shows nothing of its content
    expect(html).not.toContain('data-testid="conv-row-th-group-ch-histoires"')
    clean(html)
  })

  it('opens on the main agent’s thread with its history and a composer', () => {
    const html = render(<MessagesScreen {...props('conversations')} />)
    expect(html).toContain('data-thread="th-principal"')
    expect(html).toContain('Bonjour Charlie. Cette nuit')
    expect(html).toContain('data-testid="composer-input"')
    expect(html).toContain('data-testid="composer-attach"')
    expect(html).toContain('Écrire à Atlas')
  })

  it('the group chat has runs per author, highlighted @mentions, hand-off lines and cards', () => {
    // the demo messages are timed « minutes ago »: at 3 pm they are all today (just after midnight some are yesterday)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 24, 15, 0))
    teamActions.selectThread('th-group-ch-enigmes')
    const html = render(<MessagesScreen {...props('conversations')} />)
    vi.useRealTimers()
    expect(html).toContain('data-thread="th-group-ch-enigmes"')
    expect(html).toContain('data-mention="Léa"')
    expect(html).toContain('data-mention="Hugo"')
    expect(html).toContain('data-testid="msg-system"')
    expect(html).toContain('Hugo a confié le script de « Col Dyatlov » à Camille')
    expect(html).toContain('data-testid="msg-card-approval"')
    expect(html).toContain('Aujourd’hui')
    expect(html).toContain('data-testid="msg-members"')
    expect(html).not.toContain('data-testid="msg-video-bar"')
    clean(html)
  })

  it('a video thread has the mini video bar, the story of the production and the feedback chips', () => {
    teamActions.selectThread('th-video-templiers')
    const html = render(<MessagesScreen {...props('conversations')} />)
    expect(html).toContain('data-testid="msg-video-bar"')
    expect(html).toContain('Ouvrir dans Production')
    for (const k of ['Donner un feedback', 'Rythme trop lent', 'Change la miniature', 'Plus d’archives']) expect(html, k).toContain(k)
    expect(html).toContain('a confié')
    expect(html).toContain('Script terminé')
    expect(html).toContain('Un retour sur cette vidéo ?')
    clean(html)
  })

  it('a thread waiting for the user shows the approval card; an unknown video id falls back to the main thread', () => {
    teamActions.selectThread('th-video-v-atlantide')
    const html = render(<MessagesScreen {...props('conversations')} />)
    expect(html).toContain('data-testid="msg-card-approval"')
    expect(html).toContain('Miniature à choisir')
    teamActions.selectThread('th-video-nope')
    expect(render(<MessagesScreen {...props('conversations')} />)).toContain('data-thread="th-principal"')
  })

  it('a specialist’s direct thread has an intro, a memory line and its status', () => {
    teamActions.selectThread('th-dm-ag-enigmes-edit')
    const html = render(<MessagesScreen {...props('conversations')} />)
    expect(html).toContain('Bonjour, je suis Axel, monteur de Les Grandes Énigmes')
    expect(html).toContain('Je garde ça en tête')
    expect(html).toContain('Où j’en suis : Monte « Le trésor des Templiers » (72 %)')
    clean(html)
  })

  it('respects the channel scope: other channels vanish from the tree and the thread falls back', () => {
    teamActions.selectThread('th-group-ch-enigmes')
    const html = render(<MessagesScreen {...props('conversations')} />, 'ch-top')
    expect(html).toContain('Top Savoirs')
    expect(html).not.toContain('Les Grandes Énigmes')
    expect(html).not.toContain('Histoires Vraies')
    expect(html).toContain('data-thread="th-principal"')
    expect(html).toContain('data-testid="conv-row-th-group-ch-top"')
  })

  it('builds videos threads from the store’s existing ones plus synthesised ones, needing-you first', () => {
    const { state, agents } = world()
    const tree = buildTree(state, agents, state.channels, [])
    const enigmes = tree.find((b) => b.channel.id === 'ch-enigmes')!
    const ids = enigmes.videos.map((v) => v.thread.id)
    expect(ids).toContain('th-video-templiers')
    expect(ids).toContain('th-video-dyatlov')
    expect(ids).toContain('th-video-v-voynich')
    expect(enigmes.videos[0]!.video.status === 'waiting' || enigmes.videos[0]!.video.status === 'blocked').toBe(true)
    expect(enigmes.videos.every((v) => v.video.stage !== 'published')).toBe(true)
    expect(enigmes.unread).toBe(3 + 1)
    expect(enigmes.team.every((x) => x.agent.id !== enigmes.lead?.id)).toBe(true)
  })

  it('messages are ordered oldest first and include the extra history', () => {
    const { state, agents, team } = world()
    const thread = resolveThread('th-group-ch-enigmes', state, agents)!
    const msgs = messagesFor(thread, state, agents, team.chat, () => undefined)
    expect(msgs.length).toBeGreaterThan(10)
    for (let i = 1; i < msgs.length; i += 1) expect(msgs[i - 1]!.minutesAgo).toBeGreaterThanOrEqual(msgs[i]!.minutesAgo)
    expect(msgs.some((m) => m.authorId === 'system')).toBe(true)
  })

  it('finds who a message is addressed to', () => {
    const { state, agents } = world()
    const group = resolveThread('th-group-ch-enigmes', state, agents)!
    const pool = mentionables(group, agents)
    expect(pool.some((a) => a.role === 'principal')).toBe(true)
    expect(firstMentioned('Dis donc @lea tu as vu ?', pool)?.id).toBe('ag-enigmes-research')
    expect(firstMentioned('@Œil ça passe ?', pool)?.id).toBe('ag-enigmes-qc')
    expect(firstMentioned('personne', pool)).toBeUndefined()
    expect(responderFor(group, '@Clara des miniatures ?', agents)?.id).toBe('ag-enigmes-pack')
    expect(responderFor(group, 'salut', agents)?.id).toBe('ag-enigmes-lead')
    const dm = resolveThread(dmThreadId({ id: 'ag-enigmes-edit', role: 'editor' }), state, agents)!
    expect(responderFor(dm, 'salut', agents)?.id).toBe('ag-enigmes-edit')
  })

  it('classifies video feedback and routes it to the right specialist', () => {
    expect(feedbackKind('Le rythme est trop lent, surtout au début.')).toBe('pace')
    expect(feedbackKind('Change la miniature, elle est trop chargée.')).toBe('thumb')
    expect(feedbackKind('Plus d’archives, on voit trop d’images générées.')).toBe('archives')
    expect(feedbackKind('Merci')).toBeNull()
    const { state, agents } = world()
    const vid = resolveThread('th-video-templiers', state, agents)!
    expect(responderFor(vid, 'Le rythme est trop lent', agents)?.role).toBe('editor')
    expect(responderFor(vid, 'Change la miniature', agents)?.role).toBe('packaging')
    expect(responderFor(vid, 'Plus d’archives', agents)?.role).toBe('researcher')
  })

  it('the demo engine posts the user message, types, hands over, then answers as the right agent', () => {
    vi.useFakeTimers()
    const { state, agents } = world()
    const vid = resolveThread('th-video-templiers', state, agents)!
    sendLocal(vid, 'Le rythme est trop lent, surtout au début.', agents)
    expect(getTeamState().chat.map((m) => m.authorId)).toEqual(['user'])
    expect(getTeamState().typing[vid.id]).toEqual(['ag-enigmes-edit'])
    vi.advanceTimersByTime(2_000)
    const after = getTeamState()
    expect(after.typing[vid.id]).toEqual([])
    expect(after.chat.map((m) => m.authorId)).toEqual(['user', 'system', 'ag-enigmes-edit'])
    expect(after.chat[1]!.text).toContain('Hugo a confié')
    expect(after.chat[2]!.text).toContain('resserre')
  })

  it('in a group chat a second agent chimes in, and attachments become a card for the computer', () => {
    vi.useFakeTimers()
    const { state, agents } = world()
    const group = resolveThread('th-group-ch-enigmes', state, agents)!
    sendLocal(group, '@Hugo tu peux regarder la semaine ?', agents, { name: 'brief-chaine.pdf', sizeMb: 2 })
    const first = getTeamState().chat
    expect(first[0]!.authorId).toBe('user')
    expect(first[1]!.card?.title).toBe('brief-chaine.pdf')
    vi.advanceTimersByTime(6_000)
    const authors = getTeamState().chat.map((m) => m.authorId)
    expect(authors).toContain('ag-enigmes-lead')
    expect(getTeamState().typing[group.id]).toEqual([])
  })

  it('the real-engine screen stays reachable behind the switch', () => {
    // the switch is rendered; the old screen itself needs the real API and is exercised by its own tests
    const html = render(<MessagesScreen {...props('conversations')} />)
    expect(html).toContain('data-testid="msg-real-switch"')
    expect(html).toContain('role="switch"')
  })
})

describe('Ordinateur', () => {
  it('shows the machine with its demo badge, jobs, files, browsers, accounts, render and plans', () => {
    const html = render(<ComputerScreen {...props('ordinateurs')} />)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('data-testid="view-ordinateurs"')
    expect(html).toContain('data-testid="demo-badge"')
    for (const k of ['L’ordinateur de l’équipe', 'atelier-pc-01', 'Atelier Cloud', '8 vCPU · 16 Go · 240 Go NVMe', 'Processeur', 'Disque', '131 Go sur 240 Go', 'Fichiers de l’équipe', 'Dépose des fichiers pour l’équipe', 'Rushes', 'Gameplay', 'Navigateurs des agents', 'Voir l’écran', 'Comptes connectés', 'Claude Max 20×', 'ChatGPT Plus (Codex)', 'Google · YouTube', 'Discord', 'Ajouter un compte', 'PC de l’équipe', 'Cloud rendering', 'Agrandir l’ordinateur', 'Atelier Plus', 'Avancé']) {
      expect(html, k).toContain(k)
    }
    expect(html).toContain('data-testid="pc-dropzone"')
    expect(html).toContain('Rendu 1080p')
    clean(html)
  })

  it('the old real blocks are folded away under « Avancé »', () => {
    const html = render(<ComputerScreen {...props('ordinateurs')} />)
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('PC distant (H1)')
  })

  it('filters the channel folders by scope', () => {
    const html = render(<ComputerScreen {...props('ordinateurs')} />, 'ch-top')
    expect(html).toContain('Top Savoirs')
    expect(html).not.toContain('Les Grandes Énigmes')
    expect(html).toContain('data-testid="folder-ch-top/rushes"')
  })

  it('SectionScreen still renders the DÉMO badge on ordinateurs', () => {
    const html = render(<SectionScreen route={{ section: 'ordinateurs' }} onRoute={noop} />)
    expect(html).toContain('data-testid="demo-badge"')
  })
})

describe('catalogues', () => {
  it('every key has an English message with the same placeholders', () => {
    const placeholders = (s: string): string => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(',')
    for (const [key, text] of Object.entries(frPTeam)) {
      const english = (enPTeam as Record<string, string | undefined>)[key]
      expect(english, key).toBeTruthy()
      expect(placeholders(english ?? ''), key).toBe(placeholders(text))
    }
    expect(Object.keys(enPTeam).filter((k) => !(k in frPTeam))).toEqual([])
  })

  it('no key of this area is defined in another catalogue', () => {
    const dir = path.resolve(__dirname, '../../src/shared')
    const others = readdirSync(dir).filter((f) => /^fr.*\.ts$/.test(f) && f !== 'fr-p-team.ts' && f !== 'fr.ts')
    const keys = new Set(Object.keys(frPTeam))
    const clashes: string[] = []
    for (const f of others) {
      for (const m of readFileSync(path.join(dir, f), 'utf8').matchAll(/^\s*'([^']+)':/gm)) if (keys.has(m[1] ?? '')) clashes.push(`${f}: ${m[1]}`)
    }
    expect(clashes).toEqual([])
  })

  it('English renders when the locale is switched', () => {
    setLocale('en')
    expect(t('team.recruit')).toBe('Recruit an agent')
    expect(en['msg.real' as keyof typeof en]).toBe('Real engine (beta)')
    const html = render(<TeamScreen {...props('agents')} />)
    expect(html).toContain('Org chart')
    expect(html).toContain('Recruit an agent')
  })
})
