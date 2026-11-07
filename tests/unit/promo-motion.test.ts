// The channel's own promo (promo-motion, research note promo-motion-2026-11 (old repository)): read from the channel's sponsor asset (`type : promo`),
// placed in the script after the hook (about 1:25, as the reference), at the end, on the passage that already speaks of the offer, or
// nowhere; drawn by our motion bricks the same for every video, adapted to each, or made per video; the agent asks what the channel
// does not say. Fake browser and fake ffmpeg: no Chromium, no network.
import { afterEach, describe, expect, it } from 'vitest'
import { cardFor, fold, PromoCard, siteStem } from '../../src/engine/formats/promo'
import { Outline } from '../../src/engine/formats/outline'
import { effectiveRule, parseSponsor, promoUnknowns } from '../../src/engine/formats/sponsor'
import type { Word } from '../../src/engine/formats/timing'
import { PROMO_TIMELINE, promoHtml, qrSvg } from '../../src/engine/motion/promo'
import { promoPage } from '../../src/engine/motion/promo-render'
import { RUNTIME_JS } from '../../src/engine/motion/runtime'
import { editSponsor } from '../../src/engine/nodes/edit-sponsor'
import { scriptSponsor } from '../../src/engine/nodes/script-sponsor'
import { promoPassage, promoPassages } from '../../src/engine/nodes/script-promo'
import type { EngineServices, MediaService } from '../../src/engine/services'
import { openQuestions } from '../../src/engine/technologies/propose'
import { findAnchor, parseScript } from '../../src/engine/text/script'
import { openDatabase } from '../../src/main/db'
import { ChannelSponsors, withSetting } from '../../src/main/production/sponsors'
import { fakeBrickBrowser, fakeMedia } from './brick-fixture'
import { art, makeCtx, RESOURCES, tempDir, testServices } from './engine-node-helpers'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})
const work = (label: string): string => {
  const t = tempDir(label)
  cleanups.push(t.cleanup)
  return t.dir
}

/** Charlie's channel promo as he would type it (the reference: exemple-compagnon.fr, the book, 1:25). */
const PROMO = [
  'type : promo',
  'nom : Le Cahier d’Gaston',
  'lien : https://exemple-compagnon.fr/yt',
  'titre : Tout le cahier, au même endroit',
  'sous-titre : Le Cahier d’Gaston · par Gaston Martin, compagnon charpentier',
  'site : exemple-compagnon.fr',
  'visuel : produit'
].join('\n')

describe('the promo in the channel’s asset', () => {
  it('reads a promo: its card, our motion design by default, no reminder, a mention of about 14 s', () => {
    const s = parseSponsor(PROMO)
    expect(s).toMatchObject({ kind: 'promo', name: 'Le Cahier d’Gaston', screen: 'motion', rule: { reminder: false, seconds: 14 } })
    expect(s?.promo).toMatchObject({ headline: 'Tout le cahier, au même endroit', site: 'exemple-compagnon.fr', link: 'https://exemple-compagnon.fr/yt', qr: true, seconds: 9.72 })
    // a clip the owner made wins over the drawn card
    expect(parseSponsor(`${PROMO}\nmédia : C:\\promo\\ma-promo.mp4`)?.screen).toBe('media')
    // a sponsor stays a sponsor
    expect(parseSponsor('nom : Poêlo Clean\nlien : https://poelo.example')).toMatchObject({ kind: 'sponsor', screen: 'card', rule: { reminder: true } })
  })

  it('says what is not set yet, and reads the settings in French', () => {
    expect(promoUnknowns(parseSponsor(PROMO)!)).toEqual(['place', 'mode'])
    const set = parseSponsor(`${PROMO}\nplace : après l'accroche\nmode : adaptée\nmoment : 1:25`)!
    expect(set).toMatchObject({ place: 'after_hook', reuse: 'adapt', atS: 85 })
    expect(promoUnknowns(set)).toEqual([])
    expect(parseSponsor(`${PROMO}\nplace : fin\nmode : identique`)).toMatchObject({ place: 'end', reuse: 'same' })
    expect(parseSponsor(`${PROMO}\nplace : mention\nmode : par vidéo`)).toMatchObject({ place: 'mention', reuse: 'per_video' })
    expect(parseSponsor(`${PROMO}\nplace : aucune`)?.place).toBe('none')
    expect(promoUnknowns(parseSponsor('nom : Poêlo Clean')!)).toEqual([])
  })

  it('reads the same promo as JSON', () => {
    const s = parseSponsor(JSON.stringify({ kind: 'promo', name: 'Le Cahier d’Gaston', link: 'https://exemple-compagnon.fr/yt', reuse: 'same', place: 'end' }))
    expect(s).toMatchObject({ kind: 'promo', screen: 'motion', reuse: 'same', place: 'end', promo: { site: 'exemple-compagnon.fr', headline: 'Le Cahier d’Gaston' } })
  })

  it('writes the agent’s answers back into the asset, lines or JSON', () => {
    const lines = withSetting(withSetting(PROMO, 'place', 'after_hook'), 'mode', 'same')
    expect(parseSponsor(lines)).toMatchObject({ place: 'after_hook', reuse: 'same' })
    expect(withSetting(lines, 'place', 'end').match(/^place :/gmu)).toHaveLength(1)
    expect(parseSponsor(withSetting(lines, 'place', 'end'))?.place).toBe('end')
    const json = withSetting(JSON.stringify({ kind: 'promo', name: 'X', link: 'https://x.example' }), 'mode', 'per_video')
    expect(parseSponsor(json)?.reuse).toBe('per_video')
  })

  it('the placement rule: after the hook aims at its moment (1:25 by default), the end goes before the closing', () => {
    const s = parseSponsor(PROMO)!
    expect(effectiveRule(s)).toMatchObject({ where: 'after_hook', windowS: [85, 85], reminder: false })
    expect(effectiveRule({ ...s, atS: 60 }).windowS).toEqual([60, 60])
    expect(effectiveRule({ ...s, place: 'end' })).toMatchObject({ where: 'before_end', reminder: false })
  })
})

// ---- the script ---------------------------------------------------------------------------------------------------------------------

/** A 3-minute script of 12 paragraphs (about 180 words a minute in the fake voice: 45 words each, 15 s a paragraph). */
const PARAGRAPHS = Array.from({ length: 12 }, (_, i) =>
  Array.from({ length: 5 }, (_, j) => `Phrase ${i + 1}.${j + 1} de la partie ${i + 1} parle du mur noir de la chambre.`).join(' ')
)
const outlineOf = (title = 'Le mur noir de la chambre du fond'): Outline =>
  Outline.parse({
    language: 'fr',
    title,
    shape: 'howto',
    kind: 'lesson',
    promise: 'comprendre',
    hook: 'le mur noir',
    beats: [
      { index: 0, purpose: 'accroche', summary: 'a', wordBudget: 90, tags: ['hook'], anchor: 'Phrase 1.1 de la partie' },
      { index: 1, purpose: 'suite', summary: 'b', wordBudget: 450, tags: [], anchor: 'Phrase 3.1 de la partie' }
    ],
    chapters: []
  })
const scriptArt = (paragraphs: string[]) => art('text.script', { value: paragraphs.join('\n\n') })
const ctx = () => makeCtx(testServices(work('promo-script')), { node: scriptSponsor as never, minutes: 3 })
async function place(promo: string, paragraphs = PARAGRAPHS) {
  const r = await scriptSponsor.fake(ctx(), { script: scriptArt(paragraphs), outline: art('json.outline', { value: outlineOf() as never }), sponsor: art('text.input', { value: promo }) }, scriptSponsor.params.parse({ wpm: 180 }) as never)
  return { text: r.text?.value as string, outline: Outline.parse(r.outline?.value), meta: r.text?.meta ?? {} }
}
/** Seconds of narration before the sentence of `anchor` (180 words a minute). */
const secondsAt = (text: string, anchor: string): number => {
  const parsed = parseScript(text)
  return ((parsed.sentences[findAnchor(parsed, anchor) ?? -1]?.first ?? -1) / 180) * 60
}

describe('the promo in the script (script.sponsor)', () => {
  it('after the hook: one mention near 1:25, in the reference’s shape, no reminder, the site said', async () => {
    const r = await place(`${PROMO}\nplace : après l'accroche`)
    expect(r.outline.sponsor?.map((m) => m.kind)).toEqual(['mention'])
    const m = r.outline.sponsor![0]!
    // the paragraph break nearest to 85 s (a paragraph is 15 s): 75 or 90 s
    expect(Math.abs(secondsAt(r.text, m.anchors[0]!) - 85)).toBeLessThanOrEqual(10)
    expect(m.text).toMatch(/^Petite parenthèse\./u)
    expect(m.text).toContain('exemple-compagnon.fr')
    expect(m.text).toContain('Le Cahier d’Gaston')
    for (const a of m.anchors) expect(findAnchor(parseScript(r.text), a)).not.toBeNull()
  })

  it('a moment set by the channel moves it; an unknown placement goes after the hook (and is asked)', async () => {
    const at60 = await place(`${PROMO}\nplace : après l'accroche\nmoment : 1:00`)
    expect(Math.abs(secondsAt(at60.text, at60.outline.sponsor![0]!.anchors[0]!) - 60)).toBeLessThanOrEqual(8)
    const unknown = await place(PROMO)
    expect(Math.abs(secondsAt(unknown.text, unknown.outline.sponsor![0]!.anchors[0]!) - 85)).toBeLessThanOrEqual(10)
  })

  it('at the end: the paragraph just before the closing one', async () => {
    const r = await place(`${PROMO}\nplace : fin`)
    const paras = r.text.split(/\n\s*\n/)
    expect(paras).toHaveLength(PARAGRAPHS.length + 1)
    expect(paras.at(-2)).toBe(r.outline.sponsor?.[0]?.text)
    expect(paras.at(-1)).toBe(PARAGRAPHS.at(-1))
  })

  it('on the mention: the passage that already speaks of the offer, as said aloud, the text unchanged', async () => {
    const said = [
      ...PARAGRAPHS.slice(0, 5),
      'Petite parenthèse. Mes 44 ans de chantier, je les ai écrits dans le cahier. Il est sur exemple-compagnon-tout-en-un-mot.fr. Lien en haut de la description.',
      ...PARAGRAPHS.slice(5)
    ]
    expect(promoPassage(said, parseSponsor(PROMO)!)).toBe(5)
    const r = await place(`${PROMO}\nplace : mention`, said)
    expect(r.text).toBe(said.join('\n\n'))
    expect(r.outline.sponsor).toHaveLength(1)
    expect(r.outline.sponsor![0]!.anchors).toHaveLength(4)
    // a script that never speaks of it: no promo, and a warning that says why
    const none = await place(`${PROMO}\nplace : mention`)
    expect(none.outline.sponsor).toBeUndefined()
    expect(JSON.stringify(none.meta.warnings)).toMatch(/pas de passage|n’en a pas/u)
  })

  it('on the mention: a later passage that speaks of the offer again is its end slot (the reference shows the card twice)', async () => {
    const said = [
      ...PARAGRAPHS.slice(0, 3),
      'Petite parenthèse. Mes 44 ans de chantier, je les ai écrits dans le cahier. Il est sur exemple compagnon, tout en un mot, point F R. On commence.',
      ...PARAGRAPHS.slice(3),
      'Si vous voulez tout retrouver au même endroit, c’est sur exemple compagnon, tout en un mot, point F R. Le lien est en haut de la description.',
      'À la semaine prochaine sur le chantier.'
    ]
    expect(promoPassages(said, parseSponsor(PROMO)!)).toEqual([3, said.length - 2])
    const r = await place(`${PROMO}\nplace : mention`, said)
    expect(r.text).toBe(said.join('\n\n'))
    expect(r.outline.sponsor?.map((m) => m.kind)).toEqual(['mention', 'reminder'])
    expect(r.outline.sponsor?.map((m) => m.text)).toEqual([said[3], said.at(-2)])
    // « point F R. » reads as an initial: the end passage is one sentence, so one anchor
    expect(r.outline.sponsor![1]!.anchors).toHaveLength(1)
    // each slot's anchors point at its own passage, not at the other one
    const parsed = parseScript(r.text)
    const at = (a: string): number => parsed.sentences[findAnchor(parsed, a)!]!.first
    expect(at(r.outline.sponsor![1]!.anchors[0]!)).toBeGreaterThan(at(r.outline.sponsor![0]!.anchors.at(-1)!))
  })

  it('no promo: the script passes as it is', async () => {
    const r = await place(`${PROMO}\nplace : aucune`)
    expect(r.text).toBe(PARAGRAPHS.join('\n\n'))
    expect(r.outline.sponsor).toBeUndefined()
    expect(r.meta.sponsor).toBe('promo-none')
  })

  it('finds the site as it is said aloud', () => {
    expect(siteStem('https://exemple-compagnon.fr/yt')).toBe('exemplecompagnon')
    expect(fold('exemple-compagnon-tout-en-un-mot.fr')).toContain('exemplecompagnon')
  })
})

// ---- the card of each video ---------------------------------------------------------------------------------------------------------

describe('the promo of each video (reuse modes)', () => {
  const card = parseSponsor(PROMO)!.promo!
  const a = { title: 'Le mur noir de la chambre du fond' }
  const b = { title: 'La gouttière qui déborde' }

  it('the same each time: the same card, the same page, the same clip key for every video', async () => {
    expect(cardFor(card, 'same', a)).toEqual(card)
    expect(cardFor(card, 'same', b)).toEqual(card)
    const o = { libraryRoot: RESOURCES, width: 1920, height: 1080, frames: 292 }
    const [pa, pb] = await Promise.all([promoPage(cardFor(card, 'same', a), o), promoPage(cardFor(card, 'same', b), o)])
    expect(pa.key).toBe(pb.key)
    expect(pa.html).toBe(pb.html)
  })

  it('adapted: the offer stays, its text speaks of the video (or says what the script wrote for it)', async () => {
    const ca = cardFor(card, 'adapt', a)
    const cb = cardFor(card, 'adapt', b)
    expect(ca.headline).toBe(card.headline)
    expect(ca.site).toBe(card.site)
    expect(ca.subline).toContain('Le mur noir')
    expect(cb.subline).toContain('gouttière')
    expect(cardFor(card, 'adapt', { ...a, said: { headline: 'Tout le chapitre moisissure' } }).headline).toBe('Tout le chapitre moisissure')
    const o = { libraryRoot: RESOURCES, width: 1920, height: 1080, frames: 292 }
    expect((await promoPage(ca, o)).key).not.toBe((await promoPage(cb, o)).key)
  })

  it('made per video: the video’s title as the headline, the layout varied from one video to the next', () => {
    const ca = cardFor(card, 'per_video', a)
    expect(ca.headline).toContain('Le mur noir')
    const sides = ['Le mur noir', 'La gouttière', 'Le salpêtre', 'La cheminée', 'Les combles'].map((title) => cardFor(card, 'per_video', { title }).side)
    expect(new Set(sides).size).toBe(2)
    expect(PromoCard.safeParse(ca).success).toBe(true)
  })
})

// ---- the page and the clip ----------------------------------------------------------------------------------------------------------

describe('the promo’s page (motion bricks)', () => {
  const card = parseSponsor(PROMO)!.promo!
  const ctx0 = { width: 1920, height: 1080, durationS: 9.72, fontCss: '' }

  it('lays out every piece with the reference’s timings, its text escaped, and the QR code of the link', () => {
    const html = promoHtml({ ...card, headline: 'Tout <le> cahier' }, ctx0, { visual: 'data:image/png;base64,AAAA', logo: null })
    expect(html).toContain('Tout &lt;le&gt; cahier')
    expect(html).toContain(`data-anim="blurleft" data-at="${PROMO_TIMELINE.visual.at.toFixed(2)}"`)
    expect(html).toContain(`data-at="${PROMO_TIMELINE.qrCaption.at.toFixed(2)}"`)
    expect(html).toContain('exemple-compagnon.fr')
    expect(html).toContain(qrSvg('https://exemple-compagnon.fr/yt', 386))
    // no file and no network: pictures come in as data: URIs
    expect(html).not.toMatch(/(?:src|href)="(?:https?:|file:)/u)
    // the screenshot variant: a browser window, a push in and a pointer that clicks
    const scr = promoHtml({ ...card, visual: { ...card.visual, kind: 'screen' } }, ctx0, { visual: 'data:image/png;base64,AAAA', logo: 'data:image/png;base64,BBBB' })
    expect(scr).toContain('data-zoom')
    expect(scr).toContain('data-move=')
    expect(scr).toContain('data-click=')
    expect(scr).toContain('data-anim="reveal"')
    expect(() => promoHtml(card, { ...ctx0, width: 1080, height: 1920 }, { visual: null, logo: null })).toThrow(/16:9/)
  })

  it('a later address: the address, its link line, the QR card and its caption come in together from `linkAtS` (reference 2: 5.7 s)', () => {
    const at = (html: string, cls: string): number => Number(new RegExp(`class="${cls}"[^>]*data-at="([\\d.]+)"`, 'u').exec(html)?.[1])
    const v = { visual: 'data:image/png;base64,AAAA', logo: null }
    const early = promoHtml(card, ctx0, v)
    const late = promoHtml({ ...card, linkAtS: 5.7 }, ctx0, v)
    expect(at(early, 'site')).toBeCloseTo(PROMO_TIMELINE.site.at, 2)
    expect(at(late, 'site')).toBeCloseTo(5.7, 2)
    for (const [cls, key] of [['lk', 'linkLine'], ['qr', 'qr'], ['cap', 'qrCaption']] as const) {
      expect(at(late, cls) - at(late, 'site')).toBeCloseTo(PROMO_TIMELINE[key].at - PROMO_TIMELINE.site.at, 2)
    }
    // the book, the headline and its line keep their moments
    expect(at(late, 'hl')).toBe(at(early, 'hl'))
    expect(at(late, 'vis')).toBe(at(early, 'vis'))
    // the channel's asset says it in French
    expect(parseSponsor(`${PROMO}\narrivée du site : 5,7 s`)?.promo?.linkAtS).toBe(5.7)
  })

  it('the runtime’s new presets: out of a blur while it fades in, the pointer’s travel and its click', () => {
    const root: Record<string, unknown> = {}
    new Function('window', 'document', RUNTIME_JS)(root, undefined)
    const m = root.__atelierMotion as {
      look: (p: string, a: number, q: number, dx: number, dy: number, blur: number, curve: string | null) => { o: number; tx: number; ty: number; sx: number; blur: number }
      pointer: (path: number[], at: number, dur: number, click: number | null, t: number) => { x: number; y: number; s: number }
    }
    expect(m.look('blur', 0, 0, 0, 20, 12, 'inOut')).toMatchObject({ o: 0, ty: 20, blur: 12 })
    expect(m.look('blur', 1, 0, 0, 20, 12, 'inOut')).toMatchObject({ o: 1, ty: 0, blur: 0 })
    expect(m.look('blurleft', 0.5, 0, 70, 0, 14, 'out').tx).toBeLessThan(0)
    expect(m.look('reveal', 0, 0, 0, 0, 10, null).sx).toBeCloseTo(0.82, 5)
    // the old presets do not blur
    expect(m.look('rise', 0.2, 0, 0, 40, 12, null).blur).toBe(0)
    expect(m.pointer([0, 0, 100, 50], 1, 1, 3, 0.5)).toMatchObject({ x: 0, y: 0, s: 1 })
    expect(m.pointer([0, 0, 100, 50], 1, 1, 3, 2.5)).toMatchObject({ x: 100, y: 50 })
    expect(m.pointer([0, 0, 100, 50], 1, 1, 3, 3).s).toBeCloseTo(0.84, 5)
  })
})

/** Words of a few sentences, 0.3 s each, 0.5 s of silence between sentences. */
function wordsOf(sentences: string[]): Word[] {
  const out: Word[] = []
  let t = 0.2
  sentences.forEach((s, i) => {
    for (const w of s.split(' ')) {
      out.push({ w, start: t, end: t + 0.26, sentence: i, paragraph: i })
      t += 0.3
    }
    t += 0.5
  })
  return out
}

describe('the promo on screen (edit.sponsor)', () => {
  const SENT = ['Le mur noir revient chaque hiver.', 'Petite parenthèse.', 'Le cahier est sur exemple-compagnon.fr.', 'Lien en haut de la description.', 'On commence.']
  const words = wordsOf(SENT)
  const frames = Math.round(((words.at(-1) as Word).end + 0.4) * 30)
  const plan = {
    schema: 'atelier.editplan/1',
    fps: 30,
    size: [1920, 1080],
    frames,
    tracks: { base: ['s1'], overlay: [], labels: [] },
    captionsPreset: 'highlight',
    shots: [{ id: 's1', track: 'base', startFrame: 0, endFrame: frames, kind: 'hold', transitionIn: 'cut', role: 'base', beat: 0 }],
    chapters: [],
    diagnostics: []
  }
  const outlineFor = (title: string) => ({
    ...outlineOf(title),
    sponsor: [{ kind: 'mention' as const, text: SENT.slice(1, 4).join(' '), anchors: ['Petite parenthèse', 'Le cahier est sur', 'Lien en haut de'], seconds: 4 }]
  })
  /** The fake ffmpeg of the bricks' tests, with the H.264 encoder the promo's clip needs. */
  const media = (): MediaService & { runs: string[][] } => {
    const m = fakeMedia()
    const run = m.run.bind(m)
    const answer = (text: string) => Promise.resolve({ stdout: Buffer.from(text), stderr: '' })
    return {
      ...m,
      runs: m.runs,
      run: (tool, args, opts) =>
        args.includes('-encoders') ? answer(' V....D libx264   H.264\n') : args.includes('-filters') ? answer(['drawtext', 'geq', 'alphamerge', 'overlay'].map((f) => ` T.. ${f}  x\n`).join('')) : run(tool, args, opts)
    }
  }
  const draw = (dir: string, sponsor: string, title: string, services: Partial<EngineServices>, ctx = makeCtx({ ...testServices(dir), ...services })) =>
    editSponsor.run(
      ctx,
      { plan: art('json.editplan', { value: plan as never }), outline: art('json.outline', { value: outlineFor(title) as never }), words: art('json.words', { value: words as never }), sponsor: art('text.input', { value: sponsor }) },
      editSponsor.params.parse({})
    )

  it('lays the drawn clip from the mention’s first word, cut in, its length kept; the same promo is drawn once for every video', async () => {
    const dir = work('promo-screen')
    const browser = fakeBrickBrowser()
    const services = { browser, media: media() }
    const promo = `${PROMO}\nmode : identique\nplace : mention`
    const first = await draw(dir, promo, 'Le mur noir de la chambre du fond', services)
    const layers = first.slots?.value as { role: string; enter: string; video: boolean; durationS: number; startS: number; endS: number }[]
    expect(layers).toHaveLength(1)
    expect(layers[0]).toMatchObject({ role: 'promo', enter: 'cut', video: true, durationS: 9.733333333333333 })
    const firstWord = words.findIndex((w) => w.sentence === 1)
    expect(layers[0]!.startS).toBeLessThanOrEqual(words[firstWord]!.start)
    expect(first.slots?.meta).toMatchObject({ screen: 'motion', promo: { mode: 'same', place: 'mention', reused: false, link: 'https://exemple-compagnon.fr/yt' } })
    expect(browser.opened).toHaveLength(1)
    expect(browser.frames).toBe(292)
    // the next video of the channel: the same clip, not drawn again
    const second = await draw(dir, promo, 'La gouttière qui déborde', services)
    expect(second.slots?.files).toEqual(first.slots?.files)
    expect(second.slots?.meta).toMatchObject({ promo: { reused: true } })
    expect(browser.opened).toHaveLength(1)
  })

  it('adapted to each video: a clip per video, its text the video’s', async () => {
    const dir = work('promo-adapt')
    const browser = fakeBrickBrowser()
    const services = { browser, media: media() }
    const promo = `${PROMO}\nmode : adaptée\nplace : mention`
    const a = await draw(dir, promo, 'Le mur noir de la chambre du fond', services)
    const b = await draw(dir, promo, 'La gouttière qui déborde', services)
    expect(a.slots?.files).not.toEqual(b.slots?.files)
    expect(browser.opened).toHaveLength(2)
    expect(browser.opened[1]?.html).toContain('gouttière')
  })

  it('without a browser the drawn card stands in, and says so', async () => {
    const dir = work('promo-fallback')
    const services = { ...testServices(dir), browser: undefined, media: media() }
    const ctx = makeCtx(services)
    const out = await draw(dir, `${PROMO}\nplace : mention`, 'x', services, ctx)
    // the sponsor card of production-9 (drawn by ffmpeg, here the fake one) with the QR code of the promo's link
    expect((out.slots?.value as { role: string }[]).map((l) => l.role)).toEqual(['sponsor-card', 'qr'])
    expect(JSON.stringify(ctx.reports)).toContain('aucun navigateur')
  })
})

// ---- the agent's question -----------------------------------------------------------------------------------------------------------

describe('the pipeline agent asks what the channel does not say', () => {
  it('one short question for the placement and one for the reuse, only when unknown', () => {
    const declared = (id: string) => id === 'sponsor'
    const promoIds = (qs: { id: string }[]) => qs.map((q) => q.id).filter((id) => id.startsWith('promo'))
    const both = openQuestions([], { channelPromo: ['place', 'mode'] }, declared).filter((q) => q.id.startsWith('promo'))
    expect(promoIds(both)).toEqual(['promoPlace', 'promoMode'])
    expect(both[0]).toMatchObject({ default: 'after_hook' })
    expect(both[0]?.choices.map((c) => c.value)).toEqual(['after_hook', 'end', 'mention', 'none'])
    expect(both[1]?.choices.map((c) => c.value)).toEqual(['same', 'adapt', 'per_video'])
    expect(promoIds(openQuestions([], { channelPromo: ['mode'] }, declared))).toEqual(['promoMode'])
    expect(promoIds(openQuestions([], { channelPromo: [] }, declared))).toEqual([])
    expect(promoIds(openQuestions([], {}, declared))).toEqual([])
  })

  it('keeps the answer on the channel: the question is not asked again', () => {
    const db = openDatabase(':memory:')
    db.prepare("INSERT INTO channels (id, name) VALUES (1, 'Gaston')").run()
    const sponsors = new ChannelSponsors({ db })
    sponsors.set(1, PROMO)
    expect(sponsors.promoUnknowns(1)).toEqual(['place', 'mode'])
    expect(sponsors.get(1)?.promo).toMatchObject({ place: null, reuse: null, unknown: ['place', 'mode'] })
    sponsors.answerPromo(1, 'place', 'after_hook')
    sponsors.answerPromo(1, 'mode', 'adapt')
    expect(sponsors.promoUnknowns(1)).toEqual([])
    expect(sponsors.get(1)?.text).toMatch(/place : après l’accroche/u)
    expect(() => sponsors.answerPromo(1, 'place', 'partout')).toThrow(/inconnue/u)
  })
})
