// « Ajouter mon compte Claude Code / Codex »: a dedicated config folder per account, a terminal window where the user signs
// in HIMSELF (a fake launcher here: nothing opens), then the health check — one tiny Haiku prompt through the account's own
// CLI (the real ClaudeCodeProvider on a fake `claude` child) — and the account becomes ready and is used by the pool.
// Atelier never reads what the CLI writes in that folder. The platform launchers are checked as plain arguments.
import { trackTemp } from '../setup/track-temp'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { handleCall } from '../../src/main/ipc'
import { ClaudeCodeProvider } from '../../src/main/llm/claude-code'
import { FakeProvider } from '../../src/main/llm/fake'
import { fakeClaudeCli, scriptedReply } from '../../src/main/orchestra/fake-team'
import { AccountProviders } from '../../src/main/orchestra/providers'
import { loginCommand, macScript, systemTerminal, windowsArgs, type TerminalRequest } from '../../src/main/platform/terminal'
import { agentBySlug, drain, rig } from './orchestra-helpers'

function fakeTerminal() {
  const opened: TerminalRequest[] = []
  return { opened, launcher: { open: async (req: TerminalRequest) => (opened.push(req), true) } }
}

function cliRig(answer: (configDir: string | null, prompt: string, system: string) => { text: string } | { error: string }) {
  const cli = fakeClaudeCli((call) => answer(call.configDir, call.prompt, call.system))
  const seams = { platform: 'win32' as const, findBinary: () => 'C:\\fake\\claude.exe', spawn: cli.spawn, killTree: cli.kill, exitWaitMs: 50, removeDir: (d: string) => void trackTemp(d) }
  const ap = new AccountProviders({ defaultClaudeCode: new ClaudeCodeProvider({ ...seams, env: {} }), anthropic: new FakeProvider(), env: { PATH: 'x', ANTHROPIC_API_KEY: 'sk-ant-stray' }, claudeCode: seams })
  const term = fakeTerminal()
  const r = rig({ providerFor: ap.factory, core: { orchestra: { terminal: term.launcher } } })
  return { cli, r, term }
}

describe('adding a Claude Code account', () => {
  it('creates its own folder, opens the login terminal, then a Haiku check makes it ready and the pool uses it', async () => {
    const { cli, r, term } = cliRig((dir, prompt, system) => (dir && prompt.includes('Réponds seulement') ? { text: 'OK' } : { text: scriptedReply(system, prompt) }))
    const o = r.core.orchestra
    const login = await o.addCliAccount({ kind: 'claude-code' })
    expect(login.configDir).toBe(path.join(r.dataDir, 'accounts', 'claude-code-1'))
    expect(existsSync(login.configDir)).toBe(true)
    expect(login.launched).toBe(true)
    expect(term.opened).toEqual([{ kind: 'claude-code', configDir: login.configDir, title: 'Atelier - Claude Code · compte 2' }])
    expect(login.command).toBe(loginCommand('claude-code', login.configDir, process.platform))
    expect(login.note).toMatch(/tape \/login/)
    expect(login.account).toMatchObject({ label: 'Claude Code · compte 2', state: 'login', enabled: false, configDir: login.configDir })
    // the CLI writes its login there; Atelier never opens it
    writeFileSync(path.join(login.configDir, '.credentials.json'), '{"secret":"never-read"}')
    const checked = await o.checkAccount(login.account.id)
    expect(checked).toMatchObject({ state: 'ready', enabled: true })
    expect(checked.checkNote).toMatch(/claude-haiku-5-5 a répondu « OK »/)
    const call = cli.calls.at(-1)!
    expect(call.configDir).toBe(login.configDir)
    expect(call.args[call.args.indexOf('--model') + 1]).toBe('claude-haiku-5-5')
    expect(call.prompt).toBe('Réponds seulement : OK')
    expect(JSON.stringify(cli.calls)).not.toContain('never-read')
    expect(readdirSync(login.configDir)).toEqual(['.credentials.json'])
    // booked in the ledger like any call, on that account
    const row = r.core.db.prepare('SELECT account_id, model FROM ledger ORDER BY id DESC LIMIT 1').get() as { account_id: number; model: string }
    expect(row).toEqual({ account_id: login.account.id, model: 'claude-haiku-5-5' })
    // the default account switched off: the turn goes to the new one
    o.saveAccount({ id: 1, kind: 'claude-code', label: 'Claude Code (connexion par défaut)', enabled: false })
    const researcher = agentBySlug(r, `researcher-${r.channels[0]}`)
    o.enqueue({ assigneeId: researcher.id, kind: 'research', title: 'Sujets' })
    await drain(r)
    expect(cli.calls.at(-1)!.configDir).toBe(login.configDir)
    expect(o.tasks({ assigneeId: researcher.id })[0]!.status).toBe('done')
  })

  it('keeps the account waiting for the login when the CLI says so, and never uses it meanwhile', async () => {
    const { r } = cliRig(() => ({ error: 'Invalid API key · Please run /login' }))
    const o = r.core.orchestra
    const login = await o.addCliAccount({ kind: 'claude-code', label: 'Mon second compte' })
    const after = await o.checkAccount(login.account.id)
    expect(after).toMatchObject({ state: 'login', enabled: false })
    expect(after.checkNote).toMatch(/^Pas encore connecté/)
    // a second account gets the next folder; the terminal can be opened again
    const second = await o.addCliAccount({ kind: 'claude-code' })
    expect(path.basename(second.configDir)).toBe('claude-code-2')
    expect((await o.openLogin(login.account.id)).configDir).toBe(login.configDir)
    await expect(o.openLogin(1)).rejects.toThrow(/default login/)
  })

  it('adds a Codex account with CODEX_HOME through the same calls over IPC', async () => {
    const term = fakeTerminal()
    const r = rig({ core: { orchestra: { terminal: term.launcher } } })
    const res = await handleCall(r.core.api, 'orchestra.addCliAccount', [{ kind: 'codex' }])
    expect(res.ok).toBe(true)
    const v = (res as { ok: true; value: { configDir: string; account: { kind: string; state: string } } }).value
    expect(v.account).toMatchObject({ kind: 'codex', state: 'login' })
    expect(path.basename(v.configDir)).toBe('codex-1')
    expect(term.opened[0]).toMatchObject({ kind: 'codex', configDir: v.configDir })
    expect((await handleCall(r.core.api, 'orchestra.addCliAccount', [{ kind: 'anthropic' }])).ok).toBe(false)
  })
})

describe('the login terminal on each platform', () => {
  it('writes the commands to type by hand', () => {
    expect(loginCommand('claude-code', 'C:\\Users\\c\\acc', 'win32')).toBe('$env:CLAUDE_CONFIG_DIR="C:\\Users\\c\\acc"; claude')
    expect(loginCommand('codex', "/home/atelier/acc o'k", 'linux')).toBe("CODEX_HOME='/home/atelier/acc o'\\''k' codex login")
    expect(windowsArgs('claude-code', 'Atelier "x" & y')).toEqual(['/d', '/c', 'start', '"Atelier x  y"', 'cmd.exe', '/k', 'claude'])
    expect(macScript('claude-code', '/Users/c/acc')).toBe('tell application "Terminal"\nactivate\ndo script "export CLAUDE_CONFIG_DIR=\'/Users/c/acc\'; claude"\nend tell')
  })

  it('opens cmd.exe by full path with the folder in its environment (no stray API key), nothing on a screenless Linux', async () => {
    const spawned: { command: string; args: string[]; env: NodeJS.ProcessEnv; verbatim: boolean }[] = []
    const spawn = (command: string, args: string[], o: { env: NodeJS.ProcessEnv; windowsVerbatimArguments: boolean }) => {
      spawned.push({ command, args, env: o.env, verbatim: o.windowsVerbatimArguments })
      return { unref: () => undefined, on: () => undefined }
    }
    const win = systemTerminal({ platform: 'win32', env: { SystemRoot: 'C:\\Windows', ANTHROPIC_API_KEY: 'sk-ant-x' }, spawn })
    expect(await win.open({ kind: 'claude-code', configDir: 'C:\\acc', title: 'Atelier' })).toBe(true)
    expect(spawned[0]).toMatchObject({ command: 'C:\\Windows\\System32\\cmd.exe', verbatim: true })
    expect(spawned[0]!.env.CLAUDE_CONFIG_DIR).toBe('C:\\acc')
    expect(spawned[0]!.env.ANTHROPIC_API_KEY).toBeUndefined()
    const mac = systemTerminal({ platform: 'darwin', env: {}, spawn })
    await mac.open({ kind: 'codex', configDir: '/Users/c/x', title: 'Atelier' })
    expect(spawned[1]).toMatchObject({ command: '/usr/bin/osascript' })
    expect(spawned[1]!.env.CODEX_HOME).toBe('/Users/c/x')
    expect(await systemTerminal({ platform: 'linux', env: {}, spawn }).open({ kind: 'codex', configDir: '/x', title: 'A' })).toBe(false)
    expect(spawned).toHaveLength(2)
  })
})
