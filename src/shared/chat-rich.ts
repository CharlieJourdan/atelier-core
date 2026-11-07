// Conversations v2 (lot 12): the typed data the chat UI renders beyond the v1 contract. Everything here is pure (no
// DOM, no Electron): the renderer draws it, and lot 13 (group-chat engine) only has to feed it.
//   - extra cards (goal, engine step, handoff) next to the five v1 cards;
//   - rich blocks: a fenced ```<name> {json}``` section inside a message body (stats, chart, ideas…);
//   - rooms / channel folders / mention targets for the conversation list and the composer;
//   - the streaming "reveal" and @mention helpers.
import type { Card } from './chat'

// ---- extra cards -----------------------------------------------------------------------------------------------

export interface GoalCard {
  type: 'goal'
  goalId: number | null
  title: string
  /** Target and progress in `unit` (e.g. 12 videos). */
  target: number
  progress: number
  unit: string
  deadline?: string
}

export interface EngineCard {
  type: 'engine'
  /** Engine job slug. */
  slug: string
  title: string
  stage: string
  percent: number
  state: 'queued' | 'running' | 'done' | 'error'
  detail?: string
}

export interface HandoffCard {
  type: 'handoff'
  /** Row of `handoffs` (lot 13); the live state and answer are read from it. */
  handoffId?: number
  /** Agent ids. */
  from: string
  to: string
  ask: string
  state: 'asked' | 'answered' | 'refused'
  answerExcerpt?: string
  /** Why it was refused (limit reached, unknown agent, stopped…). */
  reason?: string
}

export type ExtraCard = GoalCard | EngineCard
export type AnyCard = Card | ExtraCard
export const EXTRA_CARD_TYPES = ['goal', 'engine'] as const
export const ALL_CARD_TYPES = ['approval', 'budget', 'proposal', 'task', 'qc', 'handoff', ...EXTRA_CARD_TYPES] as const

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The renderer receives `card` as JSON from main: accept only the known types (lot 13 may add more fields). */
export function asAnyCard(card: unknown): AnyCard | null {
  if (!isObj(card) || typeof card['type'] !== 'string') return null
  const c = card
  const has = (...keys: string[]): boolean => keys.every((k) => typeof c[k] === 'string')
  const nums = (...keys: string[]): boolean => keys.every((k) => typeof c[k] === 'number' && Number.isFinite(c[k]))
  let ok: boolean
  switch (c['type']) {
    case 'approval':
      ok = has('title', 'excerpt') && typeof c['deliverableId'] === 'number'
      break
    case 'budget':
      ok = has('message') && nums('capUsd', 'spentUsd', 'requestedUsd')
      break
    case 'proposal':
      ok = has('title', 'detail')
      break
    case 'task':
      ok = has('title', 'status', 'assignee') && typeof c['taskId'] === 'number'
      break
    case 'qc':
      ok =
        has('summary') &&
        typeof c['passed'] === 'boolean' &&
        Array.isArray(c['items']) &&
        c['items'].every((i) => isObj(i) && typeof i['label'] === 'string')
      break
    case 'goal':
      ok = has('title', 'unit') && nums('target', 'progress')
      break
    case 'engine':
      ok = has('title', 'stage') && nums('percent') && ['queued', 'running', 'done', 'error'].includes(c['state'] as string)
      break
    case 'handoff':
      ok = has('from', 'to', 'ask') && ['asked', 'answered', 'refused'].includes(c['state'] as string)
      break
    default:
      ok = false
  }
  return ok ? (card as unknown as AnyCard) : null
}

// ---- rich blocks -----------------------------------------------------------------------------------------------

export const BLOCK_NAMES = ['stats', 'chart', 'ideas', 'concepts', 'beats', 'keywords', 'tags', 'sources', 'trend', 'steps'] as const
export type BlockName = (typeof BLOCK_NAMES)[number]

export interface StatsBlock {
  items: { label: string; value: string; delta?: string }[]
}
export interface ChartBlock {
  kind: 'bar' | 'line'
  title?: string
  series: { label: string; value: number }[]
}
export interface IdeasBlock {
  items: { title: string; hook?: string }[]
}
export interface ConceptsBlock {
  items: { title: string; summary: string; tags?: string[] }[]
}
export interface BeatsBlock {
  items: { label: string; text: string; seconds?: number }[]
}
export interface KeywordsBlock {
  items: { term: string; volume?: number; difficulty?: number }[]
}
export interface TagsBlock {
  items: string[]
}
export interface SourcesBlock {
  items: { title: string; url?: string; note?: string }[]
}
export interface TrendBlock {
  title?: string
  points: number[]
  delta?: string
}
export interface StepsBlock {
  items: { label: string; state: 'done' | 'running' | 'todo' }[]
}
export interface BlockDataMap {
  stats: StatsBlock
  chart: ChartBlock
  ideas: IdeasBlock
  concepts: ConceptsBlock
  beats: BeatsBlock
  keywords: KeywordsBlock
  tags: TagsBlock
  sources: SourcesBlock
  trend: TrendBlock
  steps: StepsBlock
}

export type BodySegment =
  | { kind: 'md'; text: string }
  | { [N in BlockName]: { kind: 'block'; name: N; data: BlockDataMap[N] } }[BlockName]
  /** A fence of a block language that is still being streamed (not closed yet) or whose JSON is invalid. */
  | { kind: 'pending'; name: string; raw: string }

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, 50) : [])
const objs = (v: unknown): Record<string, unknown>[] => list(v).filter(isObj)

/** Validates the JSON of a block and keeps only the fields the renderer draws. Null = unusable. */
export function validateBlock(name: BlockName, json: unknown): BlockDataMap[BlockName] | null {
  if (!isObj(json)) return null
  const items = objs(json['items'])
  switch (name) {
    case 'stats': {
      const out = items.flatMap((i) => {
        const label = str(i['label'])
        const raw = i['value']
        const value = typeof raw === 'number' ? String(raw) : str(raw)
        if (label === null || value === null) return []
        const delta = str(i['delta'])
        return [{ label, value, ...(delta !== null ? { delta } : {}) }]
      })
      return out.length ? { items: out } : null
    }
    case 'chart': {
      const series = objs(json['series']).flatMap((s) => {
        const label = str(s['label'])
        const value = num(s['value'])
        return label !== null && value !== null ? [{ label, value }] : []
      })
      if (!series.length) return null
      const title = str(json['title'])
      return { kind: json['kind'] === 'line' ? 'line' : 'bar', ...(title !== null ? { title } : {}), series }
    }
    case 'ideas': {
      const out = items.flatMap((i) => {
        const title = str(i['title'])
        const hook = str(i['hook'])
        return title === null ? [] : [{ title, ...(hook !== null ? { hook } : {}) }]
      })
      return out.length ? { items: out } : null
    }
    case 'concepts': {
      const out = items.flatMap((i) => {
        const title = str(i['title'])
        const summary = str(i['summary'])
        if (title === null || summary === null) return []
        const tags = list(i['tags']).filter((x): x is string => typeof x === 'string')
        return [{ title, summary, ...(tags.length ? { tags } : {}) }]
      })
      return out.length ? { items: out } : null
    }
    case 'beats': {
      const out = items.flatMap((i) => {
        const label = str(i['label'])
        const text = str(i['text'])
        if (label === null || text === null) return []
        const seconds = num(i['seconds'])
        return [{ label, text, ...(seconds !== null ? { seconds } : {}) }]
      })
      return out.length ? { items: out } : null
    }
    case 'keywords': {
      const out = items.flatMap((i) => {
        const term = str(i['term'])
        if (term === null) return []
        const volume = num(i['volume'])
        const difficulty = num(i['difficulty'])
        return [{ term, ...(volume !== null ? { volume } : {}), ...(difficulty !== null ? { difficulty } : {}) }]
      })
      return out.length ? { items: out } : null
    }
    case 'tags': {
      const out = list(json['items']).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      return out.length ? { items: out } : null
    }
    case 'sources': {
      const out = items.flatMap((i) => {
        const title = str(i['title'])
        if (title === null) return []
        const url = str(i['url'])
        const note = str(i['note'])
        return [{ title, ...(url !== null ? { url } : {}), ...(note !== null ? { note } : {}) }]
      })
      return out.length ? { items: out } : null
    }
    case 'trend': {
      const points = list(json['points']).flatMap((p) => {
        const n = num(p)
        return n === null ? [] : [n]
      })
      if (points.length < 2) return null
      const title = str(json['title'])
      const delta = str(json['delta'])
      return { ...(title !== null ? { title } : {}), points, ...(delta !== null ? { delta } : {}) }
    }
    case 'steps': {
      const out = items.flatMap((i) => {
        const label = str(i['label'])
        if (label === null) return []
        const raw = i['state']
        const state: 'done' | 'running' | 'todo' = raw === 'done' ? 'done' : raw === 'running' ? 'running' : 'todo'
        return [{ label, state }]
      })
      return out.length ? { items: out } : null
    }
  }
}

const isBlockName = (s: string): s is BlockName => (BLOCK_NAMES as readonly string[]).includes(s)

/**
 * Splits a message body into markdown and rich blocks. A block is a fence whose language is a block name and whose
 * content is JSON. Any other fence stays in the markdown (rendered as code). A block fence that is not closed yet
 * (streaming) or whose JSON is invalid becomes a `pending` segment: the UI shows a placeholder, never raw JSON.
 */
export function splitBody(body: string, opts: { final?: boolean } = {}): BodySegment[] {
  const out: BodySegment[] = []
  let md: string[] = []
  const flush = (): void => {
    const text = md.join('\n')
    if (text.trim() !== '') out.push({ kind: 'md', text })
    md = []
  }
  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    // Any line starting with ``` opens a fence; its language is the first word ("```c++ x" is a plain code fence).
    const open = /^```\s*(\S*)/.exec(line)
    const lang = open ? (open[1] ?? '').toLowerCase() : undefined
    if (lang === undefined) {
      md.push(line)
      continue
    }
    // Find the closing fence.
    let end = -1
    for (let j = i + 1; j < lines.length; j++) {
      if (/^```\s*$/.test(lines[j] ?? '')) {
        end = j
        break
      }
    }
    if (!isBlockName(lang) || !/^```\s*[A-Za-z]+\s*$/.test(line)) {
      // A plain code fence: keep it (whole, if closed) in the markdown flow.
      const stop = end === -1 ? lines.length - 1 : end
      md.push(...lines.slice(i, stop + 1))
      i = stop
      continue
    }
    flush()
    if (end === -1) {
      if (opts.final) out.push({ kind: 'pending', name: lang, raw: lines.slice(i + 1).join('\n') })
      else out.push({ kind: 'pending', name: lang, raw: '' })
      break
    }
    const raw = lines.slice(i + 1, end).join('\n')
    i = end
    let data: BlockDataMap[BlockName] | null
    try {
      data = validateBlock(lang, JSON.parse(raw))
    } catch {
      data = null
    }
    if (data === null) out.push({ kind: 'pending', name: lang, raw })
    else out.push({ kind: 'block', name: lang, data } as BodySegment)
  }
  flush()
  return out
}

// ---- streaming ---------------------------------------------------------------------------------------------------

/**
 * Smooth streaming: how many characters of `total` are visible `dtMs` after the last frame. The reveal speeds up with
 * the backlog (so it never falls far behind the model) and is capped so a big chunk glides instead of jumping.
 */
export function nextRevealLength(shown: number, total: number, dtMs: number): number {
  if (shown >= total) return total
  const backlog = total - shown
  // 60 chars/s base + 6 chars/s per pending char (catches up in ~1 s whatever the backlog).
  const perSecond = 60 + backlog * 6
  const step = Math.max(1, Math.round((perSecond * Math.min(dtMs, 100)) / 1000))
  return Math.min(total, shown + step)
}

// ---- rooms, folders, mentions ----------------------------------------------------------------------------------

export const DEPARTMENTS = ['direction', 'production', 'operations'] as const
export type Department = (typeof DEPARTMENTS)[number]

/** Role groups of v1 (steering / production / operations) are the departments of the v2 rooms. */
export const DEPARTMENT_OF_GROUP: Record<string, Department> = {
  steering: 'direction',
  production: 'production',
  operations: 'operations'
}

/** A conversation that is not (yet) a row of `chat.conversations`: a department room, a channel manager. Lot 13 feeds it. */
export interface RoomInfo {
  /** Stable key (e.g. `room:3:production`). */
  key: string
  channelId: number
  kind: 'manager' | 'room'
  department?: Department
  title: string
  /** Conversation id once it exists (lot 13); null = not opened yet. */
  conversationId: number | null
  unread: number
}

export interface MentionTarget {
  /** Agent id. */
  id: string
  /** Display name, inserted as `@Name`. */
  name: string
  /** Colour index for the agent dot. */
  index: number
  /** Short role label. */
  hint?: string
}

export const MAX_MENTION_SUGGESTIONS = 7

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
/** The text inserted after @: every character the mention pattern would stop at becomes `_`, so it round-trips. */
export const mentionSlug = (name: string): string => name.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_')

/** The `@query` being typed right before the caret, or null. The `@` must start the text or follow whitespace. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const m = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(before)
  if (!m) return null
  const query = m[2] ?? ''
  return { start: caret - query.length - 1, query }
}

/** Up to 7 targets matching the query (prefix on name or id first, then substring), in a stable order. */
export function filterMentions(targets: readonly MentionTarget[], query: string): MentionTarget[] {
  const q = norm(query.replace(/_/g, ' '))
  const score = (t: MentionTarget): number => {
    const name = norm(t.name)
    const id = norm(t.id.replace(/_/g, ' '))
    if (q === '') return 2
    if (name.startsWith(q) || id.startsWith(q)) return 0
    if (name.includes(q) || id.includes(q)) return 1
    return -1
  }
  return targets
    .map((t, i) => ({ t, s: score(t), i }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, MAX_MENTION_SUGGESTIONS)
    .map((x) => x.t)
}

/** Replaces the `@query` at `start` (up to `caret`) by `@Name ` and returns the new text and caret. */
export function insertMention(text: string, start: number, caret: number, target: MentionTarget): { text: string; caret: number } {
  const insert = `@${mentionSlug(target.name)} `
  return { text: text.slice(0, start) + insert + text.slice(caret), caret: start + insert.length }
}

/** The mentioned targets of a text, in order of appearance, without duplicates. */
export function mentionsIn(text: string, targets: readonly MentionTarget[]): MentionTarget[] {
  const seen = new Set<string>()
  const out: MentionTarget[] = []
  for (const m of text.matchAll(/(^|\s)@([\p{L}\p{N}_-]+)/gu)) {
    const slug = norm(m[2] ?? '')
    const t = targets.find((x) => norm(mentionSlug(x.name)) === slug)
    if (t && !seen.has(t.id)) {
      seen.add(t.id)
      out.push(t)
    }
  }
  return out
}
