// Lot Z1 (analysis screens): server render of Chaînes et styles, Analyser une chaîne, Pipelines and Builder, plus the
// bodies of each fed with real data from an in-memory core (the same objects the IPC returns).
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConfirmProvider } from '../../src/renderer/components/atelier/confirm'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { FeaturesProvider } from '../../src/renderer/lib/features'
import { AnalysisBody } from '../../src/renderer/screens/analysis/analyser/AnalysisView'
import { AnalyserScreen } from '../../src/renderer/screens/analysis/analyser/AnalyserScreen'
import { BuilderScreen, SessionBody } from '../../src/renderer/screens/analysis/builder/BuilderScreen'
import { ChainesScreen } from '../../src/renderer/screens/analysis/chaines/ChainesScreen'
import { StyleForm } from '../../src/renderer/screens/analysis/chaines/StyleForm'
import { ANALYSIS_SCREENS } from '../../src/renderer/screens/analysis'
import { PipelineScreen } from '../../src/renderer/screens/analysis/pipeline/PipelineScreen'
import { DetailBody } from '../../src/renderer/screens/analysis/pipeline/PipelineDetail'
import { NodeInspector } from '../../src/renderer/screens/analysis/pipeline/NodeInspector'
import { DiffView } from '../../src/renderer/screens/analysis/shared/common'
import { ReproGauge, gaugeAria } from '../../src/renderer/screens/analysis/shared/Gauge'
import { PipelineGraph } from '../../src/renderer/screens/analysis/shared/PipelineGraph'
import { parsePipelineDoc } from '../../src/renderer/screens/analysis/shared/graph-layout'
import { NO_FEATURES } from '../../src/shared/features'
import { t } from '../../src/shared/fr'
import { lineDiff } from '../../src/shared/line-diff'
import { memoryCore } from './helpers'

const noop = () => undefined
const wrap = (el: ReactElement) =>
  renderToStaticMarkup(
    <FeaturesProvider value={NO_FEATURES}>
      <TooltipProvider>
        <ConfirmProvider>{el}</ConfirmProvider>
      </TooltipProvider>
    </FeaturesProvider>
  )
const route = { section: 'production' as const, page: 'pipeline' }
const screen = (C: typeof PipelineScreen, page: string) => wrap(<C route={{ section: 'production', page }} onRoute={noop} />)

function clean(html: string): void {
  for (const bad of ['undefined', 'NaN', '[object Object]']) expect(html).not.toContain(bad)
}

describe('registration', () => {
  it('registers the four production pages', () => {
    expect(Object.keys(ANALYSIS_SCREENS).sort()).toEqual(['production/analyser', 'production/builder', 'production/chaines', 'production/pipeline'])
  })
})

describe('screens, first render', () => {
  it('the old pipeline library still renders (its route now opens the recipe editor, production-2), with library, templates and import', () => {
    const html = screen(PipelineScreen, 'pipeline')
    expect(html).toContain(`<h1 id="title-production" class="page-title">${t('page.production.pipeline')}</h1>`)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('data-testid="view-production"')
    for (const label of ['Modèles', 'Mes pipelines', 'Importer']) expect(html).toContain(label)
    expect(route.page).toBe('pipeline')
    clean(html)
  })

  it('Analyser une chaîne: new analysis, past analyses, the link form under a DÉMO banner, the three references load', () => {
    const html = screen(AnalyserScreen, 'analyser')
    expect(html).toContain('Analyser une chaîne</h1>')
    for (const label of ['Nouvelle analyse', 'Analyses passées', 'Depuis un lien', 'Chaînes de référence']) expect(html).toContain(label)
    // reading a real channel needs the Cloud: the link form carries the DÉMO badge, the references do not
    expect(html).toContain('data-testid="demo-badge"')
    expect(html).toContain('data-feature="youtube-research"')
    clean(html)
  })

  it('Chaînes et styles and Builder render their chrome; Builder shows « bêta » and no DÉMO badge', () => {
    const chaines = screen(ChainesScreen, 'chaines')
    expect(chaines).toContain('Chaînes et styles</h1>')
    clean(chaines)
    const builder = screen(BuilderScreen, 'builder')
    expect(builder).toContain('Builder (bêta)</h1>')
    expect(builder).toContain('data-testid="beta-badge"')
    expect(builder).toContain('>bêta<')
    expect(builder).toContain('Nouvelle session')
    expect(builder).not.toContain('data-testid="demo-badge"')
    clean(builder)
  })
})

describe('gauge component', () => {
  it('shows the note in big figures, a coloured arc by band and an accessible text', () => {
    const html = wrap(<ReproGauge score={34} />)
    expect(html).toContain('data-score="34"')
    expect(html).toContain('data-tone="warn"')
    expect(html).toContain('stroke-warn')
    expect(html).toContain('font-serif')
    expect(html).toContain('role="img"')
    expect(html).toContain('Note de reproductibilité : 34 sur 100, Partiel')
    expect(gaugeAria(85)).toBe('Note de reproductibilité : 85 sur 100, Reproductible')
    expect(wrap(<ReproGauge score={62} />)).toContain('data-tone="info"')
    expect(wrap(<ReproGauge score={85} />)).toContain('stroke-ok')
    expect(wrap(<ReproGauge score={12} />)).toContain('data-tone="err"')
  })

  it('clamps nonsense instead of drawing NaN', () => {
    for (const score of [Number.NaN, -5, 250]) clean(wrap(<ReproGauge score={score} />))
    expect(wrap(<ReproGauge score={250} />)).toContain('data-score="100"')
    expect(wrap(<ReproGauge score={Number.NaN} />)).toContain('data-score="0"')
  })
})

describe('with real data', () => {
  it('the gameplay analysis: gauge 34, band, question, cost, chat, exits; then 62 once answered', async () => {
    const core = memoryCore()
    try {
      const started = await core.api['analysis.start']({ referenceId: 'recits-manette' })
      if (started.kind !== 'started') throw new Error('not started')
      const picking = wrap(<AnalysisBody detail={started.analysis} reload={noop} onPipelines={noop} />)
      expect(picking).toContain('data-testid="example-picker"')
      expect(picking).toContain('Choisis les vidéos exemples')
      clean(picking)

      const done = await core.api['analysis.chooseExamples'](started.analysis.id, started.analysis.reference.proposedExamples)
      const html = wrap(<AnalysisBody detail={done} reload={noop} onPipelines={noop} />)
      expect(html).toContain('data-score="34"')
      expect(html).toContain('data-testid="invented-reference"')
      expect(html).toContain('Chaîne de référence inventée')
      expect(html).toContain('data-testid="demo-badge"')
      expect(html).toContain('Partiel')
      expect(html).toContain('data-testid="time-band"')
      expect(html).toContain('data-tone="red"')
      expect(html).toContain('As-tu des images de gameplay ?')
      expect(html).toContain('data-testid="answer-gameplay-yes"')
      expect(html).toContain('Coût par mode')
      expect(html).toContain('Qualité max')
      expect(html).toContain('Usage max')
      expect(html).toContain('L’Analyste')
      expect(html).toContain('Créer le pipeline')
      expect(html).toContain('Contacter le support')
      expect(html).toContain('data-testid="analysis-pipeline-preview"')
      clean(html)

      const yes = await core.api['analysis.answer'](done.id, 'gameplay', true)
      const after = wrap(<AnalysisBody detail={yes} reload={noop} onPipelines={noop} />)
      expect(after).toContain('data-score="62"')
      expect(after).toContain('aria-checked="true"')
      expect(after).toContain('avec tes images')
      clean(after)
    } finally {
      core.close()
    }
  })

  it('the documentary reference reaches 85 and the top 10 has no question', async () => {
    const core = memoryCore()
    try {
      const a = await core.api['analysis.start']({ referenceId: 'archives-silencieuses' })
      if (a.kind !== 'started') throw new Error('not started')
      const done = await core.api['analysis.chooseExamples'](a.analysis.id, a.analysis.reference.proposedExamples)
      const html = wrap(<AnalysisBody detail={done} reload={noop} onPipelines={noop} />)
      expect(html).toContain('data-score="85"')
      expect(html).toContain('Reproductible')
      clean(html)
      const top = await core.api['analysis.start']({ referenceId: 'top-dix-anime' })
      if (top.kind !== 'started') throw new Error('not started')
      const topDone = await core.api['analysis.chooseExamples'](top.analysis.id, top.analysis.reference.proposedExamples)
      clean(wrap(<AnalysisBody detail={topDone} reload={noop} onPipelines={noop} />))
    } finally {
      core.close()
    }
  })

  it('a pipeline of the library: graph, inspector, cost, versions, actions', async () => {
    const core = memoryCore()
    try {
      const row = await core.api['pipelines.createFromTemplate']('simple-video', 'Ma recette')
      const detail = await core.api['pipelines.get'](row.id)
      const html = wrap(<DetailBody detail={detail} onDeleted={noop} />)
      expect(html).toContain('Ma recette')
      expect(html).toContain('data-testid="pipeline-graph"')
      expect(html).toContain('data-testid="graph-node-voice"')
      expect(html).toContain('data-testid="graph-node-$inputs.topic"')
      expect(html).toContain('Exporter')
      expect(html).toContain('Renommer')
      expect(html).toContain('Supprimer')
      expect(html).toContain('Graphe')
      expect(html).toContain('Versions (1)')
      clean(html)

      const doc = parsePipelineDoc(detail.json)
      if (!doc) throw new Error('no doc')
      const catalog = await core.api['pipelines.catalog']()
      const cost = await core.api['pipelines.estimate'](detail.json)
      const inspector = wrap(<NodeInspector doc={doc} nodeId="voice" catalog={catalog} cost={cost} mode="qualite_max" onMode={noop} />)
      expect(inspector).toContain('voice.tts@1')
      expect(inspector).toContain('Point d’arrêt')
      expect(inspector).toContain('Revue')
      expect(inspector).toContain('script.text')
      expect(inspector).toContain('data-testid="node-cost"')
      clean(inspector)
      expect(wrap(<NodeInspector doc={doc} nodeId={null} catalog={catalog} cost={null} mode="usage_max" onMode={noop} />)).toContain('Choisis un nœud du graphe')
      clean(wrap(<NodeInspector doc={doc} nodeId="$inputs.topic" catalog={catalog} cost={null} mode="usage_max" onMode={noop} />))
      clean(wrap(<PipelineGraph json={detail.json} selected="script" />))
      expect(wrap(<PipelineGraph json="n’importe quoi" />)).toContain('aucun nœud à dessiner')
    } finally {
      core.close()
    }
  })

  it('a Builder session: chat, live preview, cost, save panel', async () => {
    const core = memoryCore()
    try {
      const session = await core.api['builder.create']({ from: 'template', templateId: 'simple-video' })
      const html = wrap(<SessionBody detail={session} reload={noop} onSaved={noop} />)
      expect(html).toContain('Conversation')
      expect(html).toContain('data-testid="builder-preview"')
      expect(html).toContain('Valide')
      expect(html).toContain('data-testid="graph-node-render"')
      expect(html).toContain('Enregistrer')
      expect(html).toContain('Nouveau pipeline')
      expect(html).not.toContain('data-testid="demo-badge"')
      clean(html)
    } finally {
      core.close()
    }
  })

  it('the style form shows every block of a real style draft, in French', async () => {
    const core = memoryCore()
    try {
      const a = await core.api['analysis.start']({ referenceId: 'archives-silencieuses' })
      if (a.kind !== 'started') throw new Error('not started')
      const done = await core.api['analysis.chooseExamples'](a.analysis.id, a.analysis.reference.proposedExamples)
      if (!done.styleDraft) throw new Error('no draft')
      const html = wrap(<StyleForm sheet={done.styleDraft} onChange={noop} />)
      for (const key of ['identity', 'voice', 'script', 'visuals', 'animation', 'captions', 'sound', 'pace', 'thumbnail', 'packaging', 'budget'] as const) {
        expect(html).toContain(t(`styles.block.${key}`))
      }
      expect(html).toContain(done.styleDraft.identity.niche)
      clean(html)
    } finally {
      core.close()
    }
  })
})

describe('diff view', () => {
  it('colours added and removed lines and says when nothing differs', () => {
    const html = wrap(<DiffView lines={lineDiff('a\nb\nc', 'a\nB\nc\nd')} />)
    expect(html).toContain('data-kind="add"')
    expect(html).toContain('data-kind="del"')
    expect(html).toContain('data-kind="same"')
    expect(html).toContain('+2 · −1')
    expect(wrap(<DiffView lines={lineDiff('x', 'x')} />)).toContain('Aucune différence.')
    clean(html)
  })
})
