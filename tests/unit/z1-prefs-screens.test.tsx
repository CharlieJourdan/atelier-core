// Lot Z1, Réglages preference pages: every page renders on the real data of the backend, in French, and the settings
// keys they write are accepted by the real `settings.set` (and read back by the page's own helpers).
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FEATURES, NO_FEATURES, resolveFeatures } from '../../src/shared/features'
import { fr } from '../../src/shared/fr'
import { frSettingsPrefs } from '../../src/shared/fr-settings-prefs'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { FeaturesProvider } from '../../src/renderer/lib/features'
import { PREFS_SCREENS } from '../../src/renderer/screens/settings/prefs'
import { AboutBody, AboutPage } from '../../src/renderer/screens/settings/prefs/AboutPage'
import { AdvancedPage } from '../../src/renderer/screens/settings/prefs/AdvancedPage'
import { AppearanceBody, AppearancePage } from '../../src/renderer/screens/settings/prefs/AppearancePage'
import { AudioBody, AudioPage } from '../../src/renderer/screens/settings/prefs/AudioPage'
import { BrainPage } from '../../src/renderer/screens/settings/prefs/BrainPage'
import { BudgetsBody, BudgetsPage, CapEditor } from '../../src/renderer/screens/settings/prefs/BudgetsPage'
import { ChannelsBody, ChannelsPage } from '../../src/renderer/screens/settings/prefs/ChannelsPage'
import { boolOf, NumberSetting, numberOf, parseBounded } from '../../src/renderer/screens/settings/prefs/common'
import { DataBody, DataPage, exampleSummary } from '../../src/renderer/screens/settings/prefs/DataPage'
import { DiscordPage } from '../../src/renderer/screens/settings/prefs/DiscordPage'
import { EngineBody, EnginePage } from '../../src/renderer/screens/settings/prefs/EnginePage'
import { FeaturesBody, FeaturesPage } from '../../src/renderer/screens/settings/prefs/FeaturesPage'
import { GENERAL_KEYS, GeneralBody, GeneralPage } from '../../src/renderer/screens/settings/prefs/GeneralPage'
import { NotificationsBody, NotificationsPage } from '../../src/renderer/screens/settings/prefs/NotificationsPage'
import { memoryCore } from './helpers'

const noop = (): void => undefined
const noopAsync = (): Promise<void> => Promise.resolve()
const route = { section: 'reglages' as const }
const render = (el: ReactElement): string =>
  renderToStaticMarkup(
    <FeaturesProvider value={NO_FEATURES}>
      <TooltipProvider>{el}</TooltipProvider>
    </FeaturesProvider>
  )
const clean = (html: string): void => {
  expect(html).not.toContain('undefined')
  expect(html).not.toContain('NaN')
  expect(html).not.toContain('[object Object]')
}

const PAGES = {
  general: { Page: GeneralPage, title: 'Général' },
  moteur: { Page: EnginePage, title: 'Moteur' },
  budgets: { Page: BudgetsPage, title: 'Budgets' },
  chaines: { Page: ChannelsPage, title: 'Chaînes' },
  notifications: { Page: NotificationsPage, title: 'Notifications' },
  discord: { Page: DiscordPage, title: 'Discord' },
  ordinateur: { Page: BrainPage, title: 'Ordinateur d’équipe' },
  audio: { Page: AudioPage, title: 'Audio' },
  apparence: { Page: AppearancePage, title: 'Apparence' },
  fonctions: { Page: FeaturesPage, title: 'Fonctions' },
  donnees: { Page: DataPage, title: 'Données' },
  // the beta: « Mode présentation » lives here (the demo workspace, off by default)
  avance: { Page: AdvancedPage, title: 'Avancé' },
  apropos: { Page: AboutPage, title: 'À propos' }
} as const

describe('Réglages preference pages: shells', () => {
  it('registers the thirteen pages under reglages/<page>', () => {
    expect(Object.keys(PREFS_SCREENS).sort()).toEqual(Object.keys(PAGES).map((p) => `reglages/${p}`).sort())
    for (const [page, { Page }] of Object.entries(PAGES)) expect(PREFS_SCREENS[`reglages/${page}`]).toBe(Page)
  })

  for (const [page, { Page, title }] of Object.entries(PAGES)) {
    it(`${page}: one h1 (${title}), French subtitle, no raw text`, () => {
      const html = render(<Page route={route} onRoute={noop} />)
      expect(html.match(/<h1/g)).toHaveLength(1)
      expect(html).toContain('data-testid="view-reglages"')
      expect(html).toContain(`data-testid="prefs-${page}"`)
      expect(html).toContain(`>${title}</h1>`)
      clean(html)
    })
  }

  it('has a French message for every prefs.* key', () => {
    const keys = Object.keys(frSettingsPrefs)
    expect(keys.length).toBeGreaterThan(120)
    expect(keys.every((k) => k.startsWith('prefs.'))).toBe(true)
    for (const k of keys) expect(fr[k as keyof typeof fr].trim()).not.toBe('')
  })

  it('audio is the only page built on a demo feature and shows its DÉMO badge in the first render', () => {
    const html = render(<AudioPage route={route} onRoute={noop} />)
    expect(html).toContain('data-testid="demo-badge"')
    expect(html).toContain('Voix de la plateforme')
  })
})

describe('Réglages preference pages: helpers', () => {
  it('parseBounded accepts numbers in range and refuses the rest', () => {
    const o = { min: 1, max: 16, integer: true }
    expect(parseBounded('3', o)).toBe(3)
    expect(parseBounded(' 16 ', o)).toBe(16)
    for (const bad of ['', 'abc', '0', '17', '2.5', '-1', '1e3']) expect(parseBounded(bad, o)).toBeNull()
    expect(parseBounded('2,5', { min: 0, max: 10, integer: false })).toBe(2.5)
  })

  it('numberOf / boolOf fall back to the main process default on junk', () => {
    expect(numberOf({ a: 4 }, 'a', 1, 1, 10)).toBe(4)
    expect(numberOf({ a: 400 }, 'a', 1, 1, 10)).toBe(1)
    expect(numberOf({ a: 2.5 }, 'a', 1, 1, 10)).toBe(1)
    expect(numberOf({ a: 2.5 }, 'a', 1, 1, 10, false)).toBe(2.5)
    expect(numberOf({}, 'a', 7, 1, 10)).toBe(7)
    expect(boolOf({ b: false }, 'b', true)).toBe(false)
    expect(boolOf({ b: 'x' }, 'b', true)).toBe(true)
  })

  it('number editor renders its value, unit and a disabled Enregistrer', () => {
    const html = render(<NumberSetting settingKey="agents.maxTurns" label="Étapes" value={12} min={1} max={100} unit="étapes" />)
    expect(html).toContain('value="12"')
    expect(html).toContain('étapes')
    expect(html).toContain('disabled=""')
  })
})

describe('Réglages preference pages: on the real backend', () => {
  it('général: app info and the agent settings, with defaults the main process uses', async () => {
    const core = memoryCore()
    const info = await core.api['app.info']()
    const html = render(<GeneralBody info={info} settings={await core.api['settings.list']()} />)
    for (const label of ['Version', 'Français', 'Laisser les agents démarrer seuls', 'Tâches en même temps', 'Relais entre agents', 'Budget d’un message (USD)']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('value="3"')
    expect(html).toContain('value="12"')
    expect(html).toContain('value="2"')
    clean(html)
  })

  it('général: every key the page writes is accepted by settings.set and read back', async () => {
    const core = memoryCore()
    const values: Record<string, number | boolean> = {
      [GENERAL_KEYS.runner]: false,
      [GENERAL_KEYS.maxParallel]: 5,
      [GENERAL_KEYS.maxParallelPerChannel]: 4,
      [GENERAL_KEYS.maxTurns]: 20,
      [GENERAL_KEYS.multiplier]: 6,
      [GENERAL_KEYS.handoffs]: 1,
      [GENERAL_KEYS.roundBudget]: 3.5
    }
    for (const [k, v] of Object.entries(values)) await core.api['settings.set'](k, v)
    const info = await core.api['app.info']()
    const html = render(<GeneralBody info={info} settings={await core.api['settings.list']()} />)
    expect(html).toContain('aria-checked="false"')
    for (const v of [5, 4, 20, 6, 1, 3.5]) expect(html).toContain(`value="${v}"`)
    expect(() => core.api['settings.set']('llm.tierModels', {})).toThrow('cannot be changed')
  })

  it('moteur: ffmpeg, folders and active runs from production.engineStatus', async () => {
    const core = memoryCore()
    const status = await core.api['production.engineStatus']()
    const html = render(<EngineBody status={status} onCloud={noop} />)
    for (const label of ['ffmpeg', 'ffprobe', 'Voix du système', 'Rendus en cours', 'Dossiers', 'Atelier Cloud']) expect(html).toContain(label)
    expect(html).toContain(status.dataDir.replace(/&/g, '&amp;'))
    const missing = render(<EngineBody status={{ ...status, ffmpeg: { found: false, path: null, version: null } }} />)
    expect(missing).toContain('Introuvable')
    expect(missing).toContain('Installe ffmpeg')
    clean(html + missing)
  })

  it('budgets: this month, the global cap and one line per channel (example workspace)', async () => {
    const core = memoryCore()
    await core.api['example.load']()
    const overview = await core.api['spend.overview']()
    expect(overview.channels.length).toBeGreaterThan(0)
    const html = render(<BudgetsBody overview={overview} onGlobal={noopAsync} onChannel={noopAsync} />)
    expect(html).toContain('Plafond global du mois')
    expect(html).toContain('Plafond par chaîne')
    expect(html.match(/data-testid="budget-channel"/g)).toHaveLength(overview.channels.length)
    for (const c of overview.channels) expect(html).toContain(c.name.replace(/&/g, '&amp;'))
    clean(html)
  })

  it('budgets: caps written by the page are what the ledger returns', async () => {
    const core = memoryCore()
    await core.api['example.load']()
    await core.api['spend.setGlobalCap'](150)
    const channel = (await core.api['spend.overview']()).channels[0]!
    await core.api['spend.setChannelCap'](channel.channelId, 40)
    const overview = await core.api['spend.overview']()
    expect(overview.globalCapUsd).toBe(150)
    const html = render(<BudgetsBody overview={overview} onGlobal={noopAsync} onChannel={noopAsync} />)
    expect(html).toContain('value="150"')
    expect(html).toContain('value="40"')
    expect(html).toContain('Retirer le plafond')
    expect(() => core.api['spend.setGlobalCap'](-5)).toThrow('non-negative')
  })

  it('budgets: cap editor shows "Pas de plafond" when empty', () => {
    const html = render(<CapEditor cap={null} label="Plafond" onSave={noopAsync} />)
    expect(html).toContain('placeholder="Pas de plafond"')
    expect(html).not.toContain('Retirer le plafond')
  })

  it('chaînes: example channels carry the EXEMPLE chip, archived ones the Archivée badge', async () => {
    const core = memoryCore()
    await core.api['example.load']()
    const mine = await core.api['channels.create']({ name: 'Ma chaîne', niche: 'Cuisine' })
    const old = await core.api['channels.create']({ name: 'Ancienne' })
    await core.api['channels.archive'](old.id, true)
    const channels = await core.api['channels.list'](true)
    const ids = (await core.api['example.status']()).channelIds
    const actions = { create: () => Promise.resolve(true), rename: () => Promise.resolve(true), setArchived: noopAsync }
    const hidden = render(<ChannelsBody channels={channels} exampleIds={ids} actions={actions} showArchived={false} onShowArchived={noop} />)
    expect(hidden).toContain('Ajouter une chaîne')
    expect(hidden).toContain('Ma chaîne')
    expect(hidden).toContain('Cuisine')
    expect(hidden).toContain('data-testid="example-badge"')
    expect(hidden).not.toContain('Ancienne')
    expect(hidden).toContain('Afficher les chaînes archivées')
    expect(mine.id).toBeGreaterThan(0)
    const shown = render(<ChannelsBody channels={channels} exampleIds={ids} actions={actions} showArchived onShowArchived={noop} />)
    expect(shown).toContain('Ancienne')
    expect(shown).toContain('Archivée')
    expect(shown).toContain('Restaurer')
    clean(hidden + shown)
  })

  it('chaînes: empty state and creation/rename/archive through the real API', async () => {
    const core = memoryCore()
    const actions = { create: () => Promise.resolve(true), rename: () => Promise.resolve(true), setArchived: noopAsync }
    const empty = render(<ChannelsBody channels={[]} exampleIds={[]} actions={actions} showArchived={false} onShowArchived={noop} />)
    expect(empty).toContain('Aucune chaîne')
    const c = await core.api['channels.create']({ name: 'Test' })
    expect((await core.api['channels.update'](c.id, { name: 'Test 2' })).name).toBe('Test 2')
    expect((await core.api['channels.archive'](c.id, true)).archived).toBe(true)
    expect((await core.api['channels.archive'](c.id, false)).archived).toBe(false)
    expect(() => core.api['channels.create']({ name: '   ' })).toThrow('name is required')
  })

  it('notifications: pending count and the fixed rules, no invented switch', () => {
    const none = render(<NotificationsBody pending={0} />)
    expect(none).toContain('Rien n’attend ton OK.')
    expect(none).toContain('Notification du système')
    expect(none).not.toContain('role="switch"')
    const some = render(<NotificationsBody pending={3} onOpen={noop} />)
    expect(some).toContain('3 livrables attendent ton OK')
    expect(some).toContain('Ouvrir les validations')
    expect(render(<NotificationsBody pending={1} />)).toContain('1 livrable attend ton OK')
    clean(none + some)
  })

  it('audio: the voices listed by the engine', async () => {
    const core = memoryCore()
    const voices = await core.api['production.voices']()
    const html = render(<AudioBody voices={voices} />)
    expect(html).toContain('Voix de cet ordinateur')
    expect(html.match(/data-testid="voice-line"/g) ?? []).toHaveLength(voices.voices.length)
    const fallback = render(<AudioBody voices={{ ...voices, listed: false }} />)
    expect(fallback).toContain('liste courte de secours')
    expect(render(<AudioBody voices={{ voices: [], listed: true, note: '' }} />)).toContain('Aucune voix trouvée')
    clean(html + fallback)
  })

  it('apparence: both themes, the current one is checked', () => {
    const dark = render(<AppearanceBody theme="dark" onPick={noop} />)
    expect(dark).toContain('Sombre')
    expect(dark).toContain('Clair')
    expect(dark.match(/aria-checked="true"/g)).toHaveLength(1)
    expect(render(<AppearanceBody theme="light" onPick={noop} />)).toContain('data-theme-option="light"')
  })

  it('fonctions: every feature of the registry, demo ones with why and how to unlock', () => {
    const features = resolveFeatures(NO_FEATURES)
    const html = render(<FeaturesBody features={features} />)
    expect(html.match(/data-testid="feature-line"/g)).toHaveLength(FEATURES.length)
    expect(html).toContain('Réelle')
    expect(html).toContain('Démo')
    expect(html).toContain('Pourquoi')
    expect(html).toContain('Pour l’activer')
    expect(html).toContain('Voix de la plateforme')
    const demo = features.filter((f) => f.status === 'demo').length
    const real = features.filter((f) => f.status === 'real').length
    expect(html).toContain(`${real} réelles · ${demo} en démo · 0 sans crédits`)
    clean(html)
  })

  it('fonctions: the wallet state changes the list (needs credits)', () => {
    const ctx = { cloud: { functions: { 'voice-platform': 'real' as const }, hasCredits: false }, youtubeConnected: true }
    const html = render(<FeaturesBody features={resolveFeatures(ctx)} />)
    expect(html).toContain('Crédits insuffisants')
    expect(html).toContain('1 sans crédits')
  })

  it('données: database path, schema, and the example workspace in each state', async () => {
    const core = memoryCore()
    const info = await core.api['app.info']()
    const before = await core.api['example.status']()
    const html = render(<DataBody info={info} example={before} onLoad={noop} onDelete={noop} />)
    expect(html).toContain('Fichier de la base')
    expect(html).toContain('Version du schéma')
    const loadedState = await core.api['example.load']()
    const loaded = render(<DataBody info={info} example={{ ...loadedState, loaded: true, channelIds: [1, 2] }} onLoad={noop} onDelete={noop} />)
    expect(loaded).toContain('Supprimer l’exemple')
    expect(loaded).toContain('2 chaînes d’exemple')
    const gone = await core.api['example.delete']()
    expect(exampleSummary(gone)).toContain('Tu l’as supprimé')
    expect(exampleSummary({ loaded: false, deleted: false, channelIds: [] })).toBe('Pas chargé.')
    expect(render(<DataBody info={info} example={gone} onLoad={noop} onDelete={noop} />)).toContain('Charger l’exemple')
    clean(html + loaded)
  })

  it('à propos: version, licences from VENDOR.md and the clean-room note', async () => {
    const core = memoryCore()
    const info = await core.api['app.info']()
    const html = render(<AboutBody info={info} />)
    for (const label of ['Licences', 'ElevenLabs UI', 'licence MIT', 'VENDOR.md', 'Écriture indépendante', 'ne publie jamais sur YouTube']) {
      expect(html).toContain(label)
    }
    expect(html).toContain(`Version ${info.version}`)
    clean(html)
  })
})
