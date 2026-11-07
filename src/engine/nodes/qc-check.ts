// `qc.check@1` (the « qc » kind of a drawn pipeline; docs/ENGINE-SPEC.md §31, its deterministic technical part): free,
// automatic checks on the rendered film, made by ffmpeg and ffprobe alone (no model call): black pictures, a long
// silence, a frozen picture, the integrated loudness against the target, the length against the plan or the format asked,
// and the container's basics. The result is the spec's `json.qc` report. A failing check never crashes the node: the
// report says `pass: false` and the result is flagged `needsReview` in its meta, which makes the scheduler park the node at
// a review gate (R11) whatever the gate mode. The visual review (Claude, on contact sheets), the repair `patches` and the
// checks that need the clips' roles (repetition, cadence) belong to later lots: `frames` and `patches` are empty here.
import { z } from 'zod'
import type { NodeOutputs } from '../artefacts'
import { EngineError } from '../errors'
import { EditPlan } from '../formats/editplan'
import { FPS, aspectOfSize } from '../formats/timing'
import { probe } from '../media/probe'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { need } from '../services'
import type { Json } from '../types'
import { progress, readFile0, readValue } from './common'

export const QC_SCHEMA = 'atelier.qc/1'

export const QcParams = z.object({
  /** A black stretch at least this long (seconds) fails. */
  blackMaxS: z.number().min(0.1).max(30).default(0.5),
  /** A silence at least this long (seconds) fails; `silenceDb` is its level. */
  silenceMaxS: z.number().min(0.5).max(60).default(2),
  silenceDb: z.number().min(-90).max(-20).default(-50),
  /** A picture that does not change for `freezeWarnS` seconds is a warning, for `freezeMaxS` a failure; `freezeNoise` is the change below which it counts as still. */
  freezeWarnS: z.number().min(0.5).max(60).default(1.5),
  freezeMaxS: z.number().min(1).max(60).default(4),
  freezeNoise: z.number().min(0.0001).max(0.05).default(0.001),
  /** Integrated loudness target and how far (LU) the film may be from it. */
  targetLufs: z.number().min(-30).max(-5).default(-14),
  lufsTolerance: z.number().min(0.5).max(10).default(1),
  /** Length asked: seconds (± `durationTolerance`, a share), and/or a floor and a ceiling (a short is at most 60 s). */
  expectedS: z.number().positive().optional(),
  durationTolerance: z.number().min(0.01).max(1).default(0.15),
  minS: z.number().positive().optional(),
  maxS: z.number().positive().optional()
})
type Params = z.infer<typeof QcParams>

export type CheckStatus = 'ok' | 'warn' | 'fail'
export interface QcFinding {
  start: number
  end: number
}
export interface QcCheck {
  id: 'black' | 'silence' | 'freeze' | 'loudness' | 'duration' | 'format' | 'edit'
  status: CheckStatus
  /** One French sentence for the person reading the report. */
  detail: string
  /** Seconds, where the first problem starts. */
  at?: number
  /** Every stretch concerned (black, silent, frozen). */
  findings: QcFinding[]
  data: Record<string, Json>
}
export interface QcReport {
  schema: typeof QC_SCHEMA
  /** No check failed. */
  pass: boolean
  /** 100 − 10 per failure − 3 per warning, floored at 0. */
  score: number
  /** The result asks for a person to look at it (any failure). */
  needsReview: boolean
  durationS: number
  checks: QcCheck[]
  frames: Json[]
  patches: Json[]
}

const num = (s: string | undefined): number => (s === undefined ? NaN : Number(s))
const r1 = (n: number): number => Math.round(n * 10) / 10
const r2 = (n: number): number => Math.round(n * 100) / 100

/** Black stretches from `blackdetect` lines: `black_start:0 black_end:1.5 black_duration:1.5`. */
export function parseBlack(stderr: string): QcFinding[] {
  const out: QcFinding[] = []
  for (const m of stderr.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)) out.push({ start: num(m[1]), end: num(m[2]) })
  return out
}

/** Frozen stretches from `freezedetect` lines (`freeze_start`, `freeze_end`); one still open at the end runs to `durationS`. */
export function parseFreeze(stderr: string, durationS: number): QcFinding[] {
  const out: QcFinding[] = []
  let open: number | null = null
  for (const m of stderr.matchAll(/freeze_(start|end):\s*([\d.]+)/g)) {
    const t = num(m[2])
    if (m[1] === 'start') open = t
    else if (open !== null) {
      out.push({ start: open, end: t })
      open = null
    }
  }
  if (open !== null) out.push({ start: open, end: durationS })
  return out
}

/** Silences from `silencedetect` lines; a silence still open at the end runs to `durationS`. */
export function parseSilence(stderr: string, durationS: number): QcFinding[] {
  const out: QcFinding[] = []
  let open: number | null = null
  for (const m of stderr.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
    const t = Math.max(0, num(m[2]))
    if (m[1] === 'start') open = t
    else if (open !== null) {
      out.push({ start: open, end: t })
      open = null
    }
  }
  if (open !== null) out.push({ start: open, end: durationS })
  return out
}

/** The loudnorm summary at the end of a stderr: integrated loudness and true peak (a silent film measures -70). */
export function parseLoudness(stderr: string): { integrated: number; truePeak: number } {
  let j: { input_i?: string; input_tp?: string } = {}
  try {
    j = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1)) as typeof j
  } catch {
    throw new EngineError('internal', 'loudness measurement gave no result')
  }
  const integrated = Number(j.input_i)
  const truePeak = Number(j.input_tp)
  return { integrated: Number.isFinite(integrated) ? integrated : -70, truePeak: Number.isFinite(truePeak) ? truePeak : -70 }
}

const spans = (f: QcFinding[]): string => f.slice(0, 3).map((x) => `${r1(x.start)}–${r1(x.end)} s`).join(', ') + (f.length > 3 ? ` (+${f.length - 3})` : '')

/**
 * A check made of stretches that must not exist: those of at least `failS` seconds fail, those of at least `warnS` (when
 * given) are warnings. `found` holds every stretch the detector saw (it was asked for the shortest that matters).
 */
export function stretchCheck(id: QcCheck['id'], found: QcFinding[], o: { noun: string; none: string; failS: number; warnS?: number }): QcCheck {
  const len = (f: QcFinding): number => f.end - f.start
  const long = found.filter((f) => len(f) >= o.failS - 1e-6)
  const warn = o.warnS === undefined ? [] : found.filter((f) => len(f) >= o.warnS! - 1e-6 && len(f) < o.failS - 1e-6)
  const shown = long.length > 0 ? long : warn
  const limit = long.length > 0 ? o.failS : (o.warnS ?? o.failS)
  return {
    id,
    status: long.length > 0 ? 'fail' : warn.length > 0 ? 'warn' : 'ok',
    detail: shown.length > 0 ? `${shown.length} ${o.noun} d’au moins ${limit} s : ${spans(shown)}.` : `${o.none} ${o.noun} d’au moins ${o.warnS ?? o.failS} s.`,
    ...(shown[0] ? { at: r2(shown[0].start) } : {}),
    findings: shown,
    data: { failS: o.failS, warnS: o.warnS ?? null, longest: r1(Math.max(0, ...found.map(len))) }
  }
}

export function loudnessCheck(m: { integrated: number; truePeak: number }, p: Pick<Params, 'targetLufs' | 'lufsTolerance'>): QcCheck {
  const off = m.integrated - p.targetLufs
  const bad = Math.abs(off) > p.lufsTolerance
  // the render's master allows a peak a little over its −1 dBTP ceiling: only a clear overshoot is worth a warning
  const hot = m.truePeak > -0.7
  return {
    id: 'loudness',
    status: bad ? 'fail' : hot ? 'warn' : 'ok',
    detail: bad
      ? `Le son est à ${r1(m.integrated)} LUFS, cible ${p.targetLufs} (écart ${r1(off)}).`
      : hot
        ? `Niveau ${r1(m.integrated)} LUFS, mais le pic (${r1(m.truePeak)} dB) frôle la saturation.`
        : `Niveau ${r1(m.integrated)} LUFS (cible ${p.targetLufs}).`,
    findings: [],
    data: { integrated: r1(m.integrated), truePeak: r1(m.truePeak), target: p.targetLufs, tolerance: p.lufsTolerance }
  }
}

export function durationCheck(film: { durationS: number; frames: number | null }, p: Pick<Params, 'expectedS' | 'durationTolerance' | 'minS' | 'maxS'>, plannedFrames: number | null): QcCheck {
  const D = film.durationS
  const problems: string[] = []
  // the plan's own length: the picture has its frames, one more or less
  if (plannedFrames !== null) {
    const got = film.frames ?? Math.round(D * FPS)
    if (Math.abs(got - plannedFrames) > 1) problems.push(`le plan prévoit ${plannedFrames} images (${r1(plannedFrames / FPS)} s), la vidéo en a ${got}`)
  }
  if (p.expectedS !== undefined && Math.abs(D - p.expectedS) / p.expectedS > p.durationTolerance) problems.push(`on en attendait ${r1(p.expectedS)} s (±${Math.round(p.durationTolerance * 100)} %)`)
  if (p.minS !== undefined && D < p.minS) problems.push(`moins que le minimum de ${r1(p.minS)} s`)
  if (p.maxS !== undefined && D > p.maxS) problems.push(`plus que le maximum de ${r1(p.maxS)} s`)
  return {
    id: 'duration',
    status: problems.length > 0 ? 'fail' : 'ok',
    detail: problems.length > 0 ? `La vidéo dure ${r1(D)} s : ${problems.join(' ; ')}.` : `La vidéo dure ${r1(D)} s, comme prévu.`,
    findings: [],
    data: { durationS: r2(D), frames: film.frames, plannedFrames, expectedS: p.expectedS ?? null, minS: p.minS ?? null, maxS: p.maxS ?? null }
  }
}

/**
 * The edit review that rides on the film (`render.assemble` `review`, qualite-montage): what it fixed and what is left, shot by shot. What
 * is left is a warning listed first on the package card, never a stop (an automatic run is not parked for a picture that fits loosely).
 */
export function editCheck(review: unknown): QcCheck | null {
  const r = review as { rounds?: { defects?: unknown[]; applied?: unknown[] }[]; left?: { kind: string; severity: string; atS: number; endS: number; detail: string }[] } | undefined
  if (!r || !Array.isArray(r.rounds) || !Array.isArray(r.left)) return null
  const before = r.rounds[0]?.defects?.length ?? 0
  const fixed = r.rounds.reduce((n, x) => n + (x.applied?.length ?? 0), 0)
  const left = r.left
  return {
    id: 'edit',
    status: left.length > 0 ? 'warn' : 'ok',
    detail:
      left.length > 0
        ? `Revue du montage : ${before} défaut(s) vus, ${fixed} corrigé(s) par le rendu, ${left.length} restant(s) : ${left.slice(0, 3).map((d) => d.detail).join(' ')}`
        : `Revue du montage : ${before} défaut(s) vus, ${fixed} corrigé(s), rien ne reste.`,
    ...(left[0] ? { at: left[0].atS } : {}),
    findings: left.map((d) => ({ start: d.atS, end: d.endS })),
    data: { before, fixed, left: left.length, kinds: [...new Set(left.map((d) => d.kind))] }
  }
}

const absent = (id: QcCheck['id'], what: string): QcCheck => ({ id, status: 'fail', detail: `Pas de ${what} à contrôler.`, findings: [], data: {} })

async function check(ctx: RunCtx, inputs: ResolvedInputs, p: Params): Promise<NodeOutputs> {
  const media = need(ctx, 'media')
  const file = readFile0(inputs.video, 'the film')
  const plan = inputs.plan ? readValue(inputs.plan, EditPlan, 'the edit plan') : null
  const info = await probe(media, file, ctx.signal)
  const v = info.streams.find((s) => s.codec_type === 'video')
  const audio = info.streams.filter((s) => s.codec_type === 'audio')
  const D = info.durationS

  progress(ctx, 0, 3, 'Je regarde l’image')
  // the detectors are asked for the shortest stretch that matters; the check sorts warnings from failures
  const picture = v
    ? (await media.run('ffmpeg', ['-i', file, '-an', '-vf', `blackdetect=d=${p.blackMaxS}:pix_th=0.1,freezedetect=n=${p.freezeNoise}:d=${Math.min(p.freezeWarnS, p.freezeMaxS)}`, '-f', 'null', '-'], { signal: ctx.signal })).stderr
    : ''
  progress(ctx, 1, 3, 'J’écoute le son')
  const sound =
    audio.length > 0
      ? (await media.run('ffmpeg', ['-i', file, '-vn', '-af', `silencedetect=n=${p.silenceDb}dB:d=${p.silenceMaxS},loudnorm=I=${p.targetLufs}:print_format=json`, '-f', 'null', '-'], { signal: ctx.signal })).stderr
      : ''

  const formatProblems: string[] = []
  if (!v) formatProblems.push('pas d’image')
  else if (plan) {
    // the plan says the shape of the film (1920×1080, or 1080×1920 for a short)
    if (v.width !== plan.size[0] || v.height !== plan.size[1]) formatProblems.push(`image en ${String(v.width)}×${String(v.height)}, ${plan.size[0]}×${plan.size[1]} attendu`)
  } else if (!v.width || !v.height || aspectOfSize([v.width, v.height]) === null) {
    formatProblems.push(`image en ${String(v.width)}×${String(v.height)}, 1920×1080 ou 1080×1920 attendu`)
  }
  if (audio.length !== 1) formatProblems.push(audio.length === 0 ? 'pas de son' : `${audio.length} pistes son`)
  const frames = Number(v?.nb_frames)
  const checks: QcCheck[] = [
    v ? stretchCheck('black', parseBlack(picture), { noun: 'passage noir', none: 'Aucun', failS: p.blackMaxS }) : absent('black', 'image'),
    audio.length > 0 ? stretchCheck('silence', parseSilence(sound, D), { noun: 'silence', none: 'Aucun', failS: p.silenceMaxS }) : absent('silence', 'son'),
    v ? stretchCheck('freeze', parseFreeze(picture, D), { noun: 'image figée', none: 'Aucune', failS: p.freezeMaxS, warnS: p.freezeWarnS }) : absent('freeze', 'image'),
    audio.length > 0 ? loudnessCheck(parseLoudness(sound), p) : absent('loudness', 'son'),
    durationCheck({ durationS: D, frames: Number.isFinite(frames) ? frames : null }, p, plan ? plan.frames : null),
    {
      id: 'format',
      status: formatProblems.length > 0 ? 'fail' : 'ok',
      detail: formatProblems.length > 0 ? `Format : ${formatProblems.join(', ')}.` : `Format ${String(v?.width)}×${String(v?.height)}, ${v?.codec_name ?? '?'}, une piste son.`,
      findings: [],
      data: { width: v?.width ?? null, height: v?.height ?? null, codec: v?.codec_name ?? null, audioStreams: audio.length }
    }
  ]
  const edit = editCheck(inputs.video?.meta?.review)
  if (edit) checks.push(edit)
  const failed = checks.filter((c) => c.status === 'fail')
  const warned = checks.filter((c) => c.status === 'warn')
  const report: QcReport = {
    schema: QC_SCHEMA,
    pass: failed.length === 0,
    score: Math.max(0, 100 - 10 * failed.length - 3 * warned.length),
    needsReview: failed.length > 0,
    durationS: r2(D),
    checks,
    frames: [],
    patches: []
  }
  progress(ctx, 3, 3, report.pass ? 'Contrôle qualité : tout est bon' : `Contrôle qualité : ${failed.length} point(s) à revoir`)
  if (!report.pass) ctx.emit({ kind: 'log', level: 'warn', text: `qc: ${failed.map((c) => c.id).join(', ')}` })
  return {
    report: {
      value: report as unknown as Json,
      meta: { pass: report.pass, score: report.score, needsReview: report.needsReview, failed: failed.map((c) => c.id), warnings: warned.map((c) => c.id) }
    }
  }
}

export const qcCheck = defineNode({
  type: 'qc.check@1',
  inputs: {
    video: { type: 'video.final', required: true, label: 'Film' },
    plan: { type: 'json.editplan', required: false, label: 'Plan (la durée prévue)' }
  },
  outputs: { report: 'json.qc' },
  params: QcParams,
  executors: ['local'],
  estimate: (ctx) => ({ units: [], durationS: 3 + ctx.minutes * 4 }),
  run: check,
  fake: check
})
