// The channel voice (production-5, decisions 0025 and 0029): `voice.make` in the app. A voice is made once — designed from
// a description, cloned from a sample (an upload, or 30–60 s isolated from the channel's own videos on import), or imported
// from a provider voice id — and may be cloned on several engines; its source sample is kept so it can be cloned again.
// No clone without the consent tick (who, when, what is stored with the voice); a voice cloned from the channel's videos
// is proposed until the owner accepts it. The channel's runs speak with its default active voice (`styleFor`).
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { toneVoice } from '../../../engine/nodes/voice-tone'
import type { MediaService } from '../../../engine/services'
import type { ChannelVoiceView, Consent, ConsentInput, VoiceDesignPreview, BlindTestResult } from '../../../shared/channel-voices'
import { ai33VoiceId } from '../../../shared/default-voices'
import { isVoiceEngine, VOICE_ENGINE_CAN, type VoiceEngine } from '../../../shared/voice-engines'
import type { CloudVoicesService } from '../../cloud/voices'
import type { Db } from '../../db'
import { BLIND_TEXT_FR, makeBlindTest } from './blind-test'
import { excerpt, isolateSpeech } from './sample'
import { ChannelVoiceStore } from './store'

/** What the voice service asks of Atelier Cloud (the app's Cloud voices service; tests give a fake). */
export type VoiceMaker = Pick<CloudVoicesService, 'clone' | 'design' | 'keep' | 'speak'>

/** The engines a new voice is cloned on when none are named: ai33 Pro only (standing order 2026-11-02). Any other engine is
 * cloned only when the caller names it (the app shows the quote first): never an unquoted paid clone (issue #109). */
export const DEFAULT_CLONE_ENGINES: readonly VoiceEngine[] = ['voice:ai33']
/** The engine voice design runs on (the only one that designs, decision 0029). */
export const DESIGN_ENGINE: VoiceEngine = 'voice:elevenlabs-v2'
/** What a designed voice says to make the sample it is cloned from on another engine (about a minute: every engine takes it). */
export const SAMPLE_TEXT_FR = `${BLIND_TEXT_FR} ${BLIND_TEXT_FR}`

export interface ChannelVoicesOptions {
  db: Db
  /** Where samples, previews and blind tests are kept (`<userData>/voices`). */
  dir: string
  maker: VoiceMaker
  /** ffmpeg of this computer (null: samples are sent as they are, the provider checks them). */
  media: MediaService | null
  now?: () => Date
  notify?: () => void
}

const text = (v: unknown, what: string, max: number): string => {
  const s = typeof v === 'string' ? v.trim() : ''
  if (s.length < 1 || s.length > max) throw new Error(`${what} : entre 1 et ${max} caractères.`)
  return s
}
const lang = (v: unknown): string => (typeof v === 'string' && /^[a-z]{2}$/.test(v) ? v : 'fr')
const engineOf = (v: unknown): VoiceEngine => {
  if (!isVoiceEngine(v)) throw new Error(`Moteur de voix inconnu : ${String(v)}.`)
  return v
}
const enginesOf = (v: unknown): VoiceEngine[] => {
  const list = v === undefined ? [...DEFAULT_CLONE_ENGINES] : Array.isArray(v) ? v.map(engineOf) : []
  if (list.length === 0) throw new Error('Choisis au moins un moteur de voix.')
  const unable = list.find((e) => !VOICE_ENGINE_CAN[e].clone)
  if (unable) throw new Error(`Le moteur ${unable} ne clone pas de voix.`)
  return [...new Set(list)]
}

export class ChannelVoices {
  private readonly store: ChannelVoiceStore
  private readonly now: () => Date

  constructor(private readonly o: ChannelVoicesOptions) {
    this.now = o.now ?? (() => new Date())
    this.store = new ChannelVoiceStore(o.db, this.now)
  }

  list(channelId: number): ChannelVoiceView[] {
    this.channel(channelId)
    return this.store.list(channelId)
  }

  /** The voice a run of this channel speaks with: its default active voice's id per engine, or null when it has none. */
  styleFor(channelId: number): { voice: string; voices: Record<string, string> } | null {
    const v = this.store.list(channelId).find((x) => x.isDefault && x.status === 'active' && x.clones.length > 0)
    if (!v) return null
    const spoken = (c: { engine: string; voiceId: string }): string => (c.engine === 'voice:ai33' ? ai33VoiceId(c.voiceId) : c.voiceId)
    return { voice: spoken(v.clones[0] as { engine: string; voiceId: string }), voices: Object.fromEntries(v.clones.map((c) => [c.engine, spoken(c)])) }
  }

  // ---- design --------------------------------------------------------------------------------------------------------

  async design(input: { channelId: number; description: string; text?: string; language?: string; engine?: string }): Promise<{ previews: VoiceDesignPreview[]; demo: boolean }> {
    this.channel(input.channelId)
    const description = text(input.description, 'La description de la voix', 1000)
    if (description.length < 20) throw new Error('Décris la voix en au moins 20 caractères (timbre, âge, ton, débit).')
    const engine = engineOf(input.engine ?? DESIGN_ENGINE)
    if (!VOICE_ENGINE_CAN[engine].design) throw new Error(`Le moteur ${engine} ne crée pas de voix à partir d’une description.`)
    const dir = path.join(this.o.dir, 'designs', `${input.channelId}-${this.now().getTime()}`)
    await mkdir(dir, { recursive: true })
    return this.o.maker.design({ description, ...(input.text ? { text: input.text } : {}), language: lang(input.language), engine }, dir)
  }

  async keepDesign(input: { channelId: number; description: string; generatedVoiceId: string; name: string; previewFile?: string; language?: string; engine?: string }): Promise<ChannelVoiceView> {
    this.channel(input.channelId)
    const engine = engineOf(input.engine ?? DESIGN_ENGINE)
    const name = text(input.name, 'Le nom de la voix', 60)
    const description = text(input.description, 'La description de la voix', 1000)
    const language = lang(input.language)
    const kept = await this.o.maker.keep({ description, generatedVoiceId: text(input.generatedVoiceId, 'L’essai choisi', 200), name, language, engine })
    // a designed voice is ours: no one else's voice, so its consent is « designed »
    const id = this.store.insert({ channelId: input.channelId, name, method: 'design', source: 'design', description, language, consent: this.consent({ granted: true, statement: 'own-voice', by: 'design' }, 'designed'), status: 'active' })
    this.store.addClone(id, engine, kept.voiceId, kept.demo)
    if (input.previewFile) await this.keepSample(id, input.previewFile)
    return this.adopt(input.channelId, id)
  }

  // ---- clone ---------------------------------------------------------------------------------------------------------

  async clone(input: { channelId: number; name: string; language?: string; fileName: string; bytes: Uint8Array; consent: ConsentInput; engines?: string[] }): Promise<ChannelVoiceView> {
    this.channel(input.channelId)
    const consent = this.consent(input.consent)
    const engines = enginesOf(input.engines)
    const name = text(input.name, 'Le nom de la voix', 60)
    const ext = path.extname(input.fileName).toLowerCase() || '.wav'
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'atelier-voice-'))
    try {
      const file = path.join(tmp, `sample${ext}`)
      await writeFile(file, input.bytes)
      const id = this.store.insert({ channelId: input.channelId, name, method: 'clone', source: 'upload', language: lang(input.language), consent, status: 'active' })
      const sample = await this.keepSample(id, file)
      await this.cloneSample(id, sample, engines)
      return this.adopt(input.channelId, id)
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async fromChannelVideo(input: { channelId: number; name: string; videoFile: string; language?: string; consent: ConsentInput; engines?: string[] }): Promise<ChannelVoiceView> {
    this.channel(input.channelId)
    // decision 0025: cloning the voice of someone else's channel is refused
    if (input.consent?.statement !== 'own-channel') throw new Error('Pour cloner la voix des vidéos d’une chaîne, coche « cette chaîne est à moi » : la voix de la chaîne de quelqu’un d’autre n’est jamais clonée.')
    const consent = this.consent(input.consent)
    const engines = enginesOf(input.engines)
    if (!this.o.media) throw new Error('ffmpeg est introuvable : impossible d’extraire la voix de la vidéo.')
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'atelier-voice-'))
    try {
      const { file } = await isolateSpeech(this.o.media, input.videoFile, tmp, new AbortController().signal)
      const id = this.store.insert({ channelId: input.channelId, name: text(input.name, 'Le nom de la voix', 60), method: 'clone', source: 'channel', language: lang(input.language), consent, status: 'proposed' })
      const sample = await this.keepSample(id, file)
      await this.cloneSample(id, sample, engines)
      this.o.notify?.()
      return this.store.get(id) as ChannelVoiceView
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** One more engine for a voice the channel has (Charlie's flow: made on ElevenLabs, cloned on a cheaper engine). */
  async cloneOn(voiceId: number, engineId: string): Promise<ChannelVoiceView> {
    const v = this.voice(voiceId)
    const engine = enginesOf([engineId])[0] as VoiceEngine
    if (v.status === 'retired') throw new Error('Cette voix est retirée.')
    if (!v.consent) throw new Error('Cette voix n’a pas de consentement enregistré : clone-la à nouveau depuis un enregistrement.')
    let sample = this.store.sampleOf(voiceId)
    // a designed (or short) sample: the voice speaks a minute of text on an engine it already has, and that is the sample
    if (!sample || v.method === 'design') {
      const from = v.clones[0]
      if (!from) throw new Error('Cette voix n’a ni échantillon ni moteur pour en faire un.')
      const dir = path.join(this.o.dir, String(voiceId))
      await mkdir(dir, { recursive: true })
      const spoken = await this.o.maker.speak({ text: SAMPLE_TEXT_FR, voiceId: from.voiceId, engine: from.engine }, dir)
      sample = await this.keepSample(voiceId, spoken.file)
    }
    await this.cloneSample(voiceId, sample, [engine])
    this.o.notify?.()
    return this.store.get(voiceId) as ChannelVoiceView
  }

  // ---- import, statuses ----------------------------------------------------------------------------------------------

  import(input: { channelId: number; name: string; engine: string; providerVoiceId: string; language?: string }): ChannelVoiceView {
    this.channel(input.channelId)
    const engine = engineOf(input.engine)
    const id = this.store.insert({ channelId: input.channelId, name: text(input.name, 'Le nom de la voix', 60), method: 'import', source: 'provider', language: lang(input.language), consent: null, status: 'active' })
    this.store.addClone(id, engine, text(input.providerVoiceId, 'L’identifiant de la voix', 100), false)
    return this.adopt(input.channelId, id)
  }

  accept(voiceId: number): ChannelVoiceView {
    const v = this.voice(voiceId)
    if (v.status !== 'proposed') throw new Error('Cette voix n’est pas une proposition.')
    this.store.setStatus(voiceId, 'active')
    this.store.setDefault(v.channelId, voiceId)
    this.o.notify?.()
    return this.store.get(voiceId) as ChannelVoiceView
  }

  setDefault(voiceId: number): ChannelVoiceView {
    const v = this.voice(voiceId)
    if (v.status !== 'active') throw new Error('Seule une voix active peut être la voix de la chaîne.')
    this.store.setDefault(v.channelId, voiceId)
    this.o.notify?.()
    return this.store.get(voiceId) as ChannelVoiceView
  }

  retire(voiceId: number): ChannelVoiceView {
    this.voice(voiceId)
    this.store.setStatus(voiceId, 'retired')
    this.o.notify?.()
    return this.store.get(voiceId) as ChannelVoiceView
  }

  // ---- blind test ----------------------------------------------------------------------------------------------------

  async blindTest(voiceId: number, text?: string): Promise<BlindTestResult> {
    const v = this.voice(voiceId)
    if (v.clones.length < 2) throw new Error('Clone d’abord la voix sur au moins deux moteurs.')
    const demo = v.clones.every((c) => c.demo)
    const dir = path.join(this.o.dir, 'blind-tests', `${voiceId}-${this.now().toISOString().replace(/[:.]/g, '-')}`)
    const entries = v.clones.map((c, i) => ({
      engine: c.engine,
      render: async (spoken: string, out: string): Promise<string> => {
        // demo clones: a tone at a pitch of its own per engine (the Cloud's fake voice is the same file for every engine)
        if (demo) {
          await toneVoice(spoken, v.language, `${out}.wav`, 40 * i)
          return `${out}.wav`
        }
        const r = await this.o.maker.speak({ text: spoken, voiceId: c.voiceId, engine: c.engine }, path.dirname(out))
        const target = `${out}${path.extname(r.file) || '.mp3'}`
        await copyFile(r.file, target)
        await rm(r.file, { force: true })
        return target
      }
    }))
    // a text of the channel's own (avatar-reglages-voix: 60 s of Marcel's script), else the 30 s Titanic text
    const own = typeof text === 'string' && text.trim().split(/\s+/).length >= 10 ? text.trim().slice(0, 3000) : undefined
    const { files } = await makeBlindTest({ dir, entries, seed: `${voiceId}:${this.now().getTime()}`, ...(own ? { text: own } : {}) })
    return { dir, files, demo }
  }

  // ---- inside --------------------------------------------------------------------------------------------------------

  private channel(channelId: number): void {
    if (!Number.isInteger(channelId) || !this.o.db.prepare('SELECT 1 FROM channels WHERE id = ?').get(channelId)) throw new Error('Chaîne introuvable.')
  }

  private voice(id: number): ChannelVoiceView {
    const v = Number.isInteger(id) ? this.store.get(id) : null
    if (!v) throw new Error('Voix introuvable.')
    return v
  }

  /** Decision 0025: the tick is required; who, when and what are kept with the voice. */
  private consent(c: ConsentInput | undefined, statement?: Consent['statement']): Consent {
    if (!c || c.granted !== true || !['own-voice', 'rights', 'own-channel'].includes(c.statement)) {
      throw new Error('Coche la case qui dit que tu as les droits sur cette voix : sans elle, aucune voix n’est clonée.')
    }
    return { by: typeof c.by === 'string' && c.by.trim() ? c.by.trim().slice(0, 80) : 'propriétaire', at: this.now().toISOString(), statement: statement ?? c.statement }
  }

  /** Copies `file` as the voice's kept sample. */
  private async keepSample(id: number, file: string): Promise<string> {
    const dir = path.join(this.o.dir, String(id))
    await mkdir(dir, { recursive: true })
    const target = path.join(dir, `sample${path.extname(file).toLowerCase() || '.wav'}`)
    if (path.resolve(target) !== path.resolve(file)) await copyFile(file, target)
    this.store.setSample(id, target)
    return target
  }

  /** Clones the sample on each engine (cut to what the engine takes), recording each clone. */
  private async cloneSample(id: number, sample: string, engines: readonly VoiceEngine[]): Promise<void> {
    const v = this.voice(id)
    for (const engine of engines) {
      const maxS = VOICE_ENGINE_CAN[engine].cloneSampleS[1]
      const file = this.o.media ? await excerpt(this.o.media, sample, path.join(path.dirname(sample), `sample-${maxS}s.wav`), maxS, new AbortController().signal) : sample
      const bytes = new Uint8Array(await readFile(file))
      const cloned = await this.o.maker.clone({ name: v.name, language: v.language, fileName: path.basename(file), bytes, consent: true, engine })
      this.store.addClone(id, engine, cloned.id, cloned.demo)
    }
  }

  /** A new active voice becomes the channel's default when it has none yet. */
  private adopt(channelId: number, id: number): ChannelVoiceView {
    if (!this.store.list(channelId).some((x) => x.isDefault && x.status === 'active')) this.store.setDefault(channelId, id)
    this.o.notify?.()
    return this.store.get(id) as ChannelVoiceView
  }
}
