// The paid slots: sources that charge per use. They are in the catalog so the planner, the docs and the key list know them, but
// `searchMedia` never calls one unless the caller passes `allowPaid` (Charlie's OK, per run), and until a real adapter is built
// their `search` refuses. They GENERATE a file rather than find one, so a real adapter lives in the Cloud (provider jobs, billing,
// vault key) and is not part of this free chantier. `fakePaid` (./fakes.ts) stands in for them in tests.
//   ElevenLabs sound effects   POST /v1/sound-generation { text, duration_seconds }   vault ELEVENLABS_API_KEY (already used for voice)
//   ElevenLabs Music           $0.15 a minute (research note MEDIA-PROVIDERS-2026-10 (old repository) §7); commercial use needs the Starter plan
//   Epidemic Sound             Partner API, partner agreement needed for distribution to end users: not a self-serve source
import type { MediaCandidate, MediaKind, SourcingProvider } from '../types.ts'

function slot(id: string, label: string, kind: MediaKind, estCostUsd: number): SourcingProvider {
  return {
    id,
    label,
    kinds: [kind],
    paid: true,
    estCostUsd,
    search(): Promise<MediaCandidate[]> {
      return Promise.reject(new Error(`${label}: the paid adapter is not built yet (slot only)`))
    }
  }
}

export const elevenlabsSfx = slot('elevenlabs-sfx', 'ElevenLabs sound effects', 'sfx', 0.02)
export const elevenlabsMusic = slot('elevenlabs-music', 'ElevenLabs Music', 'music', 0.15)
