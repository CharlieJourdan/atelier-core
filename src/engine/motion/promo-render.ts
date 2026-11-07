// Draws the channel promo's clip (promo-motion): reads its pictures into the page, photographs the card frame by frame in the headless
// browser and writes an opaque H.264 file of exactly `frames` frames at 30 fps. Cached by the hash of its page (the card, its pictures,
// the timings, the fonts), the size, the length and the promo's version: a channel that shows the same promo in every video draws it once.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { PromoCard } from '../formats/promo'
import type { BrowserService, MediaService } from '../services'
import { promoFontCssOf } from './fonts'
import { PROMO_VERSION, promoHtml, type PromoAssets } from './promo'
import { CARD_ENCODER, renderGraphic } from './render'
import { FPS } from '../formats/timing'

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

async function dataUri(file: string): Promise<{ uri: string } | null> {
  if (!file) return null
  const type = TYPES[path.extname(file).toLowerCase()]
  if (!type) throw new Error(`promo: ${path.basename(file)} is not a PNG, JPEG or WebP picture`)
  if (!existsSync(file)) throw new Error(`promo: the picture ${file} is not on this machine`)
  const bytes = await readFile(file)
  return { uri: `data:${type};base64,${bytes.toString('base64')}` }
}

/** The page of a card with its pictures read in, and the key of its clip. */
export async function promoPage(card: PromoCard, o: { libraryRoot: string; width: number; height: number; frames: number }): Promise<{ html: string; key: string }> {
  const [visual, logo] = await Promise.all([card.visual.kind === 'none' ? null : dataUri(card.visual.image), dataUri(card.logo)])
  const assets: PromoAssets = { visual: visual?.uri ?? null, logo: logo?.uri ?? null }
  const fontCss = await promoFontCssOf(o.libraryRoot)
  const html = promoHtml(card, { width: o.width, height: o.height, durationS: o.frames / FPS, fontCss }, assets)
  // the page holds everything the clip shows (text, pictures, timings, fonts): its hash with the size, length and encoder is the key
  const key = createHash('sha256')
    .update(JSON.stringify({ v: PROMO_VERSION, w: o.width, h: o.height, frames: o.frames, enc: CARD_ENCODER }))
    .update(html)
    .digest('hex')
    .slice(0, 32)
  return { html, key }
}

/** Draws the promo's clip into `cacheDir` (or finds it there). Returns its file and whether it was already drawn. */
export async function drawPromo(o: {
  card: PromoCard
  libraryRoot: string
  browser: BrowserService
  media: MediaService
  width: number
  height: number
  frames: number
  cacheDir: string
  signal: AbortSignal
}): Promise<{ file: string; cached: boolean }> {
  const { html, key } = await promoPage(o.card, o)
  const file = path.join(o.cacheDir, `promo-${key}.mp4`)
  if (existsSync(file)) return { file, cached: true }
  await renderGraphic({ browser: o.browser, media: o.media, html, width: o.width, height: o.height, frames: o.frames, out: file, signal: o.signal, encoder: CARD_ENCODER })
  return { file, cached: false }
}
