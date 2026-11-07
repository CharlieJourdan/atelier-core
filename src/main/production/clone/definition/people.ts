// The real `presenters` and `voices` services of the cloning engine (chantier B, decision 0095). His own channel → his
// existing presenter and voice clones (the app's channel stores: ChannelPresenters / ChannelVoices `styleFor`). Another
// channel → a look-alike placeholder presenter of the same type (lookalike.ts) and a catalogue voice of the same kind
// (gender, age, timbre, language) — never a clone of somebody's voice. Ports are injected; the assembler wires them.
import { defaultVoiceFor } from '../../../../shared/default-voices'
import type { CloneServices } from '../services'
import { LookAlikeMaker, type PresenterPicturesPort } from './lookalike'

/** The user's own clones, found from a channel URL (null = not one of his channels, or no clone yet). */
export interface OwnClonesPort {
  presenter(channelUrl: string): Promise<string | null>
  voice(channelUrl: string): Promise<string | null>
}

/** A catalogue voice the engine may speak with (never a person's clone). */
export interface CatalogueVoice { id: string; name: string; languages: readonly string[]; descriptors: readonly string[] }

const base = (language: string): string => language.toLowerCase().split(/[-_]/)[0] ?? 'en'
const words = (xs: readonly string[]): Set<string> => new Set(xs.flatMap((x) => x.toLowerCase().split(/[^\p{L}\p{N}]+/u)).filter((w) => w.length > 2))

/** Synonyms so « man » finds « male », « 35-45 » finds « middle-aged »… (kept small, words only). */
const SYNONYMS: Record<string, string[]> = { man: ['male'], woman: ['female'], male: ['man'], female: ['woman'], young: ['youthful'], old: ['elderly', 'older'], warm: ['soft'], deep: ['low', 'baritone'] }
const expand = (s: Set<string>): Set<string> => new Set([...s, ...[...s].flatMap((w) => SYNONYMS[w] ?? [])])

/** The best catalogue voice of the same kind in a language: language first, then the most shared descriptors. */
export function pickSameKind(catalogue: readonly CatalogueVoice[], descriptors: readonly string[], language: string): { ref: string; description: string } {
  const want = expand(words(descriptors))
  const speaks = catalogue.filter((v) => !v.id.startsWith('clone_') && v.languages.some((l) => l === '*' || base(l) === base(language)))
  let best: { v: CatalogueVoice; score: number } | null = null
  for (const v of speaks) {
    const has = expand(words([...v.descriptors, v.name]))
    const score = [...want].filter((w) => has.has(w)).length
    if (!best || score > best.score) best = { v, score }
  }
  if (best && best.score > 0) return { ref: best.v.id, description: `${best.v.name}: same kind of voice (${descriptors.join(', ')}), speaks ${language}` }
  const d = defaultVoiceFor(language)
  return { ref: d.id, description: `${d.name}: no catalogue voice matches ${descriptors.join(', ') || 'the reference'}; the ${language} default narrator stands in` }
}

/** The `presenters` and `voices` members of CloneServices, real. */
export function peopleServices(o: { own: OwnClonesPort; pictures: PresenterPicturesPort; catalogue: readonly CatalogueVoice[] }): Pick<CloneServices, 'presenters' | 'voices'> {
  const maker = new LookAlikeMaker(o.pictures)
  return {
    presenters: {
      own: (url) => o.own.presenter(url),
      lookAlike: async (identity) => { const r = await maker.make(identity); return { ref: r.ref, description: r.description } }
    },
    voices: {
      own: (url) => o.own.voice(url),
      sameKind: async (descriptors, language) => pickSameKind(o.catalogue, descriptors, language)
    }
  }
}
