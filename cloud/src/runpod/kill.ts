// Kills a fake pod's worker and everything it started. The Cloud keeps its own copy (it never depends on the app's
// main-process tree): Windows = taskkill /T /F by its full path (never looked up on PATH); elsewhere the worker was
// spawned detached, so SIGKILL goes to its whole process group.
import { spawn } from 'node:child_process'
import { win32 } from 'node:path'

export function taskkillPath(systemRoot: string | undefined = process.env.SystemRoot ?? process.env.SYSTEMROOT): string {
  return win32.join(systemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')
}

export function killTree(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  run: (command: string, args: string[]) => void = (command, args) => {
    spawn(command, args, { stdio: 'ignore', windowsHide: true }).on('error', () => undefined)
  },
  signal: (pid: number, sig: NodeJS.Signals) => void = (p, s) => process.kill(p, s)
): void {
  if (platform === 'win32') {
    run(taskkillPath(), ['/PID', String(pid), '/T', '/F'])
    return
  }
  try {
    signal(-pid, 'SIGKILL')
  } catch {
    try {
      signal(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
}
