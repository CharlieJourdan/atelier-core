// The edit review (qualite-montage, METHODE-CLONAGE « Lessons from Charlie's second review »): every render is reviewed before anyone sees
// it, shot by shot against the words and their times: does the picture illustrate this sentence (Claude looks), is it the same picture
// as a recent one, is it held with nothing moving, does a film freeze, does the hook wait, are the texts dates and figures said on their
// word and in the video's language, does a map say whose lands it shades, does the voice break or click, is the music too loud. The render
// fixes what it can on its own plan (drop a shot into a neighbour, move a boundary, a slow camera on a held picture, a wrong text off),
// renders again (only the touched segments: they are cached by spec) and reviews again, `rounds` times at most; what is left is reported.
// The real errors among them (blocking.ts, decision 0102) are measured by code and never delivered: a bed too loud under the voice is
// lowered and mixed again, a black or repeated picture is measured on the film itself, and a film that still has a real error after the
// rounds is refused (`blocking: 'refuse'`, the default).
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { EditPlan, Shot } from '../formats/editplan'
import { FPS, type Word } from '../formats/timing'
import { energyEnvelope } from '../media/probe'
import type { RunCtx } from '../registry'
import { blockingOf, refusal } from './blocking'
import { blackDefects, filmThumbs, frameDuplicates, measureBlack, FILM_LIMITS, type FilmLimits } from './blocking-film'
import { musicGapDb, soundHoles, timingDrift, wordsCut, SOUND_LIMITS, type SoundLimits } from './blocking-sound'
import { dropFix, languageOf, reviewPlan, saidBetween, REVIEW_LIMITS, type PlanReviewInput, type ReviewLimits, type SeenShot } from './checks'
import { lookAtShots, type LookCache } from './look'
import { frozenDefects, measureFrozen, voiceDefects } from './media'
import { applyPatches, choosePatches } from './repair'
import { fmtS, type Defect, type ReviewReport, type ReviewRound } from './types'

export type { Defect, Patch, ReviewReport } from './types'
export { REVIEW_LIMITS, languageOf, reviewPlan } from './checks'
export { applyPatches, choosePatches } from './repair'
export { BLOCKING_KINDS, blockingOf, isBlocking, refusalText } from './blocking'

export interface RenderedFilm {
  file: string
  seen: SeenShot[]
}

export interface ReviewLoopInput {
  ctx: RunCtx
  plan: EditPlan
  words: readonly Word[]
  voice: string
  /** The voice's own longest pause (`voice.tts` `maxPauseS`, in the voice's meta): a pause after a clause up to it is not a cut. */
  voicePauseMaxS?: number
  music: boolean
  /** The music bed the render mixes: its level under the voice is measured on it (the mix's pauses hold the bed's lifts). */
  musicFile?: string | null
  /** Re-renders allowed after the first (0 = review only). */
  rounds: number
  /** Claude looks at every picture shot. */
  look: boolean
  clipS: (s: Shot) => number | undefined
  isCard: (s: Shot) => boolean
  /** One render of the plan, the music bed `musicDb` dB quieter (0: as made). */
  render: (plan: EditPlan, o: { musicDb: number }) => Promise<RenderedFilm>
  dir: string
  limits?: Partial<ReviewLimits>
  sound?: Partial<SoundLimits>
  film?: Partial<FilmLimits>
  /** A real error left after the rounds: the film is refused (default) or only reported (a test render still to be compared). */
  blocking?: 'refuse' | 'report'
}

const ORDER: Record<Defect['severity'], number> = { fail: 0, warn: 1 }
const note = (e: unknown): string => (e instanceof Error ? e.message.slice(0, 160) : String(e))
const r2 = (x: number): number => Math.round(x * 100) / 100

/** Renders the plan, reviews the film, fixes and renders again until nothing fixable is left or the rounds are spent; a film with a
 *  real error left is refused. */
export async function renderReviewed(o: ReviewLoopInput): Promise<{ plan: EditPlan; film: RenderedFilm; report: ReviewReport }> {
  const L = { ...REVIEW_LIMITS, ...o.limits }
  const S = { ...SOUND_LIMITS, ...o.sound }
  const FL = { ...FILM_LIMITS, ...o.film }
  const ctx = o.ctx
  const language = languageOf(o.words)
  const notes: string[] = []
  const looks = new Map<string, { fits: 'yes' | 'loose' | 'no'; why: string }>()
  const cache: LookCache = { get: (k) => looks.get(k), set: (k, v) => void looks.set(k, v) }
  let looked = o.look && ctx.services.claude !== undefined
  if (o.look && !looked) notes.push('Claude n’est pas connecté : les images n’ont pas été regardées.')
  // the voice and the bed do not change between rounds: they are measured once
  let voiceChecks: Defect[] | null = null
  let gapDb: number | null = null
  let musicDb = 0
  const rounds: ReviewRound[] = []
  let plan = o.plan
  let film = await o.render(plan, { musicDb })
  for (let round = 0; ; round++) {
    const input: PlanReviewInput = { plan, words: o.words, language, clipS: o.clipS, isCard: o.isCard, seen: film.seen, limits: L }
    const defects = reviewPlan(input)
    const media = ctx.services.media
    const filmS = plan.frames / FPS
    const cut = wordsCut(o.words, filmS)
    if (cut) defects.push(cut)
    let musicFix: number | null = null
    if (media) {
      const frozen = await measureFrozen(media, film.file, L.holdMaxS, filmS, ctx.signal)
      const known = new Set(defects.filter((d) => d.kind === 'held' || d.kind === 'film_short').map((d) => d.shotId))
      defects.push(...frozenDefects(plan, frozen, L.holdMaxS, (s) => s.kind === 'motion' || s.kind === 'stock.photo' || s.kind === 'image.gen').filter((d) => !d.shotId || !known.has(d.shotId)))
      try {
        defects.push(...blackDefects(await measureBlack(media, film.file, FL.blackMinS, ctx.signal), FL.blackMinS))
        const dupes = new Set(defects.filter((d) => d.kind === 'duplicate').map((d) => d.shotId as string))
        const thumbs = await filmThumbs(media, film.file, plan, o.dir, ctx.signal)
        defects.push(...frameDuplicates(plan, thumbs, { known: dupes, dropFor: (id) => dropFix(input, id, dupes), limits: FL, seen: film.seen }))
        defects.push(...soundHoles(await energyEnvelope(media, film.file, ctx.signal), filmS, S))
      } catch (e) {
        if (ctx.signal.aborted) throw e
        notes.push(`L’image ou le son du film n’ont pas pu être mesurés : ${note(e)}`)
      }
      if (voiceChecks === null && o.words.length > 0) {
        try {
          const env = await energyEnvelope(media, o.voice, ctx.signal)
          voiceChecks = voiceDefects(env, o.words, o.voicePauseMaxS !== undefined ? { pauseMaxS: o.voicePauseMaxS } : {})
          const drift = timingDrift(env, o.words, S)
          if (drift) voiceChecks.push(drift)
          if (o.music && o.musicFile) gapDb = musicGapDb(env, await energyEnvelope(media, o.musicFile, ctx.signal), o.words)
        } catch (e) {
          if (ctx.signal.aborted) throw e
          voiceChecks = []
          notes.push(`Le son n’a pas pu être mesuré : ${note(e)}`)
        }
      }
      defects.push(...(voiceChecks ?? []))
      // the bed's level under the voice, with the gain this review already gave it
      if (gapDb !== null && gapDb - musicDb < S.musicUnderVoiceDb) {
        const now = gapDb - musicDb
        defects.push({ kind: 'music_loud', severity: 'fail', atS: 0, endS: r2(o.words.at(-1)?.end ?? 0), detail: `La musique n’est que ${now.toFixed(1)} dB sous la voix pendant qu’elle parle (au moins ${S.musicUnderVoiceDb} dB).` })
        // one dB more than needed, so the next measure is clear of the limit
        musicFix = Math.max(-40, Math.round((musicDb - (S.musicUnderVoiceDb - now) - 1) * 10) / 10)
      }
    }
    if (looked) {
      try {
        const keyOf = (s: Shot): string => `${s.genItem ?? s.id}|${(s.alsoItems ?? []).join(',')}|${saidBetween(o.words, s.startFrame / FPS, s.endFrame / FPS)}`
        const off = await lookAtShots(ctx, { plan, film: film.file, dir: o.dir, said: (s) => saidBetween(o.words, s.startFrame / FPS, s.endFrame / FPS), cache, keyOf, language })
        const offIds = new Set(off.map((d) => d.shotId as string))
        for (const d of off) {
          const fix = dropFix(input, d.shotId as string, offIds)
          defects.push(fix ? { ...d, fix } : d)
        }
      } catch (e) {
        if (ctx.signal.aborted) throw e
        looked = false
        notes.push(`Le regard sur les images a échoué : ${note(e)}`)
      }
    }
    defects.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.atS - b.atS)
    const chosen = round < o.rounds ? choosePatches(defects) : []
    const next = chosen.length > 0 ? applyPatches(plan, chosen) : { plan, applied: [] }
    const remix = round < o.rounds && musicFix !== null && musicFix !== musicDb
    rounds.push({ round, defects, applied: next.applied })
    ctx.emit({ kind: 'log', level: defects.length > 0 ? 'warn' : 'info', text: `edit review ${round + 1}: ${defects.length} defect(s), ${next.applied.length} fixed by the render${remix ? `, music to ${musicFix} dB` : ''}` })
    if (next.applied.length === 0 && !remix) break
    plan = next.plan
    if (remix) {
      musicDb = musicFix as number
      notes.push(`Musique baissée de ${(-musicDb).toFixed(1)} dB pour rester sous la voix.`)
    }
    const superseded = film.file
    film = await o.render(plan, { musicDb })
    // the film this round replaces is not delivered: its (large) file goes now, not at the end of the run
    if (superseded !== film.file) await rm(superseded, { force: true }).catch(() => undefined)
  }
  const last = rounds.at(-1) as ReviewRound
  const blocked = blockingOf(last.defects)
  const report: ReviewReport = { schema: 'atelier.review/1', rounds, left: last.defects, looked, notes, blocked, ...(musicDb !== 0 ? { musicDb } : {}) }
  if (blocked.length > 0 && (o.blocking ?? 'refuse') === 'refuse') {
    // the evidence stays beside the refused film
    await writeFile(path.join(o.dir, 'review-refused.json'), JSON.stringify(report, null, 2)).catch(() => undefined)
    ctx.emit({ kind: 'log', level: 'warn', text: `edit review: ${blocked.length} real error(s) left — ${blocked.slice(0, 4).map((d) => `${fmtS(d.atS)} ${d.kind}`).join(', ')}` })
    throw refusal(blocked)
  }
  return { plan, film, report }
}
