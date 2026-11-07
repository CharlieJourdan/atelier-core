// Finding binaries on the search path and killing process trees: taskkill on Windows, the process group elsewhere.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

export interface FindBinaryEnv {
  platform: NodeJS.Platform
  pathVar: string | undefined
  pathExt: string | undefined
  exists: (file: string) => boolean
}

const defaultEnv = (): FindBinaryEnv => ({
  platform: process.platform,
  pathVar: process.env.PATH ?? process.env.Path,
  pathExt: process.env.PATHEXT,
  exists: existsSync
})

/**
 * Looks up `name` on PATH. On Windows tries `.exe` first, then `.cmd` (npm shim), then other PATHEXT entries,
 * directory by directory, like the shell does. Returns the absolute path or null.
 */
export function findOnPath(name: string, env: FindBinaryEnv = defaultEnv()): string | null {
  const win = env.platform === 'win32'
  const p = win ? path.win32 : path.posix
  const dirs = (env.pathVar ?? '').split(win ? ';' : ':').filter(Boolean)
  const exts = win ? windowsExtensions(env.pathExt) : ['']
  for (const rawDir of dirs) {
    const dir = rawDir.replace(/^"(.*)"$/, '$1')
    for (const ext of exts) {
      const candidate = p.join(dir, name + ext)
      if (env.exists(candidate)) return candidate
    }
  }
  return null
}

function windowsExtensions(pathExt: string | undefined): string[] {
  const listed = (pathExt ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase()).filter(Boolean)
  const ordered = ['.exe', '.cmd', ...listed]
  return [...new Set(ordered)]
}

/** Full path of taskkill.exe: never looked up on the search path (a planted `taskkill` must not run). */
export function taskkillPath(systemRoot: string | undefined = process.env.SystemRoot ?? process.env.SYSTEMROOT): string {
  return path.win32.join(systemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')
}

export type KillRunner = (command: string, args: string[]) => void

const runDetached: KillRunner = (command, args) => {
  const child = spawn(command, args, { stdio: 'ignore', windowsHide: true })
  child.on('error', () => undefined)
}

/**
 * Kills a process and all its children. Windows: `taskkill /PID <pid> /T /F`. Elsewhere the child must have
 * been spawned `detached` (its own process group) and the whole group gets SIGKILL.
 */
export function killTree(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  run: KillRunner = runDetached,
  killGroup: (pid: number, signal: NodeJS.Signals) => void = (p, s) => process.kill(p, s)
): void {
  if (platform === 'win32') {
    run(taskkillPath(), ['/PID', String(pid), '/T', '/F'])
    return
  }
  try {
    killGroup(-pid, 'SIGKILL')
  } catch {
    try {
      killGroup(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
}

const runSync: KillRunner = (command, args) => {
  try {
    execFileSync(command, args, { stdio: 'ignore', windowsHide: true, timeout: 10_000 })
  } catch {
    // already gone (taskkill exits 128), or it could not be killed: nothing more to do at quit
  }
}

/** Like killTree, but returns only once taskkill has finished (quitting: nothing may outlive the app). */
export function killTreeSync(pid: number, platform: NodeJS.Platform = process.platform, run: KillRunner = runSync): void {
  killTree(pid, platform, run)
}
