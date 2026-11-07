// Real mode, voices: the Cloud's voice list (`cloud.voices`) as the proto screens read it (« Mes voix », the voice picker of
// « Nouvelle vidéo »). Nothing is invented: when the app is not connected or the Cloud does not answer, the list is empty and
// the status says why, so the screen shows the reason instead of voices.
import type { CloudVoices, CloudVoice } from '../../../shared/api'
import type { MessageKey } from '../../../shared/fr'
import { VOICES, type ProtoVoice } from '../data-production'

export interface LiveVoices {
  status: CloudVoices['status']
  voices: ProtoVoice[]
  /** Whether cloning is real or a demo (null: the Cloud does not offer it). */
  clone: CloudVoices['clone']
}

/** A Cloud voice as a proto voice: a clone is `clone`, a platform voice `platform`; demo voices keep their flag. */
export function mapVoice(v: CloudVoice): ProtoVoice {
  return { id: v.id, name: v.name, kind: v.cloned ? 'clone' : 'platform', lang: v.language.toUpperCase(), note: '', ...(v.demo ? { demo: true } : {}) }
}

export function mapVoices(v: CloudVoices): LiveVoices {
  return { status: v.status, voices: v.voices.map(mapVoice), clone: v.clone }
}

export interface VoiceList {
  voices: readonly ProtoVoice[]
  status: LiveVoices['status'] | 'demo' | 'loading'
  clone: LiveVoices['clone']
}

/** The voices a screen shows: the demo ones, or in real mode the Cloud's (empty until the first read). */
export function voicesOf(state: { mode: 'demo' | 'live'; liveVoices: LiveVoices | null }): VoiceList {
  if (state.mode !== 'live') return { voices: VOICES, status: 'demo', clone: null }
  if (!state.liveVoices) return { voices: [], status: 'loading', clone: null }
  return state.liveVoices
}

/** The message that explains an empty real-mode list (null when there is nothing to explain). */
export function voicesNotice(status: VoiceList['status']): MessageKey | null {
  if (status === 'not-connected') return 'cloud.voices.notConnected'
  if (status === 'unreachable') return 'cloud.voices.unreachable'
  return null
}

/** The voice a new video starts with: the chosen one if it still exists, else the channel's, else a clone, else the first. */
export function defaultVoice(voices: readonly ProtoVoice[], chosen: string, channelId: string): string {
  if (chosen && voices.some((v) => v.id === chosen)) return chosen
  return voices.find((v) => v.channelId === channelId)?.id ?? voices.find((v) => v.kind === 'clone')?.id ?? voices[0]?.id ?? ''
}
