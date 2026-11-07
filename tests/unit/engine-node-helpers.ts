// Test helpers for the production nodes of lot P4: a RunCtx outside the scheduler, artefacts built by hand, and the
// host services of this machine (ffmpeg from PATH, temp working folders, the repo's resources). Tests that need ffmpeg
// skip with a clear reason when it is absent (`hasFfmpeg`); tests that draw, burn captions or render also skip when this
// ffmpeg lacks a filter or encoder they need (`hasFullFfmpeg`: Homebrew's plain `ffmpeg` is a slim build since 2026).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { trackTemp } from '../setup/track-temp'
import { createRunCtx, type AnyNodeDef, type Artefact, type ArtefactType, type Cost, type EngineServices, type Json, type NodeReport, type RunCtx, type RunCtxBase } from '../../src/engine'
import { DRAW_FILTERS } from '../../src/engine/media/draw'
import { DRAW_VIDEO_FILTERS } from '../../src/engine/media/draw-video'
import { locateTool, parseCapabilityList, RENDER_ENCODERS, RENDER_FILTERS, systemMediaService } from '../../src/engine/media/tools'

export const ROOT = path.join(__dirname, '..', '..')
export const RESOURCES = path.join(ROOT, 'resources')

/** ffmpeg + ffprobe of this machine, or null. */
const TOOL_ENV = { platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' }
export const MEDIA = systemMediaService(TOOL_ENV)
export const hasFfmpeg = MEDIA !== null
export const NO_FFMPEG = 'ffmpeg/ffprobe not found on PATH: media tests skipped'

/** The ffmpeg the engine uses here and what it lacks among what the drawings, the captions burn and the render need. */
export const FFMPEG_PATH = hasFfmpeg ? locateTool('ffmpeg', TOOL_ENV) : null
let FFMPEG_BROKEN: string | null = null
function capabilities(ffmpeg: string): Set<string> {
  const list = (what: string): string[] => {
    const r = spawnSync(ffmpeg, ['-hide_banner', '-v', 'error', what], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
    if (r.error || r.status !== 0) FFMPEG_BROKEN ??= r.error ? r.error.message : `exit ${String(r.status)}: ${(r.stderr ?? '').trim().slice(0, 200)}`
    return parseCapabilityList(r.stdout ?? '')
  }
  return new Set([...list('-filters'), ...list('-encoders')])
}
const CAPS = FFMPEG_PATH ? capabilities(FFMPEG_PATH) : new Set<string>()
export const FFMPEG_LACKS = FFMPEG_PATH ? [...new Set([...RENDER_FILTERS, ...RENDER_ENCODERS, ...DRAW_FILTERS, ...DRAW_VIDEO_FILTERS])].filter((n) => !CAPS.has(n)) : []
export const hasFullFfmpeg = hasFfmpeg && FFMPEG_LACKS.length === 0
export const NO_FULL_FFMPEG = !hasFfmpeg
  ? NO_FFMPEG
  : FFMPEG_BROKEN
    ? `${FFMPEG_PATH ?? 'ffmpeg'} did not run (${FFMPEG_BROKEN}): drawing/burn/render tests skipped`
    : `${FFMPEG_PATH ?? 'ffmpeg'} lacks ${FFMPEG_LACKS.join(', ')} (on a Mac: brew install ffmpeg-full): drawing/burn/render tests skipped`

/** A temp folder removed by `cleanup()`. */
export function tempDir(label: string): { dir: string; cleanup: () => void } {
  const dir = trackTemp(mkdtempSync(path.join(os.tmpdir(), `atelier-p4-${label}-`)))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
}

/** Host services for tests: workspace under `root`, media of this machine, library = the repo's resources. */
export function testServices(root: string, extra: Partial<EngineServices> = {}): EngineServices {
  let n = 0
  return {
    ...(MEDIA ? { media: MEDIA } : {}),
    workspace: {
      scratch: async (label) => {
        const d = path.join(root, 'scratch', `${String(++n).padStart(3, '0')}-${label}`)
        await mkdir(d, { recursive: true })
        return d
      },
      cache: async (kind) => {
        const d = path.join(root, 'cache', kind)
        await mkdir(d, { recursive: true })
        return d
      }
    },
    library: { root: RESOURCES },
    ...extra
  }
}

export interface TestCtx extends RunCtx {
  reports: NodeReport[]
}

/**
 * A RunCtx for calling a node's `run` / `fake` directly, built like the scheduler's (`createRunCtx`): `minutes` and
 * `budgetMode` are readable only when `node` declares them in `reads`, so a missing declaration fails here too.
 */
export function makeCtx(
  services: EngineServices,
  o: Partial<Pick<RunCtx, 'seed' | 'budgetMode' | 'minutes' | 'notes' | 'where'>> & {
    signal?: AbortSignal
    node?: Pick<AnyNodeDef, 'type' | 'reads'>
    /** Collects what the node reports it really used. */
    costs?: Cost[]
  } = {}
): TestCtx {
  const reports: NodeReport[] = []
  const base: RunCtxBase = {
    emit: (r) => reports.push(r),
    signal: o.signal ?? new AbortController().signal,
    store: { read: () => Promise.resolve(null) },
    seed: o.seed ?? 0,
    where: o.where ?? 'local',
    attempt: 1,
    notes: o.notes ?? [],
    reportCost: (c) => void o.costs?.push(c),
    services
  }
  const ctx = createRunCtx(o.node ?? { type: 'test.node@1' }, base, { minutes: o.minutes ?? 1, budgetMode: o.budgetMode ?? 'usage_max' })
  return Object.assign(ctx, { reports })
}

let fpCounter = 0
/** An artefact as a node receives it. */
export function art(type: ArtefactType, o: { value?: Json; files?: string[]; meta?: Record<string, Json> }): Artefact {
  return { type, fingerprint: (++fpCounter).toString(16).padStart(64, '0'), ...o }
}
