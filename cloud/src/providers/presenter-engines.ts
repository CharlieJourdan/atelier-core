// The real adapters of the presenter engines (production-7, decision 0034): one adapter per engine, whose id IS the engine id, so a
// `talkingAvatar` job that names `engine: "presenter:kling-avatar2-std"` reaches it through the registry (`resolveFor`). Building
// them is free, nothing is called until a job runs behind the paidCalls guard, with the engine listed in config.json `realEngines`
// and its key in the vault (HEYGEN_API_KEY, HEDRA_API_KEY, FAL_KEY, WAVESPEED_API_KEY, RUNPOD_API_KEY, KIE_API_KEY). Without that,
// the usage's fake answers (demo). `presenter:heygen-mcp` (the founder's HeyGen plan, an OAuth sign-in) is registered apart in
// real.ts.
//
//   presenter:heygen-avatar4                       HeyGen API v3                    HEYGEN_API_KEY
//   presenter:hedra-c3                             Hedra Character-3                HEDRA_API_KEY
//   presenter:kling-avatar2-std                    Kling AI Avatar v2 on fal        FAL_KEY
//   presenter:infinitetalk-fast / -std             InfiniteTalk on WaveSpeed        WAVESPEED_API_KEY
//   presenter:pruna-avatar                         Pruna P-Video Avatar, WaveSpeed  WAVESPEED_API_KEY
//   presenter:infinitetalk-gpu                     InfiniteTalk on RunPod           RUNPOD_API_KEY
//   presenter:kling-avatar-kie                     Kling AI Avatar on Kie.ai        KIE_API_KEY
import { PRESENTER_ENGINES } from '../../../src/shared/presenter-engines.ts'
import { falAvatarAdapter } from './fal-avatar.ts'
import { hedraAdapter } from './hedra.ts'
import { heygenAdapter } from './heygen.ts'
import type { HttpOptions } from './http.ts'
import { infinitetalkGpuAdapter, type InfinitetalkSettings } from './infinitetalk-gpu.ts'
import { kieAvatarAdapter } from './kie.ts'
import type { ProviderAdapter } from './types.ts'
import { wavespeedAdapter } from './wavespeed.ts'

/** The presenter engines with a real adapter in this version (FAKE_ENGINES declares the same ids); the MCP one is in real.ts. */
export const REAL_PRESENTER_ENGINES = PRESENTER_ENGINES

export function presenterEngineAdapters(http: HttpOptions = {}, infinitetalk: Partial<InfinitetalkSettings> = {}): ProviderAdapter[] {
  return [
    heygenAdapter(http),
    hedraAdapter({ ...http, id: 'presenter:hedra-c3', engine: 'presenter:hedra-c3' }),
    falAvatarAdapter(http),
    wavespeedAdapter(http),
    infinitetalkGpuAdapter({ ...http, ...infinitetalk }),
    wavespeedAdapter({ ...http, engine: 'presenter:infinitetalk-std' }),
    wavespeedAdapter({ ...http, engine: 'presenter:pruna-avatar' }),
    kieAvatarAdapter(http)
  ]
}
