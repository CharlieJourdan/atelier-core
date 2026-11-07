// `director.plan` when the pipeline has a mix (decision 0022, production-model §7): the presenter by code, the scene pass's
// directives (LLM in run, deterministic in fake), the pictures filled to the curve, then the passes every plan goes
// through (labels, the channel's bricks, animated overlays, budget, checker). Outputs the plan, the priced list,
// `json.directives` and the editable `atelier.timeline/1`. One revision on a failed check: the deterministic directives. The
// check includes the pictures' variety (avatar-qualite): no subject twice within 20 s (director-variety.ts).
import type { NodeOutputs } from '../artefacts'
import { EngineError } from '../errors'
import { GENERATED_CLIP_MAX_SECONDS } from '../../shared/cloud-api'
import { buildTimeline, findAnchorWord, type Directive } from '../formats/directives'
import { checkEditPlan, type GenList } from '../formats/editplan'
import type { Outline } from '../formats/outline'
import { FPS, toFrame, type Beat, type Word } from '../formats/timing'
import type { RunCtx } from '../registry'
import type { Json } from '../types'
import { parseScript } from '../text/script'
import { progress } from './common'
import { resolveBudget } from './director-budget'
import { buildPlan, type BeatDraft, type DirectorParams, type PlanResult } from './director-cuts'
import { SHOT_LENGTHS, fillTrack, placePresenter, screenRows, sentencesOf, sharesByPart, type ScreenParams, type Sentence } from './director-mix'
import { markRecurring, shareClips, SHARE_DEFAULTS } from './director-clips'
import { sponsorWindows } from './sponsor-slots'
import { fakeDirectives, mergeAnswers, scenePass, sentenceStretches, topUpPass } from './director-scenes'
import { earlyCuts, EARLY_CUT_S, snapEarlyCuts } from './director-cutcheck'
import { sentenceRoles } from './director-talk'
import { repeatProblems } from './director-variety'
import { placeCards } from './director-cards'
import { checkScreenTexts } from './director-textcheck'
import { directorMix } from './director-screen'

/**
 * The seconds of generated video and of avatar the list asks for (a clip is cut at the provider's longest). A clip shared by
 * two shots (`sameAs`) is one generation as long as both: `videoItems` counts generations, `sharedItems` the shots they also serve.
 */
export function billedSeconds(list: GenList): { videoItems?: number; videoSeconds?: number; sharedItems?: number; avatarItems?: number; avatarSeconds?: number } {
  const video = list.items.filter((i) => i.kind === 'video.gen' && i.sameAs === undefined)
  const shared = list.items.filter((i) => i.kind === 'video.gen' && i.sameAs !== undefined)
  const avatar = list.items.filter((i) => i.kind === 'avatar')
  const secondsOf = (head: GenList['items'][number]): number => head.constraints.durationS + shared.filter((x) => x.sameAs === head.id).reduce((n, x) => n + x.constraints.durationS, 0)
  return {
    ...(video.length > 0 ? { videoItems: video.length, videoSeconds: video.reduce((n, i) => n + Math.min(GENERATED_CLIP_MAX_SECONDS, Math.ceil(secondsOf(i))), 0) } : {}),
    ...(shared.length > 0 ? { sharedItems: shared.length } : {}),
    ...(avatar.length > 0 ? { avatarItems: avatar.length, avatarSeconds: avatar.reduce((n, i) => n + Math.ceil(i.constraints.durationS), 0) } : {})
  }
}

/** Every beat gets a draft from the directives anchored in it: their on-screen texts become its labels (§21.9 checks them). */
function draftsFrom(directives: readonly Directive[], beats: readonly Beat[], words: readonly Word[], sentences: readonly Sentence[]): Map<number, BeatDraft> {
  const drafts = new Map<number, BeatDraft>()
  for (const d of directives) {
    const s = sentences[d.sentence - 1]
    const k = s ? findAnchorWord(words, (words[s.first] as Word).sentence, d.anchor, s.first) : null
    if (k === null) continue
    const b = beats.find((x) => k >= x.firstWord && k <= x.lastWord)
    if (!b) continue
    const cur = drafts.get(b.i) ?? { beat: b.i, subject: d.subject.slice(0, 200), stockQuery: (d.query ?? d.subject).slice(0, 80), imagePrompt: (d.prompt ?? d.subject).slice(0, 600), labels: [] }
    if (d.text && cur.labels.length < 4) cur.labels.push({ text: d.text, anchorWords: d.anchor })
    drafts.set(b.i, cur)
  }
  for (const b of beats) if (!drafts.has(b.i)) drafts.set(b.i, { beat: b.i, subject: b.text.slice(0, 200), stockQuery: b.text.slice(0, 80), imagePrompt: b.text.slice(0, 600), labels: [] })
  return drafts
}

const pct = (x: number | undefined): number => Math.round((x ?? 0) * 100)
const fmt = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

export async function directMix(
  ctx: RunCtx,
  o: { beats: Beat[]; words: Word[]; outline: Outline; D: number; script: string | null; diagnostics: string[] },
  p: DirectorParams,
  screenRaw: ScreenParams,
  useClaude: boolean
): Promise<NodeOutputs> {
  const { beats, words, outline, D } = o
  const diag = [...o.diagnostics]
  // no clip engine in the pipeline: no clip is planned, whatever the mix asked (issue #114: a clip without an engine went to a demo one)
  const screenIn: ScreenParams = screenRaw.clips ? screenRaw : { ...screenRaw, mix: directorMix(screenRaw.mix, true, diag, true, false) }
  const presenter = p.avatar !== undefined
  // a mix with a budget: the curve is made for this video's length (nodes/director-budget.ts), within what it may cost
  const budgeted = resolveBudget(screenIn, p, D)
  const screen = budgeted.screen
  if (budgeted.plan) diag.push(`budget: ${Math.round(budgeted.plan.total)} credits (${Math.round(budgeted.plan.perMinute)} a minute) for a target of ${Math.round(budgeted.plan.target)}${budgeted.plan.reachable ? '' : ' — not reachable within the floors'}`, ...budgeted.plan.steps.map((s) => `budget: ${s}`))
  const parts = screenRows(screen, presenter, D, diag)
  const sentences = sentencesOf(words, D)
  const scened = useClaude && p.scenePass
  // the presenter on the talk sentences, the pictures on the ones that name something (avatar-qualite part 2)
  const roles = presenter && screen.presenterOnTalk ? await sentenceRoles(ctx, sentences, outline.language, scened, diag) : undefined
  const slots = presenter
    ? placePresenter(
        words,
        sentences,
        parts,
        D,
        { placement: screen.placement, lengthS: screen.mix.shotLengthS?.presenter ?? SHOT_LENGTHS.presenter, ...(screen.presenterStretchS !== undefined ? { stretchS: screen.presenterStretchS } : {}), minShotS: p.minShotS, ...(roles ? { roles } : {}), ...(screen.presenterRunMaxS !== undefined ? { runMaxS: screen.presenterRunMaxS } : {}) },
        diag
      )
    : []
  const startOf = (n: number): number => sentences[n - 1]?.start ?? 0
  const fakes = (): ReturnType<typeof mergeAnswers> => mergeAnswers(sentenceStretches(sentences, p.hookSpanS).map((part) => fakeDirectives(part, slots, parts, words, screen, outline.language)), startOf, screen.repeatWindowS)
  const fill = (directives: readonly Directive[]): ReturnType<typeof fillTrack> =>
    fillTrack({
      words,
      sentences,
      beats,
      parts,
      slots,
      directives,
      D,
      screen,
      minShotS: p.minShotS,
      maxShotS: p.maxShotS,
      ...(p.paceRows ? { paceRows: p.paceRows } : {}),
      aspect: p.aspect,
      styleSuffix: p.styleSuffix,
      prices: p.prices,
      ...(p.avatar ? { presenterPerS: p.avatar.creditsPerSecond } : {}),
      ...(p.clipMotionOnly ? { motionOnly: true } : {}),
      seed: ctx.seed
    })
  // the pictures each sentence gets: its time off the presenter, one picture a ~3.5 s, at least one from a second on (avatar-
  // qualite: 9 directives for 10 shots made two shots of one directive; a short sentence with none, « frotté avec un spray »,
  // was covered by the picture of the sentence before)
  const counts = new Map<number, number>()
  if (scened) {
    for (const s of sentences) {
      const shown = s.end - s.start - slots.reduce((n, sl) => n + Math.max(0, Math.min(sl.end, s.end) - Math.max(sl.start, s.start)), 0)
      if (shown >= 1) counts.set(s.n, Math.max(1, Math.round(shown / 3.5)))
    }
  }
  let merged = scened ? mergeAnswers(await scenePass(ctx, { outline, sentences, slots, parts, words, screen, hookSpanS: p.hookSpanS, counts }, diag), startOf, screen.repeatWindowS) : fakes()
  if (scened) {
    // sentences whose directives ran out get new ones (one more call), never an angle written by code when the director can say
    const first = fill(merged.directives)
    if (first.angles.length > 0) {
      const byShot = new Map(first.items.map((i) => [i.shotIds[0], i]))
      const around = first.shots
        .filter((sh) => sh.track === 'base' && sh.kind !== 'avatar' && first.angles.some((g) => Math.abs(sh.startFrame / FPS - g.startS) < 20))
        .flatMap((sh) => {
          const it = byShot.get(sh.id)
          return it && !first.angles.some((g) => Math.abs(g.startS - sh.startFrame / FPS) < 1e-3) ? [{ startS: sh.startFrame / FPS, subject: it.context.subject, scene: it.shot?.scene ?? it.prompt ?? '' }] : []
        })
      const extra = await topUpPass(ctx, { outline, sentences, screen, gaps: first.angles, around }, diag)
      if (extra.length > 0) merged = { ...merged, directives: [...merged.directives, ...extra].sort((a, b) => a.sentence - b.sentence) }
    }
  }
  // every text the directives write on screen is stated by the script, or rewritten with its words, or removed (director text check)
  if (p.textCheck) {
    const checked = await checkScreenTexts(ctx, merged.directives, { script: o.script ?? words.map((w) => w.w).join(' '), mode: p.textCheck, useClaude: scened }, diag)
    merged = { ...merged, directives: checked.directives }
  }
  const parsed = p.motion && o.script !== null ? parseScript(o.script) : null
  const build = (directives: readonly Directive[]): PlanResult => {
    const filled = fill(directives)
    // documentary cards (style-markets): framed archives, then maps / data cards / timelines over the pictures, on their words
    const carded = screen.cards ? placeCards({ shots: filled.shots, items: filled.items, framed: filled.framed, directives, words, sentences, beats, parts, D, theme: screen.cardTheme }) : null
    const track = carded ? { shots: carded.shots, items: carded.items, diagnostics: [...filled.diagnostics, ...carded.diagnostics] } : filled
    return buildPlan({
      beats,
      words,
      durationS: D,
      title: outline.title,
      script: words.map((w) => w.w).join(' '),
      parsed,
      drafts: draftsFrom(directives, beats, words, sentences),
      p,
      seed: ctx.seed,
      diagnostics: [...diag, ...track.diagnostics],
      track
    })
  }
  let directives = merged.directives
  let result = build(directives)
  // the scene pass's pictures never repeat a subject within 20 s; the deterministic directives describe no scene (their subjects
  // are key terms): their repeats are only said
  const check = (r: PlanResult, scenes: boolean): string[] => [...checkEditPlan(r.plan, r.list, toFrame(D)), ...(scenes && screen.repeatWindowS > 0 ? repeatProblems(r.plan, r.list, screen.repeatWindowS) : [])]
  let problems = check(result, scened)
  if (problems.length > 0) {
    ctx.emit({ kind: 'log', level: 'warn', text: `checker: ${problems.join('; ')} — revising once` })
    directives = fakes().directives
    result = build(directives)
    problems = check(result, false)
    if (problems.length > 0) throw new EngineError('schema', `the edit plan failed its check twice: ${problems.join('; ')}`)
  }
  const { plan } = result
  if (screen.repeatWindowS > 0) for (const r of repeatProblems(plan, result.list, screen.repeatWindowS)) plan.diagnostics.push(`variety: ${r}`)
  let list = markRecurring(result.list, merged.recurring)
  if (p.clipShotsPerGeneration === 2) {
    const shared = shareClips(plan, list, { ...SHARE_DEFAULTS, ...(p.clipPairShare !== undefined ? { pairShare: p.clipPairShare } : {}), ...(p.clipPairSameAction ? { sameAction: true } : {}) })
    list = shared.list
    if (shared.pairs > 0) plan.diagnostics.push(`clips: ${shared.pairs} pairs of shots share one generation (wide, then a tight crop)`)
  }
  // a pipeline that cuts on the word (cutLeadS) has its early pictures listed, on the heard times (record 0059); never a stop
  if (screen.cutLeadS !== undefined) {
    const maxS = Math.max(EARLY_CUT_S, screen.cutLeadS + 0.05)
    const snapped = snapEarlyCuts(plan, list, words, { lead: screen.cutLeadS, maxS, minS: Math.min(p.minShotS, 1.1), runMaxS: screen.presenterRunMaxS ?? Infinity })
    if (snapped > 0) plan.diagnostics.push(`cuts on the word: ${snapped} early picture(s) moved onto their word`)
    const early = earlyCuts(plan, list, words, maxS)
    for (const e of early) plan.diagnostics.push(`early cut: ${e.shot} starts ${e.earlyS.toFixed(2)} s before « ${e.word} »`)
    if (early.length > 0) ctx.emit({ kind: 'log', level: 'warn', text: `${early.length} image(s) avant leur mot : ${early.map((e) => `« ${e.word} » ${e.earlyS.toFixed(2)} s`).join(', ')}` })
  }
  const shares = sharesByPart(plan.shots, parts)
  for (const r of shares) {
    const kinds = Object.keys({ ...r.target, ...r.achieved })
    plan.diagnostics.push(`shares ${fmt(r.fromS)}–${fmt(r.toS)}: ${kinds.map((k) => `${k} ${pct(r.achieved[k])} % (${pct(r.target[k as keyof typeof r.target])})`).join(', ')}`)
  }
  const timeline = buildTimeline(plan, list, words, {
    ...(screen.pictureStyle ? { style: screen.pictureStyle } : {}),
    people: screen.people,
    sponsor: sponsorWindows(outline, words, D, sentences).map(({ startS, endS, anchor }) => ({ startS, endS, anchor }))
  })
  const presenterShots = plan.shots.filter((s) => s.kind === 'avatar').length
  progress(ctx, 1, 1, `${plan.tracks.base.length} plans dont ${presenterShots} du présentateur, ${list.totals.credits} crédits`)
  return {
    plan: { value: plan as unknown as Json, meta: { frames: plan.frames, shots: plan.tracks.base.length, labels: plan.tracks.labels.length, presenterShots, mode: 'mix', demo: !scened } },
    genlist: {
      value: list as unknown as Json,
      meta: {
        credits: list.totals.credits,
        items: list.totals.items,
        stock: (list.totals.byKind['stock.photo'] ?? 0) + (list.totals.byKind['stock.video'] ?? 0),
        ...billedSeconds(list)
      }
    },
    directives: { value: directives as unknown as Json, meta: { mode: 'mix', count: directives.length, recurring: merged.recurring as unknown as Json, demo: !scened } },
    timeline: {
      value: timeline as unknown as Json,
      meta: {
        shots: timeline.shots.length,
        overlays: timeline.overlays.length,
        parts: shares.map((r) => ({ fromS: r.fromS, toS: Math.round(r.toS * FPS) / FPS, target: r.target, achieved: r.achieved })) as unknown as Json
      }
    }
  }
}
