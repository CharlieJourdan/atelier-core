// Demo data of the onboarding flow (2026-10-24): what the "analysis" finds, the report it writes, the test video and the
// team that assembles at the end. Every number is invented for the pitch. Sentences are message keys (fr-p-onboarding.ts),
// names of other people's channels are plain data.
import type { MessageKey } from '../../shared/fr'
import type { AutomationLevels } from './types'

export type OnboardingLang = 'fr' | 'en' | 'es' | 'de' | 'pt'
export const ONBOARDING_LANGS: readonly OnboardingLang[] = ['fr', 'en', 'es', 'de', 'pt']

/* ---------- step 1 and 2 ---------- */

export type Personality = 'calm' | 'direct' | 'enthusiastic'
export const PERSONALITIES: readonly Personality[] = ['calm', 'direct', 'enthusiastic']

export type EngineChoice = 'claude-code' | 'codex' | 'multi' | 'atelier'
export const ENGINE_CHOICES: readonly EngineChoice[] = ['claude-code', 'codex', 'multi', 'atelier']

/* ---------- step 3: niches to start from ---------- */

export type Competition = 'low' | 'medium' | 'high'

export interface NicheSuggestion {
  id: string
  nameKey: MessageKey
  whyKey: MessageKey
  /** Estimated revenue per 1 000 views, in euros. */
  rpm: number
  competition: Competition
  /** Number of channels already above 100 k subscribers in the language. */
  bigChannels: number
}

export const NICHES: readonly NicheSuggestion[] = [
  { id: 'niche-cold', nameKey: 'onb.niche.cold.name', whyKey: 'onb.niche.cold.why', rpm: 9, competition: 'medium', bigChannels: 6 },
  { id: 'niche-money', nameKey: 'onb.niche.money.name', whyKey: 'onb.niche.money.why', rpm: 18, competition: 'high', bigChannels: 21 },
  { id: 'niche-science', nameKey: 'onb.niche.science.name', whyKey: 'onb.niche.science.why', rpm: 7, competition: 'low', bigChannels: 3 }
]

/** How many channels of the source's niche already exist in each language (the check made before translating). */
export const EXISTING_TRANSLATIONS: Record<OnboardingLang, number> = { fr: 4, en: 0, es: 1, de: 0, pt: 2 }

/* ---------- step 4: the analysis ---------- */

export interface AnalysisStep {
  id: string
  labelKey: MessageKey
  doneKey: MessageKey
  /** How long the step lasts in the demo, in ms. */
  ms: number
}

export const ANALYSIS_STEPS: readonly AnalysisStep[] = [
  { id: 'videos', labelKey: 'onb.analysis.videos', doneKey: 'onb.analysis.videos.done', ms: 1200 },
  { id: 'transcripts', labelKey: 'onb.analysis.transcripts', doneKey: 'onb.analysis.transcripts.done', ms: 1100 },
  { id: 'frames', labelKey: 'onb.analysis.frames', doneKey: 'onb.analysis.frames.done', ms: 2000 },
  { id: 'styles', labelKey: 'onb.analysis.styles', doneKey: 'onb.analysis.styles.done', ms: 1100 },
  { id: 'competitors', labelKey: 'onb.analysis.competitors', doneKey: 'onb.analysis.competitors.done', ms: 1400 },
  { id: 'compare', labelKey: 'onb.analysis.compare', doneKey: 'onb.analysis.compare.done', ms: 1200 }
]

export const ANALYSIS_TOTAL_MS = ANALYSIS_STEPS.reduce((s, x) => s + x.ms, 0)

/** The frames grid: 28 tiles, each a time code (1 frame every 2 s) and a hue. */
export const ANALYSIS_FRAME_COUNT = 28

export interface FoundCompetitor {
  id: string
  name: string
  initials: string
  hue: number
  subscribers: number
  /** How far the channel outperforms its peers (0 = average, 3+ = exceptional). */
  outlier: number
}

export const FOUND_COMPETITORS: readonly FoundCompetitor[] = [
  { id: 'cp-1', name: 'Histoires Oubliées', initials: 'HO', hue: 250, subscribers: 1_240_000, outlier: 2.4 },
  { id: 'cp-2', name: 'Chroniques d’Hier', initials: 'CH', hue: 160, subscribers: 860_000, outlier: 1.8 },
  { id: 'cp-3', name: 'Mystères & Cie', initials: 'MC', hue: 70, subscribers: 612_000, outlier: 3.1 },
  { id: 'cp-4', name: 'Le Carnet Noir', initials: 'CN', hue: 25, subscribers: 540_000, outlier: 1.2 },
  { id: 'cp-5', name: 'Archives Secrètes', initials: 'AS', hue: 295, subscribers: 388_000, outlier: 2.0 },
  { id: 'cp-6', name: 'Temps Perdus', initials: 'TP', hue: 200, subscribers: 301_000, outlier: 0.9 },
  { id: 'cp-7', name: 'Dossier Zéro', initials: 'DZ', hue: 340, subscribers: 274_000, outlier: 2.7 },
  { id: 'cp-8', name: 'L’Œil du Passé', initials: 'OP', hue: 120, subscribers: 219_000, outlier: 1.5 },
  { id: 'cp-9', name: 'Énigmes d’Europe', initials: 'EE', hue: 220, subscribers: 187_000, outlier: 1.1 },
  { id: 'cp-10', name: 'Les Veilleurs', initials: 'LV', hue: 45, subscribers: 143_000, outlier: 3.4 },
  { id: 'cp-11', name: 'Après Minuit', initials: 'AM', hue: 275, subscribers: 121_000, outlier: 1.6 },
  { id: 'cp-12', name: 'Cold Case FR', initials: 'CC', hue: 180, subscribers: 97_000, outlier: 2.2 },
  { id: 'cp-13', name: 'Faits Troublants', initials: 'FT', hue: 10, subscribers: 72_000, outlier: 0.7 },
  { id: 'cp-14', name: 'La Chambre Noire', initials: 'CB', hue: 320, subscribers: 54_000, outlier: 1.9 }
]

/* ---------- step 5: the report ---------- */

export type ReportKind = 'docu' | 'sms'

export interface Report {
  kind: ReportKind
  pipelineId: string
  /** Average duration, as a message (« 16 min » or « 0:48 »). */
  durationKey: MessageKey
  paceKey: MessageKey
  voiceKey: MessageKey
  visuals: { labelKey: MessageKey; pct: number }[]
  structure: MessageKey[]
  styles: { nameKey: MessageKey; pct: number }[]
  strengths: MessageKey[]
  competitorsDoBetter: MessageKey[]
  /** Honest limits, shown when the style is hard to replicate. */
  limits: MessageKey[]
}

const DOCU_REPORT: Omit<Report, 'pipelineId'> = {
  kind: 'docu',
  durationKey: 'onb.report.docu.duration',
  paceKey: 'onb.report.docu.pace',
  voiceKey: 'onb.report.docu.voice',
  visuals: [
    { labelKey: 'onb.report.visual.archive', pct: 45 },
    { labelKey: 'onb.report.visual.ai', pct: 35 },
    { labelKey: 'onb.report.visual.motion', pct: 20 }
  ],
  structure: ['onb.report.docu.s1', 'onb.report.docu.s2', 'onb.report.docu.s3', 'onb.report.docu.s4', 'onb.report.docu.s5'],
  styles: [
    { nameKey: 'onb.style.docu', pct: 80 },
    { nameKey: 'onb.style.face', pct: 20 }
  ],
  strengths: ['onb.report.docu.good1', 'onb.report.docu.good2', 'onb.report.docu.good3'],
  competitorsDoBetter: ['onb.report.docu.better1', 'onb.report.docu.better2', 'onb.report.docu.better3'],
  limits: []
}

const SMS_REPORT: Omit<Report, 'pipelineId'> = {
  kind: 'sms',
  durationKey: 'onb.report.sms.duration',
  paceKey: 'onb.report.sms.pace',
  voiceKey: 'onb.report.sms.voice',
  visuals: [
    { labelKey: 'onb.report.visual.gameplay', pct: 65 },
    { labelKey: 'onb.report.visual.chat', pct: 30 },
    { labelKey: 'onb.report.visual.text', pct: 5 }
  ],
  structure: ['onb.report.sms.s1', 'onb.report.sms.s2', 'onb.report.sms.s3', 'onb.report.sms.s4'],
  styles: [
    { nameKey: 'onb.style.sms', pct: 90 },
    { nameKey: 'onb.style.gameplayText', pct: 10 }
  ],
  strengths: ['onb.report.sms.good1', 'onb.report.sms.good2'],
  competitorsDoBetter: ['onb.report.sms.better1', 'onb.report.sms.better2'],
  limits: ['onb.report.sms.limit1', 'onb.report.sms.limit2', 'onb.report.sms.limit3']
}

export function reportFor(pipelineId: string): Report {
  return pipelineId === 'pl-sms' ? { ...SMS_REPORT, pipelineId } : { ...DOCU_REPORT, pipelineId }
}

/* ---------- step 6: defaults of the questions ---------- */

export const DEFAULT_AUTOMATION: AutomationLevels = {
  idea: 'validate',
  script: 'validate',
  production: 'auto',
  packaging: 'validate',
  publishing: 'auto'
}

export const AUTOMATION_PRESETS: { id: string; labelKey: MessageKey; levels: AutomationLevels }[] = [
  { id: 'all-auto', labelKey: 'onb.q.preset.auto', levels: { idea: 'auto', script: 'auto', production: 'auto', packaging: 'auto', publishing: 'auto' } },
  { id: 'balanced', labelKey: 'onb.q.preset.balanced', levels: DEFAULT_AUTOMATION },
  { id: 'all-validate', labelKey: 'onb.q.preset.validate', levels: { idea: 'validate', script: 'validate', production: 'validate', packaging: 'validate', publishing: 'validate' } }
]

export const MINIMAX_VOICES: { id: string; labelKey: MessageKey }[] = [
  { id: 'mm-calm', labelKey: 'onb.voice.mm.calm' },
  { id: 'mm-warm', labelKey: 'onb.voice.mm.warm' },
  { id: 'mm-deep', labelKey: 'onb.voice.mm.deep' }
]

/** Product the agent finds in the descriptions of an existing channel. */
export const DETECTED_PRODUCTS: { kind: 'ebook'; name: string }[] = [{ kind: 'ebook', name: 'Le Carnet des Énigmes (e-book)' }]

/* ---------- step 7: the test video ---------- */

export const TEST_FEEDBACK_CHIPS: MessageKey[] = [
  'onb.test.chip.faster',
  'onb.test.chip.voice',
  'onb.test.chip.archive',
  'onb.test.chip.fewerAi',
  'onb.test.chip.thumb'
]

/* ---------- step 8: the team ---------- */

export interface TeamMember {
  id: string
  name: string
  roleKey: MessageKey
  /** Index into the agent colour pairs. */
  colorIndex: number
  /** Which answer removes this member (the user does the job herself). */
  skippedWhen?: 'script' | 'packaging'
}

export const TEAM_LEAD: TeamMember = { id: 'lead', name: 'Hugo', roleKey: 'onb.team.role.lead', colorIndex: 1 }

export const TEAM_SPECIALISTS: TeamMember[] = [
  { id: 'research', name: 'Léa', roleKey: 'onb.team.role.research', colorIndex: 3 },
  { id: 'script', name: 'Camille', roleKey: 'onb.team.role.script', colorIndex: 2, skippedWhen: 'script' },
  { id: 'director', name: 'Basile', roleKey: 'onb.team.role.director', colorIndex: 4 },
  { id: 'edit', name: 'Axel', roleKey: 'onb.team.role.edit', colorIndex: 5 },
  { id: 'pack', name: 'Clara', roleKey: 'onb.team.role.pack', colorIndex: 6, skippedWhen: 'packaging' },
  { id: 'compet', name: 'Victor', roleKey: 'onb.team.role.compet', colorIndex: 7 },
  { id: 'qc', name: 'Œil', roleKey: 'onb.team.role.qc', colorIndex: 0 }
]
