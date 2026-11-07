// Proto onboarding and Chaînes: the flow and the channels screen render from the proto store in plain Node, every step shows
// its key texts, the model derives the right analysis / pipeline / channel, and the channel list follows the global scope.
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { fr, getLocale, setLocale, t } from '../../src/shared/fr'
import { en } from '../../src/shared/en'
import { enPOnboarding } from '../../src/shared/en-p-onboarding'
import { frPOnboarding } from '../../src/shared/fr-p-onboarding'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { ANALYSIS_STEPS, ANALYSIS_TOTAL_MS, FOUND_COMPETITORS } from '../../src/renderer/proto/data-onboarding'
import { competitorsOf } from '../../src/renderer/proto/data-onboarding-channels'
import { createProtoStore, initialState, ProtoProvider, type ProtoState } from '../../src/renderer/proto/store'
import { SCREENS } from '../../src/renderer/screens/SectionScreen'
import { ChannelsScreen } from '../../src/renderer/screens/channels/ChannelsScreen'
import { CHANNELS_SCREENS } from '../../src/renderer/screens/channels'
import { DETAIL_TABS } from '../../src/renderer/screens/channels/ChannelDetail'
import { evenMix, normalize, rebalance, resetChannelExtras } from '../../src/renderer/screens/channels/extras'
import { OnboardingFlow } from '../../src/renderer/screens/onboarding/OnboardingFlow'
import {
  buildChannel,
  channelNameOf,
  handleOf,
  initialAnswers,
  isHardToReplicate,
  pipelineIdFor,
  sourceKind,
  stepsOf,
  stepValid,
  type Answers,
  type StepProps
} from '../../src/renderer/screens/onboarding/model'
import { AnalysisStep, stageAt } from '../../src/renderer/screens/onboarding/steps/Analysis'
import { ChannelStep } from '../../src/renderer/screens/onboarding/steps/Channel'
import { EngineStep } from '../../src/renderer/screens/onboarding/steps/Engine'
import { QuestionsStep } from '../../src/renderer/screens/onboarding/steps/Questions'
import { ReportStep } from '../../src/renderer/screens/onboarding/steps/Report'
import { hiredSpecialists, TeamStep } from '../../src/renderer/screens/onboarding/steps/TeamReady'
import { TestVideoStep } from '../../src/renderer/screens/onboarding/steps/TestVideo'
import { WelcomeStep } from '../../src/renderer/screens/onboarding/steps/Welcome'

const noop = (): void => undefined
const count = (html: string, needle: string): number => html.split(needle).length - 1
const clean = (html: string): void => {
  for (const bad of ['undefined', 'NaN', '[object Object]']) expect(html).not.toContain(bad)
}

function withStore(el: ReactElement, overrides: Partial<ProtoState> = {}): string {
  const store = createProtoStore(initialState(overrides))
  return renderToStaticMarkup(
    <ProtoProvider store={store}>
      <TooltipProvider>{el}</TooltipProvider>
    </ProtoProvider>
  )
}

function answers(patch: Partial<Answers> = {}): Answers {
  return { ...initialAnswers('Atlas'), ...patch }
}

function stepProps(a: Answers, extra: Partial<StepProps> = {}): StepProps {
  return { a, set: noop, mode: 'first-run', next: noop, ready: false, setReady: noop, ...extra }
}

const OWN = answers({ hasChannel: 'yes', link: 'youtube.com/@grandesenigmes' })
const TEXTIFY = answers({ hasChannel: 'yes', link: 'https://www.youtube.com/@textify.stories' })

beforeEach(() => {
  setLocale('fr')
  resetChannelExtras()
})

describe('onboarding model', () => {
  it('has 8 steps in first run and skips the agent and engine steps when adding a channel', () => {
    expect(stepsOf('first-run')).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(stepsOf('add-channel')).toEqual([3, 4, 5, 6, 7, 8])
  })

  it('validates the name and every way of answering the channel question', () => {
    expect(stepValid(1, answers({ name: '  ' }))).toBe(false)
    expect(stepValid(1, answers())).toBe(true)
    expect(stepValid(3, answers())).toBe(false)
    expect(stepValid(3, answers({ hasChannel: 'yes' }))).toBe(false)
    expect(stepValid(3, OWN)).toBe(true)
    expect(stepValid(3, answers({ hasChannel: 'no' }))).toBe(false)
    expect(stepValid(3, answers({ hasChannel: 'no', creation: 'niche' }))).toBe(false)
    expect(stepValid(3, answers({ hasChannel: 'no', creation: 'niche', nicheId: 'niche-cold' }))).toBe(true)
    expect(stepValid(3, answers({ hasChannel: 'no', creation: 'translate', translateLink: 'youtube.com/@x' }))).toBe(true)
    expect(stepValid(3, answers({ hasChannel: 'no', creation: 'idea', idea: ' ' }))).toBe(false)
    expect(stepValid(3, answers({ hasChannel: 'no', creation: 'idea', idea: 'des naufrages' }))).toBe(true)
  })

  it('picks the analysis source and the pipeline from the answers (textify is hard to replicate)', () => {
    expect(sourceKind(OWN)).toBe('own')
    expect(sourceKind(answers({ hasChannel: 'no', creation: 'translate' }))).toBe('translate')
    expect(pipelineIdFor(OWN)).toBe('pl-docu')
    expect(pipelineIdFor(answers({ hasChannel: 'no', creation: 'translate', translateLink: '@grandesenigmes' }))).toBe('pl-docu-en')
    expect(isHardToReplicate(TEXTIFY)).toBe(true)
    expect(pipelineIdFor(TEXTIFY)).toBe('pl-sms')
    expect(handleOf('https://www.youtube.com/@textify.stories?x=1')).toBe('textify.stories')
  })

  it('builds the channel of an add-channel run, linking a translation to its source in the workspace', () => {
    const state = initialState()
    const a = answers({ hasChannel: 'no', creation: 'translate', translateLink: 'youtube.com/@grandesenigmes', targetLang: 'es', videosPerWeek: 2, shortsPerDay: 1 })
    const ch = buildChannel(a, state)
    expect(ch.language).toBe('es')
    expect(ch.translatedFrom).toBe('ch-enigmes')
    expect(ch.name).toBe('Les Grandes Énigmes (ES)')
    expect(ch.cadence).toBe('2 vidéos par semaine · 1 short par jour')
    expect(ch.pipelineIds).toEqual(['pl-docu-en'])
    expect(state.channels.map((c) => c.color)).not.toContain(ch.color)
    const niche = buildChannel(answers({ hasChannel: 'no', creation: 'niche', nicheId: 'niche-science' }), state)
    expect(niche.name).toBe('Sciences animées')
    expect(niche.connected).toBe(false)
    expect(channelNameOf(answers({ hasChannel: 'no', creation: 'idea', idea: 'histoires de naufrages vraies' }), [])).toBe('Histoires De Naufrages')
  })

  it('keeps the analysis timeline consistent: ~8 s, steps tick in order', () => {
    expect(ANALYSIS_TOTAL_MS).toBeGreaterThanOrEqual(7500)
    expect(ANALYSIS_TOTAL_MS).toBeLessThanOrEqual(9000)
    expect(FOUND_COMPETITORS).toHaveLength(14)
    expect(stageAt(0).current).toBe(0)
    expect(stageAt(ANALYSIS_STEPS[0]!.ms + 10).current).toBe(1)
    expect(stageAt(ANALYSIS_TOTAL_MS).current).toBe(ANALYSIS_STEPS.length)
    expect(stageAt(ANALYSIS_TOTAL_MS).progress.every((p) => p === 1)).toBe(true)
  })
})

describe('onboarding steps', () => {
  it('step 1: the agent orb, the question, a default name and the three personalities', () => {
    const html = withStore(<WelcomeStep {...stepProps(answers())} />)
    expect(html).toContain('data-testid="onboarding-orb"')
    expect(html).toContain('Je suis ton agent principal.')
    expect(html).toContain('Comment veux-tu m’appeler ?')
    expect(html).toContain('value="Atlas"')
    for (const p of ['Posé', 'Direct', 'Enthousiaste']) expect(html).toContain(p)
    clean(html)
  })

  it('step 2: the four engines, Claude Code recommended and detected, one line about credits', () => {
    const html = withStore(<EngineStep {...stepProps(answers())} />)
    for (const id of ['claude-code', 'codex', 'multi', 'atelier']) expect(html).toContain(`data-testid="engine-${id}"`)
    expect(html).toContain('Recommandé')
    expect(html).toContain('Détecté sur l’ordinateur de l’équipe')
    expect(html).toContain('data-testid="engine-login"')
    expect(html).toContain('Abonnement ou crédits ?')
    expect(html).toContain('Plus cher')
    clean(html)
    expect(withStore(<EngineStep {...stepProps(answers({ engineCheck: 'connected' }))} />)).toContain('Connecté · Claude Max 20×')
  })

  it('step 3: asks the question, then shows what each answer needs', () => {
    const base = withStore(<ChannelStep {...stepProps(answers())} />)
    expect(base).toContain('Tu as déjà une chaîne ?')
    expect(base).toContain('data-testid="channel-yes"')
    expect(base).toContain('data-testid="channel-no"')
    expect(base).not.toContain('onboarding-channel-link')
    const yes = withStore(<ChannelStep {...stepProps(OWN)} />)
    expect(yes).toContain('data-testid="onboarding-channel-link"')
    expect(yes).toContain('Connecter avec Google')
    expect(yes).toContain('youtube.com/@grandesenigmes')
    expect(withStore(<ChannelStep {...stepProps({ ...OWN, googleConnected: true })} />)).toContain('YouTube Analytics connecté')
    const no = withStore(<ChannelStep {...stepProps(answers({ hasChannel: 'no', creation: 'niche' }))} />)
    for (const k of ['Trouver une niche', 'Traduire une chaîne qui marche', 'J’ai déjà une idée', 'RPM 9 €', 'Concurrence forte']) expect(no).toContain(k)
    expect(no).toContain('data-testid="onboarding-language"')
    const tr = withStore(<ChannelStep {...stepProps(answers({ hasChannel: 'no', creation: 'translate', translateLink: 'youtube.com/@x', targetLang: 'es' }))} />)
    expect(tr).toContain('Une chaîne existe déjà en espagnol sur ce créneau')
    expect(withStore(<ChannelStep {...stepProps(answers({ hasChannel: 'no', creation: 'translate', translateLink: 'youtube.com/@x', targetLang: 'en' }))} />)).toContain('la place est libre')
    clean(yes + no + tr)
  })

  it('step 4: the analysis starts at zero with the six steps, the frames grid and the competitors panel', () => {
    const html = withStore(<AnalysisStep {...stepProps(OWN)} />)
    for (const l of ['Je récupère les 30 dernières vidéos', 'Je lis les transcriptions', 'Je découpe 1 frame toutes les 2 s et je regarde les plans', 'Je repère les styles', 'Je trouve 14 concurrents', 'Je compare titres, miniatures, rythme']) expect(html).toContain(l)
    expect(html).toContain('data-testid="analysis-frames"')
    expect(html).toContain('data-testid="analysis-competitors"')
    expect(html).toContain('data-testid="onboarding-skip-analysis"')
    expect(html).toContain('data-state="running"')
    expect(html).toContain('Je regarde ta chaîne comme le ferait un expert YouTube.')
    // Already done (coming back to the step): the results are shown, no skip button.
    const done = withStore(<AnalysisStep {...stepProps(OWN, { ready: true })} />)
    expect(done).toContain('data-state="done"')
    expect(done).toContain('14 400 frames regardées')
    expect(done).toContain('2 styles trouvés')
    expect(done).not.toContain('onboarding-skip-analysis')
    clean(html + done)
  })

  it('step 5: the report of a documentary channel with its pipeline, score, cost and time', () => {
    const html = withStore(<ReportStep {...stepProps(OWN)} />)
    expect(html).toContain('Voilà ce que j’ai compris de ta chaîne.')
    expect(html).toContain('88 %')
    expect(html).toContain('≈ 445')
    expect(html).toContain('≈ 48 min')
    expect(html).toContain('21 min en cloud')
    expect(html).toContain('82 %')
    for (const k of ['Documentaire narré', 'Face caméra', '80 %', '20 %', 'Points forts', 'Ce que font mieux les concurrents', 'Structure d’un script', 'Archives et B-roll']) expect(html).toContain(k)
    expect(html).toContain('data-testid="report-strip"')
    expect(html).not.toContain('report-limits')
    clean(html)
  })

  it('step 5: honest limits when the style is hard to replicate (textify)', () => {
    const html = withStore(<ReportStep {...stepProps(TEXTIFY)} />)
    expect(html).toContain('data-testid="report-limits"')
    expect(html).toContain('Ce que je ne saurai pas faire seul')
    expect(html).toContain('46 %')
    expect(html).toContain('Réplicable en partie')
    expect(html).toContain('Conversation SMS')
    clean(html)
  })

  it('step 6: every question on one screen, with defaults', () => {
    const html = withStore(<QuestionsStep {...stepProps(OWN)} />)
    for (const k of ['Qui fait quoi', 'Rythme', 'Voix', 'Ce que tu fournis', 'Produits et sponsors', 'Livraison', 'Idées de sujets', 'Miniature et titre', 'Publication', 'Automatique', 'Je valide', 'Je m’en occupe', 'Cloner la voix de la chaîne', 'Bibliothèque MiniMax', 'Importer depuis ElevenLabs', 'Ma propre voix', 'J’écris mes scripts', 'Je fournis des clips de gameplay', 'Google Drive', 'Dropbox', 'Je poste à la main']) expect(html, k).toContain(k)
    expect(html).toContain('J’ai repéré « Le Carnet des Énigmes (e-book) » dans tes descriptions.')
    // An existing channel keeps its art direction: the question is for new channels only.
    expect(html).not.toContain('data-testid="q-art"')
    const fresh = withStore(<QuestionsStep {...stepProps(answers({ hasChannel: 'no', creation: 'niche', nicheId: 'niche-cold' }))} />)
    expect(fresh).toContain('data-testid="q-art"')
    expect(fresh).toContain('Garder celle des concurrents')
    expect(fresh).toContain('Mixer')
    expect(fresh).toContain('Nouvelle DA')
    expect(fresh).toContain('Cloner une voix qui marche')
    expect(fresh).not.toContain('product-detected')
    clean(html + fresh)
  })

  it('step 7: the test video starts running through the pipeline columns', () => {
    const html = withStore(<TestVideoStep {...stepProps(OWN)} />)
    expect(html).toContain('Je fais une vidéo test.')
    expect(html).toContain('data-state="running"')
    expect(html).toContain('Montage')
    expect(html).not.toContain('data-testid="test-result"')
    clean(html)
  })

  it('step 7: finished, it shows the result card with the feedback tools', () => {
    const html = withStore(<TestVideoStep {...stepProps(OWN, { ready: true })} />)
    expect(html).toContain('data-testid="test-result"')
    for (const k of ['Regarder', 'Qu’est-ce que je change ?', 'Plus rythmé', 'Relancer avec ce feedback', 'C’est bon', 'Version 1']) expect(html, k).toContain(k)
    expect(html).toContain('Reproduction :')
    clean(html)
  })

  it('step 8: the org chart, the summary and the Discord option; a job done by the user removes its specialist', () => {
    const html = withStore(<TeamStep {...stepProps(OWN)} />)
    for (const id of ['principal', 'lead', 'research', 'script', 'director', 'edit', 'pack', 'compet', 'qc']) expect(html).toContain(`data-testid="team-${id}"`)
    expect(html).toContain('Atlas')
    expect(html).toContain('Hugo')
    expect(html).toContain('Recevoir Atlas sur ton téléphone')
    expect(html).toContain('Documentaire narré')
    clean(html)
    const own = answers({ ...OWN, automation: { ...OWN.automation, script: 'human', packaging: 'human' } })
    expect(hiredSpecialists(own).map((m) => m.id)).not.toContain('script')
    expect(hiredSpecialists(own).map((m) => m.id)).not.toContain('pack')
    expect(withStore(<TeamStep {...stepProps(own)} />)).toContain('Je n’ai pas recruté ces spécialistes.')
  })
})

describe('OnboardingFlow', () => {
  it('first run: full window, step 1, eight progress segments, no Back, Continuer enabled, skip link', () => {
    const html = withStore(<OnboardingFlow />, { onboarded: false })
    expect(html).toContain('data-testid="onboarding"')
    expect(html).toContain('data-testid="onboarding-step-1"')
    expect(count(html, '<h1')).toBe(1)
    expect(count(html, 'data-done=')).toBe(8)
    expect(html).not.toContain('data-testid="onboarding-back"')
    expect(html).toContain('data-testid="onboarding-next"')
    expect(html).not.toMatch(/data-testid="onboarding-next"[^>]*disabled/)
    expect(html).toContain('data-testid="onboarding-skip"')
    expect(html).toContain('Étape 1 sur 8')
    clean(html)
  })

  it('add-channel mode starts at the channel question, has six segments and a Cancel link instead of Back', () => {
    const html = withStore(<OnboardingFlow mode="add-channel" />)
    expect(html).toContain('data-mode="add-channel"')
    expect(html).toContain('data-testid="onboarding-step-3"')
    expect(html).toContain('Tu as déjà une chaîne ?')
    expect(count(html, 'data-done=')).toBe(6)
    expect(html).not.toContain('data-testid="onboarding-back"')
    expect(html).toContain('Annuler')
    expect(html).toContain('Étape 1 sur 6')
    // The step needs an answer before moving on.
    expect(html).toMatch(/data-testid="onboarding-next"[^>]*disabled|disabled=""[^>]*data-testid="onboarding-next"/)
  })
})

describe('Chaînes screen', () => {
  const route = { section: 'chaines' as const }
  const render = (props: { initialChannelId?: string; initialTab?: string } = {}, overrides: Partial<ProtoState> = {}): string => withStore(<ChannelsScreen route={route} onRoute={noop} {...props} />, overrides)

  it('is registered under chaines and in the section screens', () => {
    expect(CHANNELS_SCREENS.chaines).toBe(ChannelsScreen)
    expect(SCREENS.chaines).toBe(ChannelsScreen)
  })

  it('lists the four channels with figures, tags, step pills and the two header buttons', () => {
    const html = render()
    expect(html).toContain('data-testid="view-chaines"')
    expect(count(html, '<h1')).toBe(1)
    expect(html).toContain('data-testid="add-channel"')
    expect(html).toContain('data-testid="replay-onboarding"')
    expect(html).toContain('Ajouter une chaîne')
    expect(html).toContain('Revoir l’accueil de départ')
    expect(count(html, 'data-testid="channel-card-')).toBe(4)
    for (const n of ['Les Grandes Énigmes', 'Histoires Vraies', 'Top Savoirs', 'Mystery Files']) expect(html).toContain(n)
    expect(html).toContain('Traduction de Les Grandes Énigmes')
    expect(html).toContain('Analytics non connectées')
    expect(html).toContain('data-testid="channel-connect-ch-top"')
    expect(count(html, 'data-testid="channel-figures"')).toBe(3)
    expect(count(html, 'data-testid="step-pills"')).toBe(4)
    expect(html).toContain('Documentaire narré')
    expect(html).toContain('3 vidéos par semaine')
    expect(html).toContain('Chaînes : 4 · Analytics connectées : 3')
    clean(html)
  })

  it('follows the global channel scope', () => {
    const html = render({}, { scope: 'ch-top' })
    expect(count(html, 'data-testid="channel-card-')).toBe(1)
    expect(html).toContain('Top Savoirs')
    expect(html).not.toContain('Histoires Vraies')
    expect(html).toContain('Chaînes : 1 · Analytics connectées : 0')
  })

  it('summarises who does what with A / V / M pills', () => {
    const html = render({}, { scope: 'ch-top' })
    // Top Savoirs: ideas validated, script by hand, production automatic, packaging and publishing by hand.
    expect(html).toContain('data-mode="validate"')
    expect(html).toContain('data-mode="human"')
    expect(html).toContain('data-mode="auto"')
  })

  it.each(DETAIL_TABS)('detail tab %s renders for a channel', (tab) => {
    const html = render({ initialChannelId: 'ch-enigmes', initialTab: tab })
    expect(html).toContain('data-testid="channel-detail"')
    expect(html).toContain(`data-testid="channel-panel-${tab}"`)
    expect(count(html, '<h1')).toBe(1)
    for (const l of ['Automatisation', 'Styles et pipelines', 'Concurrents', 'Produits et sponsors', 'Règles', 'Connexions']) expect(html).toContain(l)
    clean(html)
  })

  it('detail: the automation matrix, the style mix, 14 competitors, products, rules and connections', () => {
    expect(render({ initialChannelId: 'ch-enigmes', initialTab: 'automation' })).toContain('data-testid="automation-matrix"')
    const styles = render({ initialChannelId: 'ch-enigmes', initialTab: 'styles' })
    expect(styles).toContain('Documentaire narré')
    expect(styles).toContain('80 %')
    expect(styles).toContain('20 %')
    expect(styles).toContain('data-testid="style-slider-pl-docu"')
    expect(styles).toContain('Voir dans Production › Pipelines')
    const comp = render({ initialChannelId: 'ch-enigmes', initialTab: 'competitors' })
    expect(count(comp, 'data-testid="competitor-row"')).toBe(14)
    expect(comp).toContain('10 chaînes surveillées sur 14')
    expect(count(render({ initialChannelId: 'ch-mystery', initialTab: 'competitors' }), 'data-testid="competitor-row"')).toBe(8)
    expect(render({ initialChannelId: 'ch-enigmes', initialTab: 'products' })).toContain('Le Carnet des Énigmes (e-book)')
    const rules = render({ initialChannelId: 'ch-enigmes', initialTab: 'rules' })
    expect(rules).toContain('Jamais de sujets politiques.')
    expect(rules).toContain('Toujours sourcer')
    const conn = render({ initialChannelId: 'ch-top', initialTab: 'connections' })
    for (const l of ['YouTube Analytics', 'Stockage des vidéos', 'Publication automatique', 'Discord', 'Non connecté']) expect(conn).toContain(l)
  })

  it('competitor pools stay between 8 and 14 per channel', () => {
    for (const id of ['ch-enigmes', 'ch-histoires', 'ch-top', 'ch-mystery']) {
      const n = competitorsOf(id).length
      expect(n).toBeGreaterThanOrEqual(8)
      expect(n).toBeLessThanOrEqual(14)
    }
  })

  it('style mix always sums to 100', () => {
    expect(evenMix(['a', 'b', 'c'])).toEqual({ a: 34, b: 33, c: 33 })
    const mixed = rebalance({ a: 80, b: 20 }, 'a', 60)
    expect(mixed).toEqual({ a: 60, b: 40 })
    const three = rebalance({ a: 50, b: 30, c: 20 }, 'a', 80)
    expect(Object.values(three).reduce((s, n) => s + n, 0)).toBe(100)
    expect(three.a).toBe(80)
    expect(normalize({ a: 30, b: 20 })).toEqual({ a: 60, b: 40 })
    expect(rebalance({ a: 100 }, 'a', 30)).toEqual({ a: 100 })
  })
})

describe('strings', () => {
  it('every onboarding key has an English translation with the same placeholders', () => {
    const placeholders = (s: string): string => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(',')
    const missing: string[] = []
    const bad: string[] = []
    for (const [k, v] of Object.entries(frPOnboarding)) {
      const e = (enPOnboarding as Record<string, string | undefined>)[k]
      if (!e) missing.push(k)
      else if (placeholders(e) !== placeholders(v)) bad.push(k)
    }
    expect(missing).toEqual([])
    expect(bad).toEqual([])
    expect(Object.keys(frPOnboarding).length).toBeGreaterThan(300)
  })

  it('t() switches the onboarding to English', () => {
    expect(t('onb.next')).toBe('Continuer')
    setLocale('en')
    expect(getLocale()).toBe('en')
    expect(t('onb.next')).toBe('Continue')
    expect(en['onb.next' as keyof typeof en]).toBe('Continue')
    expect(fr['onb.next']).toBe('Continuer')
    const html = withStore(<ChannelStep {...stepProps(answers())} />)
    expect(html).toContain('Do you already have a channel?')
  })
})
