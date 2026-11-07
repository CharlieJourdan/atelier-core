// Opening a terminal window where the user signs a CLI in HIMSELF (« Ajouter mon compte Claude Code / Codex »). Atelier
// only sets the account's own config folder in the window's environment (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) and runs the
// CLI; the sign-in happens between the user and the CLI, and Atelier never reads, copies or stores what the CLI writes in
// that folder. Windows: a new console (`cmd.exe /c start … cmd.exe /k <cli>`, full path of cmd.exe). macOS: Terminal.app
// through `osascript`. Linux (the team computer): an X terminal on its remote screen when there is a display, else
// nothing is opened and the command is shown to type in the remote screen's terminal.
import { spawn as nodeSpawn } from 'node:child_process'
import path from 'node:path'

export type LoginKind = 'claude-code' | 'codex'

export interface TerminalRequest {
  kind: LoginKind
  configDir: string
  title: string
}

export interface TerminalLauncher {
  /** True when a window was opened. Never throws: a failure means « type the command yourself ». */
  open(req: TerminalRequest): Promise<boolean>
}

export interface TerminalPlatform {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  spawn?: (
    command: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; cwd: string; detached: boolean; stdio: 'ignore'; windowsHide: boolean; windowsVerbatimArguments: boolean }
  ) => { unref(): void; on(e: 'error', f: (err: Error) => void): void }
}

export const ENV_OF: Record<LoginKind, string> = { 'claude-code': 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' }
const CLI_OF: Record<LoginKind, string> = { 'claude-code': 'claude', codex: 'codex login' }

const sq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

/** The command line to type by hand (shown in Réglages and in docs for the team computer). */
export function loginCommand(kind: LoginKind, configDir: string, platform: NodeJS.Platform): string {
  const v = ENV_OF[kind]
  if (platform === 'win32') return `$env:${v}="${configDir}"; ${CLI_OF[kind]}`
  return `${v}=${sq(configDir)} ${CLI_OF[kind]}`
}

/**
 * What the Windows launcher runs: `cmd.exe /d /c start "<title>" cmd.exe /k <cli>`, passed verbatim (start reads its own
 * quotes; the folder comes through the environment, never on the command line).
 */
export function windowsArgs(kind: LoginKind, title: string): string[] {
  return ['/d', '/c', 'start', `"${title.replace(/["^&|<>%]/g, '')}"`, 'cmd.exe', '/k', CLI_OF[kind]]
}

/** The AppleScript that opens Terminal.app on the CLI with its folder. */
export function macScript(kind: LoginKind, configDir: string): string {
  const shell = `export ${ENV_OF[kind]}=${sq(configDir)}; ${CLI_OF[kind]}`
  const escaped = shell.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `tell application "Terminal"\nactivate\ndo script "${escaped}"\nend tell`
}

export function systemTerminal(p: TerminalPlatform): TerminalLauncher {
  const spawn = p.spawn ?? ((c, a, o) => nodeSpawn(c, a, o))
  const run = (command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, verbatim = false): Promise<boolean> =>
    new Promise((resolve) => {
      try {
        const child = spawn(command, args, { env, cwd, detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: verbatim })
        child.on('error', () => resolve(false))
        child.unref()
        setTimeout(() => resolve(true), 50)
      } catch {
        resolve(false)
      }
    })
  return {
    open: async (req) => {
      const env = { ...p.env, [ENV_OF[req.kind]]: req.configDir }
      // The subscription login must be used, never a stray API key of the environment.
      delete env.ANTHROPIC_API_KEY
      delete env.OPENAI_API_KEY
      if (p.platform === 'win32') {
        const cmd = path.win32.join(p.env.SystemRoot ?? p.env.windir ?? 'C:\\Windows', 'System32', 'cmd.exe')
        return run(cmd, windowsArgs(req.kind, req.title), env, req.configDir, true)
      }
      if (p.platform === 'darwin') return run('/usr/bin/osascript', ['-e', macScript(req.kind, req.configDir)], env, req.configDir)
      if (!p.env.DISPLAY) return false
      return run('x-terminal-emulator', ['-e', 'sh', '-c', `${CLI_OF[req.kind]}; exec sh`], env, req.configDir)
    }
  }
}
