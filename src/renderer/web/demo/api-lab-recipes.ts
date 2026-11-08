// Demo fixtures, lab: the team's pipelines (« recettes »), in memory. The base pipelines are the app's own
// (src/engine/technologies/bases, pure data, browser-safe); the team's pipelines are copies of them under invented names,
// tied to the demo channels. Every save is a new immutable version, like the real store.
import { parseRecipe } from '../../../engine/technologies/recipe'
import {
  DEFAULT_RECIPE_CHECKPOINTS,
  RECIPE_STAGES,
  pipelineForm,
  type BasePipelineInfo,
  type ChannelProductionView,
  type OptionInfo,
  type RecipeCheckpoint,
  type RecipeDetail,
  type RecipeDocument,
  type RecipeIssueView,
  type RecipeStage,
  type RecipeSummary,
  type RecipeVideoType
} from '../../../shared/recipes'
import { BASES, baseById, type DemoBase } from './api-lab-bases'
import { changed, type DemoHandlers } from './bridge'
import { createdRecipe, createdRecipes, updateRecipe } from './api-create-recipes'
import { DEMO_TECHNOLOGIES, codeOf, techOf } from './api-lab-techs'
import { DEMO_CHANNELS, ago, nextId } from './world'

type Base = DemoBase

interface Version {
  number: number
  note: string
  createdAt: string
  doc: RecipeDocument
}

interface Recipe {
  id: number
  versions: Version[]
  archived: boolean
  updatedAt: string
}

const docOf = (b: Base): RecipeDocument => structuredClone(b.doc)

const baseLike = (prefix: string): Base => {
  const b = BASES.find((x) => x.id.startsWith(prefix)) ?? BASES[0]
  if (!b) throw new Error('Démo : pipelines de base introuvables.')
  return b
}

function optionInfo(d: Base['options'][number]): OptionInfo {
  return {
    id: d.id,
    labelKey: d.labelKey,
    subject: d.subject,
    kind: d.kind,
    default: d.default,
    choices: d.kind === 'slider' ? [] : d.choices.map((c) => ({ value: c.value, labelKey: c.labelKey, soon: c.soon ?? null })),
    slider: d.kind === 'slider' ? { min: d.min, max: d.max, step: d.step } : null,
    soon: d.soon ?? null
  }
}

// ------------------------------------------------------------------------------------------------ the seed

function seed(base: Base, name: string, minutesAgo: number, edits: Partial<RecipeDocument> = {}, older: string[] = []): Recipe {
  const doc: RecipeDocument = { ...docOf(base), base: base.id, name, ...edits }
  const notes = [`Depuis la pipeline de base ${base.id}`, ...older]
  const versions = notes.map((note, i) => ({ number: i + 1, note, createdAt: ago(minutesAgo + (notes.length - 1 - i) * 1440), doc: structuredClone(doc) }))
  return { id: nextId(), versions, archived: false, updatedAt: ago(minutesAgo) }
}

const recipes: Recipe[] = [
  seed(baseLike('documentary'), 'Énigmes — documentaire d’archives', 180, { language: 'fr' }, ['Plus de cartes animées', 'Musique plus discrète']),
  seed(baseLike('story-short'), 'Histoires Vraies — short Reddit', 60 * 26, { language: 'fr' }, ['Sous-titres plus gros']),
  seed(baseLike('avatar@1'), 'Top Savoirs — classement présenté', 60 * 50, { language: 'fr' }),
  seed(baseLike('documentary'), 'Mystery Files — archive doc (EN)', 60 * 75, { language: 'en' })
]

/** Channel → recipe per video type (the demo channels 1..4 each use one of the seeded pipelines). */
const channelUse = new Map<number, Partial<Record<RecipeVideoType, number>>>()
const channelTech = new Map<number, Record<string, Record<string, unknown>>>()
const channelGates = new Map<number, RecipeCheckpoint[] | null>()
recipes.forEach((r, i) => {
  const ch = DEMO_CHANNELS[i]
  if (ch) channelUse.set(ch.id, { [latest(r).doc.videoType]: r.id })
})

function latest(r: Recipe): Version {
  return r.versions[r.versions.length - 1]!
}

function find(id: number): Recipe {
  const r = recipes.find((x) => x.id === id)
  if (!r) throw new Error('Pipeline introuvable.')
  return r
}

function stagesOf(doc: RecipeDocument): RecipeStage[] {
  const has = new Set(doc.bricks.map((b) => techOf(b.tech)?.stage).filter((s): s is RecipeStage => !!s))
  return RECIPE_STAGES.filter((s) => has.has(s))
}

function summary(r: Recipe): RecipeSummary {
  const v = latest(r)
  const channels: RecipeSummary['channels'] = []
  for (const [channelId, use] of channelUse) {
    for (const [videoType, id] of Object.entries(use)) if (id === r.id) channels.push({ channelId, videoType: videoType as RecipeVideoType })
  }
  return {
    id: r.id,
    name: v.doc.name,
    videoType: v.doc.videoType,
    version: v.number,
    bricks: v.doc.bricks.length,
    channels,
    archived: r.archived,
    updatedAt: r.updatedAt,
    base: v.doc.base,
    form: pipelineForm(v.doc),
    minutes: v.doc.format.minutes,
    stages: stagesOf(v.doc),
    code: codeOf(JSON.stringify(v.doc))
  }
}

export function recipeDetail(id: number, version?: number): RecipeDetail {
  const made = createdRecipe(id)
  if (made) return structuredClone(made)
  const r = find(id)
  const v = (version !== undefined ? r.versions.find((x) => x.number === version) : undefined) ?? latest(r)
  return {
    ...summary(r),
    doc: structuredClone(v.doc),
    docVersion: v.number,
    versions: [...r.versions].reverse().map(({ number, note, createdAt }) => ({ number, note, createdAt }))
  }
}

/** The documents the other lab files read (the latest version of every pipeline). */
export const recipeDocs = (): { id: number; doc: RecipeDocument }[] => [
  ...createdRecipes.flatMap((r) => {
    const d = createdRecipe(r.id)
    return d ? [{ id: d.id, doc: d.doc }] : []
  }),
  ...recipes.filter((r) => !r.archived).map((r) => ({ id: r.id, doc: latest(r).doc }))
]

export function recipeChannelIds(id: number): number[] {
  return [...channelUse].filter(([, use]) => Object.values(use).includes(id)).map(([c]) => c)
}

/** Sets the channels a pipeline serves for its video type (the others stop using it). */
export function assignRecipe(id: number, channelIds: number[]): void {
  const type = latest(find(id)).doc.videoType
  for (const ch of DEMO_CHANNELS) {
    const use = { ...(channelUse.get(ch.id) ?? {}) }
    if (channelIds.includes(ch.id)) use[type] = id
    else if (use[type] === id) delete use[type]
    channelUse.set(ch.id, use)
  }
  changed('production')
}

// ------------------------------------------------------------------------------------------------ check and save

/** The editor's live check: a name and bricks (`strict`: the full `atelier.recette/2` schema, for an imported file). */
export function checkDoc(doc: RecipeDocument, strict = false): RecipeIssueView[] {
  if (strict) {
    const parsed = parseRecipe(doc)
    if (!parsed.success) return parsed.error.issues.slice(0, 8).map((i) => ({ code: 'schema', path: i.path.map((p) => (typeof p === 'number' ? p : String(p))), message: i.message }))
  }
  const errors: RecipeIssueView[] = []
  if (!doc.name?.trim()) errors.push({ code: 'name', path: ['name'], message: 'Donne un nom à la pipeline.' })
  if (!Array.isArray(doc.bricks) || doc.bricks.length === 0) errors.push({ code: 'bricks', path: ['bricks'], message: 'La pipeline n’a aucune brique.' })
  return errors
}

export function saveRecipe(doc: RecipeDocument, note: string, id?: number): RecipeDetail {
  const errors = checkDoc(doc)
  if (errors.length > 0) throw new Error(`La recette n’est pas valable : ${errors.map((e) => e.message).join(' ; ')}`)
  const now = new Date().toISOString()
  if (id !== undefined && createdRecipe(id)) {
    const d = updateRecipe(id, { doc: structuredClone(doc), note })
    if (d) return structuredClone(d)
  }
  if (id !== undefined) {
    const r = find(id)
    r.versions.push({ number: latest(r).number + 1, note, createdAt: now, doc: structuredClone(doc) })
    r.updatedAt = now
    changed('production')
    return recipeDetail(r.id)
  }
  const r: Recipe = { id: nextId(), versions: [{ number: 1, note, createdAt: now, doc: structuredClone(doc) }], archived: false, updatedAt: now }
  recipes.unshift(r)
  changed('production')
  return recipeDetail(r.id)
}

function fromBase(baseId: string, name?: string): RecipeDetail {
  const b = baseById(baseId)
  if (!b) throw new Error('Pipeline de base inconnue.')
  const doc: RecipeDocument = { ...docOf(b), base: b.id, ...(name?.trim() ? { name: name.trim() } : {}) }
  return saveRecipe(doc, `Depuis la pipeline de base ${b.id}`)
}

function parseFile(json: string): RecipeDocument {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('Ce fichier n’est pas un JSON lisible.')
  }
  const doc = (raw && typeof raw === 'object' && 'recipe' in raw ? (raw as { recipe: unknown }).recipe : raw) as RecipeDocument
  const errors = checkDoc(doc, true)
  if (errors.length > 0) throw new Error(`Fichier refusé : ${errors.map((e) => e.message).join(' ; ')}`)
  return doc
}

function channelView(channelId: number): ChannelProductionView {
  const gates = channelGates.get(channelId) ?? null
  return {
    channelId,
    technologies: channelTech.get(channelId) ?? {},
    checkpoints: gates ?? [...DEFAULT_RECIPE_CHECKPOINTS],
    defaultCheckpoints: gates === null,
    recipes: channelUse.get(channelId) ?? {}
  }
}

export const recipesHandlers: DemoHandlers = {
  // the editor's « Développeur » block reads the Cloud's engines: the demo has no Cloud, so none (the block says why)
  'engines.list': () => ({ available: false, reason: 'Démo : le catalogue des moteurs vient d’Atelier Cloud, non connecté ici.', engines: [] }),
  'channelClips.get': (channelId) => ({ channelId, folder: `chaines/${channelId}/fonds`, clips: 24, fromStock: 18, own: 6, avatar: null, music: null }),
  'technologies.list': () => DEMO_TECHNOLOGIES,
  'recipes.bases': (): BasePipelineInfo[] => {
    const docs = recipeDocs()
    return BASES.map((b) => ({
      id: b.id,
      labelKey: b.labelKey,
      doc: docOf(b),
      options: b.options.map(optionInfo),
      copies: docs.filter((d) => d.doc.base === b.id).length,
      form: pipelineForm(b.doc),
      code: codeOf(JSON.stringify(b.doc))
    }))
  },
  'recipes.list': () => [...createdRecipes.map((r) => ({ ...r })), ...[...recipes].sort((a, b) => Number(a.archived) - Number(b.archived) || b.updatedAt.localeCompare(a.updatedAt)).map(summary)],
  'recipes.get': (id, version) => recipeDetail(id, version),
  'recipes.fromBase': (baseId, name) => fromBase(baseId, name),
  'recipes.translate': (id, language) => {
    const lang = language.trim().toLowerCase()
    if (!/^[a-z]{2}$/.test(lang)) throw new Error('Langue invalide : deux lettres (fr, en, es…).')
    const { doc } = recipeDetail(id)
    if ((doc.language ?? null) === lang) throw new Error('Cette pipeline est déjà dans cette langue.')
    const name = `${doc.name.replace(/\s*\([A-Z]{2}\)$/, '')} (${lang.toUpperCase()})`
    return saveRecipe({ ...doc, language: lang, name }, `Traduite en ${lang} depuis « ${doc.name} »`)
  },
  'recipes.edit': (id, ops, note) => {
    const { doc } = recipeDetail(id)
    for (const op of ops) {
      if (op.op === 'setOption' && typeof op.option === 'string') doc.options[op.option] = op.value as string | number | boolean
      else if (op.op === 'rename' && typeof op.name === 'string') doc.name = op.name
      else if (op.op === 'setCap') doc.capCredits = typeof op.credits === 'number' ? op.credits : null
    }
    return saveRecipe(doc, note?.trim() ? note : 'Modifiée', id)
  },
  'recipes.check': (doc) => {
    const errors = checkDoc(doc)
    return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [], mix: doc.mix, overrides: [] }
  },
  'recipes.save': (input) => saveRecipe(input.doc, input.note?.trim() || (input.id !== undefined ? 'Modifiée dans l’éditeur' : 'Créée dans l’éditeur'), input.id),
  'recipes.archive': (id, archived) => {
    const r = find(id)
    r.archived = archived
    r.updatedAt = new Date().toISOString()
    changed('production')
    return summary(r)
  },
  'recipes.compile': (id) => {
    const { doc } = recipeDetail(id)
    return {
      ok: true,
      errors: [],
      nodes: doc.bricks.map((b, i) => ({ id: `${b.tech.split('@')[0]}-${i + 1}`, type: (techOf(b.tech)?.nodeTypes[0] ?? 'node'), gate: 'auto', params: b.settings })),
      checkpoints: doc.checkpoints ?? [...DEFAULT_RECIPE_CHECKPOINTS],
      pins: {},
      overrides: []
    }
  },
  'recipes.export': (id, version) => {
    const d = recipeDetail(id, version)
    const slug = d.name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    return { fileName: `${slug || 'pipeline'}.atelier-recette.json`, json: JSON.stringify(d.doc, null, 2) }
  },
  'recipes.import': (json) => saveRecipe(parseFile(json), 'Importée depuis un fichier'),
  'recipes.share': (id, version) => {
    const d = recipeDetail(id, version)
    const code = d.code
    return { code, text: `Ma pipeline « ${d.name} » sur Atelier : ${code}` }
  },
  'recipes.channel': (channelId) => channelView(channelId),
  'recipes.setChannel': (channelId, input) => {
    if (input.technologies) channelTech.set(channelId, input.technologies)
    if (input.checkpoints !== undefined) channelGates.set(channelId, input.checkpoints)
    changed('production')
    return channelView(channelId)
  },
  'recipes.useForChannel': (channelId, videoType, recipeId) => {
    const use = { ...(channelUse.get(channelId) ?? {}) }
    if (recipeId === null) delete use[videoType]
    else use[videoType] = recipeId
    channelUse.set(channelId, use)
    changed('production')
    return channelView(channelId)
  }
}
