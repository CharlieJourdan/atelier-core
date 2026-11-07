// The still and clip engines Atelier generates pictures with (production-8, decision 0035), shared by the Cloud (which
// adapter serves each, what a call may carry) and the engine (which engine of a list can take a reference image, how long
// one clip may be). The ids are those of the engines registry (cloud/src/providers/engines.ts). Self-contained: the Cloud
// imports this file with its `.ts` extension, the app without.

export const IMAGE_ENGINES = [
  'image:gpt-image-25-low',
  'image:gpt-image-25-medium',
  'image:gpt-image-25-high',
  'image:gpt-image-25-fal-low',
  'image:gpt-image-25-fal-medium',
  'image:gpt-image-25-kie',
  'image:flux-schnell',
  'image:nano-banana-2',
  'image:flux3-klein',
  'image:z-image-turbo',
  'image:nano-banana-2-lite',
  'image:nano-banana-21',
  'image:seedream-50-lite'
] as const
export type ImageEngine = (typeof IMAGE_ENGINES)[number]

export const CLIP_ENGINES = [
  'clip:veo31-lite-relaxed',
  'clip:veo31-lite-vertex',
  'clip:veo31-lite',
  'clip:veo31-fast',
  'clip:veo31-fast-1080p',
  'clip:veo31-lite-kie',
  'clip:minimax-h3-lite',
  'clip:wan22',
  'clip:grok-imagine-15-lite',
  'clip:seedance-20-mini-480p',
  'clip:seedance-20-mini',
  'clip:seedance-15-pro',
  'clip:hailuo-23-fast',
  'clip:kling-25-turbo'
] as const
export type ClipEngine = (typeof CLIP_ENGINES)[number]

export interface ImageEngineCan {
  /** Reference images one call may carry (the model's edit or multi-image input); 0: text to image only. */
  references: number
  /** A negative prompt field of its own; otherwise the adapter writes « Avoid: … » at the end of the prompt. */
  negativeField: boolean
}

export interface ClipEngineCan {
  /** Starts from a still (image to video). Every clip engine we list does; text to video is the old path. */
  fromImage: boolean
  /** The clip lengths it makes, in seconds (a request is rounded up to the next one, cut at the last). */
  durations: readonly number[]
  /** Billed per call (`clip`) or per second of video (`second`), as its registry line says. */
  billed: 'clip' | 'second'
}

/** From each provider's public docs (read 2026-10-30 / 31; docs/PROVIDERS.md §6 lists what to confirm on the first call). */
export const IMAGE_ENGINE_CAN: Record<ImageEngine, ImageEngineCan> = {
  // GPT Image: the edits endpoint takes up to 16 input images; we send at most 4 (portrait, room, a recurring object)
  'image:gpt-image-25-low': { references: 4, negativeField: false },
  'image:gpt-image-25-medium': { references: 4, negativeField: false },
  'image:gpt-image-25-high': { references: 4, negativeField: false },
  // the same model on fal (its edit endpoint takes up to 16 image_urls) and on Kie.ai (input_urls, up to 16)
  'image:gpt-image-25-fal-low': { references: 4, negativeField: false },
  'image:gpt-image-25-fal-medium': { references: 4, negativeField: false },
  'image:gpt-image-25-kie': { references: 4, negativeField: false },
  // FLUX.1 schnell on fal: text to image only
  'image:flux-schnell': { references: 0, negativeField: false },
  // Gemini 3.1 Flash Image: several input images in the same request
  'image:nano-banana-2': { references: 3, negativeField: false },
  // unifically.com models (vrais-tests, docs.unifically.com read 2026-11-01): we send at most 4 references; Z-Image is text only
  'image:flux3-klein': { references: 4, negativeField: false },
  'image:z-image-turbo': { references: 0, negativeField: false },
  'image:nano-banana-2-lite': { references: 4, negativeField: false },
  'image:nano-banana-21': { references: 4, negativeField: false },
  'image:seedream-50-lite': { references: 4, negativeField: false }
}

export const CLIP_ENGINE_CAN: Record<ClipEngine, ClipEngineCan> = {
  'clip:veo31-lite-relaxed': { fromImage: true, durations: [4, 6, 8], billed: 'clip' },
  'clip:veo31-lite-vertex': { fromImage: true, durations: [4, 6, 8], billed: 'second' },
  'clip:veo31-lite': { fromImage: true, durations: [4, 6, 8], billed: 'clip' },
  'clip:veo31-fast': { fromImage: true, durations: [4, 6, 8], billed: 'clip' },
  'clip:veo31-fast-1080p': { fromImage: true, durations: [4, 6, 8], billed: 'clip' },
  'clip:veo31-lite-kie': { fromImage: true, durations: [4, 6, 8], billed: 'clip' },
  'clip:minimax-h3-lite': { fromImage: true, durations: [6, 10], billed: 'second' },
  // Wan 2.2 on fal: 17 to 161 frames at 16 per second
  'clip:wan22': { fromImage: true, durations: [2, 3, 4, 5, 6, 7, 8, 9, 10], billed: 'second' },
  // unifically.com models (vrais-tests): Grok Imagine Lite 1–15 s, SeeDance 2.0 Mini 4–15 s, SeeDance 1.5 Pro 4–12 s, Hailuo 2.3
  // Fast 6 or 10 s, Kling 2.5 Turbo 5 or 10 s; all billed per second (the dry run gives the exact price of a request)
  'clip:grok-imagine-15-lite': { fromImage: true, durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], billed: 'second' },
  'clip:seedance-20-mini-480p': { fromImage: true, durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], billed: 'second' },
  'clip:seedance-20-mini': { fromImage: true, durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], billed: 'second' },
  'clip:seedance-15-pro': { fromImage: true, durations: [4, 5, 6, 7, 8, 9, 10, 11, 12], billed: 'second' },
  'clip:hailuo-23-fast': { fromImage: true, durations: [6, 10], billed: 'second' },
  'clip:kling-25-turbo': { fromImage: true, durations: [5, 10], billed: 'second' }
}

export const isImageEngine = (v: unknown): v is ImageEngine => typeof v === 'string' && (IMAGE_ENGINES as readonly string[]).includes(v)
export const isClipEngine = (v: unknown): v is ClipEngine => typeof v === 'string' && (CLIP_ENGINES as readonly string[]).includes(v)

/** How many reference images an image engine takes (an unknown engine: none, so nothing is sent it cannot read). */
export const referencesOf = (engine: string | undefined): number => (isImageEngine(engine) ? IMAGE_ENGINE_CAN[engine].references : 0)

/** The clip length an engine makes for `seconds` asked: the next length it offers, at most its longest. Unknown engine: 10 s max. */
export function clipLengthFor(engine: string | undefined, seconds: number): number {
  const want = Math.max(1, Math.ceil(seconds - 1e-9))
  if (!isClipEngine(engine)) return Math.min(10, want)
  const d = CLIP_ENGINE_CAN[engine].durations
  return d.find((x) => x >= want) ?? (d.at(-1) as number)
}

/** The longest clip an engine makes (unknown engine: 10 s, the old text-to-video limit). */
export const clipMaxSeconds = (engine: string | undefined): number => (isClipEngine(engine) ? (CLIP_ENGINE_CAN[engine].durations.at(-1) as number) : 10)
