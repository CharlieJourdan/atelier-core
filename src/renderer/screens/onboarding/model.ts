// The answers of the onboarding and what is derived from them (which analysis, which pipeline, the channel to create).
// Pure functions, no React: the unit test drives them directly.
import {
  DEFAULT_AUTOMATION,
  NICHES,
  reportFor,
  type EngineChoice,
  type OnboardingLang,
  type Personality,
  type Report
} from '@/proto/data-onboarding'
import type { LiveOnboardingSession } from '@/proto/live/onboarding-live'
import type { ProtoState } from '@/proto/store'
import type { AutomationLevels, ChannelColor, ChannelProduct, ProtoChannel, ProtoPipeline } from '@/proto/types'

export type FlowMode = 'first-run' | 'add-channel'
/** « J'ai déjà une chaîne », « Je veux créer une chaîne », or « Plus tard » (first run only: no channel yet). */
export type HasChannel = 'yes' | 'no' | 'later'
export type Creation = 'niche' | 'translate' | 'idea'
export type EngineCheck = 'detected' | 'checking' | 'connected'
export type VoiceChoice = 'clone' | 'library' | 'elevenlabs' | 'own'
export type ArtChoice = 'keep' | 'mix' | 'new'
export type StorageChoice = 'atelier' | 'drive' | 'dropbox'
export type PublishChoice = 'auto' | 'manual'

export interface ProductRow {
  kind: ChannelProduct['kind']
  name: string
  url: string
}

export interface Answers {
  name: string
  personality: Personality
  engine: EngineChoice
  engineCheck: EngineCheck
  hasChannel: HasChannel | null
  link: string
  googleConnected: boolean
  creation: Creation | null
  nicheId: string | null
  translateLink: string
  targetLang: OnboardingLang
  idea: string
  language: OnboardingLang
  automation: AutomationLevels
  videosPerWeek: number
  shortsPerDay: number
  days: number[]
  hour: string
  voice: VoiceChoice
  voiceSample: string
  art: ArtChoice
  gameplay: boolean
  rushes: boolean
  products: ProductRow[]
  storage: StorageChoice
  publishing: PublishChoice
  discord: boolean
}

export function initialAnswers(principalName: string): Answers {
  return {
    name: principalName,
    personality: 'calm',
    engine: 'claude-code',
    engineCheck: 'detected',
    hasChannel: null,
    link: '',
    googleConnected: false,
    creation: null,
    nicheId: null,
    translateLink: '',
    targetLang: 'en',
    idea: '',
    language: 'fr',
    automation: { ...DEFAULT_AUTOMATION },
    videosPerWeek: 3,
    shortsPerDay: 0,
    days: [0, 2, 4],
    hour: '17:00',
    voice: 'clone',
    voiceSample: 'mm-calm',
    art: 'keep',
    gameplay: false,
    rushes: false,
    products: [],
    storage: 'atelier',
    publishing: 'auto',
    discord: false
  }
}

/** What the analysis looks at: the user's own channel, a channel to translate, a niche, or an idea. */
export type SourceKind = 'own' | 'translate' | 'niche' | 'idea'

export function sourceKind(a: Answers): SourceKind {
  if (a.hasChannel === 'yes') return 'own'
  if (a.creation === 'translate') return 'translate'
  if (a.creation === 'niche') return 'niche'
  return 'idea'
}

/** The channel the analysis is about: the link the user pasted, whichever flow they took. */
export function analysedLink(a: Answers): string {
  return sourceKind(a) === 'translate' ? a.translateLink : a.link
}

export function isHardToReplicate(a: Answers): boolean {
  return /textify/i.test(analysedLink(a))
}

/** « youtube.com/@grandesenigmes » → « grandesenigmes ». */
export function handleOf(link: string): string {
  const m = /@([\w.-]+)/.exec(link) ?? /(?:channel|c|user)\/([\w.-]+)/.exec(link)
  if (m?.[1]) return m[1]
  return link.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
}

export function pipelineIdFor(a: Answers): string {
  if (isHardToReplicate(a)) return 'pl-sms'
  return sourceKind(a) === 'translate' ? 'pl-docu-en' : 'pl-docu'
}

export function reportOf(a: Answers): Report {
  return reportFor(pipelineIdFor(a))
}

export function stepValid(step: number, a: Answers): boolean {
  switch (step) {
    case 1:
      return a.name.trim().length > 0
    case 3:
      if (a.hasChannel === 'later') return true
      if (a.hasChannel === 'yes') return a.link.trim().length > 0
      if (a.hasChannel === 'no') {
        if (a.creation === 'niche') return a.nicheId !== null
        if (a.creation === 'translate') return a.translateLink.trim().length > 0
        if (a.creation === 'idea') return a.idea.trim().length > 0
      }
      return false
    default:
      return true
  }
}

/** The steps of a run: the first two (agent, engine) are skipped when a channel is added to a workspace that has them. */
export function stepsOf(mode: FlowMode): number[] {
  return mode === 'add-channel' ? [3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 5, 6, 7, 8]
}

/**
 * What « Continuer » does after a step: the next step, or the end of the flow — the last step, or « Plus tard » on the
 * channel question of the first run (the onboarding ends with no channel; Accueil offers to add one).
 */
export function afterStep(step: number, a: Pick<Answers, 'hasChannel'>, mode: FlowMode): 'next' | 'finish' {
  const steps = stepsOf(mode)
  if (step === steps[steps.length - 1]) return 'finish'
  if (step === 3 && mode === 'first-run' && a.hasChannel === 'later') return 'finish'
  return 'next'
}

/** A readable channel name from the answers (the user renames it later). */
export function channelNameOf(a: Answers, known: Pick<ProtoChannel, 'name' | 'handle'>[]): string {
  const kind = sourceKind(a)
  if (kind === 'niche') {
    const niche = NICHES.find((n) => n.id === a.nicheId)
    return niche ? NICHE_SHORT_NAMES[niche.id] ?? 'Nouvelle chaîne' : 'Nouvelle chaîne'
  }
  if (kind === 'idea') return titleCase(a.idea.trim().split(/\s+/).slice(0, 3).join(' ')) || 'Nouvelle chaîne'
  const handle = handleOf(analysedLink(a))
  const match = known.find((c) => c.handle.replace('@', '').toLowerCase() === handle.toLowerCase())
  if (match) return kind === 'translate' ? `${match.name} (${a.targetLang.toUpperCase()})` : match.name
  const base = titleCase(handle.replace(/[._-]+/g, ' '))
  return kind === 'translate' ? `${base} (${a.targetLang.toUpperCase()})` : base
}

const NICHE_SHORT_NAMES: Record<string, string> = {
  'niche-cold': 'Affaires non résolues',
  'niche-money': 'Finance en motion',
  'niche-science': 'Sciences animées'
}

function titleCase(s: string): string {
  return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}

function initialsOf(name: string): string {
  const words = name.replace(/[()]/g, '').split(/\s+/).filter(Boolean)
  return (words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : name.slice(0, 2)).toUpperCase()
}

function cadenceOf(a: Answers): string {
  const parts: string[] = []
  if (a.videosPerWeek > 0) parts.push(`${a.videosPerWeek} ${a.videosPerWeek > 1 ? 'vidéos' : 'vidéo'} par semaine`)
  if (a.shortsPerDay > 0) parts.push(`${a.shortsPerDay} ${a.shortsPerDay > 1 ? 'shorts' : 'short'} par jour`)
  return parts.join(' · ') || 'Pas de rythme fixé'
}

/** The channel the flow creates in add-channel mode. */
export function buildChannel(a: Answers, state: Pick<ProtoState, 'channels' | 'pipelines'>): Omit<ProtoChannel, 'id'> {
  const kind = sourceKind(a)
  const name = channelNameOf(a, state.channels)
  const used = new Set(state.channels.map((c) => c.color))
  const color = ([1, 2, 3, 4, 5, 6] as ChannelColor[]).find((c) => !used.has(c)) ?? (((state.channels.length % 6) + 1) as ChannelColor)
  const pipelineId = pipelineIdFor(a)
  const pipeline: ProtoPipeline | undefined = state.pipelines.find((p) => p.id === pipelineId)
  const handle = kind === 'own' || kind === 'translate' ? handleOf(analysedLink(a)) : name.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const source = state.channels.find((c) => c.handle.replace('@', '').toLowerCase() === handleOf(a.translateLink).toLowerCase())
  const niche = kind === 'niche' ? NICHES.find((n) => n.id === a.nicheId) : undefined
  const language: ProtoChannel['language'] = kind === 'translate' ? a.targetLang : kind === 'own' ? 'fr' : a.language
  return {
    name,
    handle: `@${handle}`,
    color,
    initials: initialsOf(name),
    niche: kind === 'niche' && niche ? NICHE_SHORT_NAMES[niche.id] ?? '' : kind === 'idea' ? a.idea.trim() : pipeline?.name ?? '',
    language,
    format: pipeline?.format ?? 'long',
    connected: kind === 'own' && a.googleConnected,
    subscribers: kind === 'own' ? 12_400 : 0,
    views28d: kind === 'own' ? 96_000 : 0,
    revenue28d: 0,
    trend: 0,
    cadence: cadenceOf(a),
    automation: { ...a.automation },
    pipelineIds: pipeline ? [pipeline.id] : [],
    ...(kind === 'translate' && source ? { translatedFrom: source.id } : {}),
    products: a.products.map((p) => ({ kind: p.kind, name: p.name, ...(p.url ? { url: p.url } : {}) })),
    createdDaysAgo: 0
  }
}

/** What every step receives from the flow. */
export interface StepProps {
  a: Answers
  set: (patch: Partial<Answers>) => void
  mode: FlowMode
  /** Moves to the next step (« C'est bon » of the test video). */
  next: () => void
  /** Whether the step's own work is finished (the analysis, the test video): the flow waits for it to continue. */
  ready: boolean
  setReady: (v: boolean) => void
  /** Real mode: the session that does the work for real (absent in the demo). */
  live?: LiveOnboardingSession | null
}
