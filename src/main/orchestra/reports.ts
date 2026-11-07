// The daily digest and the weekly report (docs/AGENT-RUNTIME.md §27): what shipped, what is late and why, what waits for
// Charlie, and what the team spent, computed in code from the real state — the planner's slots and early warnings, the
// inbox, the queue, the events and the ledger. No model call: the same numbers in the app (« Activité ») and on Discord.
import type { ReportDecision, ReportKind, ReportLate, ReportShipped, ReportSpend, TeamReport } from '../../shared/api/autopilot'
import { monthBounds, monthOf } from '../ledger'
import { GATE_NAMES } from './goals'
import type { RuntimeParts } from './parts'
import { slotLabel } from './plan'
import { iso } from './util'

const HOUR = 3_600_000
const SHOWN = 8

const REASONS: Record<string, string> = {
  late: 'en retard',
  budget: 'budget',
  production: 'production',
  missed: 'créneau manqué'
}

export function teamReport(p: RuntimeParts, kind: ReportKind, utc = false): TeamReport {
  const to = p.now()
  const from = to - (kind === 'weekly' ? 7 * 24 : 24) * HOUR
  const [fromIso, toIso] = [iso(from), iso(to)]
  const shipped = shippedIn(p, fromIso, toIso)
  const late = lateNow(p, fromIso, toIso)
  const decisions = decisionsOpen(p, to)
  const finished = p.queue.finishedSince(from)
  const tasks = { done: finished.filter((t) => t.status === 'done').length, stopped: finished.filter((t) => t.status === 'dead').length }
  const autoRows = p.db.prepare(`SELECT text FROM orch_events WHERE type = 'auto-approved' AND at >= ? AND at <= ?`).all(fromIso, toIso) as { text: string }[]
  const rules = autoRows.filter((r) => r.text.includes('standing rule')).length
  const autoApproved = { level: autoRows.length - rules, rules }
  const spend = spendIn(p, fromIso, toIso, to)
  const report: Omit<TeamReport, 'text'> = { kind, from: fromIso, to: toIso, shipped, late, decisions, tasks, autoApproved, spend }
  return { ...report, text: reportText(report, utc) }
}

/** Kits made ready for their slot, and videos marked published, in the period. */
function shippedIn(p: RuntimeParts, from: string, to: string): ReportShipped[] {
  const ready = p.db
    .prepare(
      `SELECT c.name AS channel, COALESCE(v.title, '') AS title, s.slot_at, s.updated_at AS at FROM orch_plan_slots s
       JOIN channels c ON c.id = s.channel_id LEFT JOIN videos v ON v.id = s.video_id
       WHERE s.status = 'ready' AND s.updated_at >= ? AND s.updated_at <= ? ORDER BY s.slot_at`
    )
    .all(from, to) as { channel: string; title: string; slot_at: string; at: string }[]
  const published = p.db
    .prepare(
      `SELECT c.name AS channel, v.title, v.updated_at AS at FROM videos v JOIN channels c ON c.id = v.channel_id
       WHERE v.status = 'published' AND v.updated_at >= ? AND v.updated_at <= ? ORDER BY v.updated_at`
    )
    .all(from, to) as { channel: string; title: string; at: string }[]
  return [
    ...ready.map((r) => ({ channelName: r.channel, title: r.title || `créneau du ${r.slot_at.slice(0, 10)}`, state: 'ready' as const, at: r.slot_at })),
    ...published.map((r) => ({ channelName: r.channel, title: r.title, state: 'published' as const, at: r.at }))
  ]
}

/** The early warnings of slots still open, and the slots of the period that passed without a ready kit. */
function lateNow(p: RuntimeParts, from: string, to: string): ReportLate[] {
  const warned = p.db
    .prepare(
      `SELECT c.name AS channel, w.slot_at, w.reason, w.text FROM orch_plan_warnings w
       JOIN orch_plan_slots s ON s.channel_id = w.channel_id AND s.slot_at = w.slot_at JOIN channels c ON c.id = w.channel_id
       WHERE s.status = 'planned' ORDER BY w.slot_at, w.reason`
    )
    .all() as { channel: string; slot_at: string; reason: string; text: string }[]
  const missed = p.db
    .prepare(
      `SELECT c.name AS channel, s.slot_at FROM orch_plan_slots s JOIN channels c ON c.id = s.channel_id
       WHERE s.status = 'planned' AND s.slot_at >= ? AND s.slot_at <= ? ORDER BY s.slot_at`
    )
    .all(from, to) as { channel: string; slot_at: string }[]
  return [
    ...missed.map((m) => ({ channelName: m.channel, slotAt: m.slot_at, reason: 'missed', text: 'Le créneau est passé sans kit de publication prêt.' })),
    ...warned.map((w) => ({ channelName: w.channel, slotAt: w.slot_at, reason: w.reason, text: w.text }))
  ]
}

/** What waits for Charlie's answer (questions, validations, files), oldest first. */
function decisionsOpen(p: RuntimeParts, now: number): ReportDecision[] {
  const rows = p.db
    .prepare(
      `SELECT i.id, i.kind, i.title, i.gate, i.created_at, c.name AS channel FROM orch_inbox i LEFT JOIN channels c ON c.id = i.channel_id
       WHERE i.status = 'open' AND i.kind != 'alert' ORDER BY i.id`
    )
    .all() as { id: number; kind: ReportDecision['kind']; title: string; gate: string | null; created_at: string; channel: string | null }[]
  return rows.map((r) => ({
    inboxId: r.id,
    channelName: r.channel,
    title: r.title,
    kind: r.kind,
    gate: r.gate !== null && r.gate in GATE_NAMES ? (r.gate as ReportDecision['gate']) : null,
    hours: Math.max(0, Math.floor((now - Date.parse(r.created_at)) / HOUR))
  }))
}

/** The team's calls in the ledger (booked with an account) in the period, per channel, and this month. */
function spendIn(p: RuntimeParts, from: string, to: string, now: number): TeamReport['spend'] {
  const usd = `COALESCE(SUM(CASE l.status WHEN 'reserved' THEN l.estimate_usd WHEN 'refunded' THEN 0 ELSE l.amount_usd END), 0)`
  const rows = p.db
    .prepare(
      `SELECT c.name AS channel, COUNT(*) AS calls, ${usd} AS usd FROM ledger l LEFT JOIN channels c ON c.id = l.channel_id
       WHERE l.account_id IS NOT NULL AND l.created_at >= ? AND l.created_at <= ? GROUP BY l.channel_id ORDER BY usd DESC`
    )
    .all(from, to) as { channel: string | null; calls: number; usd: number }[]
  const { start, end } = monthBounds(monthOf(new Date(now)))
  const month = p.db.prepare(`SELECT ${usd} AS usd FROM ledger l WHERE l.account_id IS NOT NULL AND l.created_at >= ? AND l.created_at < ?`).get(start, end) as { usd: number }
  const round = (v: number): number => Math.round(v * 100) / 100
  const byChannel: ReportSpend[] = rows.map((r) => ({ channelName: r.channel, usd: round(r.usd), calls: r.calls }))
  return {
    usd: round(rows.reduce((s, r) => s + r.usd, 0)),
    calls: rows.reduce((s, r) => s + r.calls, 0),
    monthUsd: round(month.usd),
    byChannel
  }
}

const money = (v: number): string => `${v.toFixed(2).replace('.', ',')} $`

/** The report as posted on Discord (Markdown, French). */
export function reportText(r: Omit<TeamReport, 'text'>, utc = false): string {
  const at = (s: string): string => slotLabel(Date.parse(s), utc)
  const more = (n: number): string[] => (n > SHOWN ? [`• … et ${n - SHOWN} de plus`] : [])
  const lines = [`**${r.kind === 'weekly' ? 'Rapport de la semaine' : 'Digest du jour'}**`]

  lines.push('', `**Livré** : ${r.shipped.length}`)
  for (const s of r.shipped.slice(0, SHOWN)) lines.push(`• ${s.channelName} — ${s.title} (${s.state === 'ready' ? `kit prêt pour ${at(s.at)}` : 'publiée'})`)
  lines.push(...more(r.shipped.length))

  lines.push('', `**En retard, et pourquoi** : ${r.late.length}`)
  for (const l of r.late.slice(0, SHOWN)) lines.push(`• ${l.channelName} · ${at(l.slotAt)} · ${REASONS[l.reason] ?? l.reason.replace(/^failed-/, 'échec ')} : ${l.text}`)
  lines.push(...more(r.late.length))

  lines.push('', `**Décisions à prendre** : ${r.decisions.length}`)
  for (const d of r.decisions.slice(0, SHOWN)) {
    const gate = d.gate ? ` (${GATE_NAMES[d.gate]})` : ''
    lines.push(`• ${d.channelName ? `${d.channelName} — ` : ''}${d.title}${gate}, depuis ${d.hours} h`)
  }
  lines.push(...more(r.decisions.length))

  const auto = r.autoApproved.level + r.autoApproved.rules
  lines.push('', `**Travail** : ${r.tasks.done} tâche(s) terminée(s), ${r.tasks.stopped} arrêtée(s)${auto ? ` ; ${auto} validation(s) sans te déranger (${r.autoApproved.rules} par tes règles « toujours »)` : ''}`)

  lines.push('', `**Dépenses** : ${money(r.spend.usd)} sur la période (${r.spend.calls} appel(s)), ${money(r.spend.monthUsd)} ce mois-ci`)
  for (const c of r.spend.byChannel.slice(0, SHOWN)) lines.push(`• ${c.channelName ?? 'Équipe'} : ${money(c.usd)}`)
  return lines.join('\n')
}
