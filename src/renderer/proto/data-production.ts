// Demo voices of the presentation mode (Réglages › Audio and the voice lists outside Production). Production's own demo
// data (pre-made pipelines, bricks, avatars, versions, library extras) was removed in production-2 (decision 0008).
// Invented values only. Pure data, no React.

export interface ProtoVoice {
  id: string
  name: string
  kind: 'minimax' | 'clone' | 'eleven' | 'human' | 'platform'
  lang: string
  channelId?: string
  note: string
  /** Real mode: a voice of the Cloud's demo provider (nothing paid). */
  demo?: boolean
}

export const VOICES: readonly ProtoVoice[] = [
  { id: 'vo-narrator', name: 'Narrateur grave', kind: 'clone', lang: 'FR', channelId: 'ch-enigmes', note: 'Voix clonée de la chaîne' },
  { id: 'vo-storyteller', name: 'Conteur vif', kind: 'minimax', lang: 'FR', channelId: 'ch-histoires', note: 'MiniMax Speech' },
  { id: 'vo-host', name: 'Animateur enjoué', kind: 'minimax', lang: 'FR', channelId: 'ch-top', note: 'MiniMax Speech' },
  { id: 'vo-narrator-en', name: 'Narrator (EN)', kind: 'clone', lang: 'EN', channelId: 'ch-mystery', note: 'Clone de la voix FR, en anglais' },
  { id: 'vo-eleven', name: 'Léa (ElevenLabs)', kind: 'eleven', lang: 'FR', note: 'Importée avec ta clé' },
  { id: 'vo-charlie', name: 'Ma voix', kind: 'human', lang: 'FR', note: 'Enregistrée par toi' }
]
