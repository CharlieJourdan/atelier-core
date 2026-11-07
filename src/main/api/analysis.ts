// IPC handlers, module "analysis" (lot Z1): Analyser une chaîne, the pipeline library, channel styles, the Builder and
// support requests. Every argument is checked here or in the stores (the renderer is untrusted).
import type { ApiHandlers } from '../../shared/api'
import type { ANALYSIS_METHODS } from '../../shared/api/analysis'
import { AnalysisStore } from '../analysis/analyses'
import { BuilderStore } from '../analysis/builder'
import { catalogNodes, checkPipeline, costReport, TEMPLATES } from '../analysis/catalog'
import { saveDrawing } from '../analysis/drawing'
import { cleanText, isId, PipelineInvalidError, PipelineLibrary } from '../analysis/library'
import { ADJUST_TAG, analystSystem, builderSystem, extractBlock, parseAdjust } from '../analysis/prompts'
import { REFERENCES, findReference, referenceSummary } from '../analysis/references'
import { StyleStore } from '../analysis/styles'
import { SupportStore } from '../analysis/support'
import type { ApiContext } from './context'

type Methods = (typeof ANALYSIS_METHODS)[number]

const MAX_CHAT = 4000

function asSave<T>(fn: () => T): { ok: true; value: T } | { ok: false; problems: PipelineInvalidError['problems'] } {
  try {
    return { ok: true, value: fn() }
  } catch (e) {
    if (e instanceof PipelineInvalidError) return { ok: false, problems: e.problems }
    throw e
  }
}

export function analysisApi(ctx: ApiContext): Pick<ApiHandlers, Methods> {
  const analyses = new AnalysisStore(ctx.db)
  const library = new PipelineLibrary(ctx.db)
  const styles = new StyleStore(ctx.db)
  const builder = new BuilderStore(ctx.db)
  const support = new SupportStore(ctx.db)
  const changed = (...topics: ('analysis' | 'pipelines')[]): void => {
    for (const t of topics) ctx.notify(t)
  }
  const template = (id: unknown) => {
    const tpl = TEMPLATES.find((x) => x.id === id)
    if (!tpl) throw new Error('Modèle de pipeline inconnu.')
    return tpl.build()
  }

  return {
    'analysis.references': () => REFERENCES.map(referenceSummary),
    'analysis.list': () => analyses.list(),
    'analysis.get': async (id) => {
      await analyses.fillCost(id)
      return analyses.detail(id)
    },
    'analysis.start': (input) => {
      if (typeof input !== 'object' || input === null) throw new Error('Colle un lien ou choisis une chaîne de référence.')
      const referenceId = typeof input.referenceId === 'string' ? input.referenceId : ''
      const link = typeof input.link === 'string' ? input.link.trim().slice(0, 500) : ''
      if (referenceId) {
        if (!findReference(referenceId)) throw new Error('Chaîne de référence inconnue.')
        const id = analyses.start(referenceId, link)
        changed('analysis')
        return { kind: 'started' as const, analysis: analyses.detail(id) }
      }
      if (!link) throw new Error('Colle un lien ou choisis une chaîne de référence.')
      // reading a real channel needs YouTube Data + video analysis through Atelier Cloud (features youtube-research,
      // video-analysis: demo while the Cloud has no key). Nothing is read, nothing is spent.
      return { kind: 'unavailable' as const, link, references: REFERENCES.map(referenceSummary) }
    },
    'analysis.chooseExamples': async (id, videoIds) => {
      analyses.chooseExamples(id, videoIds)
      await analyses.fillCost(id)
      changed('analysis')
      return analyses.detail(id)
    },
    'analysis.answer': async (id, input, value) => {
      analyses.answer(id, input, value)
      await analyses.fillCost(id)
      changed('analysis')
      return analyses.detail(id)
    },
    'analysis.setMode': async (id, mode) => {
      analyses.setMode(id, mode)
      await analyses.fillCost(id)
      changed('analysis')
      return analyses.detail(id)
    },
    'analysis.chat': async (id, text) => {
      const body = cleanText(text, 'Message', MAX_CHAT)
      const before = analyses.detail(id)
      if (before.status !== 'done') throw new Error('Choisis d’abord une vidéo d’exemple : l’Analyste n’a encore rien analysé.')
      analyses.addMessage(id, 'user', body)
      changed('analysis')
      const history = before.messages.slice(-8).map((m) => `${m.author === 'user' ? 'Utilisateur' : 'Analyste'} : ${m.body}`)
      const prompt = [...history, `Utilisateur : ${body}`].join('\n\n')
      let reply: string
      try {
        reply = (await ctx.ask({ role: 'analyst', system: analystSystem(before), prompt })).text
      } catch (e) {
        changed('analysis')
        throw e
      }
      const { shown, block, count } = extractBlock(reply, ADJUST_TAG)
      const adjust = block !== null && count === 1 ? parseAdjust(block) : null
      const rejected = block !== null && adjust === null
      if (adjust) {
        analyses.applyAdjust(id, adjust)
        await analyses.fillCost(id)
      }
      analyses.addMessage(id, 'analyst', shown || '…', adjust)
      changed('analysis')
      return { analysis: analyses.detail(id), applied: adjust, adjustRejected: rejected }
    },
    'analysis.createPipeline': (id, channelId) => {
      const { ref, pipelineJson, style } = analyses.forCreation(id)
      if (!isId(channelId)) throw new Error('Choisis une de tes chaînes.')
      const channel = ctx.workflow.channels.get(channelId)
      const pipeline = library.create({
        name: `${ref.format} — ${channel.name}`,
        description: `Créé depuis l’analyse de « ${ref.name} ».`,
        origin: 'analysis',
        channelId,
        json: pipelineJson,
        note: 'Version 1, depuis l’analyse'
      })
      const row = library.setDefault(pipeline.id, channelId)
      const styleVersion = styles.save(
        channelId,
        { ...style, identity: { ...style.identity, name: channel.name } },
        `Depuis l’analyse de « ${ref.name} »`
      )
      analyses.setCreatedPipeline(id, row.id)
      changed('analysis', 'pipelines')
      ctx.notify('channels')
      return { pipeline: row, styleVersion }
    },
    'analysis.delete': (id) => {
      analyses.delete(id)
      changed('analysis')
    },

    'pipelines.templates': () => TEMPLATES.map((t) => t.build()),
    'pipelines.catalog': () => catalogNodes(),
    'pipelines.list': () => library.list(),
    'pipelines.get': (id) => library.get(id),
    'pipelines.version': (id, number) => library.versionJson(id, number),
    'pipelines.diff': (id, from, to) => library.diff(id, from, to),
    'pipelines.check': (json) => {
      const c = checkPipeline(json)
      return c.ok ? { ok: true, json: c.json, name: c.name } : { ok: false, problems: c.problems }
    },
    'pipelines.estimate': async (json) => {
      const c = checkPipeline(json)
      if (!c.ok || !c.plan) throw new Error('Ce pipeline n’est pas valide : impossible de l’estimer.')
      return costReport(c.plan)
    },
    'pipelines.import': (json, opts) => {
      const c = checkPipeline(json)
      if (!c.ok) return { ok: false, problems: c.problems }
      const name = typeof opts?.name === 'string' && opts.name.trim() ? opts.name : c.name
      const res = asSave(() => library.create({ name, origin: 'import', channelId: opts?.channelId ?? null, json: c.json, note: 'Importé' }))
      if (!res.ok) return res
      changed('pipelines')
      return { ok: true, pipeline: res.value }
    },
    'pipelines.createFromTemplate': (templateId, name) => {
      const tpl = template(templateId)
      const row = library.create({ name, description: tpl.description, origin: 'own', json: tpl.json, note: `Depuis le modèle « ${tpl.name} »` })
      changed('pipelines')
      return row
    },
    'pipelines.saveVersion': (id, json, note) => {
      const res = asSave(() => library.addVersion(id, json, note))
      if (!res.ok) return res
      changed('pipelines')
      return { ok: true, pipeline: res.value }
    },
    'pipelines.setDefault': (id, channelId) => {
      const row = library.setDefault(id, channelId)
      changed('pipelines')
      return row
    },
    'pipelines.rename': (id, name, description) => {
      const row = library.rename(id, name, description)
      changed('pipelines')
      return row
    },
    'pipelines.delete': (id) => {
      library.delete(id)
      changed('pipelines')
    },
    'pipelines.saveDrawing': (drawing, opts) => {
      const res = saveDrawing(library, drawing, opts ?? {})
      changed('pipelines')
      return res
    },
    'pipelines.export': (id, version) => {
      const row = library.row(id)
      const n = version === undefined ? row.latestVersion : version
      const json = library.versionJson(id, n)
      const base = row.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'pipeline'
      return { fileName: `${base}-v${n}.atelier-pipeline.json`, json }
    },

    'styles.get': (channelId) => styles.detail(channelId, isId(channelId) ? library.defaultFor(channelId) : null),
    'styles.version': (channelId, version) => styles.version(channelId, version),
    'styles.save': (channelId, sheet, note) => {
      styles.save(channelId, sheet, note)
      ctx.notify('channels')
      changed('pipelines')
      return styles.detail(channelId, library.defaultFor(channelId))
    },
    'styles.diff': (channelId, from, to) => styles.diff(channelId, from, to),

    'builder.list': () => builder.list(),
    'builder.create': async (start) => {
      if (typeof start !== 'object' || start === null) throw new Error('Point de départ du Builder inconnu.')
      let id: number
      if (start.from === 'template') {
        const tpl = template(start.templateId)
        id = await builder.create({ title: tpl.name, draftJson: tpl.json })
      } else if (start.from === 'pipeline') {
        const p = library.get(start.pipelineId)
        id = await builder.create({ title: p.name, draftJson: p.json, pipelineId: p.id })
      } else if (start.from === 'analysis') {
        const a = analyses.detail(start.analysisId)
        if (!a.proposedPipelineJson) throw new Error('Choisis d’abord une vidéo d’exemple : l’analyse n’a pas encore de pipeline.')
        id = await builder.create({ title: `${a.reference.format} (Builder)`, draftJson: a.proposedPipelineJson, analysisId: a.id })
      } else {
        throw new Error('Point de départ du Builder inconnu.')
      }
      changed('pipelines')
      return builder.detail(id)
    },
    'builder.get': (id) => builder.detail(id),
    'builder.send': async (id, text) => {
      const body = cleanText(text, 'Message', MAX_CHAT)
      const draft = builder.draft(id)
      builder.addMessage(id, 'user', body)
      changed('pipelines')
      const history = builder
        .detail(id)
        .messages.slice(-9, -1)
        .map((m) => `${m.author === 'user' ? 'Utilisateur' : 'Builder'} : ${m.body}`)
      const prompt = [...history, `Utilisateur : ${body}`].join('\n\n')
      const reply = (await ctx.ask({ role: 'builder', system: builderSystem(draft), prompt })).text
      const res = await builder.applyReply(id, reply)
      builder.addMessage(id, 'builder', res.shown || '…', res.outcome, res.problems)
      changed('pipelines')
      return builder.detail(id)
    },
    'builder.save': (id, target, note) => {
      const s = builder.detail(id)
      const check = checkPipeline(s.draftJson)
      if (!check.ok) throw new Error('Le brouillon n’est pas valide : il ne peut pas être enregistré.')
      if (typeof target !== 'object' || target === null) throw new Error('Destination inconnue.')
      let row
      if (target.target === 'version') {
        row = library.addVersion(target.pipelineId, check.json, note)
      } else if (target.target === 'new') {
        row = library.create({ name: target.name, origin: 'builder', channelId: target.channelId ?? null, json: check.json, note })
      } else {
        throw new Error('Destination inconnue.')
      }
      builder.setPipeline(id, row.id)
      changed('pipelines')
      return row
    },
    'builder.delete': (id) => {
      builder.delete(id)
      changed('pipelines')
    },

    'support.create': (input) => {
      const row = support.create(input)
      changed('analysis')
      return row
    },
    'support.list': () => support.list(),
    'support.close': (id) => {
      const row = support.close(id)
      changed('analysis')
      return row
    }
  }
}

