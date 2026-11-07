// Standing-allow rules (migration 028, docs/AGENT-RUNTIME.md §27): Charlie answers a validation with « Toujours valider
// pour ce type » — in the app or on Discord — and the next questions of that channel about that gate are approved without
// asking him. A rule may be limited to one series (« sujets d'une série déjà validée ») or to a number of uses; Charlie
// takes it back whenever he wants. The gate check of the approval levels (actions.ts) reads `match`; an approval by a rule
// is like one by the level: never Charlie's yes for `production.approve` or `channel.create`.
import type { AllowAlwaysInput, AllowAlwaysResult, AllowRule, GoalGate } from '../../shared/api/autopilot'
import type { Db } from '../db'
import { GATE_NAMES } from './goals'
import type { Orchestra } from './runtime'
import { iso, type Clock, type EventLog } from './util'

interface RuleRow {
  id: number
  channel_id: number
  gate: GoalGate
  series: string | null
  max_uses: number | null
  uses: number
  source_inbox_id: number | null
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

/** Series names compare without case or spacing differences mattering. */
export const seriesKey = (s: string | null | undefined): string => (s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()

export class AllowRules {
  constructor(
    private readonly db: Db,
    private readonly now: Clock,
    private readonly events: EventLog
  ) {}

  get(id: number): AllowRule {
    const r = Number.isInteger(id) ? (this.db.prepare('SELECT * FROM orch_allow_rules WHERE id = ?').get(id) as unknown as RuleRow | undefined) : undefined
    if (!r) throw new Error('Cette règle n’existe pas.')
    return toRule(r)
  }

  /** The rules that apply (one channel's, or all), newest first; `all` adds the revoked and used-up ones. */
  list(channelId?: number, all = false): AllowRule[] {
    const where = [channelId !== undefined ? 'channel_id = ?' : '', all ? '' : 'revoked_at IS NULL'].filter(Boolean)
    const sql = `SELECT * FROM orch_allow_rules${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 200`
    const rows = (channelId !== undefined ? this.db.prepare(sql).all(channelId) : this.db.prepare(sql).all()) as unknown as RuleRow[]
    return rows.map(toRule)
  }

  /** A new rule; the same live rule (channel, gate, series) is reused and takes the new limit. */
  add(input: { channelId: number; gate: GoalGate; series: string | null; maxUses: number | null; sourceInboxId: number | null }): AllowRule {
    const same = this.list(input.channelId).find((r) => r.gate === input.gate && seriesKey(r.series) === seriesKey(input.series))
    if (same) {
      this.db.prepare('UPDATE orch_allow_rules SET max_uses = ?, uses = 0 WHERE id = ?').run(input.maxUses, same.id)
      return this.get(same.id)
    }
    const r = this.db
      .prepare('INSERT INTO orch_allow_rules (channel_id, gate, series, max_uses, source_inbox_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(input.channelId, input.gate, input.series, input.maxUses, input.sourceInboxId, iso(this.now()))
    const rule = this.get(Number(r.lastInsertRowid))
    this.events.add('allow-rule', `Règle « toujours » #${rule.id} : ${describeRule(rule)} (chaîne #${rule.channelId})`)
    return rule
  }

  revoke(id: number): AllowRule {
    const rule = this.get(id)
    if (rule.revokedAt) return rule
    this.db.prepare('UPDATE orch_allow_rules SET revoked_at = ? WHERE id = ?').run(iso(this.now()), id)
    this.events.add('allow-rule', `Règle « toujours » #${id} retirée : ${describeRule(rule)}`)
    return this.get(id)
  }

  /** The live rule covering a question: one for its series first, else one for the whole gate. */
  match(channelId: number, gate: GoalGate, series: string | null): AllowRule | null {
    const live = this.list(channelId).filter((r) => r.gate === gate)
    const key = seriesKey(series)
    return (key ? live.find((r) => r.series !== null && seriesKey(r.series) === key) : undefined) ?? live.find((r) => r.series === null) ?? null
  }

  /** A question was approved by the rule; a rule with a limit is used up at its last use. */
  use(id: number): void {
    const at = iso(this.now())
    this.db
      .prepare(
        `UPDATE orch_allow_rules SET uses = uses + 1, last_used_at = ?,
           revoked_at = CASE WHEN max_uses IS NOT NULL AND uses + 1 >= max_uses THEN ? ELSE revoked_at END WHERE id = ?`
      )
      .run(at, at, id)
  }
}

/** « sujets », « sujets de la série « Égypte » », « sujets (3 fois) ». */
export function describeRule(r: Pick<AllowRule, 'gate' | 'series' | 'maxUses'>): string {
  return `${GATE_NAMES[r.gate]}${r.series ? ` de la série « ${r.series} »` : ''}${r.maxUses ? ` (${r.maxUses} fois)` : ''}`
}

/**
 * « Toujours valider pour ce type »: the rule from an open validation (it needs a gate and a channel), the question
 * answered with its first option, and the other questions already waiting that the rule covers answered too.
 */
export function allowAlways(o: Pick<Orchestra, 'parts' | 'answer'>, inboxId: number, input: AllowAlwaysInput = {}): AllowAlwaysResult {
  const p = o.parts
  const item = p.inbox.get(inboxId)
  if (item.status !== 'open') throw new Error('Cette question a déjà une réponse.')
  if (item.kind !== 'validate' || item.gate === null || item.channelId === null) {
    throw new Error('« Toujours valider » ne vaut que pour une validation d’une étape de vidéo d’une chaîne (sujet, script, voix, miniature, vidéo, kit).')
  }
  const series = input?.series === true ? item.series : null
  if (input?.series === true && !series) throw new Error('Cette question ne fait pas partie d’une série.')
  const maxUses = input?.maxUses === undefined ? null : input.maxUses
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100)) throw new Error('Une limite entre 1 et 100 questions.')
  const rule = p.allow.add({ channelId: item.channelId, gate: item.gate, series, maxUses, sourceInboxId: item.id })
  const answered = o.answer(item.id, answerFor(item.options, `Toujours valider : ${describeRule(rule)}.`))
  let alsoAnswered = 0
  for (const other of p.inbox.list()) {
    if (other.id === item.id || other.kind !== 'validate' || other.channelId !== item.channelId || other.gate !== item.gate) continue
    const current = p.allow.match(item.channelId, item.gate, other.series)
    if (current?.id !== rule.id) continue
    o.answer(other.id, answerFor(other.options, `Validé par ta règle « toujours » (${describeRule(rule)}).`))
    p.allow.use(rule.id)
    alsoAnswered++
  }
  return { rule: p.allow.get(rule.id), item: answered, alsoAnswered }
}

function answerFor(options: readonly string[], text: string): { choice?: string; text: string } {
  return options[0] !== undefined ? { choice: options[0], text } : { text }
}

function toRule(r: RuleRow): AllowRule {
  return {
    id: r.id,
    channelId: r.channel_id,
    gate: r.gate,
    series: r.series,
    maxUses: r.max_uses,
    uses: r.uses,
    sourceInboxId: r.source_inbox_id,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at
  }
}
