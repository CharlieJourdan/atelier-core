// beta-agents-llm: the agents work for the beta, and the LLM features follow the beta rule (decision 0038).
// - Charlie's bug (1 Nov.): the never-checked default login (expired OAuth session) took every turn and burned the
//   retries while his second, verified account sat idle; the chat never answered.
// - The rule: agents and script writing only on a working subscription; the director on the subscription or the API
//   key; an imported script always goes through. Everything runs on fakes: never a real call.
import { describe, expect, it } from 'vitest'
import { handleCall } from '../../src/main/ipc'
import { errorMessage, stopsTheRun } from '../../src/main/production/runs/labels'
import { t } from '../../src/shared/fr'
import { Params } from '../../src/engine/nodes/script-prompts'
import { pastedScript } from '../../src/engine/nodes/script-write'
import type { RunCtx } from '../../src/engine/registry'
import { fakeInProductionReply } from '../../src/main/agents/fake-team'
import { ANTHROPIC_KEY_SECRET } from '../../src/main/llm'
import { FakeProvider } from '../../src/main/llm/fake'
import type { CompletionRequest, Provider } from '../../src/main/llm/types'
import { accountsBack } from '../../src/main/orchestra/account-health'
import { scriptedResponder } from '../../src/main/orchestra/fake-team'
import { detectAuthFailure } from '../../src/main/orchestra/limits'
import { SubscriptionProvider } from '../../src/main/orchestra/subscription'
import { engineClaude } from '../../src/main/production/claude'
import { profileKeyName } from '../../src/main/team/claude'
import type { RunSummary } from '../../src/shared/runs'
import { rig, type Rig } from './orchestra-helpers'

const EXPIRED = 'Failed to authenticate: OAuth session expired and could not be refreshed'
const QUESTION = "regarde si j'ai des videos en cours de production"

/** One call of an engine node to the app's Claude service. */
const req = (role: string) => ({ role, system: 's', prompt: 'p', json: false, signal: AbortSignal.timeout(10_000) })

const expired = (): FakeProvider => new FakeProvider(() => ({ text: '', error: EXPIRED }))

/** The principal's conversation (Messages › Atlas), its bodies in order. */
function atlasChat(r: Rig): string[] {
  const conv = r.core.orchestra.parts.messaging.conversationFor('principal', null, null)
  return r.core.chat.store.messages(conv).map((m) => m.body)
}

function atlas(r: Rig) {
  const a = r.core.orchestra.parts.tree.principal()
  if (!a) throw new Error('no principal')
  return a
}

/** Charlie's second account, added and verified (« Vérifier » passed). */
function verifiedSecond(r: Rig): number {
  const two = r.core.orchestra.saveAccount({ kind: 'claude-code', label: 'Claude Code · compte 2', configDir: 'C:\\cc\\two', priority: 2, maxConcurrent: 2 })
  r.core.orchestra.parts.accounts.setState(two.id, 'ready', 'Connecté', true)
  return two.id
}

describe('auth failures: a dead login never takes the turn twice', () => {
  it('reads the refusals of an expired or missing login, and nothing else', () => {
    for (const m of [EXPIRED, 'Not logged in · Please run /login', 'Invalid API key · Fix external API key', 'Claude Code CLI not found on PATH (where claude)', 'HTTP 401 Unauthorized'])
      expect(detectAuthFailure(m)).not.toBeNull()
    for (const m of ['Claude AI usage limit reached|1793005200', 'Stream ended without a final result', 'Claude Code exited (code 1)', ''])
      expect(detectAuthFailure(m)).toBeNull()
  })

  it("Charlie's case: the verified account answers, the never-checked default login is not even tried", async () => {
    let defaultCalls = 0
    const r = rig({
      providerFor: (a) =>
        a.id === 1
          ? new FakeProvider(() => {
              defaultCalls++
              return { text: '', error: EXPIRED }
            })
          : new FakeProvider((req) => scriptedResponder(req))
    })
    const o = r.core.orchestra
    const two = verifiedSecond(r)
    const said = o.say({ agentId: atlas(r).id, text: QUESTION })
    await o.tick({ wait: true })
    const task = o.parts.queue.list({}).find((t) => t.kind === 'mention')
    expect(task).toMatchObject({ status: 'done', attempts: 1, accountId: two })
    expect(defaultCalls).toBe(0)
    expect(r.core.chat.store.messages(said.conversationId).some((m) => m.authorType === 'agent')).toBe(true)
  })

  it('two accounts, the first expired: the same attempt moves to the second, the first goes « à reconnecter »', async () => {
    let firstCalls = 0
    const r = rig({
      providerFor: (a) =>
        a.id === 1
          ? new FakeProvider(() => {
              firstCalls++
              return { text: '', error: EXPIRED }
            })
          : new FakeProvider((req) => scriptedResponder(req))
    })
    const o = r.core.orchestra
    const two = o.saveAccount({ kind: 'claude-code', label: 'Compte 2', configDir: 'C:\\cc\\two', priority: 2 })
    o.say({ agentId: atlas(r).id, text: QUESTION })
    await o.tick({ wait: true })
    const task = o.parts.queue.list({}).find((t) => t.kind === 'mention')
    expect(task).toMatchObject({ status: 'done', attempts: 1, accountId: two.id })
    expect(firstCalls).toBe(1)
    expect(o.accounts().find((a) => a.id === 1)).toMatchObject({ state: 'login', enabled: false, reconnect: true })
    expect(o.events(0, 500).some((e) => e.type === 'failover' && e.text.includes('logged out'))).toBe(true)
    // the next turns skip it
    o.say({ agentId: atlas(r).id, text: 'et maintenant ?' })
    await o.tick({ wait: true })
    expect(firstCalls).toBe(1)
    expect(r.core.context.access.status()).toMatchObject({ subscription: true, reconnect: [{ id: 1 }] })
  })

  it('every account dead: the chat answers at once in French with what to click; the task waits, then resumes by itself', async () => {
    let healthy = false
    const r = rig({ providerFor: () => new FakeProvider((req) => (healthy ? scriptedResponder(req) : { text: '', error: EXPIRED })) })
    const o = r.core.orchestra
    const two = verifiedSecond(r)
    o.say({ agentId: atlas(r).id, text: QUESTION })
    await o.tick({ wait: true })
    const task = o.parts.queue.list({}).find((t) => t.kind === 'mention')
    // no retry burnt: the task waits for an account, attempt given back
    expect(task).toMatchObject({ status: 'waiting', waitReason: 'accounts', attempts: 0 })
    const answer = atlasChat(r).find((b) => b.includes('Réglages › Claude'))
    expect(answer).toContain('Reconnecter')
    expect(answer).toContain('Claude Code (connexion par défaut)')
    expect(answer).toContain('Ton message est gardé')
    expect(r.core.context.access.status().subscription).toBe(false)
    // a new message while nothing works is answered right away, before any pass of the loop
    const before = atlasChat(r).filter((b) => b.includes('Réglages › Claude')).length
    o.say({ agentId: atlas(r).id, text: 'tu es là ?' })
    expect(atlasChat(r).filter((b) => b.includes('Réglages › Claude')).length).toBe(before + 1)
    // Charlie reconnects the second account (« Vérifier » passes): the waiting messages are answered with no click
    healthy = true
    expect((await o.checkAccount(two)).state).toBe('ready')
    for (let i = 0; i < 4; i++) await o.tick({ wait: true })
    expect(o.parts.queue.get(task?.id as number).status).toBe('done')
    expect(atlasChat(r).some((b) => b.includes('je reprends'))).toBe(true)
  })

  it('a task a dead login stopped (before this fix) goes back to the queue once an account works', () => {
    const r = rig()
    const o = r.core.orchestra
    const t = o.enqueue({ assigneeId: atlas(r).id, kind: 'digest', title: 'Daily digest for Charlie' })
    r.core.db.prepare("UPDATE orch_tasks SET status = 'dead', attempts = 3, error = ?, updated_at = ? WHERE id = ?").run(EXPIRED, new Date(r.clock.now()).toISOString(), t.id)
    const other = o.enqueue({ assigneeId: atlas(r).id, kind: 'digest', title: 'Broken for another reason' })
    r.core.db.prepare("UPDATE orch_tasks SET status = 'dead', attempts = 3, error = 'Model said nonsense', updated_at = ? WHERE id = ?").run(new Date(r.clock.now()).toISOString(), other.id)
    expect(accountsBack(o.parts)).toBe(1)
    expect(o.parts.queue.get(t.id)).toMatchObject({ status: 'queued', attempts: 0 })
    expect(o.parts.queue.get(other.id).status).toBe('dead')
  })

  it("the app's subscription provider (chat, asks, script nodes) fails over the same way", async () => {
    const r = rig({ providerFor: (a) => (a.id === 1 ? expired() : new FakeProvider(() => 'ok from account 2')) })
    const two = r.core.orchestra.saveAccount({ kind: 'claude-code', label: 'Compte 2', configDir: 'C:\\cc\\two', priority: 2 })
    const sub = new SubscriptionProvider({ pool: () => r.core.orchestra.parts.accounts, tierModels: () => r.core.context.routes.tierModels() })
    const out = await sub.complete({ model: 'claude-sonnet-5-5', prompt: 'hello' })
    expect(out.text).toBe('ok from account 2')
    expect(r.core.orchestra.accounts().find((a) => a.id === 1)?.reconnect).toBe(true)
    r.core.orchestra.parts.accounts.markNeedsLogin(two.id, EXPIRED)
    await expect(sub.complete({ model: 'claude-sonnet-5-5', prompt: 'hello' })).rejects.toMatchObject({ code: 'LOCKED' })
  })
})

describe('Atlas reads what is in production', () => {
  const run = (id: number, title: string, status: RunSummary['status']): RunSummary =>
    ({ id, videoId: id, videoTitle: title, channelId: 1, channelName: 'Histoire', status, progress: 0.4, waitingNodes: status === 'waiting' ? ['script'] : [], current: status === 'running' ? { nodeId: 'voice', label: 'Voix', step: null } : null, error: null, demo: false, spentCredits: 12, quoteCredits: 40 }) as unknown as RunSummary

  it('answers « regarde si j’ai des vidéos en cours de production » with the runs and projects in progress', async () => {
    const runs = [run(7, 'Le mystère du vol 19', 'running'), run(8, 'Les phares hantés', 'waiting'), run(3, 'Vieille vidéo', 'succeeded')]
    const r = rig({
      providerFor: () => new FakeProvider((req: CompletionRequest) => fakeInProductionReply(req) ?? scriptedResponder(req)),
      core: {
        orchestra: {
          services: {
            production: { list: () => runs } as never,
            projects: { list: () => [{ id: 2, title: 'Atlantide', recipeId: 1, recipeName: 'Histoire', recipeVersion: 3, channelId: 1, runId: null, runStatus: null, videoId: null, createdAt: '', updatedAt: '' }] }
          }
        }
      }
    })
    const o = r.core.orchestra
    o.say({ agentId: atlas(r).id, text: QUESTION })
    await o.tick({ wait: true })
    const answer = atlasChat(r).find((b) => b.startsWith('Voici ce qui est en production')) ?? ''
    expect(answer).toContain('Le mystère du vol 19')
    expect(answer).toContain('Les phares hantés')
    expect(answer).toContain('waits for Charlie at script')
    expect(answer).toContain('project #2 "Atlantide"')
    expect(answer).not.toContain('Vieille vidéo')
  })
})

describe('the beta rule (decision 0038)', () => {
  /** No subscription works: the only account's login died. */
  function noSubscription(r: Rig): void {
    r.core.orchestra.parts.accounts.markNeedsLogin(1, EXPIRED)
  }

  function claudeService(r: Rig, sub: Provider, api: Provider) {
    const c = r.core.context
    return engineClaude({ ledger: r.core.ledger, routes: c.routes, settings: c.settings, getProvider: () => c.access.gate(sub), access: c.access, apiProvider: () => api })
  }

  it('no subscription: the agents and script writing are locked with a French message, the team cannot be switched on', async () => {
    const r = rig()
    noSubscription(r)
    const c = r.core.context
    expect(c.access.status()).toMatchObject({ subscription: false, reconnect: [{ id: 1, label: 'Claude Code (connexion par défaut)' }] })
    // one-shot asks (ideas, analysis…): locked, never sent to the API key even when one is set
    c.secrets.set(ANTHROPIC_KEY_SECRET, 'sk-ant-test-not-real')
    await expect(c.ask({ role: 'ideas_manager', system: 's', prompt: 'p' })).rejects.toThrow(/abonnement Claude Code ou Codex connecté/)
    // the engine's script roles
    const sub = new FakeProvider(() => 'sub')
    const api = new FakeProvider(() => 'api')
    const claude = claudeService(r, sub, api)
    for (const role of ['scriptwriter', 'researcher', 'factchecker', 'sponsor_writer'])
      await expect(claude.ask(req(role))).rejects.toMatchObject({ code: 'LOCKED' })
    expect(sub.calls.length + api.calls.length).toBe(0)
    // the team
    const power = await handleCall(r.core.api, 'autopilot.setPower', [{ state: 'on' }])
    expect(power.ok).toBe(false)
  })

  it('an imported script still goes through with no model at all', async () => {
    const r = rig()
    noSubscription(r)
    const claude = claudeService(r, new FakeProvider(() => 'sub'), new FakeProvider(() => 'api'))
    const ctx = { services: { claude }, minutes: 1, notes: [], signal: undefined } as unknown as RunCtx
    const text = 'Le vol 19 a disparu en 1945. Cinq avions, quatorze hommes. Personne ne les a jamais retrouvés. Voici ce que l’on sait vraiment.'
    const out = await pastedScript(ctx, text, Params.parse({ language: 'fr' }))
    expect(out.done.text).toBe(text)
    expect(out.done.pasted).toBe(true)
    expect(out.done.warnings.some((w) => w.includes('aucun modèle connecté'))).toBe(true)
  })

  it('an expired Claude Code sign-in reaches the run as the French stop with the action, never « Erreur interne » (production-17)', async () => {
    const r = rig()
    const claude = claudeService(r, expired(), new FakeProvider(() => 'api'))
    await expect(claude.ask(req('director'))).rejects.toMatchObject({ name: 'EngineError', code: 'missing_tool', permanent: true, message: t('runs.error.claudeLogin') })
    expect(t('runs.error.claudeLogin')).toMatch(/terminal.*claude.*\/login/)
    // the run's sentence for that node error is the message itself
    expect(errorMessage('missing_tool', t('runs.error.claudeLogin'))).toBe(t('runs.error.claudeLogin'))
    expect(stopsTheRun('missing_tool', t('runs.error.claudeLogin'))).toBe(true)
    expect(stopsTheRun('internal', 'boom')).toBe(false)
    // an imported script is not stopped by it: plain beats, a warning
    const ctx = { services: { claude }, minutes: 1, notes: [], signal: undefined } as unknown as RunCtx
    const out = await pastedScript(ctx, 'Le vol 19 a disparu en 1945. Cinq avions, quatorze hommes. Personne ne les a retrouvés.', Params.parse({ language: 'fr' }))
    expect(out.done.warnings.some((w) => w.includes('Claude Code de ce PC a expiré'))).toBe(true)
  })

  it('the director runs on the subscription or the API key, as set; the script always on the subscription', async () => {
    const r = rig()
    const c = r.core.context
    const sub = new FakeProvider(() => 'from subscription')
    const api = new FakeProvider(() => 'from api')
    const claude = claudeService(r, sub, api)
    // default: the subscription when one works
    expect(c.access.status().director).toMatchObject({ choice: null, effective: 'subscription', apiKeySet: false })
    expect((await claude.ask(req('director'))).text).toBe('from subscription')
    // « ma clé API » without a key: a clear French refusal
    c.access.setDirectorBackend('api')
    await expect(claude.ask(req('director'))).rejects.toThrow(/aucune clé n’est enregistrée/)
    c.secrets.set(ANTHROPIC_KEY_SECRET, 'sk-ant-test-not-real')
    expect((await claude.ask(req('director'))).text).toBe('from api')
    expect((await claude.ask(req('scene'))).text).toBe('from api')
    expect((await claude.ask(req('script_import'))).text).toBe('from api')
    // the script never goes to the key
    expect((await claude.ask(req('scriptwriter'))).text).toBe('from subscription')
    // the API key's calls are priced in the ledger as API calls, the subscription's are not
    const rows = r.core.db.prepare("SELECT provider_id FROM ledger WHERE provider_id = 'anthropic'").all()
    expect(rows.length).toBe(3)
    // back to the default; with no subscription the director falls back to the key
    c.access.setDirectorBackend(null)
    r.core.orchestra.parts.accounts.markNeedsLogin(1, EXPIRED)
    expect(c.access.status().director).toMatchObject({ choice: null, effective: 'api', apiKeySet: true })
    expect((await claude.ask(req('director'))).text).toBe('from api')
  })

  it('the API key typed in Réglages › Claude (an « API » profile) is the director’s key', () => {
    const r = rig()
    const c = r.core.context
    expect(c.access.status().director.apiKeySet).toBe(false)
    const id = Number(r.core.db.prepare("INSERT INTO claude_profiles (name, kind, is_default) VALUES ('Ma clé', 'api', 0)").run().lastInsertRowid)
    c.secrets.set(profileKeyName(id), 'sk-ant-test-not-real')
    expect(c.access.status().director.apiKeySet).toBe(true)
  })
})
