// The system ffmpeg / ffprobe (PLAN-V2-PRODUCTION §6.4: v2 uses the system's, Homebrew on the Mac). The host gives the
// PATH it computed (on macOS the login shell's, src/main/platform/shell-path.ts); this module looks the tools up in it,
// plus the usual Homebrew folders, and runs them with `spawn` (never a shell), killed by the run's AbortSignal.
// Homebrew's plain `ffmpeg` formula is a slim build since 2026 (no libass, no freetype: no `ass`, no `drawtext`); the
// complete one is `ffmpeg-full`, keg-only (never linked into /opt/homebrew/bin). Installing it is an explicit choice for
// this kind of work, so on macOS its folder comes before PATH.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { AbortError, EngineError } from '../errors'
import type { MediaService, ToolResult } from '../services'

export interface LocateEnv {
  platform: NodeJS.Platform
  /** The PATH to search (Windows: `;`-separated, else `:`). */
  pathEnv: string
  exists?: (p: string) => boolean
}

/** Folders searched after PATH on macOS (Apple Silicon and Intel Homebrew). */
export const MAC_TOOL_DIRS = ['/opt/homebrew/bin', '/usr/local/bin']

/** Folders of Homebrew's keg-only `ffmpeg-full`, searched before PATH on macOS (Apple Silicon, then Intel). */
export const MAC_FULL_FFMPEG_DIRS = ['/opt/homebrew/opt/ffmpeg-full/bin', '/usr/local/opt/ffmpeg-full/bin']

/** What to install when ffmpeg lacks something (French, shown to Charlie). */
export const FULL_FFMPEG_HINT = 'sur Mac : « brew install ffmpeg-full »'

/** Absolute path of `name` (`ffmpeg`), or null. Windows adds `.exe`; macOS looks in Homebrew's `ffmpeg-full` first
 * (for ffmpeg and ffprobe only), then PATH, then the Homebrew folders. */
export function locateTool(name: string, env: LocateEnv): string | null {
  const win = env.platform === 'win32'
  const p = win ? path.win32 : path.posix
  const exists = env.exists ?? existsSync
  const dirs = env.pathEnv.split(win ? ';' : ':').filter((d) => d && p.isAbsolute(d))
  if (env.platform === 'darwin') {
    for (const d of MAC_TOOL_DIRS) if (!dirs.includes(d)) dirs.push(d)
    if (name === 'ffmpeg' || name === 'ffprobe') dirs.unshift(...MAC_FULL_FFMPEG_DIRS.filter((d) => !dirs.includes(d)))
  }
  const file = win && !name.toLowerCase().endsWith('.exe') ? `${name}.exe` : name
  for (const d of dirs) {
    const full = p.join(d, file)
    if (exists(full)) return full
  }
  return null
}

/** Keeps the end of a long stderr (ffmpeg is verbose; the end holds the error). */
const tail = (s: string, max = 4000): string => (s.length > max ? s.slice(-max) : s)

function feed(child: ReturnType<typeof spawn>, stdin: AsyncIterable<Uint8Array> | Uint8Array | undefined): void {
  const sink = child.stdin
  if (!sink) return
  sink.on('error', () => undefined) // the tool may close its input early (EPIPE): its exit code tells the story
  if (stdin === undefined) {
    sink.end()
    return
  }
  if (stdin instanceof Uint8Array) {
    sink.end(stdin)
    return
  }
  void (async () => {
    try {
      for await (const chunk of stdin) {
        if (!sink.write(chunk)) await new Promise<void>((r) => sink.once('drain', r))
      }
    } catch {
      child.kill()
    } finally {
      sink.end()
    }
  })()
}

/** The default media service: the two tools at these paths. */
export function createMediaService(paths: { ffmpeg: string; ffprobe: string }): MediaService {
  const start = (tool: 'ffmpeg' | 'ffprobe', args: string[], signal: AbortSignal) => {
    if (signal.aborted) throw new AbortError()
    const child = spawn(paths[tool], tool === 'ffmpeg' ? ['-hide_banner', '-nostdin', ...args] : args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    const onAbort = (): void => void child.kill('SIGKILL')
    signal.addEventListener('abort', onAbort, { once: true })
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    const done = new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      child.on('error', (e) => reject(e))
      child.on('close', (code) => {
        signal.removeEventListener('abort', onAbort)
        resolve({ code, stderr })
      })
    })
    return { child, done, addStderr: (s: string) => (stderr = tail(stderr + s, 64_000)) }
  }
  const check = async (tool: string, p: Promise<{ code: number | null; stderr: string }>, signal: AbortSignal): Promise<string> => {
    let r: { code: number | null; stderr: string }
    try {
      r = await p
    } catch (e) {
      if (signal.aborted) throw new AbortError()
      throw new EngineError('missing_tool', `${tool} n’a pas pu démarrer (${(e as Error).message}).`)
    }
    if (signal.aborted) throw new AbortError()
    if (r.code !== 0) throw new EngineError('internal', `${tool} failed (exit ${String(r.code)}): ${tail(r.stderr, 1500)}`)
    return r.stderr
  }
  return {
    async run(tool, args, opts) {
      const { child, done, addStderr } = start(tool, args, opts.signal)
      const out: Buffer[] = []
      child.stdout?.on('data', (d: Buffer) => out.push(d))
      let pending = ''
      child.stderr?.on('data', (d: string) => {
        addStderr(d)
        if (!opts.onStderrLine) return
        pending += d
        const lines = pending.split(/\r?\n|\r/)
        pending = lines.pop() ?? ''
        for (const l of lines) opts.onStderrLine(l)
      })
      feed(child, opts.stdin)
      const stderr = await check(tool, done, opts.signal)
      return { stdout: Buffer.concat(out), stderr } satisfies ToolResult
    },
    stream(tool, args, opts) {
      const { child, done, addStderr } = start(tool, args, opts.signal)
      child.stderr?.on('data', (d: string) => addStderr(d))
      feed(child, undefined)
      const stdout = child.stdout as unknown as AsyncIterable<Uint8Array>
      return { stdout, done: check(tool, done, opts.signal).then((stderr) => ({ stdout: Buffer.alloc(0), stderr })) }
    }
  }
}

/** Filters the render and the demo pictures need; a slimmed ffmpeg build without them fails early and clearly. */
export const RENDER_FILTERS = ['ass', 'drawtext', 'gradients', 'xfade', 'perspective', 'loudnorm', 'amix', 'alimiter', 'atempo']

/** Encoders the render needs (H.264 video, AAC audio, FLAC intermediates). */
export const RENDER_ENCODERS = ['libx264', 'aac', 'flac']

const checked = new WeakMap<MediaService, Promise<string[]>>()

/** Names listed by `ffmpeg -filters` or `-encoders` (` flags  name  description` lines). */
export const parseCapabilityList = (stdout: string): string[] =>
  stdout
    .split('\n')
    .map((l) => /^\s*\S+\s+(\S+)\s/.exec(l)?.[1] ?? '')
    .filter(Boolean)

/** Fails with `missing_tool` (French) when this ffmpeg lacks one of `names`, filters or encoders (checked once per
 * media service). */
export async function requireFilters(media: MediaService, names: readonly string[], signal: AbortSignal): Promise<void> {
  let list = checked.get(media)
  if (!list) {
    const listOf = (what: '-filters' | '-encoders'): Promise<string[]> => media.run('ffmpeg', ['-v', 'error', what], { signal }).then((r) => parseCapabilityList(r.stdout.toString('utf8')))
    list = Promise.all([listOf('-filters'), listOf('-encoders')]).then(([f, e]) => [...f, ...e])
    checked.set(media, list)
    list.catch(() => checked.delete(media))
  }
  const have = new Set(await list)
  const missing = names.filter((n) => !have.has(n))
  if (missing.length > 0) {
    throw new EngineError('missing_tool', `Ton ffmpeg n’a pas tout ce qu’il faut (${missing.join(', ')}) : installe une version complète (${FULL_FFMPEG_HINT}).`)
  }
}

/** The media service for this machine, or null when ffmpeg or ffprobe is missing (the nodes then fail clearly). */
export function systemMediaService(env: LocateEnv): MediaService | null {
  const ffmpeg = locateTool('ffmpeg', env)
  const ffprobe = locateTool('ffprobe', env)
  return ffmpeg && ffprobe ? createMediaService({ ffmpeg, ffprobe }) : null
}
