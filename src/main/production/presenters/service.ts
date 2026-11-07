// The channel presenter (production-7, decisions 0025 and 0034, docs/specs/pipeline-avatar.md §2.5 a): `presenter.make` in the app.
// A presenter is made once — a portrait generated from an art-direction description (style `presenter-studio`), or cloned
// from frames of the channel's OWN videos picked by the eyes — then given 3 to 6 angles (the portrait edited into other
// framings, each kept only when the face-similarity check passes) and registered per presenter engine. No clone without the
// consent tick (who, when, what is stored); a cloned presenter is proposed until the owner accepts it. The channel's runs
// read its default active presenter (`styleFor`) as a channel input: `$style.presenter`.
import { copyFile, mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Aspect } from '../../../engine/formats/timing'
import { ANGLE_SIMILARITY_MIN, faceSimilarity } from '../../../engine/presenter/face'
import { identityVerdict, type FaceIdentity } from '../../../engine/presenter/face-id'
import { EngineError } from '../../../engine/errors'
import type { PresenterRef } from '../../../engine/presenter/talk'
import type { MediaService } from '../../../engine/services'
import { ANGLE_ENGINES, type ChannelPresenterView, type PresenterAnglesResult, type PresenterConsent, type PresenterConsentInput } from '../../../shared/channel-presenters'
import { isPresenterEngine, type Framing } from '../../../shared/presenter-engines'
import type { Db } from '../../db'
import type { PortraitCleaner, PresenterPictures } from './pictures'
import { ChannelPresenterStore, type PresenterRecord, type StoredAngle } from './store'

/**
 * What the `presenter-studio` brick style adds to a portrait prompt when the style store is not wired (it mirrors that style
 * and pipeline-avatar §2.5 a): one person facing the camera, upper body, a real-looking room that fits the persona, one
 * recurring outfit.
 */
export const PRESENTER_STYLE_SUFFIX =
  'One person facing the camera, upper body, eyes to camera, calm natural expression, in a real-looking room that fits the persona, wearing one recurring outfit.'

export const ANGLES_MIN = 3
export const ANGLES_MAX = 6
/** The order angles are made in: a wide shot, a close-up, then another medium shot; the cycle repeats past three. */
const ANGLE_ORDER: readonly Framing[] = ['wide', 'close', 'medium']
const FRAMING_TEXT: Record<Framing, string> = {
  wide: 'wide shot, the person seen from the waist up with the room around',
  medium: 'chest-up portrait, slightly different head angle',
  close: 'close-up on the face and shoulders'
}
/** Each framing is tried this many times before it is dropped (an image edit costs about a cent). */
const ATTEMPTS = 2
/** The edit that cleans a portrait: nothing about the person changes, only the picture's quality. */
export const CLEAN_PROMPT =
  'The same photograph, cleaner: the same person with the same face, expression, hair, beard and skin, the same clothes, the same pose and framing, the same room and light. Remove compression artefacts, blur and noise; sharp natural detail, true colours. Change nothing else, add nothing, remove no object.'

export interface ChannelPresentersOptions {
  db: Db
  /** Where portraits and angles are kept (`<userData>/presenters`, one folder per presenter). */
  dir: string
  /** Makes the pictures (Atelier Cloud's image engine once it takes image references; a stand-in until then). */
  pictures: PresenterPictures
  /** ffmpeg of this computer: needed for the similarity check (null: angles are refused, the rest works). */
  media: MediaService | null
  /** OpenCV face recognition (director text check); absent, or without OpenCV on this computer: the skin-patch check. */
  identity?: FaceIdentity | null
  /** « Nettoyer le portrait » (production-17); absent: the step is refused. */
  cleaner?: PortraitCleaner
  /** The `presenter-studio` style's prompt suffix (null / absent: PRESENTER_STYLE_SUFFIX). */
  styleSuffix?: () => string | null
  now?: () => Date
  notify?: () => void
}

const text = (v: unknown, what: string, min: number, max: number): string => {
  const s = typeof v === 'string' ? v.trim() : ''
  if (s.length < min || s.length > max) throw new Error(`${what} : entre ${min} et ${max} caractères.`)
  return s
}

const readable = async (file: unknown): Promise<boolean> => {
  if (typeof file !== 'string' || file.length === 0) return false
  try {
    const s = await stat(file)
    return s.isFile() && s.size > 0
  } catch {
    return false
  }
}

export class ChannelPresenters {
  private readonly store: ChannelPresenterStore
  private readonly now: () => Date
  /** Set once the identity check said OpenCV is missing here: the skin check from then on. */
  private identityMissing = false

  constructor(private readonly o: ChannelPresentersOptions) {
    this.now = o.now ?? (() => new Date())
    this.store = new ChannelPresenterStore(o.db, this.now)
  }

  list(channelId: number): ChannelPresenterView[] {
    this.channel(channelId)
    return this.store.list(channelId).map(view)
  }

  /** The presenter a run of this channel uses: its default active presenter, with absolute file paths; null when it has none. */
  styleFor(channelId: number): PresenterRef | null {
    const p = this.store.list(channelId).find((x) => x.isDefault && x.status === 'active' && x.portraitPath !== null)
    if (!p || !p.portraitPath) return null
    return {
      id: String(p.id),
      portrait: path.resolve(p.portraitPath),
      angles: p.angles.map((a) => ({ framing: a.framing, file: path.resolve(a.path) })),
      registrations: { ...p.registrations }
    }
  }

  // ---- make ----------------------------------------------------------------------------------------------------------

  /** A presenter generated from an art-direction description (the image engine, style `presenter-studio`). */
  async portrait(input: { channelId: number; name: string; description: string; aspect?: Aspect }): Promise<ChannelPresenterView> {
    this.channel(input.channelId)
    const name = text(input.name, 'Le nom du présentateur', 1, 60)
    const description = text(input.description, 'La description du présentateur', 10, 1000)
    const aspect: Aspect = input.aspect === '9:16' ? '9:16' : '16:9'
    // a presenter made from words copies no one's face: its consent is « designed »
    const id = this.store.insert({ channelId: input.channelId, name, method: 'portrait', description, consent: this.consent('designed'), status: 'active' })
    try {
      const picture = await this.o.pictures.portrait({ prompt: `${description}\n\n${this.suffix()}`, aspect, identity: String(id) })
      this.store.setPortrait(id, await this.keep(id, 'portrait', picture.file))
    } catch (e) {
      await this.discard(id)
      throw e
    }
    return this.adopt(input.channelId, id)
  }

  /** A presenter cloned from frames of the channel's own videos; refused without the tick, proposed until accepted. */
  async clone(input: { channelId: number; name: string; frames: string[]; consent: PresenterConsentInput }): Promise<ChannelPresenterView> {
    this.channel(input.channelId)
    // decision 0025: the face of someone else's channel is never cloned
    const c = input.consent
    if (!c || c.granted !== true || c.statement !== 'own-channel') {
      throw new Error('Pour cloner le présentateur d’une chaîne, coche « cette chaîne est à moi » : sans cette case, aucun présentateur n’est cloné, et celui de la chaîne de quelqu’un d’autre ne l’est jamais.')
    }
    const consent = this.consent('own-channel', c.by)
    const name = text(input.name, 'Le nom du présentateur', 1, 60)
    const frames = Array.isArray(input.frames) ? input.frames.slice(0, 24) : []
    let frame: string | null = null
    for (const f of frames) {
      if (await readable(f)) {
        frame = f
        break
      }
    }
    if (!frame) throw new Error('Aucune image lisible parmi celles choisies : choisis au moins une image de la chaîne où le visage se voit bien.')
    const id = this.store.insert({ channelId: input.channelId, name, method: 'clone', description: '', consent, status: 'proposed' })
    try {
      this.store.setPortrait(id, await this.keep(id, 'portrait', frame))
    } catch (e) {
      await this.discard(id)
      throw e
    }
    this.o.notify?.()
    return view(this.record(id))
  }

  // ---- angles --------------------------------------------------------------------------------------------------------

  /**
   * `count` (3 to 6) framings of the same person, edited from the portrait. Each is scored against the portrait with the face
   * similarity check and kept when it reaches ANGLE_SIMILARITY_MIN, else made once more, else dropped. The kept angles replace
   * the presenter's previous ones.
   */
  async angles(presenterId: number, input?: { count?: number; engine?: string }): Promise<PresenterAnglesResult> {
    const p = this.record(presenterId)
    const count = input?.count ?? ANGLES_MIN
    if (!Number.isInteger(count) || count < ANGLES_MIN || count > ANGLES_MAX) throw new Error(`Le nombre d’angles : entre ${ANGLES_MIN} et ${ANGLES_MAX}.`)
    const engine = input?.engine
    if (engine !== undefined && !(ANGLE_ENGINES as readonly string[]).includes(engine)) throw new Error(`Moteur d’image inconnu pour les angles : ${String(engine)}.`)
    if (p.status === 'retired') throw new Error('Ce présentateur est retiré.')
    if (!p.portraitPath) throw new Error('Ce présentateur n’a pas de portrait.')
    const media = this.o.media
    if (!media) throw new Error('ffmpeg est introuvable : impossible de vérifier que chaque angle montre la même personne.')
    const signal = new AbortController().signal
    const portrait = p.portraitPath
    const kept: StoredAngle[] = []
    const dropped: { framing: Framing; score: number }[] = []
    let check: 'face-id' | 'skin' = 'skin'
    for (let i = 0; i < count; i++) {
      const framing = ANGLE_ORDER[i % ANGLE_ORDER.length] as Framing
      let best = 0
      let made: StoredAngle | null = null
      for (let attempt = 0; attempt < ATTEMPTS && !made; attempt++) {
        const picture = await this.o.pictures.edit({ reference: portrait, prompt: this.anglePrompt(p, framing, i), framing, identity: String(p.id), ...(engine ? { engine } : {}) })
        const s = await this.sameFace(media, portrait, picture.file, signal, picture.demo)
        check = s.check
        best = Math.max(best, s.score)
        if (s.keep) made = { framing, path: await this.keep(p.id, `angle-${i + 1}-${framing}`, picture.file), score: s.score }
      }
      if (made) kept.push(made)
      else dropped.push({ framing, score: best })
    }
    for (const old of p.angles) if (!kept.some((a) => a.path === old.path)) await rm(old.path, { force: true }).catch(() => undefined)
    this.store.setAngles(p.id, kept)
    this.o.notify?.()
    return { presenter: view(this.record(p.id)), kept: kept.map(angleView), dropped, check, ...(engine ? { engine } : {}) }
  }

  /**
   * Is `picture` the person of `portrait`? OpenCV face recognition when this computer has it (the director text check: the skin check rejected
   * every frame of a real HeyGen video of the same man, 0.62–0.89 under its 0.92 bar), else the skin-patch check. A stand-in drawing
   * (demo) is no photograph of a face: the skin check.
   */
  private async sameFace(media: MediaService, portrait: string, picture: string, signal: AbortSignal, demo: boolean): Promise<{ score: number; keep: boolean; check: 'face-id' | 'skin' }> {
    if (this.o.identity && !this.identityMissing && !demo) {
      try {
        const [r] = await this.o.identity.compare([[portrait, picture]], signal)
        return { score: Math.max(0, r?.score ?? 0), keep: identityVerdict(r?.score ?? null) === 'keep', check: 'face-id' }
      } catch (e) {
        if (!(e instanceof EngineError && e.code === 'missing_tool')) throw e
        this.identityMissing = true
      }
    }
    const score = await faceSimilarity(media, portrait, picture, signal).catch(() => 0)
    return { score, keep: score >= ANGLE_SIMILARITY_MIN, check: 'skin' }
  }

  /**
   * « Nettoyer le portrait » (production-17): a portrait taken from a compressed video frame is soft (the first real run's
   * HeyGen look came from one). The image engine remakes it sharper, same face, outfit and room; it replaces the portrait
   * only when the face-similarity check passes, the original is kept beside it, and the registrations go (a new face to
   * register). Behind the consent rule: never for a retired presenter, and a clone keeps the « own channel » consent it was
   * made with.
   */
  async clean(presenterId: number): Promise<{ presenter: ChannelPresenterView; demo: boolean; score: number }> {
    const p = this.record(presenterId)
    if (p.status === 'retired') throw new Error('Ce présentateur est retiré.')
    if (!p.portraitPath) throw new Error('Ce présentateur n’a pas de portrait.')
    if (p.method === 'clone' && p.consent?.statement !== 'own-channel') throw new Error('Ce présentateur cloné n’a pas l’accord « cette chaîne est à moi » : son portrait n’est pas retouché.')
    if (!this.o.cleaner) throw new Error('Le nettoyage du portrait n’est pas disponible ici.')
    const media = this.o.media
    if (!media) throw new Error('ffmpeg est introuvable : impossible de vérifier que le portrait nettoyé montre la même personne.')
    const before = p.portraitPath
    const picture = await this.o.cleaner({ reference: before, prompt: CLEAN_PROMPT, identity: String(p.id) })
    const { score, keep } = await this.sameFace(media, before, picture.file, new AbortController().signal, picture.demo)
    if (!keep) throw new Error(`Le portrait nettoyé ne montre pas assez la même personne (ressemblance ${Math.round(score * 100)} %) : le portrait d’origine est gardé.`)
    const dir = path.resolve(this.o.dir, String(p.id))
    const original = path.join(dir, `portrait-original${path.extname(before).toLowerCase() || '.png'}`)
    if (!(await readable(original))) await copyFile(before, original)
    this.store.setPortrait(p.id, await this.keep(p.id, 'portrait-clean', picture.file))
    this.store.setRegistrations(p.id, {})
    this.o.notify?.()
    return { presenter: view(this.record(p.id)), demo: picture.demo, score }
  }

  // ---- registrations, statuses, voice ---------------------------------------------------------------------------------

  /** The id of the presenter's face on one presenter engine (what the provider returned when the face was registered). */
  register(presenterId: number, engine: string, id: string): ChannelPresenterView {
    const p = this.record(presenterId)
    if (!isPresenterEngine(engine)) throw new Error(`Moteur de présentateur inconnu : ${String(engine)}.`)
    if (p.status === 'retired') throw new Error('Ce présentateur est retiré.')
    this.store.setRegistrations(p.id, { ...p.registrations, [engine]: text(id, 'L’identifiant du visage', 1, 200) })
    this.o.notify?.()
    return view(this.record(p.id))
  }

  /** Engine ids a run returned (`clips.meta.registrations`) are kept on the channel's default presenter; unknown engines are ignored. */
  registrationsFromRun(channelId: number, registrations: Record<string, unknown>): ChannelPresenterView | null {
    const p = this.store.list(channelId).find((x) => x.isDefault && x.status === 'active')
    if (!p) return null
    const next = { ...p.registrations }
    let changed = false
    for (const [engine, id] of Object.entries(registrations)) {
      if (!isPresenterEngine(engine) || typeof id !== 'string' || id.length === 0 || id.length > 200 || next[engine] === id) continue
      next[engine] = id
      changed = true
    }
    if (changed) {
      this.store.setRegistrations(p.id, next)
      this.o.notify?.()
    }
    return view(this.record(p.id))
  }

  accept(presenterId: number): ChannelPresenterView {
    const p = this.record(presenterId)
    if (p.status !== 'proposed') throw new Error('Ce présentateur n’est pas une proposition.')
    this.store.setStatus(p.id, 'active')
    this.store.setDefault(p.channelId, p.id)
    this.o.notify?.()
    return view(this.record(p.id))
  }

  setDefault(presenterId: number): ChannelPresenterView {
    const p = this.record(presenterId)
    if (p.status !== 'active') throw new Error('Seul un présentateur actif peut être celui de la chaîne.')
    this.store.setDefault(p.channelId, p.id)
    this.o.notify?.()
    return view(this.record(p.id))
  }

  retire(presenterId: number): ChannelPresenterView {
    const p = this.record(presenterId)
    this.store.setStatus(p.id, 'retired')
    this.o.notify?.()
    return view(this.record(p.id))
  }

  /** Links the presenter to one of the channel's voices (null: unlinks). */
  linkVoice(presenterId: number, voiceId: number | null): ChannelPresenterView {
    const p = this.record(presenterId)
    if (voiceId !== null && (!Number.isInteger(voiceId) || !this.store.voiceBelongsTo(p.channelId, voiceId))) throw new Error('Voix introuvable pour cette chaîne.')
    this.store.setVoice(p.id, voiceId)
    this.o.notify?.()
    return view(this.record(p.id))
  }

  // ---- inside --------------------------------------------------------------------------------------------------------

  private channel(channelId: number): void {
    if (!Number.isInteger(channelId) || !this.o.db.prepare('SELECT 1 FROM channels WHERE id = ?').get(channelId)) throw new Error('Chaîne introuvable.')
  }

  private record(id: number): PresenterRecord {
    const p = Number.isInteger(id) ? this.store.get(id) : null
    if (!p) throw new Error('Présentateur introuvable.')
    return p
  }

  private suffix(): string {
    let s: string | null
    try {
      s = this.o.styleSuffix?.() ?? null
    } catch {
      s = null
    }
    return s && s.trim() ? s.trim() : PRESENTER_STYLE_SUFFIX
  }

  private anglePrompt(p: PresenterRecord, framing: Framing, index: number): string {
    const variant = index >= ANGLE_ORDER.length ? ` Variant ${Math.floor(index / ANGLE_ORDER.length) + 1}: a slightly different head position.` : ''
    // another photo of the same shoot: the face stays exactly the same, the mouth closed and nothing in front of it (a talking-
    // photo engine animates it next), photographic, no text (director text check)
    return `${p.description ? `${p.description}\n\n` : ''}${this.suffix()}\nAnother photo from the same shoot as the reference picture: the same person with an identical face, same hair, same outfit, same room. Mouth closed, nothing in front of the face, photographic, no text. Framing: ${FRAMING_TEXT[framing]}.${variant}`
  }

  /** Decision 0025: who, when and what are kept with the presenter. */
  private consent(statement: PresenterConsent['statement'], by?: string): PresenterConsent {
    return { by: typeof by === 'string' && by.trim() ? by.trim().slice(0, 80) : statement === 'designed' ? 'design' : 'propriétaire', at: this.now().toISOString(), statement }
  }

  /** Copies `file` into the presenter's own folder as `<label><ext>`. */
  private async keep(id: number, label: string, file: string): Promise<string> {
    const dir = path.resolve(this.o.dir, String(id))
    await mkdir(dir, { recursive: true })
    const target = path.join(dir, `${label}${path.extname(file).toLowerCase() || '.png'}`)
    if (path.resolve(file) !== target) await copyFile(file, target)
    return target
  }

  /** A presenter whose making failed leaves nothing behind. */
  private async discard(id: number): Promise<void> {
    this.store.remove(id)
    await rm(path.resolve(this.o.dir, String(id)), { recursive: true, force: true }).catch(() => undefined)
  }

  /** A new active presenter becomes the channel's default when it has none yet. */
  private adopt(channelId: number, id: number): ChannelPresenterView {
    if (!this.store.list(channelId).some((x) => x.isDefault && x.status === 'active')) this.store.setDefault(channelId, id)
    this.o.notify?.()
    return view(this.record(id))
  }
}

const angleView = (a: StoredAngle): { framing: Framing; score: number } => ({ framing: a.framing, score: a.score })

function view(p: PresenterRecord): ChannelPresenterView {
  return {
    id: p.id,
    channelId: p.channelId,
    name: p.name,
    method: p.method,
    description: p.description,
    status: p.status,
    isDefault: p.isDefault,
    hasPortrait: p.portraitPath !== null,
    angles: p.angles.map(angleView),
    registeredEngines: Object.keys(p.registrations),
    voiceId: p.voiceId,
    consent: p.consent
  }
}
