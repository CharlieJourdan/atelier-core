// « Ajouter mon compte Claude Code / Codex » (Réglages › Claude): the user connects HIS OWN subscription.
//   1. Atelier creates a dedicated config folder for the account: `<data>/accounts/claude-code-<n>` (CLAUDE_CONFIG_DIR) or
//      `<data>/accounts/codex-<n>` (CODEX_HOME), and the account (disabled, state `login`).
//   2. It opens a terminal window running the CLI with that folder (platform/terminal.ts); the user signs in himself there
//      (`/login` in Claude Code, `codex login`). Atelier never sees, reads, copies or stores a token or a credential file.
//   3. « Vérifier »: ONE tiny prompt on the fast tier (Haiku) through the account's own CLI — announced on the screen as
//      using his subscription — booked in the ledger like any call. A good answer makes the account `ready` and enabled;
//      the pool then routes turns through it with the usual failover. A « please log in » answer keeps it in `login`.
// On a team computer without a screen of its own, the same flow runs over its remote screen: the command to type is
// returned (docs/AGENT-RUNTIME.md §21).
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { OrchAccount, OrchAccountLogin, OrchCliAccountInput } from '../../shared/api/orchestra'
import { loginCommand, type TerminalLauncher } from '../platform/terminal'
import type { AccountRecord } from './accounts'
import { callModel } from './call'
import type { RuntimeParts } from './parts'
import { truncate } from './util'

export const CHECK_PROMPT = 'Réponds seulement : OK'
const NOT_LOGGED = /(not logged in|log ?in|\/login|please run|authenticat|unauthori[sz]ed|invalid api key|credentials|sign in|codex login)/i

export interface ConnectDeps {
  parts: RuntimeParts
  terminal: TerminalLauncher
  platform: NodeJS.Platform
  /** `<data>/accounts`. */
  accountsDir: string
}

function folderFor(deps: ConnectDeps, kind: OrchCliAccountInput['kind']): string {
  const taken = new Set(deps.parts.accounts.list().map((a) => a.configDir))
  for (let n = 1; ; n++) {
    const dir = path.join(deps.accountsDir, `${kind}-${n}`)
    if (!taken.has(dir)) return dir
  }
}

async function openLogin(deps: ConnectDeps, a: AccountRecord): Promise<OrchAccountLogin> {
  if (a.kind !== 'claude-code' && a.kind !== 'codex') throw new Error('Only Claude Code and Codex accounts sign in through a terminal')
  if (!a.configDir) throw new Error('This account uses the default login of the CLI: sign in with `claude` then `/login` in any terminal')
  mkdirSync(a.configDir, { recursive: true })
  const command = loginCommand(a.kind, a.configDir, deps.platform)
  const launched = await deps.terminal.open({ kind: a.kind, configDir: a.configDir, title: `Atelier - ${a.label}` })
  const how = a.kind === 'claude-code' ? 'tape /login, connecte-toi avec ton compte, puis /exit' : 'suis la connexion ChatGPT dans le navigateur'
  const note = launched
    ? `Un terminal est ouvert : ${how}. Reviens ici et clique sur « Vérifier ».`
    : `Ouvre un terminal sur cet ordinateur (ou sur l’écran à distance de l’ordinateur d’équipe), tape : ${command} — puis ${how}, et clique sur « Vérifier ».`
  return { account: deps.parts.accounts.toApi(deps.parts.accounts.get(a.id)), configDir: a.configDir, command, launched, note }
}

export async function addCliAccount(deps: ConnectDeps, input: OrchCliAccountInput): Promise<OrchAccountLogin> {
  if (!input || (input.kind !== 'claude-code' && input.kind !== 'codex')) throw new Error('kind is claude-code or codex')
  const pool = deps.parts.accounts
  const n = pool.list().filter((a) => a.kind === input.kind).length + 1
  const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim() : `${input.kind === 'codex' ? 'Codex' : 'Claude Code'} · compte ${n}`
  const configDir = folderFor(deps, input.kind)
  mkdirSync(configDir, { recursive: true })
  const saved = pool.save({ kind: input.kind, label, configDir, priority: n, maxConcurrent: 2, enabled: false })
  pool.setState(saved.id, 'login', 'En attente de ta connexion dans le terminal')
  deps.parts.events.add('account', `${label}: login terminal for ${configDir}`)
  return openLogin(deps, pool.get(saved.id))
}

export function reopenLogin(deps: ConnectDeps, id: number): Promise<OrchAccountLogin> {
  return openLogin(deps, deps.parts.accounts.get(id))
}

/** The health check: one tiny prompt on the fast tier through this account's CLI (the user's subscription). */
export async function checkAccount(deps: ConnectDeps, id: number): Promise<OrchAccount> {
  const pool = deps.parts.accounts
  const a = pool.get(id)
  if (a.kind === 'relay') throw new Error('The relay has no check yet')
  pool.setState(id, 'checking', 'Vérification en cours (une petite question à Haiku, sur ton abonnement)')
  try {
    const out = await callModel(deps.parts, {
      account: pool.get(id),
      tier: 'fast',
      effort: 'low',
      pinnedModel: null,
      system: 'You check that this account works. Answer with the single word OK.',
      prompt: CHECK_PROMPT,
      channelId: null,
      videoId: null,
      orchTaskId: null,
      maxTokens: 20,
      signal: AbortSignal.timeout(90_000)
    })
    const ok = out.text.trim().length > 0
    pool.recordCall(id, ok)
    deps.parts.events.add('account', `${a.label}: check ${ok ? 'passed' : 'failed'} (${out.model})`)
    return pool.toApi(
      ok
        ? pool.setState(id, 'ready', `Connecté : ${out.model} a répondu « ${truncate(out.text.trim(), 40)} ».`, true)
        : pool.setState(id, 'failed', 'Réponse vide du CLI', false)
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    pool.recordCall(id, false)
    const login = NOT_LOGGED.test(message)
    deps.parts.events.add('account', `${a.label}: check failed (${truncate(message, 120)})`)
    return pool.toApi(
      pool.setState(id, login ? 'login' : 'failed', login ? `Pas encore connecté : ${truncate(message, 200)}` : `Échec : ${truncate(message, 240)}`, false)
    )
  }
}
