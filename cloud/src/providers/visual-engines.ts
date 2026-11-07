// The real adapters of the still and clip engines (production-8, decision 0035), like voice-engines.ts: one adapter per engine,
// whose id IS the engine id, so a job that names `engine: "image:flux-schnell"` or `"clip:wan22"` reaches it through the registry
// (`resolveFor`). Building them is free; nothing is called until a job runs behind the paidCalls guard, with the engine listed in
// config.json `realEngines` and its key in the vault. Without that, the usage's fake answers (demo).
//
//   image:gpt-image-25-low / -medium / -high   OpenAI Images              OPENAI_API_KEY
//   image:gpt-image-25-fal-low / -medium       GPT Image 2.5 on fal.ai    FAL_KEY
//   image:gpt-image-25-kie             GPT Image 2.5 on Kie.ai            KIE_API_KEY
//   image:flux-schnell                 fal.ai FLUX schnell                FAL_KEY
//   image:nano-banana-2                Gemini 3.1 Flash Image             GEMINI_API_KEY
//   clip:wan22                         fal.ai Wan 2.2 (480p)              FAL_KEY
//   clip:minimax-h3-lite               MiniMax Hailuo 3 Lite              MINIMAX_API_KEY
//   clip:veo31-lite-vertex             Veo 3.1 Lite on Vertex AI          VERTEX_SERVICE_ACCOUNT_JSON
//   clip:veo31-lite-relaxed / -lite / -fast / -fast-1080p   Veo 3.1 through unifically.com   UNIFICALLY_API_KEY
//   clip:veo31-lite-kie                Veo 3.1 Lite on Kie.ai             KIE_API_KEY
//   image:flux3-klein, z-image-turbo, nano-banana-2-lite, nano-banana-21, seedream-50-lite; clip:grok-imagine-15-lite,
//   seedance-20-mini(-480p), seedance-15-pro, hailuo-23-fast, kling-25-turbo   through unifically.com   UNIFICALLY_API_KEY
import { CLIP_ENGINES, IMAGE_ENGINES } from '../../../src/shared/visual-engines.ts'
import { falAdapter } from './fal.ts'
import { falGptImageAdapter } from './fal-image.ts'
import { GEMINI_BASE } from './gemini.ts'
import { geminiImageMethod } from './gemini-image.ts'
import { kieImageAdapter, kieVeoAdapter } from './kie.ts'
import { minimaxVideoAdapter } from './minimax-video.ts'
import { openaiImageAdapter } from './openai-image.ts'
import type { ProviderAdapter } from './types.ts'
import { UNIFICALLY_MODEL_ENGINES, unificallyModelAdapter } from './unifically.ts'
import { unificallyAdapter, veoVertexAdapter } from './veo.ts'
import type { PollOptions } from './visual-common.ts'

/** The still and clip engines with a real adapter in this version (FAKE_ENGINES declares the same ids). */
export const REAL_VISUAL_ENGINES = [...IMAGE_ENGINES, ...CLIP_ENGINES] as const

/** Nano Banana 2 (the engine's price line, USD 0.067, is the 1K price of this model). */
export const NANO_BANANA_2_MODEL = 'gemini-3.1-flash-image'

/** The same adapter keeping only one usage, so a clip engine never answers a picture job or the other way round. */
function only(adapter: ProviderAdapter, usage: 'generateImage' | 'generateVideo'): ProviderAdapter {
  const copy: ProviderAdapter = { ...adapter }
  if (usage === 'generateImage') delete copy.generateVideo
  else delete copy.generateImage
  return copy
}

/** `http` carries the fetch, timeout and (long jobs) the pause between polls and the longest wait: tests give a fake fetch and 0. */
export function visualEngineAdapters(http: PollOptions = {}): ProviderAdapter[] {
  return [
    openaiImageAdapter({ ...http, id: 'image:gpt-image-25-low' }),
    openaiImageAdapter({ ...http, id: 'image:gpt-image-25-medium' }),
    openaiImageAdapter({ ...http, id: 'image:gpt-image-25-high' }),
    falGptImageAdapter({ ...http, id: 'image:gpt-image-25-fal-low' }),
    falGptImageAdapter({ ...http, id: 'image:gpt-image-25-fal-medium' }),
    kieImageAdapter(http),
    only(falAdapter({ ...http, id: 'image:flux-schnell' }), 'generateImage'),
    { id: 'image:nano-banana-2', kind: 'real', secretName: 'GEMINI_API_KEY', generateImage: geminiImageMethod(GEMINI_BASE, NANO_BANANA_2_MODEL, http) },
    only(falAdapter({ ...http, id: 'clip:wan22', videoResolution: '480p' }), 'generateVideo'),
    minimaxVideoAdapter({ ...http, id: 'clip:minimax-h3-lite' }),
    veoVertexAdapter({ ...http, id: 'clip:veo31-lite-vertex' }),
    unificallyAdapter({ ...http, id: 'clip:veo31-lite-relaxed' }),
    unificallyAdapter({ ...http, id: 'clip:veo31-lite' }),
    unificallyAdapter({ ...http, id: 'clip:veo31-fast' }),
    unificallyAdapter({ ...http, id: 'clip:veo31-fast-1080p' }),
    kieVeoAdapter(http),
    ...UNIFICALLY_MODEL_ENGINES.map((id) => unificallyModelAdapter({ ...http, id }))
  ]
}
