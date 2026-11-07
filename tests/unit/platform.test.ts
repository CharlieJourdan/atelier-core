// src/main/platform: login-shell PATH, the local-folder rule, process-tree kill and the native
// chrome, each with a simulated macOS (and Windows for contrast). No real shell, process or file is touched.
import type { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { chromeColors, trayBitmap, usesTemplateTrayIcon, windowChrome } from '../../src/main/platform/chrome'
import { checkLocalFolder, looksLocal } from '../../src/main/platform/paths'
import { findOnPath, killTree, killTreeSync } from '../../src/main/platform/process'
import {
  applyLoginPath,
  fallbackDirs,
  loginShell,
  mergePath,
  parseShellPath,
  resolveLoginPath,
  SHELL_PATH_COMMAND
} from '../../src/main/platform/shell-path'

const HOME = '/Users/charlie'
const LAUNCHD_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
const SHELL_OUT = `Last login: today\n__ATELIER_PATH__/opt/homebrew/bin:/Users/charlie/.local/bin:/usr/bin:/bin__ATELIER_PATH__`

describe('login shell PATH (macOS app started from the Finder)', () => {
  it('asks $SHELL -ilc with the fixed command and puts its PATH first, then the current one and the fallbacks', async () => {
    const calls: { shell: string; args: string[]; env: NodeJS.ProcessEnv }[] = []
    const env: NodeJS.ProcessEnv = { PATH: LAUNCHD_PATH, SHELL: '/bin/zsh', HOME }
    const r = await applyLoginPath({
      platform: 'darwin',
      env,
      home: HOME,
      exists: (d) => d === '/usr/local/bin' || d === '/opt/homebrew/bin',
      run: async (shell, args, e) => {
        calls.push({ shell, args, env: e })
        return SHELL_OUT
      }
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.shell).toBe('/bin/zsh')
    expect(calls[0]!.args).toEqual(['-ilc', SHELL_PATH_COMMAND])
    // Nothing of Atelier's is interpolated into the command: it only prints $PATH between markers.
    expect(SHELL_PATH_COMMAND).toBe(`printf '__ATELIER_PATH__%s__ATELIER_PATH__' "$PATH"`)
    expect(calls[0]!.env.DISABLE_AUTO_UPDATE).toBe('true')
    expect(r.source).toBe('login-shell')
    expect(r.path).toBe('/opt/homebrew/bin:/Users/charlie/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin')
    // Written into the environment every later lookup (claude, uv, ffmpeg) and child reads.
    expect(env.PATH).toBe(r.path)
    expect(findOnPath('claude', { platform: 'darwin', pathVar: env.PATH, pathExt: undefined, exists: (f) => f === '/Users/charlie/.local/bin/claude' })).toBe(
      '/Users/charlie/.local/bin/claude'
    )
  })

  it('falls back to the usual folders when the shell fails, times out or prints nothing', async () => {
    const exists = (d: string): boolean => d !== '/opt/homebrew/sbin'
    const failed = await resolveLoginPath({
      platform: 'darwin',
      env: { PATH: LAUNCHD_PATH },
      home: HOME,
      exists,
      run: () => Promise.reject(new Error('timed out'))
    })
    expect(failed.source).toBe('fallback')
    expect(failed.error).toContain('timed out')
    expect(failed.path).toBe(`${LAUNCHD_PATH}:/opt/homebrew/bin:/usr/local/bin:${HOME}/.local/bin`)
    const silent = await resolveLoginPath({ platform: 'darwin', env: { PATH: LAUNCHD_PATH }, home: HOME, exists, run: async () => 'oh-my-zsh says hi' })
    expect(silent).toMatchObject({ source: 'fallback', error: '/bin/zsh printed no PATH' })
    // No PATH at all (launchd edge case): the fallbacks alone.
    const none = await resolveLoginPath({ platform: 'darwin', env: {}, home: HOME, exists: () => true, run: async () => '' })
    expect(none.path).toBe(fallbackDirs(HOME).join(':'))
  })

  it('leaves Windows alone (no shell is run)', async () => {
    const env: NodeJS.ProcessEnv = { PATH: 'C:\\Windows' }
    let ran = false
    const r = await applyLoginPath({ platform: 'win32', env, home: 'C:\\Users\\c', run: async () => ((ran = true), '') })
    expect(r).toEqual({ path: 'C:\\Windows', source: 'unchanged' })
    expect(ran).toBe(false)
    expect(env.PATH).toBe('C:\\Windows')
  })

  it('only runs a known shell from a standard folder; anything else means /bin/zsh', () => {
    expect(loginShell({ SHELL: '/bin/bash' })).toBe('/bin/bash')
    expect(loginShell({ SHELL: '/opt/homebrew/bin/fish' })).toBe('/opt/homebrew/bin/fish')
    expect(loginShell({ SHELL: '/usr/local/bin/zsh' })).toBe('/usr/local/bin/zsh')
    expect(loginShell({})).toBe('/bin/zsh')
    expect(loginShell({ SHELL: '/tmp/evil/zsh' })).toBe('/bin/zsh')
    expect(loginShell({ SHELL: 'zsh' })).toBe('/bin/zsh')
    expect(loginShell({ SHELL: '/bin/zsh -c rm' })).toBe('/bin/zsh')
  })

  it('parses the marked PATH out of noisy output and merges lists without duplicates or relative folders', () => {
    expect(parseShellPath(SHELL_OUT)).toBe('/opt/homebrew/bin:/Users/charlie/.local/bin:/usr/bin:/bin')
    expect(parseShellPath('__ATELIER_PATH__')).toBeNull()
    expect(parseShellPath('__ATELIER_PATH____ATELIER_PATH__')).toBeNull()
    expect(parseShellPath('__ATELIER_PATH__/a\n/b__ATELIER_PATH__')).toBeNull()
    expect(mergePath('/a:/b', '/b:.:bin:/c', undefined, null, '/a')).toBe('/a:/b:/c')
  })
})

describe('a work folder must be local (Windows)', () => {
  it('refuses UNC paths and folders whose real path is a network share (moved from review 1 #12)', () => {
    const real = (p: string) => p
    const win = { platform: 'win32' as const, realpath: real }
    expect(() => checkLocalFolder('\\\\server\\share\\work', win)).toThrow('disque local')
    expect(() => checkLocalFolder('\\\\?\\UNC\\server\\share', win)).toThrow('disque local')
    expect(() => checkLocalFolder('C:\\dev\\link', { platform: 'win32', realpath: () => '\\\\server\\share\\work' })).toThrow('chemin réseau')
    expect(() => checkLocalFolder('C:\\dev\\work', win)).not.toThrow()
  })
})

describe('a work folder must be local (macOS)', () => {
  const mac = { platform: 'darwin' as const, home: HOME, tmp: '/var/folders/ab/xyz/T', realpath: (p: string) => p }

  it('accepts a folder under the home folder and under the user temp folder (real path)', () => {
    expect(() => checkLocalFolder('/Users/charlie/dev/atelier-work', mac)).not.toThrow()
    expect(() => checkLocalFolder('/Users/charlie', mac)).not.toThrow()
    // os.tmpdir() is /var/folders/…; its real path is /private/var/folders/…
    const real = (p: string): string => (p.startsWith('/var/') ? '/private' + p : p)
    expect(() => checkLocalFolder('/var/folders/ab/xyz/T/atelier-e2e-1/work-stub', { ...mac, realpath: real })).not.toThrow()
  })

  it('refuses network shares, external volumes, other users and symlinks that lead there', () => {
    expect(() => checkLocalFolder('/Volumes/share/work', mac)).toThrow('dans ton dossier personnel')
    expect(() => checkLocalFolder('/net/server/work', mac)).toThrow('dans ton dossier personnel')
    expect(() => checkLocalFolder('/Users/other/work', mac)).toThrow('dans ton dossier personnel')
    expect(() => checkLocalFolder('/Users/charlie2/work', mac)).toThrow('dans ton dossier personnel')
    expect(() => checkLocalFolder('/Users/charlie/link', { ...mac, realpath: (p) => (p === '/Users/charlie/link' ? '/Volumes/NAS/work' : p) })).toThrow('/Volumes/NAS/work')
    expect(() => checkLocalFolder('dev/atelier-work', mac)).toThrow('chemin absolu')
    expect(() =>
      checkLocalFolder('/Users/charlie/nope', {
        ...mac,
        realpath: () => {
          throw new Error('ENOENT')
        }
      })
    ).toThrow('n’existe pas')
  })

  it('never trusts the shared /tmp as the temp root (TMPDIR unset: os.tmpdir() is /tmp) (review A #6)', () => {
    for (const tmp of ['/tmp', '/tmp/', '/private/tmp']) {
      expect(() => checkLocalFolder('/tmp/work', { ...mac, tmp }), tmp).toThrow('dans ton dossier personnel')
      expect(() => checkLocalFolder('/private/tmp/work', { ...mac, tmp }), tmp).toThrow('dans ton dossier personnel')
      expect(looksLocal('/tmp/work', 'darwin', HOME, tmp), tmp).toBe(false)
      expect(looksLocal('/private/tmp/work', 'darwin', HOME, tmp), tmp).toBe(false)
    }
    // /tmp is a symlink to /private/tmp on macOS: its real path is refused as well
    const viaLink = (p: string): string => (p === '/tmp' ? '/private/tmp' : p)
    expect(() => checkLocalFolder('/private/tmp/work', { ...mac, tmp: '/tmp', realpath: viaLink })).toThrow('dans ton dossier personnel')
    // the home folder is still accepted with a shared tmp
    expect(() => checkLocalFolder('/Users/charlie/dev/atelier-work', { ...mac, tmp: '/tmp' })).not.toThrow()
  })

  it('the string-only check used before launching a saved folder', () => {
    expect(looksLocal('/Users/charlie/dev/atelier-work', 'darwin', HOME, '/var/folders/x/T')).toBe(true)
    expect(looksLocal('/Users/charlie/../other', 'darwin', HOME, '/var/folders/x/T')).toBe(false)
    expect(looksLocal('/private/var/folders/x/T/stub', 'darwin', HOME, '/var/folders/x/T')).toBe(true)
    expect(looksLocal('/Volumes/x', 'darwin', HOME, '/var/folders/x/T')).toBe(false)
    expect(looksLocal('C:\\dev\\other-project', 'win32')).toBe(true)
    expect(looksLocal('\\\\server\\share', 'win32')).toBe(false)
  })
})

describe('killing a process tree on macOS', () => {
  it('SIGKILLs the whole process group, never runs taskkill', () => {
    const ran: string[] = []
    const signals: [number, string][] = []
    killTree(321, 'darwin', (cmd) => ran.push(cmd), (pid, sig) => signals.push([pid, sig]))
    expect(signals).toEqual([[-321, 'SIGKILL']])
    expect(ran).toEqual([])
  })

  it('falls back to the pid when the group is gone, and never throws when both are', () => {
    const signals: number[] = []
    killTree(
      77,
      'darwin',
      () => undefined,
      (pid) => {
        signals.push(pid)
        throw new Error('ESRCH')
      }
    )
    expect(signals).toEqual([-77, 77])
  })

  it('the synchronous kill used at quit takes the same path (process.kill is synchronous)', () => {
    const ran: string[] = []
    // A pid that cannot exist: the group and pid kills both fail quietly.
    expect(() => killTreeSync(2 ** 22 + 12345, 'darwin', (cmd) => ran.push(cmd))).not.toThrow()
    expect(ran).toEqual([])
  })
})

describe('native chrome', () => {
  it('macOS: hiddenInset title bar (traffic lights inset), no Windows overlay', () => {
    expect(windowChrome('darwin')).toEqual({ titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 13 } })
    // Dark by default (the v2 default theme): no white overlay strip over the dark shell.
    expect(windowChrome('win32')).toEqual({ titleBarStyle: 'hidden', titleBarOverlay: { color: '#0C0C0E', symbolColor: '#F4F4F5', height: 40 } })
  })

  it('per-theme colours follow the tokens (dark #0C0C0E, light #FAFAF9); light overlay on Windows; none on macOS', () => {
    expect(chromeColors('dark')).toEqual({ background: '#0C0C0E', symbols: '#F4F4F5' })
    expect(chromeColors('light')).toEqual({ background: '#FAFAF9', symbols: '#0C0C0E' })
    expect(windowChrome('win32', 'light').titleBarOverlay).toEqual({ color: '#FAFAF9', symbolColor: '#0C0C0E', height: 40 })
    expect(windowChrome('darwin', 'light').titleBarOverlay).toBeUndefined()
    expect(windowChrome('darwin').titleBarOverlay).toBeUndefined()
  })

  it('macOS menu-bar icon: a template image, black pixels whose alpha draws the mark, at 1x and 2x', () => {
    expect(usesTemplateTrayIcon('darwin')).toBe(true)
    expect(usesTemplateTrayIcon('win32')).toBe(false)
    for (const size of [16, 32]) {
      const { buffer } = trayBitmap('darwin', size)
      expect(buffer.length).toBe(size * size * 4)
      let opaque = 0
      for (let i = 0; i < buffer.length; i += 4) {
        expect([buffer[i], buffer[i + 1], buffer[i + 2]]).toEqual([0, 0, 0])
        expect([0, 255]).toContain(buffer[i + 3])
        if (buffer[i + 3] === 255) opaque++
      }
      // The mark covers part of the square, not all of it, and the corners stay clear.
      expect(opaque).toBeGreaterThan(size * size * 0.08)
      expect(opaque).toBeLessThan(size * size * 0.5)
      expect(buffer[3]).toBe(0)
    }
  })

  it('Windows tray icon: opaque indigo square with transparent corners', () => {
    const { buffer } = trayBitmap('win32', 16)
    expect(buffer[3]).toBe(0)
    const centreBg = (2 * 16 + 8) * 4 // row 2 is above the mark
    expect(buffer[centreBg + 3]).toBe(255)
    expect([buffer[centreBg], buffer[centreBg + 1], buffer[centreBg + 2]]).toEqual([0xd6, 0x5c, 0x4f])
  })
})

describe('the real probe runner (a Node child stands in for the shell)', () => {
  it('returns stdout, rejects a silent failure, and kills a shell that does not answer in time', async () => {
    const { runShell } = await import('../../src/main/platform/shell-path')
    const node = process.execPath
    expect(await runShell(node, ['-e', 'process.stdout.write("__ATELIER_PATH__/a:/b__ATELIER_PATH__")'], process.env)).toContain('/a:/b')
    await expect(runShell(node, ['-e', 'process.exit(3)'], process.env)).rejects.toThrow('code 3')
    const t0 = Date.now()
    await expect(runShell(node, ['-e', 'setInterval(() => {}, 1000)'], process.env, 300)).rejects.toThrow('no answer within 0.3 s')
    expect(Date.now() - t0).toBeLessThan(5000)
    // killTree on Windows is a fire-and-forget taskkill: let it finish before the worker can exit, or the sleeper outlives the run
    if (process.platform === 'win32') await new Promise((r) => setTimeout(r, 1500))
  })

  it('rejects at the timeout even when stdout is held open and close never fires, and destroys stdout', { timeout: 2000 }, async () => {
    const { runShell } = await import('../../src/main/platform/shell-path')
    const { EventEmitter } = await import('node:events')
    const stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn(), destroy: vi.fn() })
    const child = Object.assign(new EventEmitter(), { stdout, pid: undefined })
    const fakeSpawn = (() => child) as unknown as typeof spawn
    const t0 = Date.now()
    await expect(runShell('/bin/zsh', ['-ilc', 'x'], {}, 50, fakeSpawn)).rejects.toThrow('no answer within 0.05 s')
    expect(Date.now() - t0).toBeLessThan(1500)
    expect(stdout.destroy).toHaveBeenCalledTimes(1)
    // A late 'close' after the timeout changes nothing (settled once).
    child.emit('close', 0)
  })
})
