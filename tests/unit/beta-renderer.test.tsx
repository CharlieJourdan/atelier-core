// The beta, the renderer: real mode is the default of the desktop app and starts EMPTY (no demo channel, video, agent,
// member or credit), the demo workspace is only the « Mode présentation »; the welcome gate; the account in the sidebar
// (offline / signed in); the welcome screen, the team block and the channel's life actions as pure views.
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import type { CloudProfile, CloudTeam } from '../../src/shared/api'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { Sidebar } from '../../src/renderer/components/shell/Sidebar'
import { TeamBlockView } from '../../src/renderer/components/cloud/TeamBlock'
import { CHANNELS, WORKSPACE } from '../../src/renderer/proto/data-core'
import { initialsOf, planLabel, workspaceOf } from '../../src/renderer/proto/live/account'
import { createProtoStore, initialState, OFFLINE_WORKSPACE, ProtoProvider, storeActions, type ProtoState } from '../../src/renderer/proto/store'
import { dbIdOf } from '../../src/renderer/screens/channels/ChannelLife'
import { gateOf } from '../../src/renderer/screens/welcome/gate'
import { WelcomeView, type WelcomeViewProps } from '../../src/renderer/screens/welcome/WelcomeScreen'

const g = globalThis as { atelier?: unknown; localStorage?: unknown }
afterEach(() => {
  delete g.atelier
})
/** Plays the desktop app: the preload bridge exists. */
function desktop(): void {
  g.atelier = { call: () => Promise.resolve(null), on: () => () => undefined }
}

const DEMO_NAMES = CHANNELS.map((c) => c.name)

function render(el: ReactElement, state: Partial<ProtoState> = {}): string {
  const store = createProtoStore(initialState(state))
  return renderToStaticMarkup(createElement(ProtoProvider, { store, children: createElement(TooltipProvider, { children: el }) }))
}

const PROFILE: CloudProfile = {
  email: 'charlie@example.com',
  name: 'Charlie Jourdan',
  teamName: 'Studio C',
  role: 'owner',
  emailVerified: true,
  plan: 'creator',
  planStatus: 'active',
  credits: { balance: 5000, held: 200, available: 4800 }
}

describe('real mode by default, empty', () => {
  it('the desktop app starts in real mode with nothing invented; the web demo and unit renders keep the demo', () => {
    expect(initialState().mode).toBe('demo')
    desktop()
    const s = initialState()
    expect(s.mode).toBe('live')
    expect(s.channels).toEqual([])
    expect(s.videos).toEqual([])
    expect(s.inbox).toEqual([])
    expect(s.messages).toEqual([])
    expect(s.accounts).toEqual([])
    expect(s.agents.map((a) => a.role)).toEqual(['principal'])
    expect(s.agents[0]).toMatchObject({ load: 0, tasksDone7d: 0, memoryItems: 0 })
    expect(s.pipelines.every((p) => p.preset && p.channelIds.length === 0)).toBe(true)
    expect(s.workspace).toEqual(OFFLINE_WORKSPACE)
    expect(JSON.stringify(s)).not.toContain(WORKSPACE.name)
    for (const name of DEMO_NAMES) expect(JSON.stringify({ ...s, pipelines: [] })).not.toContain(name)
  })

  it('switching modes: presentation brings the demo, leaving it starts real mode empty again (no demo left on screen)', () => {
    desktop()
    const store = createProtoStore(initialState())
    const act = storeActions(store)
    act.setWorkspace(workspaceOf(PROFILE, null))
    expect(store.get().workspace.cloud).toBe('signed-in')
    act.setMode('demo')
    expect(store.get().channels.map((c) => c.name)).toEqual(DEMO_NAMES)
    expect(store.get().workspace).toEqual(WORKSPACE)
    act.setWorkspace(workspaceOf(PROFILE, null)) // ignored in the demo
    expect(store.get().workspace).toEqual(WORKSPACE)
    act.setMode('live')
    expect(store.get().channels).toEqual([])
    expect(store.get().workspace).toEqual(OFFLINE_WORKSPACE)
    expect(store.get().live.loading).toBe(true)
  })
})

describe('the account', () => {
  it('the workspace of real mode is the Cloud account, else the names the session kept, else offline', () => {
    expect(workspaceOf(PROFILE, null)).toMatchObject({ name: 'Studio C', plan: 'Creator', credits: 4800, creditsMonthly: 0, cloud: 'signed-in', email: 'charlie@example.com', members: [{ name: 'Charlie Jourdan', role: 'owner', initials: 'CJ' }] })
    expect(workspaceOf({ ...PROFILE, plan: null, role: 'member' }, null)).toMatchObject({ plan: 'Sans abonnement', members: [{ role: 'editor' }] })
    const cached = workspaceOf(null, { connected: true, baseUrl: 'x', deviceId: 'd', account: { email: 'a@b.c', name: 'Ana', teamName: 'T' } })
    expect(cached).toMatchObject({ cloud: 'signed-in', name: 'T', credits: 0, members: [{ name: 'Ana' }] })
    expect(workspaceOf(null, { connected: false, baseUrl: 'x', deviceId: null })).toEqual(OFFLINE_WORKSPACE)
    expect(initialsOf('charlie')).toBe('C')
    expect(initialsOf('  ')).toBe('·')
    expect(planLabel('studio')).toBe('Studio')
    expect(planLabel('weird')).toBe('Sans abonnement')
  })

  it('the sidebar shows « Hors ligne » without an account, the account with its plan and credits once signed in', () => {
    desktop()
    const sidebar = createElement(Sidebar, { current: 'accueil', onSelect: () => undefined, onPalette: () => undefined, collapsed: false, onToggle: () => undefined })
    const offline = render(sidebar)
    expect(offline).toContain('data-cloud="offline"')
    expect(offline).toContain('Hors ligne')
    expect(offline).not.toContain('data-testid="sidebar-credits"')
    expect(offline).not.toContain(WORKSPACE.name)
    const signedIn = render(sidebar, { workspace: workspaceOf(PROFILE, null) })
    expect(signedIn).toContain('data-cloud="signed-in"')
    expect(signedIn).toContain('Charlie Jourdan')
    expect(signedIn).toContain('Creator')
    expect(signedIn).toMatch(/data-testid="sidebar-credits"[\s\S]*4[\s\u202f\u00a0]800/)
  })

  it('the gate: welcome until signed in or offline', () => {
    expect(gateOf(null, false)).toBe('loading')
    expect(gateOf(false, false)).toBe('welcome')
    expect(gateOf(true, false)).toBe('ready')
    expect(gateOf(false, true)).toBe('ready')
  })
})

describe('the views', () => {
  const welcome = (p: Partial<WelcomeViewProps>): string =>
    renderToStaticMarkup(
      createElement(WelcomeView, {
        login: 'idle',
        baseUrl: 'http://127.0.0.1:8787',
        busy: false,
        error: null,
        onConnect: () => undefined,
        onReopen: () => undefined,
        onCancel: () => undefined,
        onOffline: () => undefined,
        onServer: () => Promise.resolve(true),
        ...p
      })
    )

  it('welcome: sign in, create an account, offline clearly labelled, the server; then the code while the browser waits', () => {
    const idle = welcome({})
    for (const id of ['welcome-signin', 'welcome-signup', 'welcome-offline', 'welcome-server']) expect(idle).toContain(`data-testid="${id}"`)
    expect(idle).toContain('Continuer sans compte (hors ligne)')
    expect(idle).toContain('Serveur : http://127.0.0.1:8787')
    const pending = welcome({ login: { pending: true, userCode: 'ABCD-1234', verificationUri: 'http://x/device?code=ABCD-1234' } })
    expect(pending).toContain('data-state="pending"')
    expect(pending).toContain('ABCD-1234')
    expect(pending).not.toContain('data-testid="welcome-signin"')
    expect(welcome({ login: { error: true, message: 'La demande a expiré' } })).toContain('La demande a expiré')
  })

  it('team block: members, pending invitations, the invite form for an owner; signed out says so', () => {
    const team: CloudTeam = {
      canInvite: true,
      members: [{ accountId: 'a1', email: 'charlie@example.com', name: 'Charlie', role: 'owner' }],
      invites: [{ id: 'i1', email: 'mo@example.com', role: 'member', invitedBy: 'Charlie', createdAt: '2026-10-24T10:00:00Z', expiresAt: '2026-10-31T10:00:00Z' }]
    }
    const view = (t: CloudTeam | null) => renderToStaticMarkup(createElement(TeamBlockView, { team: t, me: 'charlie@example.com', busy: false, onInvite: () => Promise.resolve(true), onRevoke: () => undefined }))
    const html = view(team)
    expect(html).toContain('mo@example.com')
    expect(html).toContain('data-testid="team-invite-form"')
    expect(html).toContain('data-testid="team-revoke"')
    expect(html).toContain('(toi)')
    expect(view({ ...team, canInvite: false })).not.toContain('data-testid="team-invite-form"')
    expect(view(null)).toContain('data-testid="team-signed-out"')
  })

  it('the channel actions are for real channels only', () => {
    expect(dbIdOf({ id: 'db-12' })).toBe(12)
    expect(dbIdOf({ id: 'ch-enigmes' })).toBeNull()
  })
})
