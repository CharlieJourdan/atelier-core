// The real adapters of this version and which one serves each usage, from config.json (`providers`, `minimax`,
// `elevenlabs`, `gemini`, `fal`, `hedra`, `wikimedia`). Building them is free: nothing is called until a job runs, and a job only reaches
// one through the registry's guard (paidCalls on, not a test run, the key in the vault).
import type { Usage } from '../../../src/shared/cloud-api.ts'
import type { CloudConfig } from '../config.ts'
import { elevenlabsAdapter } from './elevenlabs.ts'
import { falAdapter } from './fal.ts'
import { geminiAdapter } from './gemini.ts'
import { hedraAdapter } from './hedra.ts'
import { heygenMcpAdapter } from './heygen-mcp.ts'
import type { HttpOptions } from './http.ts'
import { minimaxAdapter } from './minimax.ts'
import { pexelsAdapter } from './pexels.ts'
import { pixabayAdapter } from './pixabay.ts'
import { presenterEngineAdapters } from './presenter-engines.ts'
import type { ProviderAdapter } from './types.ts'
import { visualEngineAdapters } from './visual-engines.ts'
import { voiceEngineAdapters } from './voice-engines.ts'
import { wikimediaAdapter } from './wikimedia.ts'
import { youtubeAdapter } from './youtube.ts'

export interface RealSetup {
  adapters: ProviderAdapter[]
  /** Usage → the adapter id the config picked ('fake' = the demo). */
  select: Partial<Record<Usage, string>>
  /** The engines whose real adapter may serve a job that names them (config.json `realEngines`). */
  engines: string[]
}

export function realProviders(
  cfg: Pick<CloudConfig, 'providers' | 'minimax' | 'elevenlabs' | 'gemini' | 'fal' | 'hedra' | 'wikimedia' | 'youtube'> & Partial<Pick<CloudConfig, 'realEngines' | 'infinitetalk'>>,
  http: HttpOptions = {}
): RealSetup {
  return {
    adapters: [
      minimaxAdapter({ ...http, model: cfg.minimax.model, region: cfg.minimax.region, speed: cfg.minimax.speed, languageBoost: cfg.minimax.languageBoost }),
      elevenlabsAdapter({
        ...http,
        model: cfg.elevenlabs.model,
        speed: cfg.elevenlabs.speed,
        ...(cfg.elevenlabs.languageCode ? { languageCode: cfg.elevenlabs.languageCode } : {})
      }),
      geminiAdapter({ ...http, model: cfg.gemini.model, imageModel: cfg.gemini.imageModel }),
      falAdapter({ ...http, videoResolution: cfg.fal.videoResolution }),
      hedraAdapter({ ...http, resolution: cfg.hedra.resolution, ...(cfg.hedra.model ? { model: cfg.hedra.model } : {}) }),
      pexelsAdapter(http),
      pixabayAdapter(http),
      youtubeAdapter({ ...http, dailyQuota: cfg.youtube.dailyQuota }),
      wikimediaAdapter({ ...http, ...(cfg.wikimedia.contact ? { contact: cfg.wikimedia.contact } : {}) }),
      ...voiceEngineAdapters(http),
      ...presenterEngineAdapters(http, cfg.infinitetalk ?? {}),
      // HeyGen on the founder's plan through its MCP server: the sign-in (OAuth) is its vault entry (production-10)
      heygenMcpAdapter(http),
      ...visualEngineAdapters(http)
    ],
    engines: [...(cfg.realEngines ?? [])],
    // cloning follows the voice provider: only MiniMax clones (ElevenLabs does not here), so the others stay demo
    select: {
      synthesize: cfg.providers.synthesize,
      analyseVideo: cfg.providers.analyseVideo,
      generateImage: cfg.providers.generateImage,
      generateVideo: cfg.providers.generateVideo,
      talkingAvatar: cfg.providers.talkingAvatar,
      searchStock: cfg.providers.searchStock,
      channelData: cfg.providers.channelData,
      cloneVoice: cfg.providers.synthesize === 'minimax' ? 'minimax' : 'fake'
    }
  }
}
