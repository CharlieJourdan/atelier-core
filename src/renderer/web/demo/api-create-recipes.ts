// The pipelines the visitor makes during the tour (a clone that finished, a proposal he chose, a shared code he pasted),
// kept in memory. `recipes.list` / `recipes.get` belong to the Lab's handler file: it reads `createdRecipes` and
// `createdRecipe(id)` from here, and every new one is announced with changed('production', 'pipelines').
import type { RecipeDetail, RecipeDocument, RecipeStage, RecipeSummary } from '../../../shared/recipes'
import { pipelineForm } from '../../../shared/recipes'
import { changed } from './bridge'
import { ago, nextId } from './world'

/** Summaries of the pipelines created during this visit, newest first. */
export const createdRecipes: RecipeSummary[] = []
const details = new Map<number, RecipeDetail>()

/** The full pipeline (its document and versions) of one the visitor created, or undefined. */
export function createdRecipe(id: number): RecipeDetail | undefined {
  return details.get(id)
}

const STAGE_OF: Record<string, RecipeStage> = { script: 'script', voice: 'voix', director: 'realisateur', visuals: 'elements', archive: 'elements', captions: 'montage', edit: 'montage', check: 'controle', topic: 'idee' }

function stagesOf(doc: RecipeDocument): RecipeStage[] {
  const order: RecipeStage[] = ['idee', 'script', 'voix', 'realisateur', 'elements', 'montage', 'controle']
  const seen = new Set(doc.bricks.map((b) => STAGE_OF[b.tech.split('.')[0] ?? ''] ?? 'elements'))
  return order.filter((s) => seen.has(s))
}

const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
/** A pipeline code like `7K2Q-9XPM`, stable for an id. */
export function codeOf(id: number): string {
  let n = id * 7919 + 104729
  let s = ''
  for (let i = 0; i < 8; i++) {
    s += CODE_CHARS[n % CODE_CHARS.length]
    n = Math.floor(n / CODE_CHARS.length) + i * 31 + id
  }
  return `${s.slice(0, 4)}-${s.slice(4)}`
}

const brick = (tech: string, settings: Record<string, unknown> = {}): RecipeDocument['bricks'][number] => ({ tech, settings, engine: null, fallbacks: [], style: null })

/** A documentary pipeline in the fictional channel's manner (archives, star charts, a calm narrator). */
export function documentaryDoc(name: string, opts: { minutes?: number; short?: boolean; language?: string | null; captions?: boolean; music?: string; editing?: string } = {}): RecipeDocument {
  const short = opts.short === true
  return {
    $schema: 'atelier.recette/2',
    name,
    base: 'documentaire@1',
    videoType: short ? 'short' : 'documentaire',
    format: { aspect: short ? '9:16' : '16:9', minutes: opts.minutes ?? (short ? 1 : 12) },
    language: opts.language ?? 'fr',
    mix: { archive: 0.5, imageAi: 0.25, motion: 0.15, stock: 0.1, curve: 'hook-heavy' },
    options: { music: opts.music ?? 'library', captions: opts.captions ?? short, editing: opts.editing ?? (short ? 'dynamic' : 'simple'), chapters: !short },
    inputs: { topic: 'project', voice: 'channel', style: 'channel' },
    capCredits: null,
    checkpoints: null,
    bricks: [
      brick('topic.pick'),
      brick('script.write', { tone: 'posé, émerveillé', wordsPerMinute: 138 }),
      brick('script.factcheck'),
      brick('voice.tts', { pace: 0.96 }),
      brick('director.plan', { shotLengthS: short ? 2.1 : 5.8 }),
      brick('archive.find', { eras: ['1850-1930'] }),
      brick('visuals.image', { look: 'plaque photographique' }),
      brick('visuals.motion', { kind: 'carte-du-ciel' }),
      brick('captions.burn'),
      brick('edit.assemble'),
      brick('check.review')
    ]
  }
}

/** Saves a new pipeline (version 1) and tells the screens. */
export function registerRecipe(doc: RecipeDocument, note: string): RecipeDetail {
  const id = nextId()
  const updatedAt = ago(0)
  const detail: RecipeDetail = {
    id,
    name: doc.name,
    videoType: doc.videoType,
    version: 1,
    bricks: doc.bricks.length,
    channels: [],
    archived: false,
    updatedAt,
    base: doc.base,
    form: pipelineForm(doc),
    minutes: doc.format.minutes,
    stages: stagesOf(doc),
    code: codeOf(id),
    doc,
    docVersion: 1,
    versions: [{ number: 1, note, createdAt: updatedAt }]
  }
  details.set(id, detail)
  createdRecipes.unshift(summaryOf(detail))
  changed('production', 'pipelines')
  return detail
}

function summaryOf(d: RecipeDetail): RecipeSummary {
  const { doc: _doc, docVersion: _v, versions: _vs, ...summary } = d
  return { ...summary, channels: [...summary.channels], stages: [...summary.stages] }
}

/** A new version of a created pipeline (an accepted change of the agent), or of the channels it serves. */
export function updateRecipe(id: number, change: { doc?: RecipeDocument; note?: string; channelIds?: number[] }): RecipeDetail | undefined {
  const d = details.get(id)
  if (!d) return undefined
  if (change.doc) {
    d.version += 1
    d.docVersion = d.version
    d.doc = change.doc
    d.code = codeOf(id * 31 + d.version)
    d.versions = [{ number: d.version, note: change.note ?? '', createdAt: ago(0) }, ...d.versions]
  }
  if (change.channelIds) d.channels = change.channelIds.map((channelId) => ({ channelId, videoType: d.videoType }))
  d.updatedAt = ago(0)
  const i = createdRecipes.findIndex((r) => r.id === id)
  if (i >= 0) createdRecipes[i] = summaryOf(d)
  changed('production', 'pipelines')
  return d
}
