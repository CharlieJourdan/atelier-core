// Example workspace rows of the "analysis" area (lot Z1). `seed` inserts rows marked example = 1, `clear` deletes them.
// One finished analysis per reference channel (the gameplay one still waiting for its question), the own pipeline
// « Documentaire 8 min » in two versions as the documentary channel's default, both example channels' style sheets and
// one support request. Nothing calls a model and nothing is spent.
import { simpleVideoPipeline } from '../../engine/pipelines/simple-video'
import { AnalysisStore } from '../analysis/analyses'
import { pretty } from '../analysis/catalog'
import { PipelineLibrary } from '../analysis/library'
import { findReference } from '../analysis/references'
import { StyleStore } from '../analysis/styles'
import { SupportStore } from '../analysis/support'
import type { Db } from '../db'
import type { ExampleArea } from './types'

function documentaryV1(): ReturnType<typeof simpleVideoPipeline> {
  const p = simpleVideoPipeline(8)
  return { ...p, id: 'documentaire-8-min', name: 'Documentaire 8 min' }
}

function documentaryV2(): ReturnType<typeof simpleVideoPipeline> {
  const p = documentaryV1()
  return {
    ...p,
    budget: { default: 'usage_max', capCredits: 300 },
    nodes: p.nodes.map((n) => {
      if (n.id === 'director') return { ...n, params: { ...(n.params ?? {}), cpm: 11, mix: { stock: 0.55, image: 0.45 } } }
      if (n.id === 'script') return { ...n, params: { ...(n.params ?? {}), wpm: 145 } }
      return n
    })
  }
}

function seedAnalyses(db: Db): number {
  const store = new AnalysisStore(db)
  const doc = store.start('archives-silencieuses', '', true)
  store.chooseExamples(doc, ['as-3', 'as-7'])
  store.addMessage(doc, 'user', 'Je préfère des vidéos de 8 minutes, pas plus.')
  store.addMessage(doc, 'analyst', 'C’est noté : la durée visée passe à 8 minutes. Le format reste le même, la jauge ne bouge pas.', { minutes: 8 })
  store.applyAdjust(doc, { minutes: 8 })
  const stories = store.start('recits-manette', '', true)
  store.chooseExamples(stories, ['rm-4'])
  const top = store.start('top-dix-anime', '', true)
  store.chooseExamples(top, ['td-2', 'td-8'])
  return doc
}

function seedStyles(db: Db, channels: { documentary: number; top10: number }): void {
  const styles = new StyleStore(db)
  const doc = findReference('archives-silencieuses')
  const top = findReference('top-dix-anime')
  if (!doc || !top) return
  const docStyle = { ...doc.styleDraft, identity: { ...doc.styleDraft.identity, name: 'Les Grandes Énigmes', niche: 'Histoire et mystères' } }
  styles.save(channels.documentary, docStyle, 'Depuis l’analyse d’Archives Silencieuses', true)
  styles.save(
    channels.documentary,
    { ...docStyle, voice: { ...docStyle.voice, speed: 0.95 }, captions: { ...docStyle.captions, wordsPerLine: 5 }, budget: { mode: 'usage_max', capCredits: 300 } },
    'Voix un peu plus lente, plafond 300 crédits',
    true
  )
  styles.save(channels.top10, { ...top.styleDraft, identity: { ...top.styleDraft.identity, name: 'Top Savoirs' } }, 'Depuis l’analyse de Top Dix Animé', true)
}

export const analysisExample: ExampleArea = {
  name: 'analysis',
  seed: (db, seed) => {
    const docAnalysis = seedAnalyses(db)
    const library = new PipelineLibrary(db)
    const p = library.create({
      name: 'Documentaire 8 min',
      description: 'Documentaire raconté de 8 minutes, voix de la plateforme, images de banque et images IA.',
      origin: 'own',
      channelId: seed.channels.documentary,
      json: pretty(documentaryV1()),
      note: 'Depuis le modèle « Vidéo simple »',
      example: true
    })
    library.addVersion(p.id, pretty(documentaryV2()), 'Rythme 11 coupes par minute, plafond 300 crédits')
    library.setDefault(p.id, seed.channels.documentary)
    seedStyles(db, seed.channels)
    new SupportStore(db).create(
      {
        what: 'Je voudrais refaire des tutoriels de cuisine filmés en vue de dessus, avec mes mains à l’écran.',
        links: 'Un lien vers une de mes vidéos de test',
        budget: '200 crédits par vidéo',
        contact: 'Par la messagerie d’Atelier',
        attachAnalysis: true,
        analysisId: docAnalysis
      },
      true
    )
  },
  clear: (db) => {
    db.prepare('DELETE FROM support_requests WHERE example = 1').run()
    db.prepare('DELETE FROM builder_sessions WHERE example = 1').run()
    db.prepare('DELETE FROM library_pipelines WHERE example = 1').run()
    db.prepare('DELETE FROM channel_style_sheets WHERE example = 1').run()
    db.prepare('DELETE FROM analysis_runs WHERE example = 1').run()
  }
}
