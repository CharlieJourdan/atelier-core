// Lot Z1 (analysis): IPC handlers of Analyser une chaîne, the pipeline library, styles, the Builder and support.
import { describe, expect, it } from 'vitest'
import { simpleVideoPipeline } from '../../src/engine/pipelines/simple-video'
import { FakeProvider } from '../../src/main/llm/fake'
import { ANALYSIS_METHODS } from '../../src/shared/api'
import type { StyleSheet } from '../../src/shared/analysis'
import { memoryCore } from './helpers'

const doc = (over: Record<string, unknown> = {}) => JSON.stringify({ ...simpleVideoPipeline(8), ...over }, null, 2)

describe('analysis IPC', () => {
  it('lists its IPC methods (one comment per method)', () => {
    expect([...ANALYSIS_METHODS]).toEqual([
      'analysis.references', // the three invented reference channels
      'analysis.list', // analyses, newest first
      'analysis.get', // one analysis with its profile, gauge, cost and chat
      'analysis.start', // from a reference id; a real link answers "unavailable" (Cloud feature in demo)
      'analysis.chooseExamples', // pick example videos: the analysts complete
      'analysis.answer', // yes / no / clear for an input question, gauge recomputed
      'analysis.setMode', // budget mode of the analysis, gauge recomputed
      'analysis.chat', // the Analyste (ctx.ask) and its validated atelier-adjust block
      'analysis.createPipeline', // library pipeline (origin analysis) + channel default + style v1
      'analysis.delete', // deletes an analysis and its chat
      'pipelines.templates', // engine templates (Vidéo simple)
      'pipelines.catalog', // node types of the engine registry
      'pipelines.list', // the library
      'pipelines.get', // one pipeline, its versions and latest JSON
      'pipelines.version', // the JSON of one version
      'pipelines.diff', // line diff between two versions
      'pipelines.check', // schema + graph validation, problems by code and path
      'pipelines.estimate', // credits in both budget modes
      'pipelines.import', // a pasted or picked .atelier-pipeline.json
      'pipelines.createFromTemplate', // an own pipeline from a template
      'pipelines.saveVersion', // next version, validated first
      'pipelines.setDefault', // default pipeline of a channel
      'pipelines.rename', // name and description
      'pipelines.delete', // deletes a pipeline and its versions
      'pipelines.export', // file name and JSON for a download
      'pipelines.saveDrawing', // the editor's drawing → an executable library pipeline (new or next version)
      'styles.get', // a channel's style sheet, versions and default pipeline
      'styles.version', // one version of the style
      'styles.save', // next version of the style, validated
      'styles.diff', // line diff between two style versions
      'builder.list', // Builder sessions
      'builder.create', // a session from a template, a pipeline or an analysis
      'builder.get', // a session with its chat, draft, problems and cost
      'builder.send', // one Builder turn (ctx.ask), the block validated before it replaces the draft
      'builder.save', // saves the valid draft as a new pipeline or a new version
      'builder.delete', // deletes a session
      'support.create', // « Contacter le support » (no e-mail: demo)
      'support.list', // requests, read by Admin plateforme
      'support.close' // closes a request
    ])
  })

  it('a real link is answered "unavailable" with the reference channels; a reference starts an analysis', async () => {
    const core = memoryCore()
    try {
      const refs = await core.api['analysis.references']()
      expect(refs.map((r) => r.name)).toEqual(['Archives Silencieuses', 'Récits Manette', 'Top Dix Animé'])
      const u = await core.api['analysis.start']({ link: 'https://www.youtube.com/@uneChaine' })
      expect(u.kind).toBe('unavailable')
      if (u.kind === 'unavailable') expect(u.references).toHaveLength(3)
      expect(await core.api['analysis.list']()).toEqual([])
      const s = await core.api['analysis.start']({ referenceId: 'recits-manette' })
      if (s.kind !== 'started') throw new Error('not started')
      expect(s.analysis.status).toBe('choose_examples')
      expect(s.analysis.steps.map((x) => x.status)).toEqual(['done', 'waiting', 'pending', 'pending', 'pending'])
      expect(s.analysis.gauge).toBeNull()
      await expect(async () => core.api['analysis.start']({ referenceId: 'inconnue' })).rejects.toThrow('inconnue')
      await expect(async () => core.api['analysis.start']({})).rejects.toThrow('Colle un lien')
    } finally {
      core.close()
    }
  })

  it('gameplay question: 34 → 62, stored, with cost per minute in both modes', async () => {
    const core = memoryCore()
    try {
      const s = await core.api['analysis.start']({ referenceId: 'recits-manette' })
      if (s.kind !== 'started') throw new Error('not started')
      const id = s.analysis.id
      await expect(async () => core.api['analysis.chooseExamples'](id, [])).rejects.toThrow('au moins une')
      await expect(async () => core.api['analysis.chooseExamples'](id, ['as-1'])).rejects.toThrow('inconnue')
      const a = await core.api['analysis.chooseExamples'](id, ['rm-4'])
      expect(a.status).toBe('done')
      expect(a.gauge?.score).toBe(34)
      expect(a.questions).toEqual(['gameplay'])
      expect(a.examples[0]?.segments.length).toBeGreaterThan(3)
      expect(a.cost?.modes.usage_max.credits).toBeGreaterThan(0)
      expect(a.cost?.modes.qualite_max.perMinute).toBeGreaterThan(0)
      expect(a.styleDraft?.$schema).toBe('atelier.style/1')
      const yes = await core.api['analysis.answer'](id, 'gameplay', true)
      expect(yes.gauge?.score).toBe(62)
      expect(JSON.parse(yes.proposedPipelineJson ?? '{}').inputs.map((i: { id: string }) => i.id)).toEqual(['topic', 'gameplay'])
      expect((await core.api['analysis.get'](id)).gauge?.score).toBe(62)
      await expect(async () => core.api['analysis.answer'](id, 'camera', true)).rejects.toThrow('Question inconnue')
      await expect(async () => core.api['analysis.answer'](id, 'gameplay', 'oui' as unknown as boolean)).rejects.toThrow('Réponse attendue')
      const qm = await core.api['analysis.setMode'](id, 'qualite_max')
      expect(qm.gauge?.score).toBe(67)
      await expect(async () => core.api['analysis.setMode'](id, 'turbo' as never)).rejects.toThrow('Mode')
      expect((await core.api['analysis.answer'](id, 'gameplay', null)).answers).toEqual({})
    } finally {
      core.close()
    }
  })

  it('Analyste chat: a valid adjust block is applied and stripped; an invalid one is refused', async () => {
    const provider = new FakeProvider([
      'D’accord, sans gameplay je le remplace.\n\n```atelier-adjust\n{"answers":{"gameplay":false},"maxCreditsPerVideo":150,"script":{"length":"court","tone":"drôle"}}\n```',
      'Je change tout.\n```atelier-adjust\n{"answers":{"gameplay":"peut-être"}}\n```',
      'Rien à changer.'
    ])
    const core = memoryCore({ chatProvider: () => provider })
    try {
      const s = await core.api['analysis.start']({ referenceId: 'recits-manette' })
      if (s.kind !== 'started') throw new Error('not started')
      const id = s.analysis.id
      await expect(async () => core.api['analysis.chat'](id, 'salut')).rejects.toThrow('vidéo d’exemple')
      await core.api['analysis.chooseExamples'](id, ['rm-4'])
      const r1 = await core.api['analysis.chat'](id, 'Je n’ai pas de gameplay, 150 crédits max, plus court et drôle')
      expect(r1.applied).toEqual({ answers: { gameplay: false }, maxCreditsPerVideo: 150, script: { length: 'court', tone: 'drôle' } })
      expect(r1.analysis.gauge?.score).toBe(47)
      expect(r1.analysis.adjust).toMatchObject({ maxCreditsPerVideo: 150, scriptLength: 'court', scriptTone: 'drôle' })
      const pipe = JSON.parse(r1.analysis.proposedPipelineJson ?? '{}')
      expect(pipe.budget.capCredits).toBe(150)
      expect(pipe.format.minutes.default).toBe(6)
      expect(r1.analysis.styleDraft?.script.tone).toBe('drôle')
      const last = r1.analysis.messages.at(-1)
      expect(last?.body).toBe('D’accord, sans gameplay je le remplace.')
      expect(last?.body).not.toContain('atelier-adjust')
      expect(provider.calls[0]?.system).toContain('Récits Manette')
      expect(provider.calls[0]?.system).toContain('atelier-adjust')
      const r2 = await core.api['analysis.chat'](id, 'et alors ?')
      expect(r2.applied).toBeNull()
      expect(r2.adjustRejected).toBe(true)
      expect(r2.analysis.gauge?.score).toBe(47)
      const r3 = await core.api['analysis.chat'](id, 'merci')
      expect(r3.adjustRejected).toBe(false)
      expect(r3.analysis.messages).toHaveLength(6)
      await expect(async () => core.api['analysis.chat'](id, '   ')).rejects.toThrow('obligatoire')
    } finally {
      core.close()
    }
  })

  it('« Créer le pipeline »: library row (origin analysis), channel default, style v1', async () => {
    const core = memoryCore()
    try {
      const ch = await core.api['channels.create']({ name: 'Mes Histoires' })
      const s = await core.api['analysis.start']({ referenceId: 'recits-manette' })
      if (s.kind !== 'started') throw new Error('not started')
      await expect(async () => core.api['analysis.createPipeline'](s.analysis.id, ch.id)).rejects.toThrow('vidéo d’exemple')
      await core.api['analysis.chooseExamples'](s.analysis.id, ['rm-4'])
      await core.api['analysis.answer'](s.analysis.id, 'gameplay', true)
      const res = await core.api['analysis.createPipeline'](s.analysis.id, ch.id)
      expect(res.pipeline).toMatchObject({ origin: 'analysis', channelId: ch.id, isDefault: true, latestVersion: 1 })
      expect(res.styleVersion).toBe(1)
      const style = await core.api['styles.get'](ch.id)
      expect(style.current?.identity.name).toBe('Mes Histoires')
      expect(style.defaultPipelineId).toBe(res.pipeline.id)
      expect((await core.api['analysis.get'](s.analysis.id)).createdPipelineId).toBe(res.pipeline.id)
      await expect(async () => core.api['analysis.createPipeline'](s.analysis.id, 999)).rejects.toThrow()
    } finally {
      core.close()
    }
  })
})

describe('pipelines IPC', () => {
  it('templates, own pipeline, versions, diff, export, default, estimate', async () => {
    const core = memoryCore()
    try {
      const tpls = await core.api['pipelines.templates']()
      expect(tpls.map((t) => t.name)).toContain('Vidéo simple')
      expect((await core.api['pipelines.catalog']()).map((n) => n.type)).toContain('voice.tts@1')
      const p = await core.api['pipelines.createFromTemplate']('simple-video', 'Mon pipeline')
      expect(p).toMatchObject({ origin: 'own', latestVersion: 1 })
      await expect(async () => core.api['pipelines.createFromTemplate']('nope', 'x')).rejects.toThrow('Modèle')
      const bad = await core.api['pipelines.saveVersion'](p.id, doc({ nodes: [{ id: 'x', type: 'nope.node@1' }] }), '')
      expect(bad).toEqual({ ok: false, problems: [{ code: 'unknown_node_type', path: 'nodes[0].type' }] })
      await expect(async () => core.api['pipelines.saveVersion'](p.id, doc(), '')).rejects.toThrow('Rien n’a changé')
      const ok = await core.api['pipelines.saveVersion'](p.id, doc({ name: 'Mon pipeline v2' }), 'nom')
      expect(ok.ok && ok.pipeline.latestVersion).toBe(2)
      const diff = await core.api['pipelines.diff'](p.id, 1, 2)
      expect(diff.filter((l) => l.kind === 'del').map((l) => l.text.trim())).toEqual(['"name": "Vidéo simple narrée",'])
      expect(diff.filter((l) => l.kind === 'add').map((l) => l.text.trim())).toEqual(['"name": "Mon pipeline v2",'])
      const detail = await core.api['pipelines.get'](p.id)
      expect(detail.versions.map((v) => v.number)).toEqual([2, 1])
      const exp = await core.api['pipelines.export'](p.id)
      expect(exp.fileName).toBe('mon-pipeline-v2.atelier-pipeline.json')
      expect(JSON.parse(exp.json).name).toBe('Mon pipeline v2')
      const ch = await core.api['channels.create']({ name: 'Chaîne' })
      expect((await core.api['pipelines.setDefault'](p.id, ch.id)).isDefault).toBe(true)
      const est = await core.api['pipelines.estimate'](exp.json)
      expect(est.minutes).toBe(8)
      expect(est.modes.usage_max.nodes.find((n) => n.nodeId === 'voice')?.credits).toBeGreaterThan(0)
      expect(est.modes.usage_max.nodes.find((n) => n.nodeId === 'script')?.credits).toBe(0)
      await expect(async () => core.api['pipelines.estimate']('{')).rejects.toThrow('pas valide')
      expect((await core.api['pipelines.rename'](p.id, 'Renommé', 'desc')).name).toBe('Renommé')
      await core.api['pipelines.delete'](p.id)
      expect(await core.api['pipelines.list']()).toEqual([])
      await expect(async () => core.api['pipelines.get'](p.id)).rejects.toThrow('inconnu')
    } finally {
      core.close()
    }
  })

  it('import: JSON errors, schema errors with their path, then a valid file', async () => {
    const core = memoryCore()
    try {
      expect(await core.api['pipelines.import']('{ pas du json')).toEqual({ ok: false, problems: [{ code: 'json', path: '' }] })
      expect(await core.api['pipelines.import']('')).toEqual({ ok: false, problems: [{ code: 'empty', path: '' }] })
      const schema = await core.api['pipelines.import'](JSON.stringify({ $schema: 'atelier.pipeline/1' }))
      expect(schema.ok).toBe(false)
      if (!schema.ok) expect(schema.problems.every((p) => p.code === 'schema')).toBe(true)
      const cyc = simpleVideoPipeline(8)
      cyc.nodes[1] = { ...cyc.nodes[1], in: { brief: 'package.package' } } as (typeof cyc.nodes)[number]
      const cycle = await core.api['pipelines.import'](JSON.stringify(cyc))
      expect(cycle.ok).toBe(false)
      const ok = await core.api['pipelines.import'](doc(), { name: 'Importé' })
      expect(ok.ok && ok.pipeline).toMatchObject({ name: 'Importé', origin: 'import' })
      expect((await core.api['pipelines.check'](doc())).ok).toBe(true)
    } finally {
      core.close()
    }
  })
})

describe('styles IPC', () => {
  it('saves versions, refuses invalid sheets, diffs two versions', async () => {
    const core = memoryCore({ loadExample: true })
    try {
      const { channelIds } = await core.api['example.status']()
      const id = channelIds[0] as number
      const s = await core.api['styles.get'](id)
      expect(s.versions.map((v) => v.version)).toEqual([2, 1])
      const sheet = s.current as StyleSheet
      const next = await core.api['styles.save'](id, { ...sheet, pace: { ...sheet.pace, cutsPerMinute: 14 } }, 'plus rapide')
      expect(next.currentVersion).toBe(3)
      const d = await core.api['styles.diff'](id, 2, 3)
      expect(d.filter((l) => l.kind === 'add').map((l) => l.text.trim())).toEqual(['"cutsPerMinute": 14,'])
      await expect(async () => core.api['styles.save'](id, { ...sheet, voice: { ...sheet.voice, speed: 9 } }, '')).rejects.toThrow('Style invalide')
      await expect(async () => core.api['styles.save'](9999, sheet, '')).rejects.toThrow('Chaîne inconnue')
      expect((await core.api['styles.version'](id, 1)).identity.name).toBe('Les Grandes Énigmes')
    } finally {
      core.close()
    }
  })
})

describe('builder IPC', () => {
  it('a valid block replaces the draft, an invalid one keeps it; only a valid draft is saved', async () => {
    const v2 = doc({ name: 'Version du Builder' })
    const provider = new FakeProvider([
      'Je renomme le pipeline.\n\n```atelier-pipeline\n' + v2 + '\n```',
      'J’ajoute un nœud.\n```atelier-pipeline\n' + doc({ nodes: [{ id: 'x', type: 'magic.node@1' }] }) + '\n```'
    ])
    const core = memoryCore({ chatProvider: () => provider })
    try {
      const s = await core.api['builder.create']({ from: 'template', templateId: 'simple-video' })
      expect(s.cost?.modes.usage_max.credits).toBeGreaterThan(0)
      const t1 = await core.api['builder.send'](s.id, 'Renomme-le')
      expect(JSON.parse(t1.draftJson).name).toBe('Version du Builder')
      expect(t1.previousDraftJson).not.toBeNull()
      expect(t1.messages.at(-1)).toMatchObject({ author: 'builder', body: 'Je renomme le pipeline.', outcome: 'valid' })
      expect(provider.calls[0]?.system).toContain('voice.tts@1')
      expect(provider.calls[0]?.system).toContain('atelier-pipeline')
      const t2 = await core.api['builder.send'](s.id, 'Ajoute de la magie')
      expect(JSON.parse(t2.draftJson).name).toBe('Version du Builder')
      expect(t2.messages.at(-1)?.outcome).toBe('invalid')
      expect(t2.problems).toEqual([{ code: 'unknown_node_type', path: 'nodes[0].type' }])
      const saved = await core.api['builder.save'](s.id, { target: 'new', name: 'Depuis le Builder' }, 'v1')
      expect(saved).toMatchObject({ origin: 'builder', latestVersion: 1 })
      await expect(async () => core.api['builder.save'](s.id, { target: 'version', pipelineId: saved.id }, '')).rejects.toThrow('Rien n’a changé')
      expect((await core.api['builder.list']())[0]?.pipelineId).toBe(saved.id)
      await core.api['builder.delete'](s.id)
      await expect(async () => core.api['builder.get'](s.id)).rejects.toThrow('inconnue')
    } finally {
      core.close()
    }
  })
})

describe('support IPC', () => {
  it('creates, lists and closes requests; checks its fields', async () => {
    const core = memoryCore()
    try {
      await expect(async () => core.api['support.create']({ what: '', links: '', budget: '', contact: 'moi', attachAnalysis: false, analysisId: null })).rejects.toThrow('obligatoire')
      await expect(async () => core.api['support.create']({ what: 'x', links: '', budget: '', contact: 'moi', attachAnalysis: true, analysisId: 42 })).rejects.toThrow('introuvable')
      const r = await core.api['support.create']({ what: 'Un format spécial', links: '', budget: '100', contact: 'moi@exemple.fr', attachAnalysis: false, analysisId: 7 })
      expect(r).toMatchObject({ status: 'open', analysisId: null, attachAnalysis: false })
      expect(await core.api['support.list']()).toHaveLength(1)
      expect((await core.api['support.close'](r.id)).status).toBe('closed')
      await expect(async () => core.api['support.close'](r.id)).rejects.toThrow('déjà close')
    } finally {
      core.close()
    }
  })
})

describe('example workspace (analysis)', () => {
  it('seeds 3 analyses, « Documentaire 8 min » in 2 versions as default, styles and a support request; clears them', async () => {
    const core = memoryCore()
    try {
      const own = await core.api['channels.create']({ name: 'Ma chaîne' })
      await core.api['styles.save'](own.id, exampleStyle(), 'à moi')
      await core.api['example.load']()
      const list = await core.api['analysis.list']()
      expect(list.map((a) => [a.referenceId, a.score, a.example])).toEqual([
        ['top-dix-anime', 77, true],
        ['recits-manette', 34, true],
        ['archives-silencieuses', 85, true]
      ])
      const pipes = await core.api['pipelines.list']()
      expect(pipes).toHaveLength(1)
      expect(pipes[0]).toMatchObject({ name: 'Documentaire 8 min', latestVersion: 2, isDefault: true, example: true, channelName: 'Les Grandes Énigmes' })
      expect((await core.api['pipelines.diff'](pipes[0]?.id as number, 1, 2)).some((l) => l.kind === 'add')).toBe(true)
      expect(await core.api['support.list']()).toHaveLength(1)
      const docAnalysis = await core.api['analysis.get'](list[2]?.id as number)
      expect(docAnalysis.cost?.minutes).toBe(8)
      await core.api['example.delete']()
      expect(await core.api['analysis.list']()).toEqual([])
      expect(await core.api['pipelines.list']()).toEqual([])
      expect(await core.api['support.list']()).toEqual([])
      expect((await core.api['styles.get'](own.id)).versions).toHaveLength(1)
    } finally {
      core.close()
    }
  })
})

function exampleStyle(): StyleSheet {
  return {
    $schema: 'atelier.style/1',
    identity: { name: 'Ma chaîne', niche: 'n', language: 'fr', audience: 'a' },
    voice: { source: 'platform', voiceId: 'demo-claire', speed: 1, stability: 0.5 },
    script: { structure: [], hook: '', tone: '', wpm: 150, lengthMin: 8, forbidden: [], skills: ['hook'] },
    visuals: { mix: { stock: 1, ai_image: 0, ai_video: 0, animation: 0, footage: 0, avatar: 0 }, palette: [], fonts: [], grade: '' },
    animation: { kit: '', settings: '' },
    captions: { preset: 'highlight', position: 'bottom', wordsPerLine: 6, highlight: true },
    sound: { mood: '', volume: 0.3, duckDb: 10 },
    pace: { cutsPerMinute: 10, minShotS: 2, maxShotS: 6 },
    thumbnail: { layout: '', textRules: '', colors: [], face: false },
    packaging: { titleRules: '', descriptionTemplate: '' },
    budget: { mode: 'usage_max', capCredits: null }
  }
}
