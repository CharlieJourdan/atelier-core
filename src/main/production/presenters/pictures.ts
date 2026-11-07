// The pictures a channel presenter is made of (production-7): the portrait generated from words, and an angle edited from
// the portrait. The service takes this port by injection. Only the stand-in below exists today: it draws a stand-in person
// with the engine's own drawing (`drawPortrait`), the same person in every framing. The real implementation sends the
// request to Atelier Cloud's image engine, with the portrait as an image reference; the app builds it once the Cloud
// contract carries image references (production-8), and injects it in place of the stand-in in src/main/core.ts.
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { drawPortrait } from '../../../engine/media/draw-video'
import type { Aspect } from '../../../engine/formats/timing'
import type { CloudService, MediaService } from '../../../engine/services'
import type { Framing } from '../../../shared/presenter-engines'

export interface PresenterPicture {
  /** The picture's file on this computer. */
  file: string
  /** A stand-in drawing, not a real generation. */
  demo: boolean
}

export interface PresenterPictures {
  /** A portrait (the `medium` framing) from the art-direction prompt. `identity` is the presenter's stable key (a real engine ignores it). */
  portrait(req: { prompt: string; aspect: Aspect; identity?: string }): Promise<PresenterPicture>
  /** The same person in another framing: the portrait is the reference, the prompt says what to change; `engine`: an image engine
   *  that takes references (`ANGLE_ENGINES`), else PORTRAIT_ENGINE. */
  edit(req: { reference: string; prompt: string; framing: Framing; identity?: string; engine?: string }): Promise<PresenterPicture>
}

const hashOf = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')

/**
 * Stand-in pictures drawn in `dir`: the person comes from a hash of the presenter's `identity` (else of the prompt for a
 * portrait, of the reference picture's bytes for an edit), so every angle of a presenter shows the person of its portrait.
 */
export function fakePresenterPictures(dir: string, mediaOrNull: MediaService | null): PresenterPictures {
  let n = 0
  const need = (): MediaService => {
    if (!mediaOrNull) throw new Error('ffmpeg est introuvable : impossible de dessiner le présentateur de démonstration.')
    return mediaOrNull
  }
  const next = async (label: string): Promise<string> => {
    await mkdir(dir, { recursive: true })
    n += 1
    return path.join(dir, `${label}-${Date.now().toString(36)}-${n}.png`)
  }
  return {
    async portrait({ prompt, aspect, identity }) {
      const media = need()
      const out = await next('portrait')
      await drawPortrait(media, { out, hash: hashOf(identity ?? prompt), aspect, framing: 'medium', signal: new AbortController().signal })
      return { file: out, demo: true }
    },
    async edit({ reference, framing, identity }) {
      const media = need()
      const signal = new AbortController().signal
      // a picture's shape is read with ffprobe (the engine's probe wants a duration, which a still has not)
      const shape = await media.run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', reference], { signal })
      const [w, h] = shape.stdout.toString('utf8').trim().split(',').map(Number)
      const aspect: Aspect = (w ?? 1) >= (h ?? 0) ? '16:9' : '9:16'
      const out = await next(`angle-${framing}`)
      await drawPortrait(media, { out, hash: hashOf(identity ?? (await readFile(reference))), aspect, framing, signal })
      return { file: out, demo: true }
    }
  }
}

/** The engine an invented presenter's portrait and angles are made with (GPT Image 2.5, medium: the portrait cleaner's). */
export const PORTRAIT_ENGINE = 'image:gpt-image-25-medium'

/**
 * The real pictures (style-japanese: « Kenji » came out as the stand-in drawing although the app was signed in): while the app
 * is signed in to Atelier Cloud, a portrait is one `generateImage` job from its words and an angle one job with the portrait as
 * its reference (paid on the Cloud, or its demo); signed out, the stand-in drawing.
 */
export function cloudPresenterPictures(o: { dir: string; media: MediaService | null; cloud: () => Pick<CloudService, 'generateImage'> | null; fallback: PresenterPictures }): PresenterPictures {
  const job = async (label: string, req: { prompt: string; width: number; height: number; references?: string[]; engine?: string }, key: string): Promise<PresenterPicture | null> => {
    const cloud = o.cloud()
    if (!cloud) return null
    const dir = path.join(o.dir, key)
    await mkdir(dir, { recursive: true })
    const res = await cloud.generateImage({ ...req, engine: req.engine ?? PORTRAIT_ENGINE }, { idempotencyKey: `presenter-${label}-${key}`, signal: new AbortController().signal, dir })
    const file = res.files[0]
    if (!file) throw new Error('Atelier Cloud n’a rendu aucune image pour le présentateur.')
    return { file, demo: res.demo }
  }
  return {
    async portrait(req) {
      const [width, height] = req.aspect === '9:16' ? [1080, 1920] : [1920, 1080]
      return (await job('portrait', { prompt: req.prompt, width, height }, hashOf(`${req.identity ?? ''}|${req.prompt}`).slice(0, 24))) ?? o.fallback.portrait(req)
    },
    async edit(req) {
      if (!o.cloud() || !o.media) return o.fallback.edit(req)
      const shape = await o.media.run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', req.reference], { signal: new AbortController().signal })
      const [width = 1920, height = 1080] = shape.stdout.toString('utf8').trim().split(',').map(Number)
      // the default engine keeps the key it always had (pictures made before are found again)
      const key = hashOf(`${hashOf(await readFile(req.reference))}|${req.framing}|${req.prompt}${req.engine && req.engine !== PORTRAIT_ENGINE ? `|${req.engine}` : ''}`).slice(0, 24)
      return (await job(`angle-${req.framing}`, { prompt: req.prompt, width, height, references: [req.reference], ...(req.engine ? { engine: req.engine } : {}) }, key)) ?? o.fallback.edit(req)
    }
  }
}

/** « Nettoyer le portrait » (production-17): the same person, face, outfit and room, sharper. */
export type PortraitCleaner = (req: { reference: string; prompt: string; identity?: string }) => Promise<PresenterPicture>

/** The engine and quality the portrait is cleaned with: GPT Image 2.5 edit, medium (the portrait as the image reference). */
export const PORTRAIT_CLEAN_ENGINE = 'image:gpt-image-25-medium'

/**
 * The cleaner: while the app is signed in to Atelier Cloud, one `generateImage` job on PORTRAIT_CLEAN_ENGINE with the portrait
 * as its reference (paid on the Cloud, or its demo); signed out, a stand-in that sharpens the picture here (demo).
 */
export function portraitCleaner(o: { dir: string; media: MediaService | null; cloud: () => Pick<CloudService, 'generateImage'> | null }): PortraitCleaner {
  return async ({ reference, prompt }) => {
    if (!o.media) throw new Error('ffmpeg est introuvable : impossible de lire le portrait.')
    const media = o.media
    const signal = new AbortController().signal
    const shape = await media.run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', reference], { signal })
    const [w = 1280, h = 720] = shape.stdout.toString('utf8').trim().split(',').map(Number)
    const key = hashOf(await readFile(reference)).slice(0, 24)
    const dir = path.join(o.dir, key)
    await mkdir(dir, { recursive: true })
    const cloud = o.cloud()
    if (cloud) {
      const res = await cloud.generateImage({ prompt, width: w, height: h, engine: PORTRAIT_CLEAN_ENGINE, references: [reference] }, { idempotencyKey: `portrait-clean-${key}`, signal, dir })
      const file = res.files[0]
      if (!file) throw new Error('Atelier Cloud n’a rendu aucune image pour le portrait.')
      return { file, demo: res.demo }
    }
    const out = path.join(dir, 'clean.png')
    await media.run('ffmpeg', ['-v', 'error', '-y', '-i', reference, '-vf', 'unsharp=5:5:0.8:5:5:0.0', '-frames:v', '1', out], { signal })
    return { file: out, demo: true }
  }
}
