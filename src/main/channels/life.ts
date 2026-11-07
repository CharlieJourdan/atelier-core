// A channel's life beyond its creation (the beta): archive and restore, and « Traduire une chaîne ».
//
// Archive: the channel leaves the lists (`archived_at`), its agents are paused in the runtime (the ids paused here are kept, so
// restoring resumes exactly those and leaves an agent the owner paused herself alone). Nothing is deleted: videos, runs, the
// ledger and the chat stay readable, and the runtime's tree no longer seeds or wakes anyone for that channel.
//
// Translate: a new channel in the target language, the source kept as its reference (settings `channelLife.meta.<id>`), the
// source's style sheet and style profile copied when it has them, and a library pipeline (its default) whose script is
// written in the source language then translated (`script.translate@1`), the voice, captions and package reading the
// translation. The pipeline starts from the source's default pipeline, else from the engine's simple template.
import type { ChannelLanguage, ChannelMeta, ChannelTranslateInput, ChannelTranslateResult } from '../../shared/api/channel-life'
import { CHANNEL_LANGUAGES } from '../../shared/api/channel-life'
import type { JsonValue } from '../../shared/api'
import type { ChannelRow } from '../../shared/workflow'
import type { Pipeline, PipelineNode } from '../../engine/pipeline-schema'
import { checkPipeline, TEMPLATES } from '../analysis/catalog'
import type { PipelineLibrary } from '../analysis/library'
import type { StyleStore } from '../analysis/styles'
import type { EyesStore } from '../eyes/store'
import type { SettingsStore } from '../settings'
import type { ChannelsStore } from '../workflow/channels'

/** The part of the agent runtime this module uses (the Orchestra in the app, a fake in tests). */
export interface LifeRuntime {
  agents(): { id: number; channelId: number | null; paused: boolean }[]
  updateAgent(id: number, patch: { paused: boolean }): unknown
  seed(): unknown
}

export interface ChannelLifeDeps {
  channels: ChannelsStore
  settings: SettingsStore
  library: PipelineLibrary
  styles: StyleStore
  eyes: EyesStore
  runtime: LifeRuntime
}

export const META_PREFIX = 'channelLife.meta.'
export const PAUSED_PREFIX = 'channelLife.paused.'

const LANG_LABEL: Record<ChannelLanguage, string> = { fr: 'FR', en: 'EN', es: 'ES', de: 'DE', pt: 'PT' }

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0
const isLanguage = (v: unknown): v is ChannelLanguage => typeof v === 'string' && (CHANNEL_LANGUAGES as readonly string[]).includes(v)

/** The node that writes the script, the one that translates it, and every other node reading the script's outputs. */
const WRITE = 'script.write@1'
const TRANSLATE = 'script.translate@1'
/** Nodes that work in the source language (before the translation). */
const SOURCE_SIDE = new Set(['research.topic@1', WRITE])

/**
 * The pipeline with its script translated: `script.translate@1` right after the script (added, or the one already there
 * retargeted), every node that read the script's text or outline reading the translation instead, the research and the
 * writing in the source language and everything after in the target language (fixed values, not `$style.language`, so a
 * run of this channel always speaks the right language).
 */
export function withTranslation(doc: Pipeline, from: ChannelLanguage, to: ChannelLanguage, name?: string): Pipeline {
  const nodes: PipelineNode[] = doc.nodes.map((n) => ({ ...n, ...(n.in ? { in: { ...n.in } } : {}), ...(n.params ? { params: { ...n.params } } : {}) }))
  const writer = nodes.find((n) => n.type === WRITE)
  if (!writer) throw new Error('Ce pipeline n’écrit pas de script : il n’y a rien à traduire.')
  let translate = nodes.find((n) => n.type === TRANSLATE)
  if (!translate) {
    const id = nodes.some((n) => n.id === 'translate') ? 'translate_script' : 'translate'
    translate = { id, type: TRANSLATE, in: { script: `${writer.id}.text`, outline: `${writer.id}.outline` }, params: { language: to }, gate: 'review' }
    // every reader of the script now reads the translation (the translation itself reads the original)
    for (const n of nodes) {
      if (!n.in) continue
      for (const [port, ref] of Object.entries(n.in)) {
        if (ref === `${writer.id}.text`) n.in[port] = `${id}.text`
        else if (ref === `${writer.id}.outline`) n.in[port] = `${id}.outline`
      }
    }
    nodes.splice(nodes.indexOf(writer) + 1, 0, translate)
  }
  for (const n of nodes) {
    if (n === translate) {
      n.params = { ...n.params, language: to }
      continue
    }
    if (n.params && 'language' in n.params) n.params.language = SOURCE_SIDE.has(n.type) ? from : to
  }
  return { ...doc, ...(name ? { name } : {}), nodes }
}

function metaOf(raw: JsonValue | null, channelId: number): ChannelMeta {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    channelId,
    language: isLanguage(o.language) ? o.language : null,
    translatedFrom: isId(o.translatedFrom) ? o.translatedFrom : null,
    translatedFromName: typeof o.translatedFromName === 'string' ? o.translatedFromName : null
  }
}

export class ChannelLife {
  constructor(private readonly d: ChannelLifeDeps) {}

  private channel(id: unknown): ChannelRow {
    if (!isId(id)) throw new Error('Chaîne inconnue.')
    const row = this.d.channels.find(id)
    if (!row) throw new Error('Chaîne inconnue.')
    return row
  }

  /** Archives the channel and pauses its agents (only the ones running: an agent paused by the owner stays hers). */
  archive(id: unknown): { channel: ChannelRow; agentsPaused: number } {
    const row = this.channel(id)
    const paused: number[] = []
    for (const a of this.d.runtime.agents()) {
      if (a.channelId !== row.id || a.paused) continue
      this.d.runtime.updateAgent(a.id, { paused: true })
      paused.push(a.id)
    }
    // archiving twice keeps the first list (the second one would be empty and lose it)
    const before = this.d.settings.get<number[]>(`${PAUSED_PREFIX}${row.id}`, [])
    this.d.settings.set(`${PAUSED_PREFIX}${row.id}`, [...new Set([...before, ...paused])])
    return { channel: this.d.channels.setArchived(row.id, true), agentsPaused: paused.length }
  }

  /** Brings the channel back and resumes the agents its archive paused. */
  restore(id: unknown): { channel: ChannelRow; agentsResumed: number } {
    const row = this.channel(id)
    const channel = this.d.channels.setArchived(row.id, false)
    const ids = new Set(this.d.settings.get<number[]>(`${PAUSED_PREFIX}${row.id}`, []))
    let resumed = 0
    for (const a of this.d.runtime.agents()) {
      if (!ids.has(a.id) || a.channelId !== row.id || !a.paused) continue
      this.d.runtime.updateAgent(a.id, { paused: false })
      resumed++
    }
    this.d.settings.delete(`${PAUSED_PREFIX}${row.id}`)
    return { channel, agentsResumed: resumed }
  }

  meta(): ChannelMeta[] {
    return Object.entries(this.d.settings.all())
      .filter(([k]) => k.startsWith(META_PREFIX))
      .map(([k, v]) => metaOf(v, Number(k.slice(META_PREFIX.length))))
      .filter((m) => isId(m.channelId) && this.d.channels.find(m.channelId) !== null)
      .sort((a, b) => a.channelId - b.channelId)
  }

  metaFor(channelId: number): ChannelMeta {
    return metaOf(this.d.settings.get<JsonValue>(`${META_PREFIX}${channelId}`, null), channelId)
  }

  /** A live (not archived) translation of `sourceId` in `language`, or null. */
  findTranslation(sourceId: unknown, language: unknown): number | null {
    if (!isId(sourceId) || !isLanguage(language)) return null
    const live = new Set(this.d.channels.list().map((c) => c.id))
    return this.meta().find((m) => m.translatedFrom === sourceId && m.language === language && live.has(m.channelId))?.channelId ?? null
  }

  translate(raw: unknown): ChannelTranslateResult {
    const input = (raw ?? {}) as Partial<ChannelTranslateInput>
    const source = this.channel(input.sourceId)
    if (source.archived) throw new Error('Cette chaîne est archivée : restaure-la avant de la traduire.')
    if (!isLanguage(input.language)) throw new Error('Choisis la langue de la nouvelle chaîne.')
    const to = input.language
    const from = isLanguage(input.sourceLanguage) ? input.sourceLanguage : (this.metaFor(source.id).language ?? 'fr')
    if (from === to) throw new Error('La nouvelle chaîne doit parler une autre langue que la chaîne d’origine.')
    const existing = this.findTranslation(source.id, to)
    if (existing !== null) {
      const other = this.d.channels.get(existing)
      throw new Error(`Cette chaîne existe déjà dans cette langue : « ${other.name} ».`)
    }
    const name = (typeof input.name === 'string' ? input.name.trim() : '').slice(0, 120) || `${source.name} (${LANG_LABEL[to]})`

    // the pipeline first: if it cannot be made, no channel is left behind
    const base = this.basePipeline(source.id)
    const doc = withTranslation(base, from, to, `${name} — traduction`)
    const checked = checkPipeline(doc)
    if (!checked.ok) throw new Error(`Le pipeline traduit n’est pas valable : ${checked.problems.map((p) => p.code).join(', ')}.`)

    const channel = this.d.channels.create({
      name,
      niche: source.niche,
      standards: `Traduction de « ${source.name} » (${LANG_LABEL[from]} → ${LANG_LABEL[to]}). ${source.standards}`.trim().slice(0, 2000),
      scriptStyle: source.scriptStyle,
      thumbnailStyle: source.thumbnailStyle
    })
    const meta: ChannelMeta = { channelId: channel.id, language: to, translatedFrom: source.id, translatedFromName: source.name }
    this.d.settings.set(`${META_PREFIX}${channel.id}`, { language: to, translatedFrom: source.id, translatedFromName: source.name })
    // the source keeps its language once someone said it (a later translation knows what it reads)
    if (this.metaFor(source.id).language === null) {
      const prev = this.d.settings.get<JsonValue>(`${META_PREFIX}${source.id}`, null)
      const o = prev && typeof prev === 'object' && !Array.isArray(prev) ? prev : {}
      this.d.settings.set(`${META_PREFIX}${source.id}`, { ...o, language: from })
    }

    const row = this.d.library.create({
      name: `${name} — traduction`,
      description: `Le script est écrit comme sur « ${source.name} », puis traduit (${LANG_LABEL[from]} → ${LANG_LABEL[to]}).`,
      origin: 'own',
      channelId: channel.id,
      json: checked.json,
      note: `Traduction de « ${source.name} »`
    })
    const pipeline = this.d.library.setDefault(row.id, channel.id)

    const copied = { styleSheet: false, styleProfile: false }
    const sheet = this.d.styles.detail(source.id, null).current
    if (sheet) {
      this.d.styles.save(channel.id, sheet, `Copié de « ${source.name} »`)
      copied.styleSheet = true
    }
    const profile = this.d.eyes.latestProfile(source.id)
    if (profile) {
      this.d.eyes.saveProfile(channel.id, profile.profile, `Copié de « ${source.name} »`, 'edited')
      copied.styleProfile = true
    }
    // the new channel's team in the runtime (idempotent: existing agents are left alone)
    this.d.runtime.seed()
    return { channel, meta, pipeline, copied }
  }

  /** The source's default pipeline (its latest version), else the engine's simple template. */
  private basePipeline(sourceId: number): Pipeline {
    const id = this.d.library.defaultFor(sourceId)
    const json = id !== null ? this.d.library.versionJson(id, this.d.library.row(id).latestVersion) : TEMPLATES[0]!.build().json
    const doc = JSON.parse(json) as Pipeline
    // a source pipeline without a script (a pure re-edit) cannot be translated: fall back to the template
    return doc.nodes.some((n) => n.type === WRITE) ? doc : (JSON.parse(TEMPLATES[0]!.build().json) as Pipeline)
  }
}
