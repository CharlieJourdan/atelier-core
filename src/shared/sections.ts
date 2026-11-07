// The sections of the Atelier shell and their sub-pages. Pure data: shared by the renderer (sidebar, page tabs,
// router, ⌘K) and the tests. Labels are looked up in `fr.ts` (`section.<id>`, `page.<section>.<id>`).
//
// Proto refresh (2026-10-24): a labelled sidebar (ChatGPT / Apple style) replaces the icon rail. Accueil becomes a
// dashboard (validations live in it), Planning is new (calendar of the videos), Équipe holds the agents, Cerveau the
// ideation map, Chaînes the channels and their onboarding. Validations and Mes outils stay reachable as routes but are
// no longer sidebar entries (Mes outils moved into Production).
import type { ViewId } from './api'
import type { FeatureId } from './features'

export const SECTION_IDS = [
  'accueil',
  'planning',
  'production',
  'agents',
  'conversations',
  'cerveau',
  'chaines',
  'monetisation',
  'ordinateurs',
  'validations',
  'outils',
  'reglages'
] as const
export type SectionId = (typeof SECTION_IDS)[number]

/** Sub-pages of the sections that have some. The first one is what the sidebar opens. */
export const SECTION_PAGES = {
  accueil: [],
  planning: [],
  production: [
    'apercu',
    'pipeline',
    'bibliotheque',
    'ressources',
    'outils',
    'nouvelle',
    'encours',
    'chaines',
    'analyser',
    'builder',
    'editeur',
    'idees',
    'automatisations',
    'agent',
    'style',
    'pretes',
    'creer'
  ],

  agents: [],
  conversations: [],
  cerveau: [],
  chaines: [],
  monetisation: [],
  ordinateurs: [],
  validations: [],
  outils: [],
  reglages: [
    'general',
    'compte',
    'equipe',
    'claude',
    'cloud',
    'moteur',
    'budgets',
    'chaines',
    'notifications',
    'discord',
    'ordinateur',
    'audio',
    'apparence',
    'fonctions',
    'donnees',
    'avance',
    'admin',
    'apropos',
    'galerie'
  ]
} as const satisfies Record<SectionId, readonly string[]>

/** Pages shown as tabs at the top of a section; the others are reached from inside the screens (and ⌘K). */
export const SECTION_TABS: Partial<Record<SectionId, readonly string[]>> = {
  // Production holds pipelines only (production-15, Charlie 01/11): the technologies panel is no longer a tab, nor are the
  // beta tools for now (pipeline-ui: « masque les outils bêta »; the route stays, through ⌘K)
  production: ['apercu', 'pipeline', 'bibliotheque']
}

/** Sections that keep a settings-like column of pages (System Settings style) instead of tabs. */
export const COLUMN_SECTIONS: readonly SectionId[] = ['reglages']

/** The sidebar: a main group, a workspace group, and Réglages pinned at the bottom. */
export const SIDEBAR_GROUPS: readonly (readonly SectionId[])[] = [
  ['accueil', 'planning', 'production', 'agents', 'conversations', 'cerveau'],
  ['chaines', 'monetisation', 'ordinateurs']
]

/** lucide icon name per section (resolved in the renderer). */
export const SECTION_ICONS = {
  accueil: 'house',
  planning: 'calendar-days',
  production: 'clapperboard',
  agents: 'users-round',
  conversations: 'messages-square',
  cerveau: 'sparkles',
  chaines: 'tv-minimal-play',
  monetisation: 'wallet',
  ordinateurs: 'monitor',
  validations: 'inbox',
  outils: 'wrench',
  reglages: 'settings'
} as const satisfies Record<SectionId, string>

export function isSectionId(v: unknown): v is SectionId {
  return typeof v === 'string' && (SECTION_IDS as readonly string[]).includes(v)
}

export interface Route {
  section: SectionId
  /** Sub-page of the section, when it has some. */
  page?: string
}

export const HOME_ROUTE: Route = { section: 'accueil' }

/** The pages of a section (empty when it has none). */
export function pagesOf(section: SectionId): readonly string[] {
  return SECTION_PAGES[section]
}

/** The pages shown as tabs (all pages for column sections, the curated list otherwise). */
export function tabsOf(section: SectionId): readonly string[] {
  return SECTION_TABS[section] ?? (COLUMN_SECTIONS.includes(section) ? pagesOf(section) : [])
}

/** The first page of a section (what clicking it in the sidebar opens), or undefined when it has none. */
export function defaultPage(section: SectionId): string | undefined {
  return pagesOf(section)[0]
}

/** Where the main process' `atelier:navigate` events (notification clicks…) land. */
const VIEW_ROUTES: Record<ViewId, Route> = {
  chats: { section: 'conversations' },
  dashboard: { section: 'accueil' },
  board: { section: 'planning' },
  content: { section: 'production' },
  approvals: { section: 'validations' },
  computer: { section: 'ordinateurs' },
  spend: { section: 'reglages', page: 'budgets' }
}

export function routeForView(view: ViewId): Route {
  return VIEW_ROUTES[view] ?? HOME_ROUTE
}

/**
 * Screens that show demo content, keyed `section` or `section/page`, with the feature (registry in `features.ts`) whose
 * status decides the DÉMO badge. A test walks every screen and checks that a screen mapped to a demo / needs-credits feature
 * really renders its badge (PLAN-V2 §8.4). Add a line here whenever a screen is built on demo data.
 */
export const SCREEN_FEATURES: Readonly<Record<string, FeatureId>> = {
  'reglages/galerie': 'remote-desktop-control',
  // lot Z1: platform voices come from Atelier Cloud (demo until the app is connected to a Cloud). Production's own screens
  // left this list in production-2: they show no demo data any more (the voices of Technologies are real mode only).
  'reglages/audio': 'voice-platform',
  // lot Z1: buying credits is simulated (money movement is never real in v2)
  'reglages/compte': 'buy-credits',
  // lot Z1: the PC cloud card (PLAN-V2-PRODUCTION §4.9) is demo; the other blocks of Ordinateurs are real
  ordinateurs: 'cloud-pc'
}

export function screenFeature(route: Pick<Route, 'section' | 'page'>): FeatureId | undefined {
  return SCREEN_FEATURES[route.page ? `${route.section}/${route.page}` : route.section]
}
