// `edit.sponsor@1` (docs/specs/pipeline-avatar.md §2.13, production-9): the sponsor on screen, on exactly the sentences of each mention
// that `script.sponsor` wrote (found in the voice's words, sponsor-slots.ts). The slot shows our card (product, pitch, link) over the
// darkened picture, or the sponsor's own media: a clip played from the mention's first word, cut at its end or held on its last frame
// when shorter (never looped); a picture held. The QR code (media/qr.ts) sits at the set position and size for the whole slot. Without
// a sponsor, or without a mention in the script, it hands an empty list: the film is unchanged. Local, free, real in demo mode too.
import { copyFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { NodeOutputs } from '../artefacts'
import { EngineError } from '../errors'
import { EditPlan } from '../formats/editplan'
import type { Layer } from '../formats/layers'
import { Outline } from '../formats/outline'
import { parseSponsor, type Sponsor } from '../formats/sponsor'
import { cardFor, localCard, promoLink, type PromoCard } from '../formats/promo'
import { drawPromo } from '../motion/promo-render'
import { FPS, WordsValue } from '../formats/timing'
import { drawSponsorCard, MARK_FILTERS, qrBox } from '../media/marks'
import { probe } from '../media/probe'
import { qrMatrix, qrPng } from '../media/qr'
import { requireFilters } from '../media/tools'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { need } from '../services'
import type { Json } from '../types'
import { progress, readValue, scratch } from './common'
import { sponsorWindows, type SponsorWindow } from './sponsor-slots'

export const SponsorEditParams = z.object({
  /** The small line above the product's name on the card. */
  kicker: z.string().min(1).max(40).default('Partenaire'),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FFD84D'),
  /** The longest a sponsor clip may be (pipeline-avatar §2.13: ≤ 90 s). */
  maxClipS: z.number().min(5).max(300).default(90)
})
type Params = z.infer<typeof SponsorEditParams>

const PICTURE = /\.(?:png|jpe?g|webp|bmp)$/i

/** What the slots of one sponsor show: the card or the media, and the QR code, each a layer with its file. */
export interface SlotPlan {
  window: SponsorWindow
  layers: Omit<Layer, 'file'>[]
}

/**
 * The layers of each window (pure): the card or the media over the whole frame from the first word to the end of the mention, the QR
 * code in its box for the same seconds. A clip plays from the window's start; its length is kept so the render holds its last frame.
 */
export function slotLayers(windows: readonly SponsorWindow[], s: Sponsor, o: { media: { video: boolean; durationS?: number } | null; qr: { x: number; y: number; w: number; h: number } | null }): SlotPlan[] {
  return windows.map((w) => {
    const startS = Math.round(w.startS * FPS) / FPS
    const endS = Math.round(w.endS * FPS) / FPS
    const media = s.screen === 'media' && o.media
    const layers: Omit<Layer, 'file'>[] = [
      media
        ? { role: 'sponsor-media', startS, endS, video: o.media?.video ?? false, ...(o.media?.durationS ? { durationS: o.media.durationS } : {}), enter: 'fade', fadeS: 0.3 }
        : { role: 'sponsor-card', startS, endS, video: false, enter: 'fade', fadeS: 0.3 }
    ]
    if (o.qr) layers.push({ role: 'qr', startS, endS, box: o.qr, video: false, enter: 'pop', fadeS: 0.2 })
    return { window: w, layers }
  })
}

async function mediaOf(ctx: RunCtx, s: Sponsor, maxS: number): Promise<{ file: string; video: boolean; durationS?: number } | null> {
  if (s.screen !== 'media' || !s.media) return null
  if (!existsSync(s.media)) {
    ctx.emit({ kind: 'log', level: 'warn', text: `the sponsor's media is not on this machine (${s.media}): the card shows instead` })
    return null
  }
  if (PICTURE.test(s.media)) return { file: s.media, video: false }
  const durationS = (await probe(need(ctx, 'media'), s.media, ctx.signal)).durationS
  if (!(durationS > 0)) throw new EngineError('bad_input', 'La vidéo du sponsor ne se lit pas : remplace-la dans la fiche du sponsor de la chaîne.')
  if (durationS > maxS + 0.5) throw new EngineError('bad_input', `La vidéo du sponsor dure ${Math.round(durationS)} s, ${maxS} s au plus : coupe-la puis remets-la dans la fiche du sponsor.`)
  return { file: s.media, video: true, durationS }
}

async function run(ctx: RunCtx, inputs: ResolvedInputs, p: Params): Promise<NodeOutputs> {
  const sponsor = typeof inputs.sponsor?.value === 'string' ? parseSponsor(inputs.sponsor.value) : null
  const plan = readValue(inputs.plan, EditPlan, 'the edit plan')
  const outline = readValue(inputs.outline, Outline, 'the outline')
  const words = readValue(inputs.words, WordsValue, 'the word list')
  const D = plan.frames / FPS
  const windows = sponsor ? sponsorWindows(outline, words, D) : []
  if (!sponsor || windows.length === 0) {
    if (sponsor) ctx.emit({ kind: 'log', level: 'warn', text: 'the script has no sponsor mention: nothing to show' })
    progress(ctx, 1, 1, 'Pas de sponsor à l’écran')
    return { slots: { value: [] as unknown as Json, files: [], meta: { slots: 0 } } }
  }
  const media = need(ctx, 'media')
  if (sponsor.kind === 'promo' && sponsor.screen !== 'media' && sponsor.promo) {
    const drawn = await promoSlots(ctx, sponsor, sponsor.promo, outline, windows, plan.size)
    if (drawn) return drawn
  }
  await requireFilters(media, MARK_FILTERS, ctx.signal)
  const dir = await scratch(ctx, 'sponsor')
  const files: string[] = []
  const link = sponsor.qr.link || sponsor.link
  let qr: { x: number; y: number; w: number; h: number } | null = null
  if (sponsor.qr.show && link) {
    const modules = qrMatrix(link).length + 8
    const box = qrBox(sponsor.qr.position, sponsor.qr.size, plan.size, modules)
    const file = path.join(dir, 'qr.png')
    await writeFile(file, qrPng(link, box.scale))
    qr = { x: box.x, y: box.y, w: box.w, h: box.h }
    files.push(file)
  }
  progress(ctx, 0, 2, 'Je prépare le créneau du sponsor')
  const own = await mediaOf(ctx, sponsor, p.maxClipS)
  let main: string
  if (own) {
    main = path.join(dir, `media${path.extname(own.file).toLowerCase()}`)
    await copyFile(own.file, main)
  } else {
    main = path.join(dir, 'card.png')
    const fonts = path.join(need(ctx, 'library').root, 'fonts')
    await drawSponsorCard(
      media,
      { kicker: p.kicker, name: sponsor.name, pitch: sponsor.pitch, link: sponsor.link.replace(/^https?:\/\//, ''), accent: p.accent, frame: plan.size, qr },
      { bold: path.join(fonts, 'Inter-Bold.ttf'), semi: path.join(fonts, 'Inter-SemiBold.ttf') },
      dir,
      main,
      ctx.signal
    )
  }
  files.unshift(main)
  // the main picture is file 0, the QR code file 1
  const planned = slotLayers(windows, { ...sponsor, screen: own ? 'media' : 'card' }, { media: own, qr })
  const layers: Layer[] = planned.flatMap((s) => s.layers.map((l) => ({ ...l, file: l.role === 'qr' ? 1 : 0 })))
  progress(ctx, 2, 2, `${windows.length} créneau(x) du sponsor`)
  return {
    slots: {
      value: layers as unknown as Json,
      files,
      meta: {
        slots: windows.length,
        windows: windows.map((w) => ({ kind: w.kind, startS: w.startS, endS: w.endS, anchor: w.anchor })) as unknown as Json,
        screen: own ? 'media' : 'card',
        ...(qr ? { qr: link } : {})
      }
    }
  }
}

/**
 * The channel's own promo drawn by our motion bricks (promo-motion): the card of this video (`cardFor`: the same one, its text adapted, or
 * one made for the video) drawn once into the workspace's cache and laid over each window from its first word, cut in like the reference;
 * the clip lasts its longest slot (at most 30 s), the card pushing in slowly once it has landed (a held card is a frozen picture). Without a browser, null: the slot falls back to the drawn sponsor card.
 */
async function promoSlots(ctx: RunCtx, s: Sponsor, base: PromoCard, outline: Outline, windows: SponsorWindow[], size: readonly [number, number]): Promise<NodeOutputs | null> {
  const browser = ctx.services.browser
  if (!browser) {
    ctx.emit({ kind: 'log', level: 'warn', text: 'aucun navigateur sur cet ordinateur : la promo animée est remplacée par sa carte fixe' })
    return null
  }
  const mode = s.reuse ?? 'same'
  const said = outline.sponsor?.find((m) => m.kind === 'mention')?.promo
  const card = localCard(cardFor(base, mode, { title: outline.title, said }), outline.language)
  progress(ctx, 0, 1, 'Je dessine la promo de la chaîne')
  const [width, height] = size
  // the clip covers its whole slot (at most 30 s): its card keeps moving under the words instead of holding its last frame
  const longest = Math.max(0, ...windows.map((w) => w.endS - w.startS))
  const frames = Math.round(Math.min(30, Math.max(card.seconds, longest)) * FPS)
  const media = need(ctx, 'media')
  await requireFilters(media, ['libx264'], ctx.signal)
  const drawn = await drawPromo({ card, libraryRoot: need(ctx, 'library').root, browser, media, width, height, frames, cacheDir: await need(ctx, 'workspace').cache('promo'), signal: ctx.signal }).catch((e: unknown) => {
    if (e instanceof EngineError && e.code === 'missing_tool') return null
    throw e
  })
  if (!drawn) return null
  const layers: Layer[] = windows.map((w) => ({
    file: 0,
    role: 'promo',
    startS: Math.round(w.startS * FPS) / FPS,
    endS: Math.round(w.endS * FPS) / FPS,
    video: true,
    durationS: frames / FPS,
    enter: 'cut',
    fadeS: 0.2
  }))
  progress(ctx, 1, 1, drawn.cached ? 'Promo reprise telle quelle' : 'Promo dessinée')
  return {
    slots: {
      value: layers as unknown as Json,
      files: [drawn.file],
      meta: {
        slots: windows.length,
        windows: windows.map((w) => ({ kind: w.kind, startS: w.startS, endS: w.endS, anchor: w.anchor })) as unknown as Json,
        screen: 'motion',
        promo: { mode, place: s.place ?? 'after_hook', reused: drawn.cached, headline: card.headline, seconds: card.seconds, link: promoLink(card) }
      }
    }
  }
}

export const editSponsor = defineNode({
  type: 'edit.sponsor@1',
  inputs: {
    plan: { type: 'json.editplan', required: true, label: 'Plan de montage' },
    outline: { type: 'json.outline', required: true, label: 'Plan du script (les mentions)' },
    words: { type: 'json.words', required: true, label: 'Mots minutés' },
    sponsor: { type: 'text.input', required: false, label: 'Sponsor de la chaîne' }
  },
  outputs: { slots: 'media.graphic[]' },
  params: SponsorEditParams,
  executors: ['local'],
  estimate: () => ({ units: [], durationS: 2 }),
  run,
  fake: run
})
