// Demo fixtures, lab: the pipeline library of the analysis area (`atelier.pipeline/1` documents: templates, the team's
// pipelines, versions, the default per channel), the channels' styles (`atelier.style/1`, versioned) and the Builder (a
// conversation that edits a draft pipeline). The template is the engine's own simple video (pure data, loaded through
// Vite's glob so the type check does not walk the engine).
import type {
  BuilderDetail,
  BuilderSummary,
  CatalogNode,
  ChannelStyleDetail,
  LibraryPipelineDetail,
  LibraryPipelineRow,
  PipelineCostReport,
  PipelineOrigin,
  PipelineProblem,
  StyleSheet,
  TemplateInfo
} from '../../../shared/analysis'
import type { BuilderStart } from '../../../shared/api/analysis'
import { lineDiff } from '../../../shared/line-diff'
import { changed, wait, type DemoHandlers } from './bridge'
import { DEMO_CHANNELS, ago, channelName, nextId } from './world'

interface PipelineNode {
  id: string
  type: string
  in?: Record<string, string>
  params?: Record<string, unknown>
  gate?: string
}
interface PipelineJson {
  $schema: string
  id: string
  name: string
  format: { minutes: { default: number } }
  nodes: PipelineNode[]
  [k: string]: unknown
}

const tpl = import.meta.glob<(minutes?: number) => PipelineJson>('../../../engine/pipelines/simple-video.ts', { eager: true, import: 'simpleVideoPipeline' })
const simpleVideo = Object.values(tpl)[0] ?? ((): PipelineJson => ({ $schema: 'atelier.pipeline/1', id: 'simple-video', name: 'Vidéo simple narrée', format: { minutes: { default: 8 } }, nodes: [] }))

export const pretty = (doc: unknown): string => JSON.stringify(doc, null, 2)

/** A pipeline document for a fictional channel, from the template. */
export function pipelineJson(name: string, minutes: number, tweak?: (p: PipelineJson) => void): string {
  const p = simpleVideo(minutes)
  p.name = name
  p.id = name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'pipeline'
  tweak?.(p)
  return pretty(p)
}

const TEMPLATES: TemplateInfo[] = [{ id: 'simple-video', name: 'Vidéo simple', description: 'Vidéo simple narrée', json: pipelineJson('Vidéo simple narrée', 8) }]

// ------------------------------------------------------------------------------------------------ the library

interface Pipe {
  row: LibraryPipelineRow
  versions: { number: number; note: string; createdAt: string; json: string }[]
}

const library: Pipe[] = []

export function addLibraryPipeline(name: string, json: string, origin: PipelineOrigin, channelId: number | null, note: string, description = ''): LibraryPipelineRow {
  const now = new Date().toISOString()
  const row: LibraryPipelineRow = { id: nextId(), name, description, origin, channelId, channelName: channelId === null ? null : channelName(channelId), isDefault: false, latestVersion: 1, example: false, updatedAt: now }
  library.unshift({ row, versions: [{ number: 1, note, createdAt: now, json }] })
  changed('pipelines')
  return { ...row }
}

function seedPipe(name: string, channelId: number, origin: PipelineOrigin, minutes: number, notes: string[], minutesAgo: number, isDefault: boolean, description: string): void {
  const versions = notes.map((note, i) => ({
    number: i + 1,
    note,
    createdAt: ago(minutesAgo + (notes.length - 1 - i) * 2880),
    json: pipelineJson(name, minutes + i, (p) => {
      if (i > 0) for (const n of p.nodes) if (n.id === 'director') n.params = { ...n.params, cutsPerMinute: 10 + i * 3 }
    })
  }))
  library.push({
    row: { id: nextId(), name, description, origin, channelId, channelName: channelName(channelId), isDefault, latestVersion: versions.length, example: false, updatedAt: ago(minutesAgo) },
    versions
  })
}

seedPipe('Énigmes — narration d’archives', 1, 'analysis', 14, ['Créée depuis l’analyse', 'Plus de coupes', 'Musique plus basse'], 240, true, 'Récit posé, archives et cartes.')
seedPipe('Histoires Vraies — récit court', 2, 'builder', 1, ['Créée avec le Builder', 'Voix plus rapide'], 60 * 30, true, 'Récit à la première personne, fond de jeu.')
seedPipe('Top Savoirs — classement', 3, 'template', 9, ['Depuis le modèle « Vidéo simple »'], 60 * 72, true, 'Dix entrées, une image par entrée.')
seedPipe('Essai — voix off seule', 1, 'own', 6, ['Brouillon'], 60 * 96, false, '')

function findPipe(id: number): Pipe {
  const p = library.find((x) => x.row.id === id)
  if (!p) throw new Error('Pipeline introuvable.')
  return p
}

const latestJson = (p: Pipe): string => p.versions[p.versions.length - 1]?.json ?? '{}'

function parse(json: string): { ok: true; doc: PipelineJson } | { ok: false; problems: PipelineProblem[] } {
  if (!json.trim()) return { ok: false, problems: [{ code: 'empty', path: '' }] }
  let doc: unknown
  try {
    doc = JSON.parse(json)
  } catch {
    return { ok: false, problems: [{ code: 'json', path: '' }] }
  }
  const d = doc as Partial<PipelineJson>
  if (!d || typeof d !== 'object' || d.$schema !== 'atelier.pipeline/1') return { ok: false, problems: [{ code: 'schema', path: '$schema' }] }
  if (!Array.isArray(d.nodes) || d.nodes.length === 0) return { ok: false, problems: [{ code: 'nodes', path: 'nodes' }] }
  if (typeof d.name !== 'string' || !d.name.trim()) return { ok: false, problems: [{ code: 'name', path: 'name' }] }
  return { ok: true, doc: d as PipelineJson }
}

/** Credits per node per finished minute, per budget mode (a plausible grid, not the Cloud's). */
const NODE_COST: Record<string, [qualite: number, usage: number, where: string, seconds: number]> = {
  'research.topic': [0.6, 0.3, 'cloud', 40],
  'script.write': [1.2, 0.6, 'cloud', 60],
  'voice.tts': [1.6, 0.9, 'cloud', 20],
  'beats.split': [0, 0, 'local', 2],
  'director.plan': [0.9, 0.5, 'cloud', 45],
  'visuals.fulfil': [9.5, 3.2, 'cloud', 90],
  'captions.make': [0, 0, 'local', 6],
  'sound.music': [0.2, 0.1, 'local', 4],
  'render.assemble': [0, 0, 'local', 70],
  'package.youtube': [0.5, 0.3, 'cloud', 25]
}

export function costOf(json: string): PipelineCostReport {
  const r = parse(json)
  const nodes = r.ok ? r.doc.nodes : []
  const minutes = r.ok ? (r.doc.format?.minutes?.default ?? 8) : 8
  const mode = (k: 0 | 1) => {
    const list = nodes.map((n) => {
      const [q, u, where, s] = NODE_COST[n.type.split('@')[0] ?? ''] ?? [0.4, 0.2, 'cloud', 20]
      return { nodeId: n.id, type: n.type, where, credits: Math.round((k === 0 ? q : u) * minutes * 10) / 10, durationS: Math.round(s * Math.max(1, minutes / 4)) }
    })
    const credits = Math.round(list.reduce((a, n) => a + n.credits, 0) * 10) / 10
    return { credits, perMinute: Math.round((credits / minutes) * 10) / 10, durationS: list.reduce((a, n) => a + n.durationS, 0), nodes: list }
  }
  return { minutes, modes: { qualite_max: mode(0), usage_max: mode(1) } }
}

function detail(p: Pipe): LibraryPipelineDetail {
  return { ...p.row, versions: [...p.versions].reverse().map(({ number, note, createdAt }) => ({ number, note, createdAt })), json: latestJson(p) }
}

function setDefault(id: number, channelId: number): LibraryPipelineRow {
  const p = findPipe(id)
  for (const q of library) if (q.row.channelId === channelId) q.row.isDefault = false
  p.row.channelId = channelId
  p.row.channelName = channelName(channelId)
  p.row.isDefault = true
  changed('pipelines')
  return { ...p.row }
}

// ------------------------------------------------------------------------------------------------ styles

const STYLE_SEED: Record<number, { niche: string; language: string; voice: string; tone: string; palette: string[]; mood: string; minutes: number; cuts: number }> = {
  1: { niche: 'Histoire et mystères', language: 'fr', voice: 'demo-claire', tone: 'posé, émerveillé', palette: ['#1B2A41', '#C9A227', '#E8E1D0'], mood: 'nappes calmes, cordes', minutes: 14, cuts: 9 },
  2: { niche: 'Histoires racontées', language: 'fr', voice: 'demo-leo', tone: 'complice, rythmé', palette: ['#111111', '#FF5A5F', '#FFFFFF'], mood: 'électro douce', minutes: 1, cuts: 28 },
  3: { niche: 'Classements de culture générale', language: 'fr', voice: 'demo-nina', tone: 'enjoué, clair', palette: ['#0B3954', '#FFD166', '#F4F4F4'], mood: 'pop légère', minutes: 9, cuts: 16 },
  4: { niche: 'History and mysteries', language: 'en', voice: 'demo-river', tone: 'calm, curious', palette: ['#1B2A41', '#C9A227', '#E8E1D0'], mood: 'ambient strings', minutes: 14, cuts: 9 }
}

export function styleSheetFor(channelId: number, name = channelName(channelId)): StyleSheet {
  const s = STYLE_SEED[channelId] ?? STYLE_SEED[1]!
  return {
    $schema: 'atelier.style/1',
    identity: { name, niche: s.niche, language: s.language, audience: s.language === 'en' ? 'Curious adults' : 'Curieux de 25 à 55 ans' },
    voice: { source: 'platform', voiceId: s.voice, speed: s.cuts > 20 ? 1.1 : 0.96, stability: 0.6 },
    script: { structure: ['Accroche', 'Contexte', 'Trois rebondissements', 'Révélation', 'Appel à s’abonner'], hook: 'Une question en moins de 10 secondes', tone: s.tone, wpm: s.cuts > 20 ? 165 : 140, lengthMin: s.minutes, forbidden: ['clickbait mensonger'], skills: ['hook', 'retention', 'cta'] },
    visuals: { mix: { stock: 0.25, ai_image: 0.45, ai_video: 0.1, animation: 0.15, footage: 0.05, avatar: 0 }, palette: s.palette, fonts: ['Inter', 'Playfair Display'], grade: 'contraste doux, grain léger' },
    animation: { kit: 'cartes-et-titres', settings: 'zooms lents, titres en bas à gauche' },
    captions: { preset: 'highlight', position: 'bottom', wordsPerLine: s.cuts > 20 ? 3 : 5, highlight: true },
    sound: { mood: s.mood, volume: 0.18, duckDb: 12 },
    pace: { cutsPerMinute: s.cuts, minShotS: 1.5, maxShotS: s.cuts > 20 ? 4 : 9 },
    thumbnail: { layout: 'un objet au centre, titre de 3 mots', textRules: 'majuscules, 3 mots au plus', colors: s.palette.slice(0, 2), face: false },
    packaging: { titleRules: 'Une question ou un chiffre, 60 caractères au plus', descriptionTemplate: 'Dans cet épisode : {{résumé}}\n\nChapitres :\n{{chapitres}}' },
    budget: { mode: 'usage_max', capCredits: null }
  }
}

const styles = new Map<number, { version: number; note: string; createdAt: string; sheet: StyleSheet }[]>()
for (const c of DEMO_CHANNELS) {
  if (c.id === 4) continue
  const sheet = styleSheetFor(c.id, c.name)
  const older = structuredClone(sheet)
  older.pace.cutsPerMinute = Math.max(1, sheet.pace.cutsPerMinute - 3)
  styles.set(c.id, [
    { version: 1, note: 'Depuis l’analyse', createdAt: ago(60 * 24 * 9), sheet: older },
    { version: 2, note: 'Rythme plus soutenu', createdAt: ago(60 * 24 * 2), sheet }
  ])
}

/** Saves a new version of a channel's style; returns its number. */
export function saveStyle(channelId: number, sheet: StyleSheet, note: string): number {
  const list = styles.get(channelId) ?? []
  const version = (list[list.length - 1]?.version ?? 0) + 1
  list.push({ version, note, createdAt: new Date().toISOString(), sheet: structuredClone(sheet) })
  styles.set(channelId, list)
  changed('channels', 'pipelines')
  return version
}

function styleDetail(channelId: number): ChannelStyleDetail {
  const list = styles.get(channelId) ?? []
  const last = list[list.length - 1]
  return {
    channelId,
    versions: [...list].reverse().map((v) => ({ version: v.version, note: v.note, createdAt: v.createdAt, example: false })),
    current: last ? structuredClone(last.sheet) : null,
    currentVersion: last?.version ?? null,
    defaultPipelineId: library.find((p) => p.row.channelId === channelId && p.row.isDefault)?.row.id ?? null
  }
}

const styleText = (channelId: number, version: number): string => pretty(styles.get(channelId)?.find((v) => v.version === version)?.sheet ?? {})

// ------------------------------------------------------------------------------------------------ builder

const builders: BuilderDetail[] = []

function newBuilder(title: string, json: string, from: { pipelineId?: number | null; analysisId?: number | null }, minutesAgo = 0): BuilderDetail {
  const b: BuilderDetail = {
    id: nextId(),
    title,
    pipelineId: from.pipelineId ?? null,
    analysisId: from.analysisId ?? null,
    valid: true,
    example: false,
    updatedAt: ago(minutesAgo),
    draftJson: json,
    previousDraftJson: null,
    problems: [],
    cost: costOf(json),
    messages: []
  }
  builders.unshift(b)
  return b
}

{
  const b = newBuilder('Version plus courte des Énigmes', pipelineJson('Énigmes — format 8 minutes', 8), { pipelineId: library[0]?.row.id ?? null }, 60 * 5)
  b.messages.push(
    { id: nextId(), author: 'user', body: 'Fais-moi une version de 8 minutes, sans la relecture du script.', outcome: 'none', problems: [], createdAt: ago(60 * 5 + 2) },
    { id: nextId(), author: 'builder', body: 'C’est fait : 8 minutes, et le script passe sans arrêt de relecture. Le coût baisse d’environ 40 %.', outcome: 'valid', problems: [], createdAt: ago(60 * 5) }
  )
}

const summaryOf = ({ id, title, pipelineId, analysisId, valid, example, updatedAt }: BuilderDetail): BuilderSummary => ({ id, title, pipelineId, analysisId, valid, example, updatedAt })

function findBuilder(id: number): BuilderDetail {
  const b = builders.find((x) => x.id === id)
  if (!b) throw new Error('Session du Builder introuvable.')
  return b
}

/** What the Builder does with one message: a few phrases it understands, the rest is answered without a change. */
function builderEdit(doc: PipelineJson, text: string): string | null {
  const low = text.toLowerCase()
  const minutes = /(\d{1,2})\s*min/.exec(low)
  if (minutes) {
    doc.format.minutes.default = Number(minutes[1])
    return `C’est fait : la vidéo dure maintenant ${minutes[1]} minutes.`
  }
  if (/sans (relecture|validation|arr[êe]t)/.test(low)) {
    for (const n of doc.nodes) if (n.gate === 'review') delete n.gate
    return 'C’est fait : plus d’arrêt de relecture, seule la validation finale reste.'
  }
  if (/musique/.test(low) && /(sans|enl[eè]ve|retire)/.test(low)) {
    doc.nodes = doc.nodes.filter((n) => !n.type.startsWith('sound.music'))
    for (const n of doc.nodes) if (n.in?.music) delete n.in.music
    return 'C’est fait : la musique est retirée du montage.'
  }
  if (/sous-titre|captions/.test(low) && /(sans|enl[eè]ve|retire)/.test(low)) {
    doc.nodes = doc.nodes.filter((n) => !n.type.startsWith('captions.make'))
    for (const n of doc.nodes) if (n.in?.subs) delete n.in.subs
    return 'C’est fait : plus de sous-titres incrustés.'
  }
  return null
}

const CATALOG: CatalogNode[] = [
  { type: 'research.topic@1', inputs: [{ name: 'topic', type: 'text', required: true }], outputs: [{ name: 'brief', type: 'json' }], executors: ['llm'], defaultGate: 'none', claudeRole: 'researcher' },
  { type: 'script.write@1', inputs: [{ name: 'brief', type: 'json', required: true }], outputs: [{ name: 'text', type: 'text' }, { name: 'outline', type: 'json' }], executors: ['llm'], defaultGate: 'review', claudeRole: 'writer' },
  { type: 'voice.tts@1', inputs: [{ name: 'script', type: 'text', required: true }], outputs: [{ name: 'audio', type: 'audio' }, { name: 'words', type: 'json' }], executors: ['cloud'], defaultGate: 'review', claudeRole: null },
  { type: 'beats.split@1', inputs: [{ name: 'script', type: 'text', required: true }, { name: 'words', type: 'json', required: true }], outputs: [{ name: 'beats', type: 'json' }], executors: ['local'], defaultGate: 'none', claudeRole: null },
  { type: 'director.plan@1', inputs: [{ name: 'beats', type: 'json', required: true }, { name: 'words', type: 'json', required: true }], outputs: [{ name: 'plan', type: 'json' }, { name: 'genlist', type: 'json' }], executors: ['llm'], defaultGate: 'review', claudeRole: 'director' },
  { type: 'visuals.fulfil@1', inputs: [{ name: 'list', type: 'json', required: true }], outputs: [{ name: 'images', type: 'image' }, { name: 'clips', type: 'file' }], executors: ['cloud'], defaultGate: 'review', claudeRole: null },
  { type: 'captions.make@1', inputs: [{ name: 'words', type: 'json', required: true }], outputs: [{ name: 'subs', type: 'file' }], executors: ['local'], defaultGate: 'none', claudeRole: null },
  { type: 'sound.music@1', inputs: [{ name: 'voice', type: 'audio', required: true }], outputs: [{ name: 'music', type: 'audio' }], executors: ['local'], defaultGate: 'none', claudeRole: null },
  { type: 'render.assemble@1', inputs: [{ name: 'plan', type: 'json', required: true }, { name: 'voice', type: 'audio', required: true }], outputs: [{ name: 'video', type: 'file' }], executors: ['local'], defaultGate: 'none', claudeRole: null },
  { type: 'package.youtube@1', inputs: [{ name: 'video', type: 'file', required: true }], outputs: [{ name: 'package', type: 'json' }], executors: ['llm'], defaultGate: 'owner', claudeRole: 'packager' }
]

/** The analyses the Builder may start from (the analysis file registers its own). */
export const builderSources: { analysisJson: (id: number) => { title: string; json: string } | null } = { analysisJson: () => null }

export const libraryHandlers: DemoHandlers = {
  'pipelines.templates': () => TEMPLATES,
  'pipelines.catalog': () => CATALOG,
  'pipelines.list': () => library.map((p) => ({ ...p.row })),
  'pipelines.get': (id) => detail(findPipe(id)),
  'pipelines.version': (id, number) => findPipe(id).versions.find((v) => v.number === number)?.json ?? latestJson(findPipe(id)),
  'pipelines.diff': (id, from, to) => {
    const p = findPipe(id)
    return lineDiff(p.versions.find((v) => v.number === from)?.json ?? '', p.versions.find((v) => v.number === to)?.json ?? '')
  },
  'pipelines.check': (json) => {
    const r = parse(json)
    return r.ok ? { ok: true, json: pretty(r.doc), name: r.doc.name } : { ok: false, problems: r.problems }
  },
  'pipelines.estimate': (json) => costOf(json),
  'pipelines.import': (json, opts) => {
    const r = parse(json)
    if (!r.ok) return { ok: false, problems: r.problems }
    return { ok: true, pipeline: addLibraryPipeline(opts?.name?.trim() || r.doc.name, pretty(r.doc), 'import', opts?.channelId ?? null, 'Importée') }
  },
  'pipelines.createFromTemplate': (templateId, name) => {
    const t = TEMPLATES.find((x) => x.id === templateId)
    if (!t) throw new Error('Modèle inconnu.')
    return addLibraryPipeline(name.trim() || t.name, t.json, 'template', null, `Depuis le modèle « ${t.name} »`)
  },
  'pipelines.saveVersion': (id, json, note) => {
    const r = parse(json)
    if (!r.ok) return { ok: false, problems: r.problems }
    const p = findPipe(id)
    p.versions.push({ number: p.row.latestVersion + 1, note, createdAt: new Date().toISOString(), json: pretty(r.doc) })
    p.row.latestVersion += 1
    p.row.updatedAt = new Date().toISOString()
    changed('pipelines')
    return { ok: true, pipeline: { ...p.row } }
  },
  'pipelines.setDefault': (id, channelId) => setDefault(id, channelId),
  'pipelines.rename': (id, name, description) => {
    const p = findPipe(id)
    if (!name.trim()) throw new Error('Le nom ne peut pas être vide.')
    p.row.name = name.trim()
    p.row.description = description.trim()
    changed('pipelines')
    return { ...p.row }
  },
  'pipelines.delete': (id) => {
    const at = library.findIndex((p) => p.row.id === id)
    if (at >= 0) library.splice(at, 1)
    changed('pipelines')
  },
  'pipelines.export': (id, version) => {
    const p = findPipe(id)
    const json = (version !== undefined ? p.versions.find((v) => v.number === version)?.json : undefined) ?? latestJson(p)
    return { fileName: `${parse(json).ok ? (JSON.parse(json) as PipelineJson).id : 'pipeline'}.atelier-pipeline.json`, json }
  },
  'styles.get': (channelId) => styleDetail(channelId),
  'styles.version': (channelId, version) => structuredClone(styles.get(channelId)?.find((v) => v.version === version)?.sheet ?? styleSheetFor(channelId)),
  'styles.save': (channelId, sheet, note) => {
    saveStyle(channelId, sheet, note || 'Modifié à la main')
    return styleDetail(channelId)
  },
  'styles.diff': (channelId, from, to) => lineDiff(styleText(channelId, from), styleText(channelId, to)),
  'builder.list': () => builders.map(summaryOf),
  'builder.create': (start: BuilderStart) => {
    if (start.from === 'template') {
      const t = TEMPLATES.find((x) => x.id === start.templateId) ?? TEMPLATES[0]!
      return newBuilder(`Depuis « ${t.name} »`, t.json, {})
    }
    if (start.from === 'pipeline') {
      const p = findPipe(start.pipelineId)
      return newBuilder(`Depuis « ${p.row.name} »`, latestJson(p), { pipelineId: p.row.id })
    }
    const a = builderSources.analysisJson(start.analysisId)
    if (!a) throw new Error('Cette analyse n’a pas encore de pipeline proposée.')
    return newBuilder(`Depuis l’analyse de ${a.title}`, a.json, { analysisId: start.analysisId })
  },
  'builder.get': (id) => structuredClone(findBuilder(id)),
  'builder.send': async (id, text) => {
    const b = findBuilder(id)
    b.messages.push({ id: nextId(), author: 'user', body: text, outcome: 'none', problems: [], createdAt: new Date().toISOString() })
    changed('pipelines')
    await wait(1400)
    const doc = JSON.parse(b.draftJson) as PipelineJson
    const said = builderEdit(doc, text)
    if (said) {
      b.previousDraftJson = b.draftJson
      b.draftJson = pretty(doc)
      b.cost = costOf(b.draftJson)
    }
    b.messages.push({
      id: nextId(),
      author: 'builder',
      body: said ?? 'Démo : le Builder comprend ici quelques demandes simples — « 6 minutes », « sans relecture », « sans musique », « sans sous-titres ». Le vrai Builder modifie n’importe quelle partie de la pipeline.',
      outcome: said ? 'valid' : 'none',
      problems: [],
      createdAt: new Date().toISOString()
    })
    b.updatedAt = new Date().toISOString()
    changed('pipelines')
    return structuredClone(b)
  },
  'builder.save': (id, target, note) => {
    const b = findBuilder(id)
    if (target.target === 'new') {
      const row = addLibraryPipeline(target.name.trim() || b.title, b.draftJson, 'builder', target.channelId ?? null, note || 'Créée avec le Builder')
      b.pipelineId = row.id
      return row
    }
    const p = findPipe(target.pipelineId)
    p.versions.push({ number: p.row.latestVersion + 1, note: note || 'Modifiée avec le Builder', createdAt: new Date().toISOString(), json: b.draftJson })
    p.row.latestVersion += 1
    p.row.updatedAt = new Date().toISOString()
    changed('pipelines')
    return { ...p.row }
  },
  'builder.delete': (id) => {
    const at = builders.findIndex((b) => b.id === id)
    if (at >= 0) builders.splice(at, 1)
    changed('pipelines')
  }
}
