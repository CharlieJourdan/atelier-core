// Production rebuilt (production-2, decision 0008): every Production page, in presentation mode AND in real mode, shows no
// pre-made pipeline and no invented data (no demo video, pipeline, brick, avatar or voice, no DÉMO badge); the start
// screen offers the three ways to build; the recipe editor shows the seven stages with the code registry's technologies;
// the technologies panel lists them by stage. The pure helpers of the editor behave. Rendered in plain Node.
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { NO_FEATURES } from '../../src/shared/features'
import { t } from '../../src/shared/fr'
import { RECIPE_STAGES, type RecipeSummary } from '../../src/shared/recipes'
import type { EstimateCardsView } from '../../src/shared/estimates'
import { screenFeature, type Route } from '../../src/shared/sections'
import { listTechnologies } from '../../src/main/production/recipes'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { FeaturesProvider } from '../../src/renderer/lib/features'
import { PIPELINES } from '../../src/renderer/proto/data-pipelines'
import { VOICES } from '../../src/renderer/proto/data-production'
import { VIDEOS } from '../../src/renderer/proto/data-videos'
import { createProtoStore, initialState, ProtoProvider, type DataMode } from '../../src/renderer/proto/store'
import { SectionScreen } from '../../src/renderer/screens/SectionScreen'
import { RecipeHeader } from '../../src/renderer/screens/production/recettes/RecipeEditor'
import { RecipeStages } from '../../src/renderer/screens/production/recettes/RecipeStages'
import { ReadyCard } from '../../src/renderer/screens/production/lab/ReadyCard'
import { MyPipelineCard } from '../../src/renderer/screens/production/lab/MyPipelines'
import { MixBar, OptionFields, optionsIn, PipelineOptions } from '../../src/renderer/screens/production/recettes/PipelineOptions'
import { avatarBase } from '../../src/engine/technologies'
import { optionInfo } from '../../src/main/production/recipes/store'
import { ProjectRows } from '../../src/renderer/screens/production/recettes/ProjectsScreen'
import { TechnologiesByStage } from '../../src/renderer/screens/production/recettes/TechnologiesPanel'
import { addable, addBrick, bricksByStage, newRecipe, parseField, removeBrick, setSetting } from '../../src/renderer/screens/production/recettes/recipe-model'

const noop = () => undefined
const BAD = /undefined|NaN|\[object Object\]/
const TECHS = listTechnologies()
const PAGES = ['apercu', 'nouvelle', 'pretes', 'pipeline', 'editeur', 'bibliotheque', 'ressources'] as const

function wrap(node: ReactElement, mode: DataMode = 'demo'): string {
  return renderToStaticMarkup(
    <ProtoProvider store={createProtoStore(initialState({ mode }))}>
      <FeaturesProvider value={NO_FEATURES}>
        <TooltipProvider>{node}</TooltipProvider>
      </FeaturesProvider>
    </ProtoProvider>
  )
}

const page = (p: string, mode: DataMode): string => wrap(<SectionScreen route={{ section: 'production', page: p } satisfies Route} onRoute={noop} />, mode)

describe('Production shows no invented data (production-2)', () => {
  for (const mode of ['demo', 'live'] as const) {
    it(`${mode === 'demo' ? 'presentation' : 'real'} mode: no pre-made pipeline, no demo video, voice or badge on any Production page`, () => {
      for (const p of PAGES) {
        const html = page(p, mode)
        expect(html, p).not.toMatch(BAD)
        expect(html, p).not.toContain('data-testid="demo-badge"')
        expect(html, p).not.toContain('data-testid="demo-banner"')
        for (const pl of PIPELINES) {
          expect(html, `${p}: ${pl.id}`).not.toContain(pl.id)
          expect(html, `${p}: ${pl.name}`).not.toContain(`>${pl.name}<`)
        }
        for (const v of VIDEOS) expect(html, `${p}: ${v.id}`).not.toContain(v.title.replace(/'/g, '&#x27;'))
        for (const v of VOICES) expect(html, `${p}: ${v.id}`).not.toContain(v.name)
      }
    })
  }

  it('no Production page is marked as built on demo data any more', () => {
    for (const p of PAGES) expect(screenFeature({ section: 'production', page: p }), p).toBeUndefined()
  })

  it('the store keeps no pre-made pipeline in real mode', () => {
    expect(initialState({ mode: 'live' }).pipelines).toEqual([])
  })
})

describe('the Lab (production-lab)', () => {
  // Charlie 01/11: the Lab is Production's home — « Créer une pipeline » the big button, « Nouvelle vidéo » beside it (it
  // left the top bar), « Mes pipelines » on the side, « Pipelines prêtes » (the base pipelines' new name) with « Voir toutes
  // les pipelines »; no Atlas on the Lab (he sits beside the Pipeline and Projets pages); building by hand and the file
  // import only behind the flags (decision 0051, pipeline codes)
  it('offers « Créer une pipeline », « Nouvelle vidéo », my pipelines and the ready ones; no Atlas, nothing by hand', () => {
    const html = page('apercu', 'live')
    expect(html).toContain('data-testid="view-production-start"')
    expect(html).toContain('data-testid="create-pipeline"')
    expect(html).toContain('data-testid="new-video"')
    expect(html).toContain('data-testid="team-recipes"')
    expect(html).toContain('data-testid="prebuilt-recipes"')
    expect(html).toContain('data-testid="ready-all"')
    for (const k of ['lab.title', 'lab.create', 'lab.newVideo', 'lab.mine', 'lab.ready', 'lab.ready.all'] as const) expect(html, k).toContain(t(k).replace(/'/g, '&#x27;'))
    expect(html).not.toContain('data-testid="atlas-dock"')
    expect(html).not.toContain('data-testid="atlas-square"')
    expect(html).not.toContain('data-testid="start-advanced"')
    expect(html).not.toContain('data-testid="build-self"')
    expect(html).not.toContain('data-testid="import-file"')
    expect(page('nouvelle', 'live')).toContain('data-testid="view-production-start"')
    expect(page('pretes', 'live')).toContain('data-testid="view-production-ready"')
    expect(t('page.production.apercu')).toBe('Lab')
  })

  it('Atlas sits beside the Pipeline and Projets pages', () => {
    for (const p of ['pipeline', 'bibliotheque']) {
      const html = page(p, 'live')
      expect(html, p).toContain('data-testid="atlas-dock"')
      expect(html, p).toContain('data-testid="atlas-square"')
    }
  })

  it('a ready pipeline: its name, an example slot, its specs, « Utiliser », « Ajouter », « Voir »; its options first, « soon » choices locked', () => {
    const base = { id: avatarBase.id, labelKey: avatarBase.labelKey, doc: avatarBase.doc, options: avatarBase.options.map(optionInfo), copies: 2, form: 'long' as const, code: 'ABCD-EFGH' }
    const cards = wrap(<ReadyCard base={base} estimates={null} actions={{ busy: false, onUse: noop, onAdd: noop }} />)
    for (const s of [
      'data-testid="base-avatar@1"',
      'data-testid="example-avatar@1"',
      'data-testid="run-avatar@1"',
      'data-testid="use-avatar@1"',
      'data-testid="see-avatar@1"',
      t('pipe.base.avatar'),
      t('lab.use'),
      t('lab.add'),
      t('lab.see'),
      t('lab.used.n', { n: 2 }),
      t('lab.form.long'),
      t('lab.spec.time'),
      t('lab.spec.cost')
    ])
      expect(cards, s).toContain(s.replace(/'/g, '&#x27;'))
    // « trop d'information »: no blurb on the card (it is in « Voir »)
    expect(cards).not.toContain(t('pipe.base.avatar.blurb').replace(/'/g, '&#x27;').slice(0, 30))
    // pipeline-ui: the main options, then « Avancé » (quality, editing…) with the mix
    const doc = { ...avatarBase.doc, base: 'avatar@1', options: { captions: true } }
    const opts =
      wrap(<PipelineOptions base={base} doc={doc} previews={new Map()} onChange={() => {}} />) +
      wrap(<OptionFields options={optionsIn(base, 'advanced')} doc={doc} deltas={null} previews={new Map()} onChange={() => {}} />) +
      wrap(<MixBar mix={doc.mix} />)
    expect(opts).toContain(t('pipe.opt.quality.images').replace(/'/g, '&#x27;'))
    expect(opts).toMatch(/aria-pressed="true"[^>]*data-testid="opt-captions-true"/)
    expect(opts).toMatch(/disabled=""[^>]*data-testid="opt-editing-advanced"/)
    expect(opts).not.toMatch(/disabled=""[^>]*data-testid="opt-chapters-true"/)
    expect(opts).toContain('data-testid="pipe-mix"')
    expect(opts).toContain('Présentateur 26 %')
  })

  it('one of my pipelines as a small card: name, Long / Short, progress graph, videos in production, price per video, channels', () => {
    const recipe: RecipeSummary = {
      id: 3,
      name: 'Avatar long',
      videoType: 'avatar-long',
      version: 2,
      bricks: 9,
      channels: [{ channelId: 7, videoType: 'avatar-long' }],
      archived: false,
      updatedAt: '2026-10-30',
      base: 'avatar@1',
      form: 'long',
      minutes: 10,
      stages: ['idee', 'script', 'voix', 'elements', 'montage'],
      code: 'ABCD-EFGH'
    }
    const estimates: EstimateCardsView = {
      available: true,
      reason: null,
      creditEur: 0.01,
      bases: {},
      recipes: { 3: { perMinute: { min: 100, avg: 124, max: 150 }, fit: null, renderTime: { minutes: 10, seconds: { min: 600, avg: 840, max: 1200 } } } }
    }
    const html = wrap(<MyPipelineCard recipe={recipe} activity={{ videos: 2, progress: 0.5 }} estimates={estimates} onOpen={noop} />)
    expect(html).toContain('data-testid="recipe-3"')
    for (const s of ['Avatar long', t('lab.form.long'), t('lab.card.videos.many', { n: 2 }), t('lab.card.channels.one'), '14 min']) expect(html, s).toContain(s)
    expect(html).toMatch(/data-testid="recipe-price-3"[^>]*>.*1[\s\u202f\u00a0]240 cr\. \/ vidéo/)
    // half way: 2 of the 5 stages done, the third breathing
    expect(html.match(/data-state="done"/g)).toHaveLength(2)
    expect(html.match(/data-state="now"/g)).toHaveLength(1)
    // no « brique » in the main path (production-15, Charlie 01/11)
    expect(html).not.toContain('briques')
  })
})

describe('the recipe editor', () => {
  it('draws the seven stages, the bricks of a new recipe and what each stage may still take', () => {
    const doc = newRecipe('Ma recette', TECHS)
    const html = wrap(<RecipeStages doc={doc} techs={TECHS} onChange={noop} />)
    for (const s of RECIPE_STAGES) expect(html, s).toContain(`data-testid="stage-${s}"`)
    for (const s of RECIPE_STAGES) expect(html, s).toContain(t(`recipe.stage.${s}`))
    expect(html).toContain('data-testid="brick-voice.tts"')
    expect(html).toContain(t('tech.voice.tts'))
    expect(html).toContain('data-testid="add-elements"')
    expect(html).toContain(t('tech.avatar.speak'))
    expect(html).not.toMatch(BAD)
    const head = wrap(<RecipeHeader doc={doc} onChange={noop} />)
    for (const k of ['recipeEd.name', 'recipeEd.videoType', 'recipeEd.cap', 'recipeEd.checkpoints', 'recipeEd.checkpoints.channel', 'recipeEd.checkpoints.channelHint'] as const) {
      expect(head, k).toContain(t(k).replace(/'/g, '&#x27;'))
    }
    expect(page('pipeline', 'live')).toContain('data-testid="view-production-recipes"')
    expect(page('editeur', 'live')).toContain('data-testid="view-production-recipes"')
  })

  it('helpers: a new recipe, bricks kept in stage order, settings set and unset, fields read from text', () => {
    let doc = newRecipe('R', TECHS)
    expect(doc.bricks.map((b) => b.tech)).toContain('render.assemble@1')
    const avatar = TECHS.find((x) => x.id === 'avatar.speak@1')!
    doc = addBrick(doc, avatar, TECHS)
    const order = doc.bricks.map((b) => b.tech)
    expect(order.indexOf('avatar.speak@1')).toBeGreaterThan(order.indexOf('visuals.fulfil@1'))
    expect(order.indexOf('avatar.speak@1')).toBeLessThan(order.indexOf('captions.make@1'))
    expect(addable(doc, 'elements', TECHS).map((x) => x.id)).not.toContain('avatar.speak@1')
    expect(bricksByStage(doc, TECHS).elements.map((b) => b.tech.id)).toEqual(['visuals.fulfil@1', 'avatar.speak@1'])
    const i = doc.bricks.findIndex((b) => b.tech === 'voice.tts@1')
    doc = setSetting(doc, i, 'speed', 1.1)
    expect(doc.bricks[i]?.settings).toEqual({ speed: 1.1 })
    doc = setSetting(doc, i, 'speed', undefined)
    expect(doc.bricks[i]?.settings).toEqual({})
    expect(removeBrick(doc, i).bricks.some((b) => b.tech === 'voice.tts@1')).toBe(false)
    expect(parseField({ key: 'n', type: 'number', recipe: true, channel: false }, '1,5')).toBe(1.5)
    expect(parseField({ key: 'n', type: 'integer', recipe: true, channel: false }, '2.6')).toBe(3)
    expect(parseField({ key: 'n', type: 'number', recipe: true, channel: false }, '')).toBeUndefined()
    expect(parseField({ key: 'l', type: 'list', recipe: true, channel: false }, 'a\n\n b ')).toEqual(['a', 'b'])
  })
})

describe('the technologies panel', () => {
  it('lists the registry by stage with status, nodes, Cloud usages, agent tools and settings', () => {
    const html = wrap(<TechnologiesByStage techs={TECHS} />)
    for (const s of RECIPE_STAGES) expect(html, s).toContain(`data-testid="tech-stage-${s}"`)
    for (const x of TECHS) expect(html, x.id).toContain(`data-testid="tech-${x.name}"`)
    expect(html).toContain('synthesize')
    expect(html).toContain(t('tech.status.draft'))
    expect(html).toContain(t('techSet.speed'))
    expect(html).not.toMatch(BAD)
    expect(page('ressources', 'live')).toContain('data-testid="view-production-technologies"')
  })
})

describe('projects', () => {
  it('a project shows its pinned recipe version and its channel; « Lancer » waits for a channel', () => {
    const html = wrap(
      <ProjectRows
        projects={[
          { id: 1, title: 'Le phare', recipeId: 2, recipeName: 'Docu', recipeVersion: 3, channelId: null, runId: null, runStatus: null, videoId: null, createdAt: '', updatedAt: '' },
          { id: 2, title: 'La tour', recipeId: 2, recipeName: 'Docu', recipeVersion: 3, channelId: 7, runId: 9, runStatus: 'succeeded', videoId: 4, createdAt: '', updatedAt: '' },
          { id: 3, title: 'Le pont', recipeId: 2, recipeName: 'Docu', recipeVersion: 3, channelId: 7, runId: 10, runStatus: 'interrupted', videoId: 5, createdAt: '', updatedAt: '' }
        ]}
        channelName={() => 'Phares'}
        onRun={noop}
        onOpen={noop}
      />
    )
    expect(html).toContain('Docu · v3')
    expect(html).toMatch(/data-testid="project-run-1"[^>]*disabled|disabled[^>]*data-testid="project-run-1"/)
    expect(html).toContain(t('runs.status.succeeded'))
    // an interrupted run is relaunched from the project (the same run); a finished one is not
    expect(html).toContain('data-testid="project-rerun-3"')
    expect(html).not.toContain('data-testid="project-rerun-2"')
    expect(page('bibliotheque', 'live')).toContain('data-testid="view-production-projects"')
  })
})
