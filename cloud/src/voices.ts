// The voices a team can pick (the catalogue's `voices`): the platform's own, then the ones this team cloned. A cloned voice is
// the result of a succeeded `cloneVoice` job (`result.voiceId`, `name`, `language`); it is demo when that job was.
import type { z } from 'zod'
import type { CatalogResponse } from '../../src/shared/cloud-api.ts'
import type { CloudDb } from './db/index.ts'
import { DEFAULT_REAL_VOICE_LIST, defaultVoiceFor, isDemoVoiceId } from '../../src/shared/default-voices.ts'
import { FAKE_VOICES } from './providers/fakes.ts'

type Voice = z.infer<typeof CatalogResponse>['voices'][number]

/**
 * A demonstration voice (`demo-claire`…) is never sent to a real provider (issue #95: ai33 answered 400 to it): the default real
 * voice of its language speaks instead. Null when the input names a real voice.
 */
export function realVoiceInput(input: { voiceId?: unknown }): { voiceId: string; note: string } | null {
  if (typeof input.voiceId !== 'string' || !isDemoVoiceId(input.voiceId)) return null
  const swap = defaultVoiceFor(FAKE_VOICES.find((v) => v.id === input.voiceId)?.language ?? 'fr')
  return { voiceId: swap.id, note: `voix de démonstration ${input.voiceId} remplacée par la voix par défaut ${swap.name}` }
}

export function listVoices(db: CloudDb, teamId: string): Voice[] {
  const rows = db
    .prepare(`SELECT result_json, demo FROM jobs WHERE team_id = ? AND usage = 'cloneVoice' AND state = 'succeeded' ORDER BY created_at, rowid`)
    .all(teamId) as { result_json: string | null; demo: number }[]
  const cloned: Voice[] = []
  for (const r of rows) {
    let data: { voiceId?: unknown; name?: unknown; language?: unknown } = {}
    try {
      data = JSON.parse(r.result_json ?? '{}') as typeof data
    } catch {
      continue
    }
    if (typeof data.voiceId !== 'string' || cloned.some((v) => v.id === data.voiceId)) continue
    cloned.push({
      id: data.voiceId,
      name: typeof data.name === 'string' ? data.name : data.voiceId,
      language: typeof data.language === 'string' ? data.language : 'fr',
      demo: r.demo === 1,
      cloned: true,
      default: false
    })
  }
  // the demonstration voices, then the default real voice of each language (ai33 Pro, issue #95), then the team's own clones
  return [...FAKE_VOICES.map((v) => ({ ...v, demo: true, cloned: false, default: false })), ...DEFAULT_REAL_VOICE_LIST.map((v) => ({ ...v, demo: false, cloned: false, default: true })), ...cloned]
}
