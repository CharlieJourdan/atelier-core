// The illustration check (avatar-qualite part 2, Charlie 01/11: « il faut que ce soit coupé au moment même, ultra précis, de ce
// qui est dit »): Claude looks at each generated picture next to the words spoken under its shot and scores how literally it
// shows them (0–10) and from which angle, the way the channel's reference videos do (director-scenes.ts ILLUSTRATION_GRAMMAR).
// A picture under ILLUSTRATION_BAR comes back with a better prompt; the pictures brick makes it again once. On the user's
// subscription the call is free (decision 0038). Six pictures a call; a call that fails twice leaves its pictures unscored.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { GenItem } from '../formats/editplan'
import type { RunCtx } from '../registry'
import { askJson, atomicWrite, eachLimited, hashOf, languageLine } from './common'

/**
 * The bar avatar@1 sets (`illustrationBar`, record 0055): under this score (0–10) a picture is made again with the judge's prompt. On run 5 (01/11) the judge gave Charlie's four
 * examples 1–7 over two passes (a hand on a wall 4 then 1, the mason's trowel 5 then 7, gloves 4, a wire brush 6 then 5) and the
 * literal pictures 8–9: under 8 catches them all; a still remade costs about 0.006 $, before any clip is made from it.
 */
export const ILLUSTRATION_BAR = 8
/** Pictures per call (each one is read by the model). */
const BATCH = 6
/** Batches judged at once (each a vision call on the subscription). */
const JUDGES_AT_ONCE = 3

export const ANGLES = ['pov-hands', 'hands-close', 'object-close', 'detail-macro', 'person-medium', 'person-wide', 'room-wide', 'outdoor', 'other'] as const

const Verdict = z.object({
  n: z.number().int().min(1),
  score: z.number().min(0).max(10),
  angle: z.enum(ANGLES).catch('other'),
  shows: z.string().max(300).catch(''),
  why: z.string().max(400).catch(''),
  better: z.string().max(600).optional()
})
const Verdicts = z.object({ shots: z.array(Verdict).max(BATCH * 2) })
export type IllustrationVerdict = Omit<z.infer<typeof Verdict>, 'n'>

export interface IllustrationShot {
  file: string
  /** The French words spoken under the shot. */
  said: string
  /** What the picture was asked to show (its scene). */
  prompt: string
}

/** The judge's rules for a bar (the pipeline's `illustrationBar`). */
export const illustrationRules = (bar: number): string => [
  'You check the pictures of a narrated YouTube video (French narration, B-roll pictures). Each picture is shown under the exact words spoken while it is on screen.',
  'The channel illustrates literally: 95 % of its pictures show something those words SAY — the object named, the gesture said, the problem described, the place, the result — never a mood, a metaphor or a generic activity.',
  'Score each picture 0–10: 9–10 it shows what the words name, clearly, at a fitting angle (a gesture as first-person hands, an object close, a defect in macro, a place wide); 6–8 it shows the words but weakly (far, unclear, half of it); 3–5 the topic of the video but not these words (a professional at work, a generic room, gloves for « quatre temps »); 0–2 unrelated, or a picture of an idea (a hand on a wall for « ce n’est pas le mur qui est malade »).',
  'When more than half of the words under a picture name something it does not show (the picture stays on while the narration has moved on, « l’armoire… Et derrière, dans l’angle du mur » on a wardrobe alone), score it 5 at most and let « better » show what those words name.',
  'angle: pov-hands (first-person hands) | hands-close (hands seen from the side) | object-close | detail-macro | person-medium | person-wide | room-wide | outdoor | other.',
  `better: only when the score is under ${bar}, ONE English prompt for a steady phone photo at eye level that would show these exact words (the thing they name, at the fitting angle, in an ordinary home), no text in the picture.`,
  'Answer with ONE JSON object: {"shots":[{"n":<picture number>,"score":<0-10>,"angle":"…","shows":"<what you see, a few English words>","why":"<one short reason>","better":"…"}]} — nothing else.'
].join('\n')

/** The verdicts of the pictures, in order (null: not scored, the call failed). */
export async function judgeIllustrations(ctx: RunCtx, shots: readonly IllustrationShot[], language: string, bar = ILLUSTRATION_BAR): Promise<(IllustrationVerdict | null)[]> {
  const out: (IllustrationVerdict | null)[] = shots.map(() => null)
  const starts = Array.from({ length: Math.ceil(shots.length / BATCH) }, (_, k) => k * BATCH)
  // batches are judged JUDGES_AT_ONCE at a time (190 pictures were 32 calls one after another, most of the stills stage)
  await eachLimited(starts, JUDGES_AT_ONCE, async (i) => {
    const batch = shots.slice(i, i + BATCH)
    const prompt = [
      languageLine(language),
      'Pictures (number · words spoken under it · what it was asked to show):',
      ...batch.map((s, k) => `${k + 1} · « ${s.said} » · ${s.prompt.slice(0, 300)}`)
    ].join('\n')
    try {
      const v = await askJson(ctx, { role: 'director', tier: 'balanced', system: illustrationRules(bar), prompt, schema: Verdicts, images: batch.map((s) => s.file) })
      for (const x of v.shots) {
        if (x.n < 1 || x.n > batch.length) continue
        const { n, ...rest } = x
        out[i + n - 1] = rest
      }
    } catch (e) {
      // a check never stops a run (record 0055): even a dead sign-in only leaves these pictures unscored
      if (ctx.signal.aborted) throw e
      ctx.emit({ kind: 'log', level: 'warn', text: `illustration check failed for pictures ${i + 1}–${i + batch.length}: left unscored` })
    }
  })
  return out
}

/** A one-line French summary of the scores (the run's record and the report). */
export function scoresLine(scores: readonly (number | null)[], bar = ILLUSTRATION_BAR): string {
  const got = scores.filter((s): s is number => s !== null)
  if (got.length === 0) return 'illustration : non vérifiée'
  const mean = got.reduce((a, b) => a + b, 0) / got.length
  return `illustration : ${mean.toFixed(1)}/10 en moyenne, ${got.filter((s) => s < bar).length} image(s) sous ${bar}`
}

/** What the check kept for one picture: its score, the first score when it was made again, the angle and the reason. */
export interface IllustrationNote {
  score: number | null
  first?: number
  angle?: string
  why?: string
  /** The remade picture's score when it was worse and the first one was put back. */
  kept?: number
}

/** The shot size a prompt asks for in its words (« close to the corner », « first-person hands », « the whole room »). */
export function framingOf(prompt: string): string {
  if (/\b(?:extreme close|macro)/i.test(prompt)) return 'extreme close-up'
  if (/\b(?:close[- ]up|close to|close on|first-person|pov|detail)\b/i.test(prompt)) return 'close-up'
  if (/\b(?:wide|whole room|whole place|from across|seen from further)\b/i.test(prompt)) return 'wide shot'
  return 'medium shot'
}

/**
 * The check over a fulfilled list: every generated still (not a hold, not a shot that shares a clip) that knows its words is
 * scored; one under the bar with a better prompt is made again once (`remake`), then scored again. Verdicts are cached by the
 * picture's bytes, its words and its prompt, so a rerun never pays the same remake twice.
 */
export async function illustrationPass(
  ctx: RunCtx,
  o: {
    items: readonly GenItem[]
    files: readonly (string | undefined)[]
    skip: ReadonlySet<number>
    parallel: number
    remake: (i: number, item: GenItem) => Promise<void>
    /** Puts the first picture back (from its cache, nothing paid twice) when the remade one scores lower (run 7: 7 then 5, kept). */
    restore?: (i: number) => Promise<void>
    bar?: number
  }
): Promise<{ notes: Map<number, IllustrationNote>; remade: Set<number>; line: string }> {
  const bar = o.bar ?? ILLUSTRATION_BAR
  const cacheDir = await ctx.services.workspace?.cache('illustration').catch(() => undefined)
  // the items as they are now: a remade one carries the judge's scene
  const now = [...o.items]
  const shotOf = (i: number): IllustrationShot => {
    const it = now[i] as GenItem
    return { file: o.files[i] as string, said: it.context.said ?? it.context.beatText, prompt: it.shot?.scene ?? it.prompt ?? it.context.subject }
  }
  const look = async (ix: readonly number[]): Promise<(IllustrationVerdict | null)[]> => {
    const keys = await Promise.all(ix.map(async (i) => {
      const s = shotOf(i)
      return hashOf({ v: 1, rules: illustrationRules(bar), bytes: createHash('sha256').update(await readFile(s.file)).digest('hex'), said: s.said, prompt: s.prompt })
    }))
    const cached = await Promise.all(keys.map(async (k) => {
      const f = cacheDir ? path.join(cacheDir, `${k}.json`) : null
      return f && existsSync(f) ? ((await readFile(f, 'utf8').then(JSON.parse).catch(() => null)) as IllustrationVerdict | null) : null
    }))
    const todo = ix.map((_, k) => k).filter((k) => cached[k] === null)
    const fresh = await judgeIllustrations(ctx, todo.map((k) => shotOf(ix[k] as number)), 'en', bar)
    for (const [j, k] of todo.entries()) {
      cached[k] = fresh[j] ?? null
      if (cacheDir && fresh[j]) await atomicWrite(path.join(cacheDir, `${keys[k]}.json`), JSON.stringify(fresh[j]))
    }
    return cached
  }
  const judged = o.items
    .map((_, i) => i)
    .filter((i) => {
      const it = o.items[i] as GenItem
      return o.files[i] !== undefined && !o.skip.has(i) && (it.kind === 'image.gen' || it.kind === 'video.gen') && it.sameAs === undefined && it.context.said !== undefined
    })
  const notes = new Map<number, IllustrationNote>()
  const first = await look(judged)
  const redo: { i: number; item: GenItem; first: number }[] = []
  first.forEach((v, k) => {
    const i = judged[k] as number
    if (!v) return
    notes.set(i, { score: v.score, angle: v.angle, why: v.why })
    const it = o.items[i] as GenItem
    // the judge's prompt says its own framing: the director's size is not put back in front of it (run 6, shot 13: « wide shot of
    // … close to the corner » made the wide room again)
    if (v.score < bar && v.better) redo.push({ i, first: v.score, item: { ...it, prompt: v.better, shot: { size: framingOf(v.better), scene: v.better.slice(0, 1200) } } })
  })
  const remade = new Set<number>()
  if (redo.length > 0) {
    await eachLimited(redo, o.parallel, async (r) => {
      now[r.i] = r.item
      await o.remake(r.i, r.item)
      remade.add(r.i)
    })
    const again = await look(redo.map((r) => r.i))
    for (const [k, r] of redo.entries()) {
      const v = again[k]
      if (v && v.score < r.first && o.restore) {
        // the remake is worse: the first picture comes back, with its verdict
        now[r.i] = o.items[r.i] as GenItem
        await o.restore(r.i)
        remade.delete(r.i)
        const f = first[judged.indexOf(r.i)] as IllustrationVerdict
        notes.set(r.i, { score: r.first, first: r.first, angle: f.angle, why: f.why, kept: v.score })
        continue
      }
      notes.set(r.i, { score: v?.score ?? null, first: r.first, ...(v ? { angle: v.angle, why: v.why } : {}) })
    }
  }
  const line = scoresLine([...notes.values()].map((n) => n.score), bar)
  ctx.emit({ kind: 'log', level: 'info', text: `${line}${remade.size > 0 ? `, ${remade.size} refaite(s)` : ''}` })
  return { notes, remade, line: remade.size > 0 ? `${line}, ${remade.size} refaite(s)` : line }
}
