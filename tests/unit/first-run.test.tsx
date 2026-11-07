// The first run (2026-10-26): a fresh install starts empty (no example workspace unless ATELIER_EXAMPLE=1), the gate opens the
// real first-run onboarding while the workspace never finished it (stored in the database settings), « Plus tard » ends it
// with no channel, and the engine step connects the person's own Claude account for real — never a fake success.
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BrainStatus } from '../../src/shared/api/brain'
import type { OrchAccount, OrchAccountLogin, OrchCliAccountInput } from '../../src/shared/api/orchestra'
import type { ProviderTestResult } from '../../src/shared/api'
import { setLocale } from '../../src/shared/fr'
import { exampleAtStart } from '../../src/main/example'
import { ONBOARDED_KEY } from '../../src/main/api/app'
import type { Call } from '../../src/renderer/proto/live/onboarding-live'
import { gateOf, mainScreenOf, type ScreenInput } from '../../src/renderer/screens/welcome/gate'
import { afterStep, initialAnswers, stepValid, type Answers, type StepProps } from '../../src/renderer/screens/onboarding/model'
import { ChannelStep } from '../../src/renderer/screens/onboarding/steps/Channel'
import { EngineLink, enginePhase, type CliKind, type EngineLinkState } from '../../src/renderer/screens/onboarding/live/engine-link'
import { EngineView } from '../../src/renderer/screens/onboarding/live/LiveEngine'
import { memoryCore } from './helpers'

const noop = (): void => undefined

beforeEach(() => setLocale('fr'))
afterEach(() => setLocale('fr'))

describe('empty start', () => {
  it('the example workspace is loaded at start only with ATELIER_EXAMPLE=1', () => {
    expect(exampleAtStart({})).toBe(false)
    expect(exampleAtStart({ ATELIER_EXAMPLE: '0' })).toBe(false)
    expect(exampleAtStart({ ATELIER_EXAMPLE: 'true' })).toBe(false)
    expect(exampleAtStart({ ATELIER_EXAMPLE: '1' })).toBe(true)
  })
})

describe('the first run is stored in the database', () => {
  it('a fresh workspace has not finished it; the example channels do not count; its own channel does', async () => {
    const core = memoryCore()
    try {
      expect(await core.api['app.onboarding']()).toEqual({ done: false })
      await core.api['example.load']()
      expect(await core.api['app.onboarding']()).toEqual({ done: false })
      await core.api['channels.create']({ name: 'Ma chaîne d’avant' })
      expect(await core.api['app.onboarding']()).toEqual({ done: true })
    } finally {
      core.close()
    }
  })

  it('« Plus tard » ends it with zero channels and onboarded = true, kept in the settings', async () => {
    const core = memoryCore()
    try {
      expect(await core.api['app.finishOnboarding']()).toEqual({ done: true })
      expect(await core.api['channels.list']()).toEqual([])
      expect(core.context.settings.get(ONBOARDED_KEY)).toBe(true)
      expect(await core.api['app.onboarding']()).toEqual({ done: true })
    } finally {
      core.close()
    }
  })
})

describe('the gate and the onboarding decision', () => {
  const at = (p: Partial<ScreenInput>): ScreenInput => ({ gate: 'ready', mode: 'live', firstRunDone: false, onboarded: true, ...p })

  it('the welcome first (signed out, not offline), loading while unknown', () => {
    expect(gateOf(false, false)).toBe('welcome')
    expect(mainScreenOf(at({ gate: 'welcome' }))).toBe('welcome')
    expect(mainScreenOf(at({ gate: 'loading' }))).toBe('loading')
  })

  it('fresh: the onboarding opens once the gate is passed, signed in or offline', () => {
    expect(mainScreenOf(at({ gate: gateOf(true, false) }))).toBe('onboarding')
    expect(mainScreenOf(at({ gate: gateOf(false, true) }))).toBe('onboarding')
    expect(mainScreenOf(at({ firstRunDone: null }))).toBe('loading')
  })

  it('already onboarded (or with channels of its own): the app; a replay by hand still shows the onboarding', () => {
    expect(mainScreenOf(at({ firstRunDone: true }))).toBe('app')
    expect(mainScreenOf(at({ firstRunDone: true, onboarded: false }))).toBe('onboarding')
  })

  it('never in the presentation mode, whatever the database says', () => {
    expect(mainScreenOf(at({ mode: 'demo', firstRunDone: false }))).toBe('app')
    expect(mainScreenOf(at({ mode: 'demo', firstRunDone: null }))).toBe('app')
    expect(mainScreenOf(at({ mode: 'demo', onboarded: false }))).toBe('onboarding')
  })
})

describe('« Plus tard » on the channel question', () => {
  const answers = (p: Partial<Answers> = {}): Answers => ({ ...initialAnswers('Atlas'), ...p })
  const props = (a: Answers, mode: StepProps['mode']): StepProps => ({ a, set: noop, mode, next: noop, ready: false, setReady: noop })

  it('is a valid answer that ends the first run at step 3; the add-a-channel flow goes on', () => {
    const later = answers({ hasChannel: 'later' })
    expect(stepValid(3, later)).toBe(true)
    expect(afterStep(3, later, 'first-run')).toBe('finish')
    expect(afterStep(3, answers({ hasChannel: 'no' }), 'first-run')).toBe('next')
    expect(afterStep(3, later, 'add-channel')).toBe('next')
    expect(afterStep(8, answers(), 'first-run')).toBe('finish')
  })

  it('shows three choices in the first run, two when adding a channel', () => {
    const first = renderToStaticMarkup(<ChannelStep {...props(answers({ hasChannel: 'later' }), 'first-run')} />)
    for (const id of ['channel-yes', 'channel-no', 'channel-later', 'onboarding-later-note']) expect(first).toContain(`data-testid="${id}"`)
    expect(first).toContain('J’ai déjà une chaîne')
    expect(first).toContain('Je veux créer une chaîne')
    expect(first).toContain('Plus tard')
    const add = renderToStaticMarkup(<ChannelStep {...props(answers(), 'add-channel')} />)
    expect(add).not.toContain('data-testid="channel-later"')
  })
})

/* ---------- the engine step, with a fake api ---------- */

function account(p: Partial<OrchAccount> & Pick<OrchAccount, 'id'>): OrchAccount {
  return {
    kind: 'claude-code',
    label: `Claude Code · compte ${p.id}`,
    configDir: `/data/orchestra/accounts/claude-code-${p.id}`,
    enabled: false,
    priority: p.id,
    maxConcurrent: 2,
    tiers: ['fast', 'balanced', 'best'],
    limitedUntil: null,
    limitNote: null,
    running: 0,
    calls: 0,
    failures: 0,
    lastUsedAt: null,
    spentUsdMonth: 0,
    state: 'login',
    checkNote: null,
    checkedAt: null,
    reconnect: false,
    ...p
  }
}

/** The default login (seeded by the runtime): `ready` but never checked. */
const DEFAULT = account({ id: 1, label: 'Claude Code (connexion par défaut)', configDir: null, enabled: true, state: 'ready' })

interface FakeApi {
  call: Call
  calls: string[]
  accounts: OrchAccount[]
}

function fakeApi(o: { cli?: ProviderTestResult | Error; brain?: Partial<BrainStatus>; launched?: boolean; check?: (a: OrchAccount) => OrchAccount } = {}): FakeApi {
  const api: FakeApi = { call: null as unknown as Call, calls: [], accounts: [DEFAULT] }
  const handlers: Record<string, (...args: never[]) => unknown> = {
    'brain.status': () => ({ mode: 'local', url: null, name: null, tokenSet: false, live: false, error: null, storage: null, ...o.brain }),
    'providers.test': () => {
      if (o.cli instanceof Error) throw o.cli
      return o.cli ?? { ok: true, message: 'Found /usr/local/bin/claude (2.1.0)', latencyMs: 3 }
    },
    'orchestra.accounts': () => api.accounts,
    'orchestra.addCliAccount': (input: OrchCliAccountInput): OrchAccountLogin => {
      const a = account({ id: api.accounts.length + 1, kind: input.kind, checkNote: 'En attente de ta connexion dans le terminal' })
      api.accounts = [...api.accounts, a]
      const command = `$env:CLAUDE_CONFIG_DIR="${a.configDir}"; claude`
      return { account: a, configDir: a.configDir ?? '', command, launched: o.launched ?? true, note: 'Un terminal est ouvert.' }
    },
    'orchestra.openLogin': (id: number): OrchAccountLogin => {
      const a = api.accounts.find((x) => x.id === id)!
      return { account: a, configDir: a.configDir ?? '', command: 'claude', launched: o.launched ?? true, note: '' }
    },
    'orchestra.checkAccount': (id: number) => {
      const a = api.accounts.find((x) => x.id === id)!
      const after = o.check ? o.check(a) : a
      api.accounts = api.accounts.map((x) => (x.id === id ? after : x))
      return after
    }
  }
  api.call = (async (method: string, ...args: unknown[]) => {
    api.calls.push(method)
    const h = handlers[method]
    if (!h) throw new Error(`unexpected call ${method}`)
    return (h as (...a: unknown[]) => unknown)(...args)
  }) as unknown as Call
  return api
}

const view = (kind: CliKind, state: EngineLinkState, mac = false): string =>
  renderToStaticMarkup(<EngineView kind={kind} onKind={noop} state={state} mac={mac} onAdd={noop} onReopen={noop} onCheck={noop} onRetryCli={noop} />)

const verified = (a: OrchAccount): OrchAccount => ({ ...a, state: 'ready', enabled: true, checkNote: 'Connecté : claude-haiku-5-5 a répondu « OK ».', checkedAt: '2026-10-26T10:00:00.000Z' })

describe('the engine step connects the real account', () => {
  it('starts with « Ajouter mon compte »: the default login, never checked, does not count as connected', async () => {
    const api = fakeApi()
    const link = new EngineLink(api.call)
    expect(enginePhase('claude-code', link.getState())).toBe('loading')
    await link.load()
    expect(enginePhase('claude-code', link.getState())).toBe('add')
    const html = view('claude-code', link.getState())
    expect(html).toContain('data-phase="add"')
    expect(html).toContain('Claude Code est installé')
    expect(html).toContain('Ajouter mon compte Claude Code')
    expect(html).toContain('data-testid="engine-warning"')
    expect(html).not.toContain('Claude Max')
    expect(html).not.toContain('data-testid="engine-ready"')
  })

  it('without the CLI: install help (npm, Mac and Windows notes), no account button', async () => {
    const api = fakeApi({ cli: { ok: false, message: 'claude not found on PATH. Install Claude Code and log in.', latencyMs: 1 } })
    const link = new EngineLink(api.call)
    await link.load()
    expect(enginePhase('claude-code', link.getState())).toBe('no-cli')
    const win = view('claude-code', link.getState())
    expect(win).toContain('npm i -g @anthropic-ai/claude-code')
    expect(win).toContain('Sur Windows')
    expect(win).not.toContain('data-testid="engine-add"')
    expect(win).toContain('data-testid="engine-warning"')
    expect(view('claude-code', link.getState(), true)).toContain('Sur Mac')
  })

  it('add → the terminal (or the command) → « Vérifier », announced as using the subscription → ready', async () => {
    const api = fakeApi({ launched: false, check: verified })
    const link = new EngineLink(api.call)
    await link.load()
    await link.add('claude-code')
    expect(api.calls).toContain('orchestra.addCliAccount')
    expect(enginePhase('claude-code', link.getState())).toBe('login')
    const waiting = view('claude-code', link.getState())
    expect(waiting).toContain('En attente de ta connexion')
    expect(waiting).toContain('tape /login')
    expect(waiting).toContain('data-testid="engine-command"')
    expect(waiting).toContain('CLAUDE_CONFIG_DIR')
    expect(waiting).toContain('sur ton abonnement')
    expect(waiting).toContain('registre des dépenses')
    expect(waiting).toContain('data-testid="engine-check"')

    await link.check(2)
    expect(api.calls.filter((c) => c === 'orchestra.checkAccount')).toHaveLength(1)
    expect(enginePhase('claude-code', link.getState())).toBe('ready')
    const ready = view('claude-code', link.getState())
    expect(ready).toContain('Compte connecté et vérifié')
    expect(ready).not.toContain('data-testid="engine-warning"')
  })

  it('a check that finds no login stays in login with its reason; a broken one says it failed', async () => {
    const notYet = fakeApi({ check: (a) => ({ ...a, state: 'login', checkNote: 'Pas encore connecté : Please run /login', checkedAt: '2026-10-26T10:00:00.000Z' }) })
    const one = new EngineLink(notYet.call)
    await one.load()
    await one.add('claude-code')
    await one.check(2)
    expect(enginePhase('claude-code', one.getState())).toBe('login')
    expect(view('claude-code', one.getState())).toContain('Pas encore connecté')

    const broken = fakeApi({ check: (a) => ({ ...a, state: 'failed', checkNote: 'Échec : spawn ENOENT', checkedAt: '2026-10-26T10:00:00.000Z' }) })
    const two = new EngineLink(broken.call)
    await two.load()
    await two.add('claude-code')
    await two.check(2)
    expect(enginePhase('claude-code', two.getState())).toBe('failed')
    const html = view('claude-code', two.getState())
    expect(html).toContain('La vérification n’a pas marché')
    expect(html).toContain('spawn ENOENT')
    expect(html).toContain('data-testid="engine-warning"')
  })

  it('on a team computer: says the account lives there and shows the command the brain gives', async () => {
    const api = fakeApi({ brain: { mode: 'remote', name: 'atelier-vm-1', url: 'relay' }, launched: true })
    const link = new EngineLink(api.call)
    await link.load()
    await link.add('claude-code')
    const html = view('claude-code', link.getState())
    expect(html).toContain('data-where="remote"')
    expect(html).toContain('Sur l’ordinateur d’équipe atelier-vm-1')
    expect(html).toContain('écran à distance')
    expect(html).toContain('data-testid="engine-command"')
  })

  it('Codex: its own add button and install line; an error of the brain is shown, not hidden', async () => {
    const api = fakeApi({ cli: new Error('unreachable') })
    const link = new EngineLink(api.call)
    await link.load()
    expect(link.getState().cli).toEqual({ state: 'unknown' })
    expect(enginePhase('codex', link.getState())).toBe('add')
    const html = view('codex', link.getState())
    expect(html).toContain('Ajouter mon compte Codex')
    expect(html).toContain('npm install -g @openai/codex')
    const failing = new EngineLink((async () => {
      throw new Error('le cerveau ne répond pas')
    }) as unknown as Call)
    await failing.load()
    await failing.add('claude-code')
    expect(failing.getState().error).toBe('le cerveau ne répond pas')
    expect(view('claude-code', failing.getState())).toContain('le cerveau ne répond pas')
  })
})
