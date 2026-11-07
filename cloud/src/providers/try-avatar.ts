// `npm run cloud -- providers try talkingAvatar --engine presenter:… --image P.png --audio V.mp3 [--resolution 480p|720p] [--bench]
// [--budget-usd 20] [--out DIR] [--team TEAM_ID]`: ONE real presenter generation, by hand, outside the wallet, to check an engine
// (and, with --bench on the open model, to measure what a rented GPU really costs: decision 0015 allows 20 USD in all, run by
// Charlie). It refuses unless the engine is really live (paidCalls on, the engine in config.json `realEngines`, its key in the
// vault; the GPU engine also needs its RunPod endpoint), PRINTS « Coût maximum : X $ (plafond B $) » before the first provider call,
// asks nothing, and never runs anything that could cost more than that maximum.
//   - The image and the audio are put in the Cloud's own storage (a team's artefacts) and given to the adapter as artefacts: a
//     provider reads them through a short signed link (an S3/R2 bucket's presigned link, else the Cloud's own `publicUrl`, which
//     must then be reachable from the internet while the benchmark runs). Decision 0025: never an anonymous public host.
//   - Not bench: at most 60 s of audio.
//   - Bench (InfiniteTalk GPU only): a fixed series, 10 s at 480p, 10 s at 720p, 30 s at 720p, 60 s at 720p, cut from the start of
//     the given audio with ffmpeg (steps longer than the audio are left out), run one after the other. Each job's executionTimeout
//     is computed from the budget REMAINING after the previous ones (benchTimeoutS), so the total can never pass --budget-usd.
//     A report goes to --out: bench.json and a printed table (GPU seconds per video second, dollars per minute of video, cold start).
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { USAGE_INPUTS } from '../../../src/shared/cloud-api.ts'
import { defaultResolution, isPresenterEngine, PRESENTER_ENGINE_CAN, PRESENTER_RESOLUTIONS, type PresenterEngine, type PresenterResolution } from '../../../src/shared/presenter-engines.ts'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import { REMOTE_LINK_TTL_S } from '../jobs.ts'
import { mimeFor, SAFE_NAME } from '../storage.ts'
import type { HttpOptions } from './http.ts'
import { gpuUsdPerSecond, INFINITETALK_ENGINE, infinitetalkGpuAdapter, maxJobCostUsd, type InfinitetalkSettings } from './infinitetalk-gpu.ts'
import { engineCostUsd } from './presenter-common.ts'
import { WAVESPEED_MODELS, wavespeedBilledSecondsFor } from './wavespeed.ts'
import { runUsage, type ProviderAdapter } from './types.ts'

export const TRY_AVATAR_MAX_S = 60
export const BENCH_HARD_MAX_USD = 20
export const BENCH_DEFAULT_USD = 20

export interface BenchStep {
  label: string
  resolution: PresenterResolution
  seconds: number
  /** The part of the whole budget this job may spend at most (the shares add up to 1): the first job can never eat the others' money. */
  share: number
}
/** The fixed series of the benchmark (shortest first, so a model that is far too slow costs little before it is seen). */
export const BENCH_STEPS: readonly BenchStep[] = [
  { label: '10 s 480p', resolution: '480p', seconds: 10, share: 0.15 },
  { label: '10 s 720p', resolution: '720p', seconds: 10, share: 0.2 },
  { label: '30 s 720p', resolution: '720p', seconds: 30, share: 0.25 },
  { label: '60 s 720p', resolution: '720p', seconds: 60, share: 0.4 }
]

export interface BenchLimits {
  budgetUsd: number
  usdPerGpuSecond: number
  /** Cold-start seconds counted on top of the execution time of every job. */
  coldReserveS: number
  /** The longest one job may run, whatever the budget. */
  perJobCapS: number
}

/** The shortest executionTimeout RunPod takes (5 s): below it a job is not started. */
export const MIN_TIMEOUT_S = 5

/**
 * The executionTimeout (seconds) of the next job: what the budget that REMAINS can pay (and the job's own share of the whole budget),
 * after the cold-start reserve, capped per job; 0 when not even a minimal job fits. PURE.
 */
export function benchTimeoutS(remainingUsd: number, lim: BenchLimits, share = 1): number {
  const usable = Math.min(remainingUsd, share * lim.budgetUsd)
  if (!(usable > 0) || !(lim.usdPerGpuSecond > 0)) return 0
  const affordable = Math.floor(usable / lim.usdPerGpuSecond - lim.coldReserveS)
  const t = Math.min(lim.perJobCapS, affordable)
  return t >= MIN_TIMEOUT_S ? t : 0
}

export interface BenchPlanned extends BenchStep {
  timeoutS: number
  maxUsd: number
}

/** The worst case of the whole series, every job spending its full ceiling: the timeouts and the largest possible total. PURE. */
export function benchWorstCase(steps: readonly BenchStep[], lim: BenchLimits): { planned: BenchPlanned[]; maxUsd: number } {
  let remaining = lim.budgetUsd
  let total = 0
  const planned: BenchPlanned[] = []
  for (const s of steps) {
    const timeoutS = benchTimeoutS(remaining, lim, s.share)
    if (timeoutS === 0) continue
    const maxUsd = (timeoutS + lim.coldReserveS) * lim.usdPerGpuSecond
    planned.push({ ...s, timeoutS, maxUsd })
    remaining -= maxUsd
    total += maxUsd
  }
  return { planned, maxUsd: total }
}

/** What the CLI hands over from config.json. */
export interface TryAvatarEnv {
  publicUrl?: string | undefined
  infinitetalk: InfinitetalkSettings
}

export interface TryAvatarArgs {
  engine: string | undefined
  image: string | undefined
  audio: string | undefined
  resolution?: string | undefined
  bench?: boolean
  budgetUsd?: number | undefined
  out?: string | undefined
  team?: string | undefined
}

/** Seams for the tests (ffprobe / ffmpeg / the provider's HTTP); production uses the real ones. */
export interface TryAvatarDeps {
  probeSeconds?: (file: string) => Promise<number>
  cutAudio?: (file: string, seconds: number, to: string) => Promise<void>
  http?: HttpOptions & { pollMs?: number }
}

const run = promisify(execFile)

async function ffprobeSeconds(file: string): Promise<number> {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])
    const s = Number(stdout.trim())
    if (Number.isFinite(s) && s > 0) return s
  } catch {
    // fall through to the WAV header
  }
  const b = readFileSync(file)
  if (b.length > 44 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') {
    const byteRate = b.readUInt32LE(28)
    if (byteRate > 0) return (b.length - 44) / byteRate
  }
  throw new CloudError('bad_request', 'cannot measure the audio length: install ffmpeg (ffprobe) or give a .wav file')
}

async function ffmpegCut(file: string, seconds: number, to: string): Promise<void> {
  try {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-t', String(seconds), '-c:a', 'libmp3lame', '-b:a', '128k', to])
  } catch {
    throw new CloudError('bad_request', '--bench cuts the audio with ffmpeg, which could not be run: install ffmpeg and put it on the PATH')
  }
}

const safeName = (path: string, fallback: string): string => {
  const raw = basename(path).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[^A-Za-z0-9]+/, '')
  const name = raw.length > 100 ? raw.slice(0, 100 - extname(raw).length) + extname(raw) : raw
  return SAFE_NAME.test(name) ? name : fallback
}

const usd = (n: number): string => n.toFixed(n < 1 ? 4 : 2)

/** The most a plain (not bench) call can cost, in dollars, for an engine, a length and a resolution. */
export function singleCallMaxUsd(engine: PresenterEngine, resolution: PresenterResolution, seconds: number, env: TryAvatarEnv, timeoutS: number): number {
  if (engine === INFINITETALK_ENGINE) return maxJobCostUsd(env.infinitetalk.gpu, timeoutS, env.infinitetalk.coldStartReserveS)
  // WaveSpeed bills its own rounding (InfiniteTalk at least 3 s)
  if (engine in WAVESPEED_MODELS) return engineCostUsd(engine, resolution, wavespeedBilledSecondsFor(engine as keyof typeof WAVESPEED_MODELS, seconds))
  return engineCostUsd(engine, resolution, seconds)
}

export async function tryAvatar(cloud: Cloud, a: TryAvatarArgs, actor: string, env: TryAvatarEnv, say: (line: string) => void, deps: TryAvatarDeps = {}): Promise<void> {
  const say1 = (line: string): void => say(cloud.vault.mask(line))
  const bad = (m: string): never => {
    throw new CloudError('bad_request', m)
  }
  if (!a.engine || !isPresenterEngine(a.engine)) return bad(`--engine is one of: ${Object.keys(PRESENTER_ENGINE_CAN).join(', ')}`)
  const engine = a.engine
  if (!a.image) return bad('--image <portrait.png|jpg> is required')
  if (!a.audio) return bad('--audio <voice.mp3|wav> is required')
  const resolution = a.resolution === undefined ? defaultResolution(engine) : (PRESENTER_RESOLUTIONS as readonly string[]).includes(a.resolution) ? (a.resolution as PresenterResolution) : bad(`--resolution is one of ${PRESENTER_RESOLUTIONS.join(', ')}`)
  if (!PRESENTER_ENGINE_CAN[engine].resolutions.includes(resolution)) return bad(`${engine} makes ${PRESENTER_ENGINE_CAN[engine].resolutions.join(', ')}, not ${resolution}`)
  const bench = a.bench === true
  if (bench && engine !== INFINITETALK_ENGINE) return bad('--bench is for presenter:infinitetalk-gpu only')
  if (bench && !a.out) return bad('--bench needs --out DIR for its report and the videos')
  const budget = a.budgetUsd ?? BENCH_DEFAULT_USD
  if (!(budget > 0)) return bad('--budget-usd is a positive number of dollars')
  if (budget > BENCH_HARD_MAX_USD) return bad(`--budget-usd is at most ${BENCH_HARD_MAX_USD} (decision 0015)`)

  // 1. is the engine really live
  const resolved = cloud.registry.resolveFor('talkingAvatar', { engine })
  if (resolved.status !== 'real') return bad(`${engine} is not live: ${resolved.reason ?? 'unknown reason'} (set paidCalls on, list it in realEngines, put its key in the vault)`)
  if (engine === INFINITETALK_ENGINE && !env.infinitetalk.endpointId) return bad('config.json "infinitetalk": { "endpointId": … } is not set: deploy the worker first (deploy/runpod/infinitetalk/README.md)')

  // 2. the inputs
  const audioPath = resolve(a.audio)
  const imagePath = resolve(a.image)
  const audioSeconds = await (deps.probeSeconds ?? ffprobeSeconds)(audioPath)
  if (!bench && audioSeconds > TRY_AVATAR_MAX_S) return bad(`a manual try is limited to ${TRY_AVATAR_MAX_S} s of audio (this one lasts ${audioSeconds.toFixed(1)} s); cut it`)
  const maxCall = PRESENTER_ENGINE_CAN[engine].maxCallS

  // 3. the maximum cost, printed before anything else happens
  const settings = env.infinitetalk
  const lim: BenchLimits = { budgetUsd: budget, usdPerGpuSecond: gpuUsdPerSecond(settings.gpu), coldReserveS: settings.coldStartReserveS, perJobCapS: settings.maxGpuSeconds }
  let steps: BenchStep[] = []
  let timeoutS = 0
  let maxUsd: number
  if (bench) {
    steps = BENCH_STEPS.filter((s) => s.seconds <= audioSeconds + 0.05 && s.seconds <= maxCall)
    if (steps.length === 0) return bad(`--bench needs at least ${BENCH_STEPS[0]?.seconds ?? 10} s of audio (this one lasts ${audioSeconds.toFixed(1)} s)`)
    const worst = benchWorstCase(steps, lim)
    if (worst.planned.length === 0) return bad('the budget does not even cover one job')
    const leftOut = steps.length - worst.planned.length
    steps = worst.planned
    maxUsd = Math.min(budget, worst.maxUsd)
    say1(`Plan : ${worst.planned.map((p) => `${p.label} (limite ${p.timeoutS} s de GPU)`).join(' puis ')} sur ${settings.gpu} (${(lim.usdPerGpuSecond * 3600).toFixed(2)} $/h), ${settings.steps} pas`)
    if (leftOut > 0) say1('Le budget ne couvre pas toute la série.')
  } else {
    const seconds = Math.max(1, Math.ceil(audioSeconds))
    if (seconds > maxCall) return bad(`${engine} takes at most ${maxCall} s in one call`)
    timeoutS = Math.min(settings.maxGpuSeconds, Math.max(MIN_TIMEOUT_S, Math.floor(budget / lim.usdPerGpuSecond - lim.coldReserveS)))
    maxUsd = singleCallMaxUsd(engine, resolution, seconds, env, timeoutS)
    say1(`Plan : une génération de ${seconds} s en ${resolution} sur ${engine}`)
  }
  say1(`Coût maximum : ${usd(maxUsd)} $ (plafond ${usd(budget)} $)`)
  if (maxUsd > budget + 1e-9) return bad(`the maximum cost ${usd(maxUsd)} $ is above the ceiling ${usd(budget)} $: nothing was called`)

  // 4. the files go into the Cloud's own storage; the adapter reads them through signed links
  const team = a.team ?? cloud.accounts.teams()[0]?.id
  if (!team) return bad('no team in this Cloud: create one first (admin user add)')
  cloud.accounts.team(team)
  const workDir = a.out ? resolve(a.out) : null
  if (workDir) mkdirSync(workDir, { recursive: true })
  const portrait = await cloud.storage.put(team, null, { name: safeName(imagePath, 'portrait.png'), mime: mimeFor(imagePath) === 'application/octet-stream' ? 'image/png' : mimeFor(imagePath), bytes: readFileSync(imagePath) }, false)
  const publicBase = env.publicUrl?.replace(/\/+$/, '')
  const link = (id: string): { name: string; url: string } => {
    const art = cloud.storage.forTeam(team, id)
    const direct = cloud.storage.presign(art, REMOTE_LINK_TTL_S)
    if (direct) return { name: art.name, url: direct }
    if (!publicBase) return bad('no way to give the provider a link: set config.json "publicUrl" (this Cloud must then run and be reachable) or use "s3" storage (R2)')
    return { name: art.name, url: publicBase + cloud.storage.signedPath(art.id, REMOTE_LINK_TTL_S).path }
  }
  const audioArtefact = async (file: string, name: string): Promise<string> => (await cloud.storage.put(team, null, { name, mime: mimeFor(file), bytes: readFileSync(file) }, false)).id

  const makeAdapter = (maxGpuSeconds: number): ProviderAdapter => (engine === INFINITETALK_ENGINE ? infinitetalkGpuAdapter({ ...settings, maxGpuSeconds, ...(deps.http ?? {}) }) : resolved.adapter)
  const generate = async (adapter: ProviderAdapter, audioId: string, seconds: number, res: PresenterResolution, ceilingS: number) => {
    cloud.registry.assertCallable(adapter)
    cloud.audit.record(actor, 'provider.try', 'talkingAvatar', { provider: adapter.id, engine, seconds, resolution: res })
    let ref: string | null = null
    const input = USAGE_INPUTS.talkingAvatar.parse({ avatarId: 'portrait', audioArtefactId: audioId, portraitArtefactId: portrait.id, seconds, engine, resolution: res })
    return runUsage(adapter, 'talkingAvatar', input, {
      signal: AbortSignal.timeout((ceilingS + settings.coldStartReserveS) * 1000 + 15 * 60_000),
      progress: () => undefined,
      secret: () => cloud.vault.readForAdapter(adapter.secretName as string, adapter.id),
      jobId: 'cli-try',
      artefact: link,
      artefactUrl: (id) => link(id).url,
      callbackUrl: () => bad('not available in a manual try'),
      providerRef: () => ref,
      setProviderRef: (r) => void (ref = r),
      // HeyGen's MCP sign-in: refreshed tokens go back to the vault, a failed refresh raises the founder's alert
      ...(adapter.secretName ? { saveSecret: (v: string) => cloud.vault.set(adapter.secretName as string, v, `adapter:${adapter.id}`) } : {}),
      alert: (m: string | null) => cloud.providerAlerts.set(adapter.id, m)
    })
  }
  const save = (name: string, bytes: Uint8Array): string | null => {
    if (!workDir) return null
    const path = join(workDir, name)
    writeFileSync(path, bytes)
    return path
  }

  if (!bench) {
    const seconds = Math.max(1, Math.ceil(audioSeconds))
    const audioId = await audioArtefact(audioPath, safeName(audioPath, 'voice.mp3'))
    const out = await generate(makeAdapter(timeoutS), audioId, seconds, resolution, timeoutS)
    say1(`${engine}: ok, provider cost $${out.costUsd.toFixed(6)}`)
    for (const f of out.files) {
      const path = save(`avatar-${engine.slice('presenter:'.length)}-${resolution}-${seconds}s.mp4`, f.bytes)
      say1(path ? `${f.name}: ${f.bytes.length} bytes written to ${path}` : `${f.name}: ${f.bytes.length} bytes (not saved: give --out DIR)`)
    }
    const d = out.data
    if (typeof d.gpuSeconds === 'number') say1(`GPU ${d.gpuSeconds.toFixed(1)} s pour ${seconds} s de vidéo (${String(d.gpuSecondsPerVideoSecond)} s de GPU par seconde de vidéo), démarrage à froid ${String(d.coldStartS)} s`)
    if (typeof d.registration === 'string') say1(`registration: ${d.registration}`)
    return
  }

  // bench: sequential, each job's ceiling from what is left
  if (!workDir) return bad('--bench needs --out DIR')
  const rows: Record<string, unknown>[] = []
  let remaining = budget
  let spent = 0
  const toCut = deps.cutAudio ?? ffmpegCut
  for (const step of steps) {
    const ceiling = benchTimeoutS(remaining, lim, step.share)
    if (ceiling === 0) {
      say1(`${step.label}: skipped, the budget left (${usd(remaining)} $) does not cover a job`)
      rows.push({ label: step.label, seconds: step.seconds, resolution: step.resolution, status: 'skipped' })
      continue
    }
    const cutPath = join(workDir, `bench-audio-${step.seconds}s.mp3`)
    await toCut(audioPath, step.seconds, cutPath)
    const audioId = await audioArtefact(cutPath, `bench-audio-${step.seconds}s.mp3`)
    const worst = (ceiling + lim.coldReserveS) * lim.usdPerGpuSecond
    say1(`${step.label}: running (limit ${ceiling} s of GPU, at most ${usd(worst)} $)…`)
    try {
      const out = await generate(makeAdapter(ceiling), audioId, step.seconds, step.resolution, ceiling)
      const d = out.data
      const gpuS = typeof d.gpuSeconds === 'number' ? d.gpuSeconds : 0
      const cold = typeof d.coldStartS === 'number' ? d.coldStartS : 0
      // what this job is counted at: the execution AND the cold start, never less than reality
      const counted = (gpuS + cold) * lim.usdPerGpuSecond
      spent += counted
      remaining -= counted
      const file = out.files[0] ? save(`bench-${step.seconds}s-${step.resolution}.mp4`, out.files[0].bytes) : null
      rows.push({
        label: step.label,
        seconds: step.seconds,
        resolution: step.resolution,
        status: 'ok',
        gpuSeconds: gpuS,
        coldStartS: cold,
        gpuSecondsPerVideoSecond: gpuS / step.seconds,
        costUsd: out.costUsd,
        usdPerMinuteOfVideo: (out.costUsd / step.seconds) * 60,
        usdPerMinuteWithColdStart: (counted / step.seconds) * 60,
        file
      })
    } catch (err) {
      // a failed job is counted at its full ceiling: the budget can only be over-estimated
      spent += worst
      remaining -= worst
      const msg = cloud.vault.mask(err instanceof Error ? err.message : String(err))
      say1(`${step.label}: failed (${msg})`)
      rows.push({ label: step.label, seconds: step.seconds, resolution: step.resolution, status: 'failed', error: msg, countedUsd: worst })
    }
  }
  const report = { engine, gpu: settings.gpu, usdPerHour: lim.usdPerGpuSecond * 3600, steps: settings.steps, budgetUsd: budget, countedSpentUsd: spent, jobs: rows }
  writeFileSync(join(workDir, 'bench.json'), JSON.stringify(report, null, 2))
  say1('')
  say1('Série | s GPU / s vidéo | $ / minute de vidéo | démarrage à froid (s) | état')
  for (const r of rows) {
    const ok = r.status === 'ok'
    say1(
      `${String(r.label)} | ${ok ? (r.gpuSecondsPerVideoSecond as number).toFixed(1) : '-'} | ${ok ? (r.usdPerMinuteOfVideo as number).toFixed(3) : '-'} | ${ok ? (r.coldStartS as number).toFixed(0) : '-'} | ${String(r.status)}`
    )
  }
  say1(`Dépense comptée : ${usd(spent)} $ sur ${usd(budget)} $. Rapport : ${join(workDir, 'bench.json')}`)
}

