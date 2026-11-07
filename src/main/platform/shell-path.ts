// The search path of Charlie's login shell. A macOS app started from the Finder or the Dock gets launchd's minimal
// PATH (/usr/bin:/bin:/usr/sbin:/sbin): no Homebrew (/opt/homebrew/bin: node, uv, python3, ffmpeg) and no
// ~/.local/bin (claude). At startup Atelier asks the login shell once for its PATH (`$SHELL -ilc`, a fixed command,
// nothing interpolated) and merges it into its own; the usual folders are added as a fallback if the shell does not
// answer. Windows keeps its PATH as is.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { killTree } from './process'

const MARK = '__ATELIER_PATH__'
/** Printed by the login shell; the markers cut out whatever its rc files print around it. */
export const SHELL_PATH_COMMAND = `printf '${MARK}%s${MARK}' "$PATH"`
const SHELL_TIMEOUT_MS = 5000

/** Shells Atelier agrees to run for the probe (`$SHELL` must be one of them, else /bin/zsh, macOS's default). */
const KNOWN_SHELL = /^\/(?:usr\/(?:local\/)?|opt\/homebrew\/)?bin\/(?:zsh|bash|sh|fish|ksh|dash)$/

export interface ShellPathEnv {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: string
  /** Runs `shell args…` without a shell of its own and resolves with its stdout (rejects on error or timeout). */
  run?: (shell: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>
  exists?: (p: string) => boolean
}

/** Folders added after the shell's own when they exist: where Homebrew, uv and the claude installer put binaries. */
export function fallbackDirs(home: string): string[] {
  return ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', path.posix.join(home, '.local', 'bin')]
}

/** The shell to ask: `$SHELL` when it is a known shell at a standard place, else /bin/zsh. */
export function loginShell(env: NodeJS.ProcessEnv): string {
  const shell = env.SHELL ?? ''
  return KNOWN_SHELL.test(shell) ? shell : '/bin/zsh'
}

/** The text between the markers, or null (a shell that printed nothing usable). */
export function parseShellPath(stdout: string): string | null {
  const start = stdout.indexOf(MARK)
  if (start < 0) return null
  const end = stdout.indexOf(MARK, start + MARK.length)
  if (end < 0) return null
  const value = stdout.slice(start + MARK.length, end).trim()
  return value && !value.includes('\n') ? value : null
}

/** Joins PATH lists in order, keeping the first copy of each absolute folder. */
export function mergePath(...lists: (string | null | undefined)[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const dir of (list ?? '').split(':')) {
      if (!dir.startsWith('/') || seen.has(dir)) continue
      seen.add(dir)
      out.push(dir)
    }
  }
  return out.join(':')
}

/**
 * Runs the probe in its own session (`detached`: setsid, no controlling terminal) with stdin closed. Started from a
 * terminal (npm run dev, the e2e tests), an interactive zsh would otherwise grab the tty and stop itself (SIGTTIN).
 * A shell that does not answer in time is killed with its whole process group (an interactive shell ignores SIGTERM).
 */
export const runShell = (
  shell: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = SHELL_TIMEOUT_MS,
  spawnFn: typeof spawn = spawn
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawnFn(shell, args, { env, detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    let settled = false
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => {
      if (out.length < 1024 * 1024) out += d
    })
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    // The timeout settles the promise itself: something started by the rc files may have left the process group and
    // still hold stdout open, in which case 'close' would never fire and the app would never open.
    const timer = setTimeout(() => {
      finish(() => {
        if (child.pid !== undefined) killTree(child.pid, process.platform)
        child.stdout.removeAllListeners('data')
        child.stdout.destroy()
        reject(new Error(`no answer within ${timeoutMs / 1000} s`))
      })
    }, timeoutMs)
    child.on('error', (err) => finish(() => reject(err)))
    child.on('close', (code) =>
      finish(() => {
        if (code !== 0 && !out) reject(new Error(`exited with code ${String(code)}`))
        else resolve(out)
      })
    )
  })

export interface ShellPathResult {
  /** The merged PATH (unchanged on Windows). */
  path: string | undefined
  /** Where it came from: the login shell, the fallback folders only, or untouched (Windows). */
  source: 'login-shell' | 'fallback' | 'unchanged'
  /** Why the shell gave nothing (logged once at startup). */
  error?: string
}

/**
 * The PATH Atelier and its children should use. macOS/Linux: the login shell's PATH, then the current one, then the
 * fallback folders that exist. Never throws: a broken rc file or a slow shell only means the fallback.
 */
export async function resolveLoginPath(opts: ShellPathEnv): Promise<ShellPathResult> {
  const current = opts.env.PATH
  if (opts.platform === 'win32') return { path: current, source: 'unchanged' }
  const exists = opts.exists ?? existsSync
  const extras = fallbackDirs(opts.home).filter((d) => exists(d)).join(':')
  const shell = loginShell(opts.env)
  try {
    // Interactive + login, like Terminal: .zprofile (brew shellenv) and .zshrc both run. Oh-my-zsh's updater is
    // told to stay quiet so it never waits on a prompt.
    const env = { ...opts.env, DISABLE_AUTO_UPDATE: 'true', ZSH_DISABLE_COMPFIX: 'true' }
    const stdout = await (opts.run ?? runShell)(shell, ['-ilc', SHELL_PATH_COMMAND], env)
    const found = parseShellPath(stdout)
    if (found) return { path: mergePath(found, current, extras), source: 'login-shell' }
    return { path: mergePath(current, extras), source: 'fallback', error: `${shell} printed no PATH` }
  } catch (err) {
    return { path: mergePath(current, extras), source: 'fallback', error: `${shell}: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** Resolves the login PATH and writes it into `env` (process.env at startup) so every lookup and child sees it. */
export async function applyLoginPath(opts: ShellPathEnv): Promise<ShellPathResult> {
  const result = await resolveLoginPath(opts)
  if (result.path !== undefined && result.source !== 'unchanged') opts.env.PATH = result.path
  return result
}
