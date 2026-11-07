// `card.intro@1` (the « card » kind of a drawn pipeline): a post-style intro card, a transparent PNG that
// `render.assemble` lays over the first seconds of the film. White rounded card, an avatar circle with the channel's
// initial, the channel name and a small line under it, then the video's title in large type. All of it drawn by ffmpeg
// with our own font (the drawing helpers of `media/`), no picture to fetch. The card is shown for the first sentence of
// the narration (between 2.5 and 6 s), or for `seconds` when the drawing says so. Local, free, real in demo mode too.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { NodeOutputs } from '../artefacts'
import { EngineError } from '../errors'
import { Outline } from '../formats/outline'
import { ASPECTS, WordsValue, type Aspect } from '../formats/timing'
import { filterPath, withShortPaths, wrapText } from '../media/filters'
import { requireFilters } from '../media/tools'
import { fontCssOf } from '../motion/fonts'
import { POST_CARD, postCardHtml } from '../motion/post-card'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { need } from '../services'
import { parseScript } from '../text/script'
import { hashOf, progress, readValue, scratch } from './common'

export const CardParams = z.object({
  /** The title shown; default: the outline's title, then the script's first sentence. */
  title: z.string().min(1).max(300).optional(),
  channel: z.string().min(1).max(60).default('Ma chaîne'),
  /** The small line under the channel name. */
  subtitle: z.string().max(80).default('À l’instant'),
  /** Seconds on screen. Default: the first sentence of the narration, kept between 2.5 and 6 s (3 s without word times). */
  seconds: z.number().min(1).max(15).optional(),
  /** Avatar colour (`#RRGGBB`); default: one of eight, picked from the channel name. */
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** The film's shape: a card for a 9:16 short is narrower (it must fit a 1080 px frame) and set in the upper third. */
  aspect: z.enum(ASPECTS).default('16:9'),
  /**
   * `plain`: the drawn card above (ffmpeg). `post` (a story short): a forum post — avatar, name and verified mark, award icons,
   * the title, likes / comments / share — drawn by the browser, popping in and out (`motion/post-card.ts`); without a browser the
   * plain card is drawn instead, said in the log.
   */
  look: z.enum(['plain', 'post']).default('plain'),
  /** `post`: the channel's avatar picture (a full path); absent: a coloured circle with the initial. */
  avatar: z.string().min(1).optional(),
  likes: z.string().max(12).default('69+'),
  comments: z.string().max(12).default('420+'),
  share: z.string().max(20).default('Share'),
  verified: z.boolean().default(true),
  awards: z.number().int().min(0).max(8).default(8),
  /** `post`: seconds the card stays after the title is said (the reference: about 0.35 s). */
  afterS: z.number().min(0).max(2).default(0.35),
  /** `post`: `initial` draws the channel's initial even when it has a picture. */
  avatarMode: z.enum(['picture', 'initial']).optional()
})
type Params = z.infer<typeof CardParams>

/** Characters a line of a post card's title holds (51 px Inter Bold in 822 px), and the card's height for `lines` lines. */
const POST_TITLE_CHARS = 30
const postCardHeight = (lines: number): number => 256 + 51 * Math.max(1, lines)
/** Room under the card for its drop shadow (12 px down, 30 px blur). */
const SHADOW_ROOM = 60

/** Avatar colours (readable white initial on each). */
const ACCENTS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316']

export const CARD_FILTERS = ['drawtext', 'geq', 'alphamerge', 'overlay']

/** The card's measurements, per film shape (pixels of the PNG, which is laid over the frame at its own size). */
interface Metrics {
  w: number
  pad: number
  avatar: number
  titleSize: number
  titleLine: number
  radius: number
  titleChars: number
  titleLines: number
  channelSize: number
  subtitleSize: number
  initialSize: number
}
const METRICS: Record<Aspect, Metrics> = {
  '16:9': { w: 1440, pad: 70, avatar: 96, titleSize: 68, titleLine: 84, radius: 36, titleChars: 32, titleLines: 4, channelSize: 42, subtitleSize: 30, initialSize: 48 },
  // a phone: 960 px wide inside the 1080 px frame, more and shorter lines
  '9:16': { w: 960, pad: 50, avatar: 84, titleSize: 54, titleLine: 68, radius: 32, titleChars: 24, titleLines: 6, channelSize: 36, subtitleSize: 26, initialSize: 42 }
}

/** Card height for a title of `lines` lines. */
export const cardHeight = (lines: number, aspect: Aspect = '16:9'): number => {
  const m = METRICS[aspect]
  return Math.round(m.avatar * 1.98 + Math.max(1, lines) * m.titleLine + m.pad)
}

/** The moment the card leaves: the end of the first sentence of the narration (+ `afterS`), kept between `minS` and 6 s. */
export function cardSeconds(words: z.infer<typeof WordsValue> | null, seconds: number | undefined, afterS = 0.3, minS = 2.5): number {
  if (seconds !== undefined) return seconds
  const first = words?.filter((w) => w.sentence === 0).at(-1)
  if (!first) return 3
  return Math.round(Math.min(6, Math.max(minS, first.end + afterS)) * 100) / 100
}

/** The ffmpeg filter graph of the card (one frame, RGBA out). `files` are the text files it reads. */
export function cardGraph(o: { height: number; accent: string; fontBold: string; fontSemi: string; files: { initial: string; channel: string; subtitle: string; title: string }; aspect?: Aspect }): string {
  const m = METRICS[o.aspect ?? '16:9']
  const w = m.w
  const h = o.height
  const r = m.radius
  const c = m.avatar / 2
  // the rows under the avatar line scale with the avatar (96 px at 16:9: name at 56, small line at 112, title at 200)
  const k = m.avatar / 96
  const top = Math.round(50 * k)
  const text = (font: string, file: string, size: number, colour: string, x: string, y: string, spacing = 0): string =>
    `drawtext=fontfile=${filterPath(font)}:textfile=${filterPath(file)}:expansion=none:fontsize=${size}:fontcolor=${colour}:line_spacing=${spacing}:x=${x}:y=${y}`
  return [
    `color=c=white:s=${w}x${h}:d=1,format=rgb24[bg]`,
    `color=c=0x${o.accent.replace('#', '')}:s=${m.avatar}x${m.avatar}:d=1,format=rgb24[avc]`,
    // a soft-edged circle: the distance to the centre, as an alpha mask
    `color=c=black:s=${m.avatar}x${m.avatar}:d=1,format=gray,geq=lum='clip(255*(${c}+0.5-hypot(X-${c - 0.5},Y-${c - 0.5})),0,255)'[avm]`,
    '[avc][avm]alphamerge[av]',
    [
      `[bg][av]overlay=${m.pad}:${top}:format=auto`,
      text(o.fontBold, o.files.initial, m.initialSize, 'white', `${m.pad + c}-text_w/2`, `${top + c}-text_h/2`),
      text(o.fontBold, o.files.channel, m.channelSize, '0x111111', `${m.pad + m.avatar + 28}`, String(Math.round(56 * k))),
      text(o.fontSemi, o.files.subtitle, m.subtitleSize, '0x6B7280', `${m.pad + m.avatar + 28}`, String(Math.round(112 * k))),
      text(o.fontBold, o.files.title, m.titleSize, '0x111111', `${m.pad}`, String(Math.round(200 * k)), m.titleLine - m.titleSize),
      'format=rgb24[card]'
    ].join(','),
    // the rounded corners: the same trick, a mask the size of the card
    `color=c=black:s=${w}x${h}:d=1,format=gray,geq=lum='clip(255*(${r}+0.5-hypot(max(max(${r}-X,X-${w - 1 - r}),0),max(max(${r}-Y,Y-${h - 1 - r}),0))),0,255)'[m]`,
    '[card][m]alphamerge,format=rgba[out]'
  ].join(';')
}

/** The title of a `post` card: the first sentence said (the hook the card shows). */
function spokenTitle(words: z.infer<typeof WordsValue> | null): string {
  return (words ?? []).filter((w) => w.sentence === 0).map((w) => w.w).join(' ')
}

async function drawPost(ctx: RunCtx, p: Params, title: string, words: z.infer<typeof WordsValue> | null, avatarFile: string | undefined): Promise<NodeOutputs | null> {
  const browser = ctx.services.browser
  if (!browser) {
    ctx.emit({ kind: 'log', level: 'warn', text: 'no browser on this computer: the plain intro card is drawn instead of the post card' })
    return null
  }
  const accent = p.accent ?? (ACCENTS[parseInt(hashOf({ channel: p.channel }).slice(0, 6), 16) % ACCENTS.length] as string)
  let avatar: string | undefined
  const picture = p.avatarMode === 'initial' ? undefined : (avatarFile ?? p.avatar)
  if (picture) {
    try {
      const data = await readFile(picture)
      const ext = path.extname(picture).toLowerCase()
      avatar = `data:${ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'};base64,${data.toString('base64')}`
    } catch {
      ctx.emit({ kind: 'log', level: 'warn', text: `the channel avatar cannot be read (${path.basename(picture)}): its initial is drawn instead` })
    }
  }
  const fontCss = await fontCssOf(need(ctx, 'library').root)
  const boxH = postCardHeight(wrapText(title, POST_TITLE_CHARS, 8).length)
  const html = postCardHtml({ title, channel: p.channel, ...(avatar ? { avatar } : {}), accent, likes: p.likes, comments: p.comments, share: p.share, verified: p.verified, awards: p.awards, fontCss })
  progress(ctx, 0, 1, 'Je dessine la carte du post')
  const page = await browser.open({ html, width: POST_CARD.frameWidth, height: boxH + SHADOW_ROOM, signal: ctx.signal })
  const dir = await scratch(ctx, 'card')
  const out = path.join(dir, 'post-card.png')
  try {
    await writeFile(out, await page.frame(0))
  } finally {
    await page.close()
  }
  progress(ctx, 1, 1, 'Carte du post prête')
  return {
    card: {
      files: [out],
      meta: { startS: 0, endS: cardSeconds(words, p.seconds, p.afterS, 1.2), width: POST_CARD.frameWidth, height: boxH + SHADOW_ROOM, boxH, y: POST_CARD.top, anim: 'pop', look: 'post', title, channel: p.channel }
    }
  }
}

async function draw(ctx: RunCtx, inputs: ResolvedInputs, p: Params): Promise<NodeOutputs> {
  const media = need(ctx, 'media')
  const outline = inputs.outline ? readValue(inputs.outline, Outline, 'the outline') : null
  const words = inputs.words ? readValue(inputs.words, WordsValue, 'the word list') : null
  const script = typeof inputs.script?.value === 'string' ? inputs.script.value : ''
  if (p.look === 'post') {
    // the reference's card shows the title without its closing full stop (a « ? » or « ! » stays)
    const said = (p.title ?? spokenTitle(words)).replace(/\s+/g, ' ').trim().replace(/[.…]+$/u, '')
    const posted = await drawPost(ctx, p, said || (outline?.title ?? parseScript(script).sentences[0]?.text ?? '').trim(), words, inputs.avatar?.files?.[0] ?? (typeof inputs.avatar?.value === 'string' ? inputs.avatar.value : undefined))
    if (posted) return posted
  }
  await requireFilters(media, CARD_FILTERS, ctx.signal)
  const title = (p.title ?? outline?.title ?? parseScript(script).sentences[0]?.text ?? '').replace(/\s+/g, ' ').trim()
  if (!title) throw new EngineError('bad_input', 'La carte d’intro n’a pas de titre : donne un titre ou un script.')
  const m = METRICS[p.aspect]
  const lines = wrapText(title, m.titleChars, m.titleLines)
  const height = cardHeight(lines.length, p.aspect)
  const accent = p.accent ?? (ACCENTS[parseInt(hashOf({ channel: p.channel }).slice(0, 6), 16) % ACCENTS.length] as string)
  const dir = await scratch(ctx, 'card')
  const files = { initial: path.join(dir, 'initial.txt'), channel: path.join(dir, 'channel.txt'), subtitle: path.join(dir, 'subtitle.txt'), title: path.join(dir, 'title.txt') }
  const initial = (Array.from(p.channel.trim())[0] ?? 'A').toUpperCase()
  await Promise.all([
    writeFile(files.initial, initial, 'utf8'),
    writeFile(files.channel, p.channel, 'utf8'),
    writeFile(files.subtitle, p.subtitle, 'utf8'),
    writeFile(files.title, lines.join('\n'), 'utf8')
  ])
  const fonts = path.join(need(ctx, 'library').root, 'fonts')
  const out = path.join(dir, 'intro-card.png')
  progress(ctx, 0, 1, 'Je dessine la carte d’intro')
  const fontBold = path.join(fonts, 'Inter-Bold.ttf')
  const fontSemi = path.join(fonts, 'Inter-SemiBold.ttf')
  // the text files sit in the run's scratch folder: a deep one is copied short for drawtext (filters.ts)
  await withShortPaths([fontBold, fontSemi, ...Object.values(files)], async (short) => {
    const shortFiles = { initial: short(files.initial), channel: short(files.channel), subtitle: short(files.subtitle), title: short(files.title) }
    await media.run(
      'ffmpeg',
      [
        '-v', 'error', '-y',
        '-filter_complex', cardGraph({ height, accent, fontBold: short(fontBold), fontSemi: short(fontSemi), files: shortFiles, aspect: p.aspect }),
        '-map', '[out]', '-frames:v', '1', '-pix_fmt', 'rgba', out
      ],
      { signal: ctx.signal }
    )
  })
  progress(ctx, 1, 1, 'Carte d’intro prête')
  const endS = cardSeconds(words, p.seconds)
  return { card: { files: [out], meta: { startS: 0, endS, width: m.w, height, title, channel: p.channel } } }
}

export const cardIntro = defineNode({
  type: 'card.intro@1',
  inputs: {
    outline: { type: 'json.outline', required: false, label: 'Plan (son titre)' },
    words: { type: 'json.words', required: false, label: 'Mots minutés (la première phrase)' },
    script: { type: 'text.script', required: false, label: 'Script (si pas de titre)' },
    avatar: { type: 'media.image[]', required: false, label: 'Image de la chaîne (carte du post)' }
  },
  outputs: { card: 'media.graphic[]' },
  params: CardParams,
  executors: ['local'],
  estimate: () => ({ units: [], durationS: 2 }),
  run: draw,
  fake: draw
})
