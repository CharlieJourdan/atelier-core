// Labels of the counted shots by a vision model looking at contact sheets (Claude at Haiku level on the user's subscription, or any
// model behind the `Labeller` port): kind, what is shown, the text burnt in, whether the shot illustrates its words, the camera move.
// The shot TIMES are never the model's: they come from scene detection; the model only names what it sees. Pure prompt and parsing.
import { CAMERA_MOVES, LOG_SHOT_KINDS, type LogShot } from '../../shared/shot-log.ts'
import type { Sheet } from './sheets.ts'

export interface LabelRequest {
  prompt: string
  images: string[]
  signal?: AbortSignal
}
export interface LabelAnswer {
  text: string
  inputTokens: number
  outputTokens: number
  /** Dollars at the model's API price (an estimate when it runs on a subscription). */
  usd: number
  /** Ran on the user's subscription (the dollars are only the API-price equivalent). */
  subscription: boolean
}
export type Labeller = (r: LabelRequest) => Promise<LabelAnswer>

/** Sheets per model call: fewer calls, each with a few pictures (the CLI reads one picture a turn). */
export const SHEETS_PER_CALL = 3

const fmt = (s: number): string => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

export function labelPrompt(sheets: readonly Sheet[], shots: readonly LogShot[], o: { cols: number; language?: string }): string {
  const byN = new Map(shots.map((s) => [s.n, s]))
  const lines: string[] = []
  sheets.forEach((sh, i) => {
    lines.push(`Picture ${i + 1}: shots ${sh.shots[0]}–${sh.shots[sh.shots.length - 1]}, two cells per shot (early frame, late frame), ${o.cols / 2} shots per row, left to right then top to bottom.`)
    for (const n of sh.shots) {
      const s = byN.get(n)
      if (s) lines.push(`  #${n} ${fmt(s.startS)}–${fmt(s.endS)} (${s.lengthS.toFixed(1)} s) words: ${s.words ? `« ${s.words.slice(0, 240)} »` : '(none)'}`)
    }
  })
  return [
    'You label the shots of a video from contact sheets. The shot times were measured by scene detection; do not change them, do not merge or split shots.',
    'Look at every picture first (Read each file). Then for EVERY listed shot answer one row:',
    `- n; kind: one of ${LOG_SHOT_KINDS.join(', ')};`,
    '  generated is ONLY a picture an image or video model made (fine texture everywhere, painterly or photoreal detail, small deformations of hands or text, the same character rendered a little differently each time). Flat colour fills, clean outlines, vector shapes and characters redrawn identically are illustration (scenes) or motion-graphic (cards, numbers); halftone cut-out photos on paper are motion-graphic; real news, archive or stock footage is archive-film or stock-footage;',
    '- shows: what is on screen, at most 15 words (subject, place, action; name people only if a caption names them);',
    '- text: the text burnt into the picture, verbatim and short (captions, labels, titles; empty if none);',
    '- illustrates: yes / partly / no — does the picture show what its words say? (no words: partly);',
    `- camera: one of ${CAMERA_MOVES.join(', ')} — compare the early and late frame (bigger subject = push-in, smaller = pull-out, shifted = pan/tilt, drawn or moving graphics = animated);`,
    '- cont: true when this is NOT a new picture but the same take as the previous shot, only the caption or overlay text changed (word-by-word captions trigger false cuts); else false.',
    ...(o.language ? [`Write shows in ${o.language}.`] : []),
    '',
    ...lines,
    '',
    'Answer ONLY with JSON: {"shots":[{"n":1,"kind":"…","shows":"…","text":"…","illustrates":"yes","camera":"still","cont":false}, …]}'
  ].join('\n')
}

const pick = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => list.find((x) => x === v) ?? fallback

/** The labels of an answer, by shot number; a malformed row is dropped (the shot keeps « other / unknown »), never guessed. */
export type ShotLabel = Pick<LogShot, 'kind' | 'shows' | 'onScreenText' | 'illustrates' | 'camera'> & { cont?: boolean }

export function parseLabels(text: string): Map<number, ShotLabel> {
  const out = new Map<number, ShotLabel>()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return out
  let rows: unknown
  try {
    rows = (JSON.parse(text.slice(start, end + 1)) as { shots?: unknown }).shots
  } catch {
    return out
  }
  if (!Array.isArray(rows)) return out
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const x = r as Record<string, unknown>
    const n = Number(x.n)
    if (!Number.isInteger(n) || n < 1) continue
    const ill = x.illustrates
    out.set(n, {
      kind: pick(LOG_SHOT_KINDS, x.kind, 'other'),
      shows: String(x.shows ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
      onScreenText: String(x.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
      illustrates: ill === 'yes' || ill === 'partly' || ill === 'no' ? ill : null,
      camera: pick(CAMERA_MOVES, x.camera, 'unknown'),
      ...(x.cont === true ? { cont: true } : {})
    })
  }
  return out
}

/** Applies labels to shots (shots without a label keep their blanks); the `cont` flag is kept apart for `mergeContinued`. */
export function applyLabels(shots: readonly LogShot[], labels: ReadonlyMap<number, ShotLabel>): LogShot[] {
  return shots.map((s) => {
    const l = labels.get(s.n)
    if (!l) return s
    const { cont: _cont, ...rest } = l
    return { ...s, ...rest }
  })
}

/** Joins a shot the model marked as the same take as the one before (a caption change counted as a cut by scene detection) into
 *  it: one shot, the first one's labels, both texts and words. The first shot never merges. */
export function mergeContinued(shots: readonly LogShot[], cont: ReadonlySet<number>): LogShot[] {
  const out: LogShot[] = []
  for (const s of shots) {
    const prev = out[out.length - 1]
    if (prev && cont.has(s.n)) {
      const texts = [prev.onScreenText, s.onScreenText].filter((t, i, a) => t && a.indexOf(t) === i)
      out[out.length - 1] = { ...prev, endS: s.endS, lengthS: Math.round((s.endS - prev.startS) * 100) / 100, words: [prev.words, s.words].filter(Boolean).join(' ').slice(0, 600), onScreenText: texts.join(' / ').slice(0, 300) }
    } else out.push(s)
  }
  return out.map((s, i) => ({ ...s, n: i + 1 }))
}

export interface HookLabel {
  firstImage: string
  notes: string
}

export function hookPrompt(times: readonly number[], words: string, cols: number): string {
  return [
    `This picture holds every frame of the first ${times.length / 2} seconds of a video, one frame each 0.5 s (${cols} per row, left to right then top to bottom).`,
    `The words said in that time: « ${words.slice(0, 800)} »`,
    'Say in at most 60 words how the hook grabs attention: what the very first image is, how fast pictures change, what text appears and when, and whether the key image arrives on the first words.',
    'Answer ONLY with JSON: {"firstImage":"…","notes":"…"}'
  ].join('\n')
}

export function parseHook(text: string): HookLabel | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const x = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    return { firstImage: String(x.firstImage ?? '').slice(0, 300), notes: String(x.notes ?? '').slice(0, 600) }
  } catch {
    return null
  }
}
