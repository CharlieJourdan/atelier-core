// A channel's standing goals (docs/AGENT-RUNTIME.md §25, migration 026): time (publication slots, formats and lengths,
// deadlines), budget (monthly credits) and the approval level (which gates of a video ask Charlie). They are proposed
// when a channel is created or imported — first a baseline computed here from what Atelier already read (the channel's
// own videos for an import, its watched competitors' rhythm and lengths; defaults when nothing was read), then refined
// by the channel lead (`goals.propose`) while Charlie has not confirmed them — and Charlie confirms or edits them. Every
// turn of the channel's agents reads them (`block`), and `gates` says which questions really go to Charlie.
import {
  APPROVAL_LEVELS,
  GOAL_GATES,
  LEVEL_GATES,
  type ApprovalLevel,
  type ChannelGoals,
  type ChannelGoalsInput,
  type GoalDeadline,
  type GoalFormat,
  type GoalGate,
  type GoalSlot
} from '../../shared/api/autopilot'
import type { Db } from '../db'
import { iso, isRecord, parseJson, type Clock, type EventLog } from './util'

/**
 * Paid generation per finished minute, in credits, until production-5 quotes for real: decision 0015's simulated grid
 * gives 0,63 to 1,57 € a minute (documentary with FLUX to hybrid avatar), so 100 credits (1 €) is the middle.
 */
export const CREDITS_PER_MINUTE_ESTIMATE = 100
/** A video of 3 minutes or less is a Short. */
const SHORT_MAX_S = 180
const WEEKS_PER_MONTH = 52 / 12

const DAYS: Record<number, number[]> = { 1: [3], 2: [2, 5], 3: [1, 3, 5], 4: [1, 2, 4, 6], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [1, 2, 3, 4, 5, 6, 7] }
const DAY_NAMES = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
export const GATE_NAMES: Record<GoalGate, string> = { topic: 'sujets', script: 'scripts', voice: 'voix', thumbnail: 'miniatures', video: 'vidéo montée', kit: 'kit de publication' }

interface GoalsRow {
  channel_id: number
  status: 'proposed' | 'confirmed'
  slots_json: string
  formats_json: string
  budget_credits: number
  deadlines_json: string
  level: ApprovalLevel
  gates_json: string
  reasons: string
  source: 'baseline' | 'agent' | 'user'
  trigger_kind: 'create' | 'import'
  inbox_id: number | null
  proposed_at: string
  confirmed_at: string | null
  updated_at: string
}

/** What a source (the channel itself or a competitor) publishes: per week, and its typical lengths. */
interface Rhythm {
  name: string
  own: boolean
  longPerWeek: number
  shortPerWeek: number
  longMinutes: number | null
}

/**
 * The goal gate a run's node belongs to (production-equipe): a team run's owner gate is answered by the channel's level
 * like the agents' own questions — the topic, the script, the voice, the thumbnail, the kit; every other node (director,
 * pictures, presenter, captions, sound, render) is the edited video.
 */
export function gateOfNode(type: string): GoalGate {
  const family = type.split('.')[0] ?? ''
  if (family === 'research' || family === 'topic' || family === 'ideas') return 'topic'
  if (family === 'script') return 'script'
  if (family === 'voice') return 'voice'
  if (family === 'thumbnail') return 'thumbnail'
  if (family === 'package' || family === 'publish') return 'kit'
  return 'video'
}

/**
 * The team may spend real credits on a run without Charlie's yes in the task (production-equipe) only when he confirmed
 * the channel's goals — its monthly budget is his authorisation — and chose a level that leaves the production to the
 * team: « tout automatique », or a custom level that gates neither the voice nor the video. The recommended level keeps
 * decision 0065's rule (he says yes to the real engine); the budget left is checked by `project.run` either way.
 */
export function realRunAllowed(g: Pick<ChannelGoals, 'status' | 'level' | 'gates'> | null): boolean {
  if (!g || g.status !== 'confirmed') return false
  if (g.level === 'all-auto') return true
  return g.level === 'custom' && !g.gates.includes('voice') && !g.gates.includes('video')
}

export class GoalsStore {
  private readonly db: Db
  private readonly now: Clock
  private readonly events: EventLog

  constructor(db: Db, now: Clock, events: EventLog) {
    this.db = db
    this.now = now
    this.events = events
  }

  get(channelId: number): ChannelGoals | null {
    const r = this.db.prepare('SELECT * FROM channel_goals WHERE channel_id = ?').get(channelId) as unknown as GoalsRow | undefined
    return r ? toGoals(r) : null
  }

  /** The gates that ask Charlie. A channel without goals yet keeps the recommended ones (topics and thumbnails). */
  gates(channelId: number | null): GoalGate[] {
    if (channelId === null) return [...LEVEL_GATES.recommended]
    return this.get(channelId)?.gates ?? [...LEVEL_GATES.recommended]
  }

  /**
   * The baseline proposal. With `force` false (a channel created or imported) an existing proposal stays as it is
   * (idempotent); with `force` (« Proposer à nouveau ») it is replaced and goes back to `proposed`.
   */
  propose(channelId: number, trigger: 'create' | 'import', force = false): { goals: ChannelGoals; created: boolean } {
    const existing = this.get(channelId)
    if (existing && !force) return { goals: existing, created: false }
    const b = baseline(this.rhythms(channelId), this.now())
    const at = iso(this.now())
    this.db
      .prepare(
        `INSERT INTO channel_goals (channel_id, status, slots_json, formats_json, budget_credits, deadlines_json, level, gates_json, reasons, source,
           trigger_kind, inbox_id, proposed_at, confirmed_at, updated_at)
         VALUES (?, 'proposed', ?, ?, ?, ?, 'recommended', ?, ?, 'baseline', ?, NULL, ?, NULL, ?)
         ON CONFLICT (channel_id) DO UPDATE SET status = 'proposed', slots_json = excluded.slots_json, formats_json = excluded.formats_json,
           budget_credits = excluded.budget_credits, deadlines_json = excluded.deadlines_json, reasons = excluded.reasons, source = 'baseline',
           proposed_at = excluded.proposed_at, confirmed_at = NULL, updated_at = excluded.updated_at`
      )
      .run(
        channelId,
        JSON.stringify(b.slots),
        JSON.stringify(b.formats),
        b.budgetCredits,
        JSON.stringify(b.deadlines),
        JSON.stringify(LEVEL_GATES.recommended),
        b.reasons,
        existing?.trigger ?? trigger,
        at,
        at
      )
    this.events.add('goals', `Objectifs proposés pour la chaîne #${channelId} (${b.slots.length} créneau(x) par semaine, ${b.budgetCredits} crédits par mois)`)
    return { goals: this.get(channelId) as ChannelGoals, created: existing === null }
  }

  setInbox(channelId: number, inboxId: number): void {
    this.db.prepare('UPDATE channel_goals SET inbox_id = ? WHERE channel_id = ?').run(inboxId, channelId)
  }

  /**
   * The lead's refined proposal: time and budget only (the approval level is Charlie's alone), refused once Charlie
   * confirmed the goals (his word stands).
   */
  agentPropose(channelId: number, input: ChannelGoalsInput, reasons: string): ChannelGoals {
    const g = this.get(channelId)
    if (!g) throw new Error('No goals were proposed for this channel yet')
    if (g.status === 'confirmed') throw new Error('Charlie already confirmed these goals: they stay as they are. Ask him (ask_human) if they should change.')
    const { slots, formats, budgetCredits, deadlines }: ChannelGoalsInput = isRecord(input) ? input : {}
    return this.write(channelId, { slots, formats, budgetCredits, deadlines, confirm: false }, 'agent', reasons.trim() || g.reasons)
  }

  /** Charlie edits and / or confirms. */
  save(channelId: number, input: ChannelGoalsInput): ChannelGoals {
    if (!this.get(channelId)) this.propose(channelId, 'create')
    return this.write(channelId, input, 'user', null)
  }

  private write(channelId: number, input: ChannelGoalsInput, source: 'agent' | 'user', reasons: string | null): ChannelGoals {
    if (!isRecord(input)) throw new Error('Des objectifs : créneaux, formats, budget, niveau de validation.')
    const g = this.get(channelId) as ChannelGoals
    const slots = input.slots === undefined ? g.slots : cleanSlots(input.slots)
    const formats = input.formats === undefined ? g.formats : cleanFormats(input.formats)
    const budget = input.budgetCredits === undefined ? g.budgetCredits : cleanBudget(input.budgetCredits)
    const deadlines = input.deadlines === undefined ? g.deadlines : cleanDeadlines(input.deadlines)
    const level = input.level === undefined ? g.level : cleanLevel(input.level)
    const gates = level === 'custom' ? (input.gates === undefined ? g.gates : cleanGates(input.gates)) : [...LEVEL_GATES[level]]
    const at = iso(this.now())
    const confirm = input.confirm === true
    this.db
      .prepare(
        `UPDATE channel_goals SET slots_json = ?, formats_json = ?, budget_credits = ?, deadlines_json = ?, level = ?, gates_json = ?,
           reasons = COALESCE(?, reasons), source = ?, status = CASE WHEN ? THEN 'confirmed' ELSE status END,
           confirmed_at = CASE WHEN ? THEN ? ELSE confirmed_at END, updated_at = ? WHERE channel_id = ?`
      )
      .run(
        JSON.stringify(slots),
        JSON.stringify(formats),
        budget,
        JSON.stringify(deadlines),
        level,
        JSON.stringify(gates),
        reasons,
        source,
        confirm ? 1 : 0,
        confirm ? 1 : 0,
        at,
        at,
        channelId
      )
    this.events.add('goals', `Objectifs de la chaîne #${channelId} ${confirm ? 'confirmés' : 'modifiés'} (${source === 'user' ? 'par le propriétaire' : 'par le responsable'})`)
    return this.get(channelId) as ChannelGoals
  }

  /** The goals as the channel's agents read them at every turn (empty when there are none). */
  block(channelId: number | null): string {
    if (channelId === null) return ''
    const g = this.get(channelId)
    if (!g) return ''
    const lines = [
      g.status === 'confirmed' ? 'Objectifs confirmés par le propriétaire :' : 'Objectifs PROPOSÉS (brouillon : le propriétaire ne les a pas encore confirmés) :',
      `- Créneaux : ${g.slots.length === 0 ? 'aucun' : g.slots.map((s) => `${DAY_NAMES[s.day]} ${s.time} (${s.kind === 'short' ? 'Short' : 'longue'})`).join(', ')}`,
      `- Formats : ${g.formats.map((f) => `${f.perWeek} × ${f.kind === 'short' ? 'Short' : 'vidéo longue'} de ${f.minutes} min par semaine`).join(' ; ') || 'aucun'}`,
      `- Budget : ${g.budgetCredits} crédits par mois (1 crédit = 0,01 €)`,
      ...(g.deadlines.length ? [`- Échéances : ${g.deadlines.map((d) => `${d.label} le ${d.date}`).join(' ; ')}`] : []),
      `- Validation : ${g.gates.length === 0 ? 'tout automatique, ne demande rien au propriétaire' : `le propriétaire valide ${g.gates.map((x) => GATE_NAMES[x]).join(', ')} ; décide seul le reste`}`
    ]
    return lines.join('\n')
  }

  /** What Atelier read about the channel (source 0, an import) and its watched competitors. */
  private rhythms(channelId: number): Rhythm[] {
    const rows = this.db
      .prepare(
        `SELECT r.source_key, r.title, r.videos_json FROM channel_reads r
         LEFT JOIN channel_competitors c ON c.id = r.source_key AND c.channel_id = r.channel_id
         WHERE r.channel_id = ? AND (r.source_key = 0 OR c.watched = 1) ORDER BY r.source_key`
      )
      .all(channelId) as { source_key: number; title: string; videos_json: string }[]
    const out: Rhythm[] = []
    for (const r of rows) {
      const videos = parseJson<unknown[]>(r.videos_json, [])
        .filter(isRecord)
        .map((v) => ({ at: Date.parse(String(v.publishedAt)), s: Number(v.durationS) }))
        .filter((v) => Number.isFinite(v.at) && Number.isFinite(v.s) && v.s > 0)
        .sort((a, b) => b.at - a.at)
        .slice(0, 30)
      if (videos.length < 3) continue
      const spanWeeks = Math.max(1, ((videos[0] as { at: number }).at - (videos[videos.length - 1] as { at: number }).at) / (7 * 86_400_000))
      const longs = videos.filter((v) => v.s > SHORT_MAX_S)
      const shorts = videos.length - longs.length
      out.push({
        name: r.title || (r.source_key === 0 ? 'la chaîne' : `concurrent #${r.source_key}`),
        own: r.source_key === 0,
        longPerWeek: longs.length / spanWeeks,
        shortPerWeek: shorts / spanWeeks,
        longMinutes: longs.length ? median(longs.map((v) => v.s / 60)) : null
      })
    }
    return out
  }
}

/** The proposal from the rhythms: the channel's own rhythm first (an import), else the competitors' median. */
export function baseline(rhythms: readonly Rhythm[], now: number): { slots: GoalSlot[]; formats: GoalFormat[]; budgetCredits: number; deadlines: GoalDeadline[]; reasons: string } {
  const own = rhythms.find((r) => r.own)
  const others = rhythms.filter((r) => !r.own)
  const basis = own ? [own] : others
  let longPerWeek = 2
  let shortPerWeek = 0
  let longMinutes = 10
  let reasons: string
  if (basis.length === 0) {
    reasons =
      "Aucune vidéo lue pour l'instant (ni la chaîne ni ses concurrents) : rythme de départ prudent, 2 vidéos longues de 10 min par semaine. Le responsable de chaîne affinera après l'analyse."
  } else {
    longPerWeek = clamp(Math.round(median(basis.map((r) => r.longPerWeek))), 1, 7)
    shortPerWeek = clamp(Math.round(median(basis.map((r) => r.shortPerWeek))), 0, 7)
    const mins = basis.map((r) => r.longMinutes).filter((m): m is number => m !== null)
    longMinutes = mins.length ? clamp(Math.round(median(mins)), 4, 40) : 10
    const who = own ? `le rythme actuel de ${own.name}` : `la médiane de ${others.length} concurrent(s) suivi(s) (${others.map((r) => r.name).join(', ')})`
    reasons = `D'après ${who} : ${fmt(median(basis.map((r) => r.longPerWeek)))} vidéo(s) longue(s) par semaine d'environ ${longMinutes} min${shortPerWeek ? ` et ${fmt(median(basis.map((r) => r.shortPerWeek)))} Short(s)` : ''}.`
  }
  const formats: GoalFormat[] = [{ kind: 'long', minutes: longMinutes, perWeek: longPerWeek }]
  if (shortPerWeek > 0) formats.push({ kind: 'short', minutes: 1, perWeek: shortPerWeek })
  const slots: GoalSlot[] = [
    ...(DAYS[longPerWeek] ?? []).map((day) => ({ day, time: '18:00', kind: 'long' as const })),
    ...(DAYS[shortPerWeek] ?? []).map((day) => ({ day, time: '12:00', kind: 'short' as const }))
  ]
  const minutesPerMonth = formats.reduce((s, f) => s + f.perWeek * f.minutes, 0) * WEEKS_PER_MONTH
  const budgetCredits = Math.ceil((minutesPerMonth * CREDITS_PER_MINUTE_ESTIMATE) / 100) * 100
  reasons += ` Budget estimé à ${CREDITS_PER_MINUTE_ESTIMATE} crédits (1 €) par minute produite, en attendant les vrais devis.`
  // the first video: the first long slot at least a week from now (time to prepare it)
  const first = nextSlotDate(slots.find((s) => s.kind === 'long'), now + 7 * 86_400_000)
  const deadlines: GoalDeadline[] = first ? [{ label: 'Première vidéo publiée', date: first }] : []
  return { slots, formats, budgetCredits, deadlines, reasons }
}

function nextSlotDate(slot: GoalSlot | undefined, from: number): string | null {
  if (!slot) return null
  const d = new Date(from)
  for (let i = 0; i < 8; i++) {
    const isoDay = ((d.getDay() + 6) % 7) + 1
    if (isoDay === slot.day) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    d.setDate(d.getDate() + 1)
  }
  return null
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const fmt = (v: number): string => (Math.round(v * 10) / 10).toString().replace('.', ',')

function toGoals(r: GoalsRow): ChannelGoals {
  return {
    channelId: r.channel_id,
    status: r.status,
    slots: parseJson<GoalSlot[]>(r.slots_json, []),
    formats: parseJson<GoalFormat[]>(r.formats_json, []),
    budgetCredits: r.budget_credits,
    deadlines: parseJson<GoalDeadline[]>(r.deadlines_json, []),
    level: r.level,
    gates: parseJson<GoalGate[]>(r.gates_json, []),
    reasons: r.reasons,
    source: r.source,
    trigger: r.trigger_kind,
    inboxId: r.inbox_id,
    proposedAt: r.proposed_at,
    confirmedAt: r.confirmed_at,
    updatedAt: r.updated_at
  }
}

// ---- validation (French messages: they reach Charlie's screen) ---------------------------------------------------

function cleanSlots(v: unknown): GoalSlot[] {
  if (!Array.isArray(v) || v.length > 21) throw new Error('Entre 0 et 21 créneaux par semaine.')
  return v.map((s) => {
    if (!isRecord(s) || !Number.isInteger(s.day) || (s.day as number) < 1 || (s.day as number) > 7) throw new Error('Un créneau a un jour de 1 (lundi) à 7 (dimanche).')
    if (typeof s.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) throw new Error('Un créneau a une heure HH:MM.')
    return { day: s.day as number, time: s.time, kind: s.kind === 'short' ? 'short' : 'long' }
  })
}

function cleanFormats(v: unknown): GoalFormat[] {
  if (!Array.isArray(v) || v.length > 4) throw new Error('Entre 0 et 4 formats.')
  return v.map((f) => {
    if (!isRecord(f)) throw new Error('Un format : type, durée, nombre par semaine.')
    const minutes = Number(f.minutes)
    const perWeek = Number(f.perWeek)
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 240) throw new Error('Une durée entre 1 et 240 minutes.')
    if (!Number.isInteger(perWeek) || perWeek < 0 || perWeek > 21) throw new Error('Entre 0 et 21 vidéos par semaine pour un format.')
    return { kind: f.kind === 'short' ? 'short' : 'long', minutes: Math.round(minutes * 10) / 10, perWeek }
  })
}

function cleanBudget(v: unknown): number {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new Error('Un budget en crédits entier, positif.')
  return n
}

function cleanDeadlines(v: unknown): GoalDeadline[] {
  if (!Array.isArray(v) || v.length > 12) throw new Error('12 échéances au plus.')
  return v.map((d) => {
    if (!isRecord(d) || typeof d.label !== 'string' || !d.label.trim() || d.label.length > 120) throw new Error('Une échéance a un libellé (120 caractères au plus).')
    if (typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !Number.isFinite(Date.parse(d.date))) throw new Error('Une échéance a une date AAAA-MM-JJ.')
    return { label: d.label.trim(), date: d.date }
  })
}

function cleanLevel(v: unknown): ApprovalLevel {
  if (!(APPROVAL_LEVELS as readonly unknown[]).includes(v)) throw new Error('Niveau de validation : recommandé, tout automatique, tout manuel ou sur mesure.')
  return v as ApprovalLevel
}

function cleanGates(v: unknown): GoalGate[] {
  if (!Array.isArray(v) || v.some((g) => !(GOAL_GATES as readonly unknown[]).includes(g))) throw new Error(`Étapes de validation connues : ${GOAL_GATES.join(', ')}.`)
  return GOAL_GATES.filter((g) => v.includes(g))
}
