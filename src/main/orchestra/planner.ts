// The planner (docs/AGENT-RUNTIME.md §26): the team picks up work before being asked. A pass in code (no LLM), every
// hour or as soon as a planned step finished, for each channel whose goals Charlie confirmed: each publication slot of
// the next 7 days gets its video, and from 5 days before it (2,5 for a Short: the subscription is spread over the week)
// its chain of steps worked backwards from the slot (plan.ts): the next missing step is enqueued for the channel lead — once: a slot and each of its steps have a key, and the step row and its task
// are written in one transaction, so a crash or a restart never makes a duplicate.
//   - Budget: before the production step, the production port quotes the video; it opens only when the quote fits in
//     the channel's monthly credits minus what this month's runs booked and what is already promised to planned ones.
//   - Subscription limits: while every account of a step's tier is at its limit the step waits for the reset; an
//     expensive turn (the `best` tier, the script) waits for a limited account's reset when its deadline allows, so the
//     accounts left serve the cheap work first.
//   - Early warning: when a slot will be missed (the steps left do not fit before it, the budget, production not wired,
//     a step that died), an alert lands in Charlie's inbox with the reason, once per slot and reason.
//   - Imported scripts (agents-production): a slot's video takes the oldest script of its channel imported with « J'ai
//     mon script » and not used yet; such a video skips the topic, its approval and the script. The production step is
//     done only when the video's run succeeded (a failed or cancelled run is warned about with its reason).
// Only Charlie's gates ask him: the step's brief says which validations his approval level wants (the approval step
// only exists when topics are one of them), and A2's auto-approval covers anything else.
import type { ChannelGoals } from '../../shared/api/autopilot'
import type { OrchTask } from '../../shared/api/orchestra'
import { transaction } from '../db'
import { monthOf } from '../ledger'
import type { ProductionPort } from '../production/port'
import { gateOfNode, realRunAllowed } from './goals'
import type { RuntimeParts } from './parts'
import { STEPS, deadlineOf, isSlotTitle, plannedMinutes, slotTitle, topicFromResult, durationOf, finishEstimate, opensAt, slotLabel, slotTimes, type SlotKind, type StepDef } from './plan'
import type { AgentRecord } from './tree'
import { iso, truncate } from './util'

const HOUR = 3_600_000
export const PLAN_HORIZON_MS = 7 * 24 * HOUR
export const PLAN_EVERY_MS = HOUR
const GATE_LOOK_MS = 60_000
/** The last pass (ISO); set to null to make the next supervisor tick pass again (a run that ended, production-news.ts). */
export const PLANNER_LAST_RUN = 'orchestra.planner.lastRun'
const LAST_RUN = PLANNER_LAST_RUN
const DONE = new Set(['done'])
const DEAD = new Set(['dead', 'cancelled'])
/** The steps an imported script makes useless. */
const WRITTEN = new Set(['topic', 'approval', 'script'])
/** A QC result that refuses the video (the quality eye's own words, French or English). */
const QC_REFUSED = /(\bFAIL(ED)?\b|non valid[ée]e?|ne pas publier|pas publiable|\brefus[ée]e?\b|\brejet[ée]e?\b|not publishable|do not publish)/i

interface Slot {
  channelId: number
  channel: string
  at: number
  kind: SlotKind
  videoId: number | null
  status: 'planned' | 'ready' | 'retired'
  lead: AgentRecord
  goals: ChannelGoals
}

interface StepRow {
  step: string
  task_id: number | null
  status: 'open' | 'skipped'
  credits: number
}

export class Planner {
  private readonly p: RuntimeParts
  private readonly port: ProductionPort
  /** Slot times and labels in UTC (tests, the demo) rather than local time. */
  readonly utc: boolean
  /** A port call (quote, runs) that does not answer in time is given up: the loop never hangs on the Cloud. */
  portTimeoutMs = 30_000

  constructor(p: RuntimeParts, port: ProductionPort, utc: boolean) {
    this.p = p
    this.port = port
    this.utc = utc
  }

  /** An hour since the last pass, or a planned step finished since then. */
  due(): boolean {
    const last = this.p.settings.get<string | null>(LAST_RUN, null)
    const lastMs = typeof last === 'string' ? Date.parse(last) : NaN
    if (!Number.isFinite(lastMs) || this.p.now() - lastMs >= PLAN_EVERY_MS || lastMs > this.p.now()) return true
    // a slot's run waiting at a gate is looked at within a minute: the level may pass it (passRunGates)
    if (this.p.now() - lastMs >= GATE_LOOK_MS && this.p.db.prepare(`SELECT 1 FROM video_runs r JOIN orch_plan_slots s ON s.video_id = r.video_id WHERE r.status = 'waiting' AND s.status = 'planned' LIMIT 1`).get() !== undefined) return true
    return (
      this.p.db
        .prepare(`SELECT 1 FROM orch_tasks WHERE finished_at >= ? AND json_extract(payload, '$.plan.step') IS NOT NULL LIMIT 1`)
        .get(iso(lastMs)) !== undefined
    )
  }

  /** The supervisor's call: a pass when one is due. Returns the steps opened. */
  async maybe(): Promise<number> {
    return this.due() ? this.pass() : 0
  }

  /** One pass over every channel with confirmed goals. Returns the steps opened. */
  async pass(): Promise<number> {
    const p = this.p
    p.settings.set(LAST_RUN, iso(p.now()))
    const channels = p.db
      .prepare(
        `SELECT c.id, c.name FROM channels c JOIN channel_goals g ON g.channel_id = c.id
         WHERE c.archived_at IS NULL AND g.status = 'confirmed' ORDER BY c.id`
      )
      .all() as { id: number; name: string }[]
    let opened = 0
    for (const ch of channels) {
      try {
        opened += await this.channel(ch)
      } catch (err: unknown) {
        // one channel's problem is said and does not stop the others; the next pass tries it again
        p.events.add('error', `Planner, ${ch.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return opened
  }

  private async channel(ch: { id: number; name: string }): Promise<number> {
    const p = this.p
    const lead = p.tree.bySlug(`lead-${ch.id}`)
    const goals = p.goals.get(ch.id)
    if (!lead || lead.archivedAt || !goals) return 0
    const now = p.now()
    const times = slotTimes(goals.slots, now, now + PLAN_HORIZON_MS, this.utc)
    this.retireMoved(ch.id, ch.name, new Set(times.map((s) => iso(s.at))))
    let opened = 0
    for (const s of times) {
      const slot = this.ensureSlot({ channelId: ch.id, channel: ch.name, at: s.at, kind: s.kind, videoId: null, status: 'planned', lead, goals })
      if (slot.status !== 'planned' || now < opensAt(s.at, s.kind)) continue
      if (await this.advance(slot)) opened++
    }
    return opened
  }

  /**
   * Charlie moved or removed a slot (or the machine's time zone changed): the planned slot no longer in the goals is
   * retired — its open steps cancelled (their promised credits go back to the month), its video cancelled — so its work
   * is never done twice. Finished steps are kept, in case the slot comes back.
   */
  private retireMoved(channelId: number, channel: string, current: ReadonlySet<string>): void {
    const p = this.p
    const rows = p.db
      .prepare(`SELECT slot_at, video_id FROM orch_plan_slots WHERE channel_id = ? AND status = 'planned' AND slot_at > ?`)
      .all(channelId, iso(p.now())) as { slot_at: string; video_id: number | null }[]
    for (const r of rows) {
      if (current.has(r.slot_at)) continue
      const steps = p.db.prepare('SELECT step, task_id FROM orch_plan_steps WHERE channel_id = ? AND slot_at = ?').all(channelId, r.slot_at) as { step: string; task_id: number | null }[]
      for (const s of steps) {
        const t = s.task_id === null ? null : p.queue.find(s.task_id)
        if (t && t.status === 'done') continue
        if (t && !DEAD.has(t.status)) p.queue.cancel(t.id)
        p.db.prepare('DELETE FROM orch_plan_steps WHERE channel_id = ? AND slot_at = ? AND step = ?').run(channelId, r.slot_at, s.step)
      }
      p.db.prepare('DELETE FROM orch_plan_warnings WHERE channel_id = ? AND slot_at = ?').run(channelId, r.slot_at)
      p.db.prepare(`UPDATE orch_plan_slots SET status = 'retired', updated_at = ? WHERE channel_id = ? AND slot_at = ?`).run(iso(p.now()), channelId, r.slot_at)
      if (r.video_id !== null) p.db.prepare(`UPDATE videos SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(iso(p.now()), r.video_id)
      p.events.add('plan', `${channel} : créneau ${slotLabel(Date.parse(r.slot_at), this.utc)} retiré (il n'est plus dans les objectifs)`)
    }
  }

  /** The slot's row and its video, made once. */
  private ensureSlot(s: Slot): Slot {
    const { db } = this.p
    const at = iso(s.at)
    const now = iso(this.p.now())
    transaction(db, () => {
      const r = db
        .prepare(`INSERT OR IGNORE INTO orch_plan_slots (channel_id, slot_at, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
        .run(s.channelId, at, s.kind, now, now)
      if (Number(r.changes) !== 1) return
      const v = db
        .prepare(`INSERT INTO videos (channel_id, title, brief, status, deadline, created_at, updated_at) VALUES (?, ?, ?, 'idea', ?, ?, ?)`)
        .run(s.channelId, slotTitle(slotLabel(s.at, this.utc)), '', at, now, now)
      db.prepare('UPDATE orch_plan_slots SET video_id = ? WHERE channel_id = ? AND slot_at = ?').run(Number(v.lastInsertRowid), s.channelId, at)
      this.p.events.add('plan', `${s.channel} : créneau ${slotLabel(s.at, this.utc)} planifié`, s.lead.id)
    })
    const row = db.prepare('SELECT video_id, status FROM orch_plan_slots WHERE channel_id = ? AND slot_at = ?').get(s.channelId, at) as { video_id: number | null; status: Slot['status'] }
    if (row.status === 'retired') {
      // the slot is back in the goals: planned again, from the steps it had finished
      db.prepare(`UPDATE orch_plan_slots SET status = 'planned', updated_at = ? WHERE channel_id = ? AND slot_at = ?`).run(now, s.channelId, at)
      if (row.video_id !== null) db.prepare(`UPDATE videos SET status = 'idea', updated_at = ? WHERE id = ?`).run(now, row.video_id)
      return { ...s, videoId: row.video_id, status: 'planned' }
    }
    return { ...s, videoId: row.video_id, status: row.status }
  }

  /** Moves a slot on: the next missing step is opened; a late or blocked slot is warned about. True when a step opened. */
  private async advance(slot: Slot): Promise<boolean> {
    const p = this.p
    const at = iso(slot.at)
    const rows = new Map(
      (p.db.prepare('SELECT step, task_id, status, credits FROM orch_plan_steps WHERE channel_id = ? AND slot_at = ?').all(slot.channelId, at) as unknown as StepRow[]).map((r) => [r.step, r])
    )
    const gates = p.goals.gates(slot.channelId)
    // the owner's own script (« J'ai mon script ») waiting for a video of this channel: this slot takes it
    if (slot.videoId !== null && !rows.has('script')) {
      const linked = this.port.linkScript?.(slot.channelId, slot.videoId) ?? null
      if (linked) p.events.add('plan', `${slot.channel} : le créneau ${slotLabel(slot.at, this.utc)} prend le script importé « ${truncate(linked.title, 80)} »`, slot.lead.id)
    }
    const imported = slot.videoId !== null && this.port.hasScript?.(slot.videoId) === true
    const needed = (d: StepDef): boolean => (imported && WRITTEN.has(d.step) ? false : d.step !== 'approval' || gates.includes('topic'))
    for (const [i, def] of STEPS.entries()) {
      const row = rows.get(def.step)
      if (row?.status === 'skipped') continue
      if (!row && !needed(def)) {
        this.skip(slot, def)
        continue
      }
      const left = STEPS.slice(i).filter((d) => needed(d) && rows.get(d.step)?.status !== 'skipped')
      if (row) {
        const task = row.task_id === null ? null : p.queue.find(row.task_id)
        if (task && DONE.has(task.status)) {
          if (def.step === 'topic' || def.step === 'script') this.adoptTopic(slot, task.result)
          if (def.step === 'qc' && (await this.qcRefused(slot, task))) return false
          if (def.step !== 'production' || (await this.produced(slot))) continue
          return false
        }
        if (!task || DEAD.has(task.status)) {
          const why = task?.status === 'cancelled' ? 'a été annulée' : `a échoué${task?.error ? ` (${truncate(task.error, 200)})` : ''}`
          this.warn(slot, `failed-${def.step}`, `L'étape « ${def.label} » ${why}. Relance-la depuis l'équipe, ou ce créneau sera manqué.`)
          return false
        }
        this.checkLate(slot, left, p.now())
        return false
      }
      // the next missing step
      let credits = 0
      if (def.step === 'production') {
        const fit = await this.budgetFor(slot)
        if (fit === null) return false
        credits = fit.credits
      }
      const notBefore = this.notBefore(slot, def)
      const task = this.open(slot, def, gates, credits, notBefore)
      this.checkLate(slot, left, Math.max(p.now(), notBefore ?? 0))
      return task !== null
    }
    // every step is done: the kit is ready for its slot
    const r = p.db.prepare(`UPDATE orch_plan_slots SET status = 'ready', updated_at = ? WHERE channel_id = ? AND slot_at = ? AND status = 'planned'`).run(iso(p.now()), slot.channelId, at)
    if (Number(r.changes) === 1) {
      if (slot.videoId !== null) p.db.prepare(`UPDATE videos SET status = 'ready', updated_at = ? WHERE id = ?`).run(iso(p.now()), slot.videoId)
      p.events.add('plan', `${slot.channel} : kit prêt pour le créneau ${slotLabel(slot.at, this.utc)}`, slot.lead.id)
    }
    return false
  }

  private skip(slot: Slot, def: StepDef): void {
    this.p.db
      .prepare(`INSERT OR IGNORE INTO orch_plan_steps (channel_id, slot_at, step, status, deadline, created_at) VALUES (?, ?, ?, 'skipped', ?, ?)`)
      .run(slot.channelId, iso(slot.at), def.step, iso(deadlineOf(def.step, slot.at, slot.kind)), iso(this.p.now()))
  }

  /** The step's row and its task, in one transaction: null when it already exists. */
  private open(slot: Slot, def: StepDef, gates: readonly string[], credits: number, notBefore: number | null): OrchTask | null {
    const p = this.p
    const at = iso(slot.at)
    const deadline = deadlineOf(def.step, slot.at, slot.kind)
    const now = p.now()
    const asks = def.gates.filter((g) => gates.includes(g))
    const minutes = slot.videoId !== null ? plannedMinutes(p.db, slot.videoId) : null
    const tier = p.router.resolve(def.kind, slot.lead.policy).tier
    const slack = deadline - Math.max(now, notBefore ?? 0) - durationOf(def.step, slot.kind)
    const urgency = slack < 0 ? 7 : slack < 24 * HOUR ? 6 : 5
    const priority = Math.min(8, Math.max(1, urgency + (tier === 'fast' ? 1 : tier === 'best' ? -1 : 0)))
    const earlier = STEPS.slice(0, STEPS.indexOf(def))
      .map((d) => {
        const id = (p.db.prepare('SELECT task_id FROM orch_plan_steps WHERE channel_id = ? AND slot_at = ? AND step = ?').get(slot.channelId, at, d.step) as { task_id: number | null } | undefined)?.task_id
        const result = id ? p.queue.find(id)?.result : null
        return result ? `${d.step}: ${truncate(result.replace(/\s+/g, ' '), 300)}` : null
      })
      .filter((x): x is string => x !== null)
    const brief = [
      `Planned step "${def.step}" for the ${slot.kind === 'short' ? 'Short' : 'video'} of the slot ${at} (${slotLabel(slot.at, this.utc)}); deadline ${iso(deadline)}.`,
      ...(slot.videoId !== null ? [`Video #${slot.videoId}.`] : []),
      ...(minutes ? [`Target length: ${minutes} min (the channel's goals for this slot): write and produce for that length, not the pipeline's default.`] : []),
      def.brief,
      ...(credits ? [`Quote: ${credits} credits (mode usage_max), within the channel's monthly budget.`] : []),
      ...(def.step === 'production' && realRunAllowed(slot.goals)
        ? ["Charlie confirmed this channel's budget and leaves the production to the team (its approval level): launch the run for REAL (project_run with real: true), within the quote. A demo run would give him nothing to publish."]
        : []),
      ...(earlier.length ? [`Earlier steps: ${earlier.join(' | ')}.`] : []),
      asks.length
        ? asks.map((g) => `Charlie validates this step: ask_human kind validate with gate "${g}" (put what he must see in the question), then finish with done once approved.`).join(' ')
        : "No validation by Charlie for this step (the channel's approval level): decide and finish with done."
    ].join(' ')
    const task = transaction(p.db, () => {
      const r = p.db
        .prepare(`INSERT OR IGNORE INTO orch_plan_steps (channel_id, slot_at, step, status, deadline, credits, created_at) VALUES (?, ?, ?, 'open', ?, ?, ?)`)
        .run(slot.channelId, at, def.step, iso(deadline), credits, iso(now))
      if (Number(r.changes) !== 1) return null
      const t = p.queue.enqueue({
        kind: def.kind,
        title: `${def.label[0]?.toUpperCase()}${def.label.slice(1)} · ${slotLabel(slot.at, this.utc)}`,
        assigneeId: slot.lead.id,
        payload: { brief, plan: { slotAt: at, kind: slot.kind, step: def.step, deadline: iso(deadline), gates: asks, ...(credits ? { credits } : {}) } },
        priority,
        channelId: slot.channelId,
        videoId: slot.videoId,
        notBefore
      })
      p.db.prepare('UPDATE orch_plan_steps SET task_id = ? WHERE channel_id = ? AND slot_at = ? AND step = ?').run(t.id, slot.channelId, at, def.step)
      return t
    })
    if (task) {
      p.events.add('plan', `${slot.channel} : « ${def.label} » lancé pour le créneau ${slotLabel(slot.at, this.utc)} (#${task.id})${notBefore ? `, après la remise à zéro du compte (${iso(notBefore)})` : ''}`, slot.lead.id, task.id)
      p.tree.refreshStatus(slot.lead.id)
    }
    return task
  }

  /** When the step should start because of the accounts' limits, or null for now. */
  private notBefore(slot: Slot, def: StepDef): number | null {
    const p = this.p
    const tier = p.router.resolve(def.kind, slot.lead.policy).tier
    const limited = p.accounts.list().filter((a) => a.enabled && a.tiers.includes(tier) && p.accounts.isLimited(a))
    if (limited.length === 0) return null
    const avail = p.accounts.availability(tier)
    if (avail.allLimited) return avail.resumesAt
    if (tier !== 'best') return null
    const reset = Math.min(...limited.map((a) => Date.parse(a.limitedUntil as string)))
    return reset + durationOf(def.step, slot.kind) <= deadlineOf(def.step, slot.at, slot.kind) ? reset : null
  }

  /**
   * The production step's task is done: the video is produced once its latest run succeeded. A run still going waits, as
   * does a failed one (its own alert says why: production-news.ts); a cancelled one, or none at all, is warned about.
   */
  private async produced(slot: Slot): Promise<boolean> {
    if (slot.videoId === null) return true
    let runs
    try {
      runs = await this.timed(this.port.listRuns({ videoId: slot.videoId }))
    } catch {
      return false
    }
    const last = runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || Number(b.id) - Number(a.id))[0]
    if (last?.state === 'done') return true
    if (last?.state === 'waiting_gate') this.passRunGates(slot, last.id)
    if (last && ['queued', 'running', 'waiting_gate'].includes(last.state)) return false
    // a failed run already reached the inbox and Atlas with its reason (production-news.ts): the slot waits for its relaunch
    if (last?.state === 'error') return false
    const label = slotLabel(slot.at, this.utc)
    const why = !last
      ? `L'étape « production » s'est finie sans lancer la fabrication de la vidéo du créneau ${label}.`
      : `La fabrication de la vidéo du créneau ${label} a été arrêtée.`
    this.warn(slot, `production-${last ? `${last.state}-${last.id}` : 'none'}`, `${why} Relance-la depuis Production, ou ce créneau sera manqué.`)
    // nobody may be there to relaunch it (« tout automatique »): the lead gets ONE task to launch it (production-equipe)
    if (!last) this.followUp(slot, `Lancer la fabrication · ${label}`, [
      `The production step of video #${slot.videoId} (slot ${label}) finished without launching its run.`,
      'Launch it now: project_prepare (video) then project_run, real when your brief or the channel leaves the production to the team. Check the budget left with production_quote or dashboard_read: the Claude turns are paid by the subscription, never by the channel budget. If something really blocks the run, say exactly what in your result.'
    ])
    return false
  }

  /** One follow-up task for the slot's lead, by title (never twice). */
  private followUp(slot: Slot, title: string, brief: string[]): void {
    const p = this.p
    if (slot.videoId === null) return
    if (p.db.prepare('SELECT 1 FROM orch_tasks WHERE channel_id = ? AND video_id = ? AND title = ?').get(slot.channelId, slot.videoId, title)) return
    p.queue.enqueue({ kind: 'production', title, assigneeId: slot.lead.id, payload: { brief: brief.join(' ') }, priority: 7, channelId: slot.channelId, videoId: slot.videoId })
    p.events.add('plan', `${slot.channel} : « ${title} » confié au responsable`, slot.lead.id)
  }

  /**
   * A slot's run waits at owner gates (the recipe's checkpoints, a package gate): each gate whose step the channel's level
   * leaves to the team (or a « toujours valider » rule covers) is passed here, said in the events; the others stay for
   * Charlie (production-equipe: a « tout automatique » channel's run waited for him forever).
   */
  private passRunGates(slot: Slot, runId: string): void {
    const p = this.p
    if (!this.port.waitingGates || !this.port.approveGate) return
    const gates = p.goals.gates(slot.channelId)
    try {
      for (const node of this.port.waitingGates(runId)) {
        const gate = gateOfNode(node.type)
        const rule = gates.includes(gate) ? p.allow.match(slot.channelId, gate, null) : null
        if (gates.includes(gate) && !rule) continue
        this.port.approveGate(runId, node.nodeId)
        if (rule) p.allow.use(rule.id)
        const by = rule ? `Charlie's standing rule #${rule.id}` : "the channel's approval level"
        p.events.add('auto-approved', `${slot.channel}: run #${runId}, step ${node.nodeId} (${gate}) approved by ${by}`, slot.lead.id)
      }
    } catch (err: unknown) {
      p.events.add('warning', `${slot.channel}: run #${runId}: ${err instanceof Error ? err.message : String(err)}`, slot.lead.id)
    }
  }

  /**
   * A topic (or script) step finished but the video still carries its slot's placeholder title: the lead did not save the
   * topic, and the pipeline would write about « Vidéo du … » (production-equipe, run #1). The planner saves what the
   * step's result states as the video's title and idea; nothing stated is a warning.
   */
  private adoptTopic(slot: Slot, result: string | null | undefined): void {
    const p = this.p
    if (slot.videoId === null || !this.port.setTopic) return
    const v = p.db.prepare('SELECT title FROM videos WHERE id = ?').get(slot.videoId) as { title: string } | undefined
    if (!v || !isSlotTitle(v.title)) return
    const topic = topicFromResult(result)
    if (!topic) {
      this.warn(slot, 'topic', `Le sujet de la vidéo du créneau ${slotLabel(slot.at, this.utc)} n'a pas été enregistré : rien ne sera fabriqué sur un titre provisoire.`)
      return
    }
    try {
      this.port.setTopic(slot.videoId, topic.title, topic.idea)
      p.events.add('plan', `${slot.channel} : sujet « ${truncate(topic.title, 100)} » enregistré sur la vidéo #${slot.videoId} (l'étape ne l'avait pas fait)`, slot.lead.id)
    } catch (err: unknown) {
      p.events.add('warning', `${slot.channel}: topic of video #${slot.videoId}: ${err instanceof Error ? err.message : String(err)}`, slot.lead.id)
    }
  }

  /**
   * The QC step finished by refusing the video (« FAIL », « ne pas publier »…) and no run started since: the slot holds —
   * never « kit prêt » on a refused video (production-equipe, run #1) — with an early warning, and the lead gets ONE task
   * to remake it (project_prepare fresh). A run started after the refusal is the remake: the chain goes on.
   */
  private async qcRefused(slot: Slot, task: OrchTask): Promise<boolean> {
    const p = this.p
    if (slot.videoId === null || !QC_REFUSED.test(task.result ?? '')) return false
    let runs
    try {
      runs = await this.timed(this.port.listRuns({ videoId: slot.videoId }))
    } catch {
      return true
    }
    // the run the QC refused is the latest one when the refusal is first seen; a newer run is the remake
    const latest = runs.map((r) => Number(r.id)).reduce((m, id) => Math.max(m, id), 0)
    const key = `orchestra.planner.qcRefused.${slot.videoId}`
    const refused = p.settings.get<number | null>(key, null)
    if (refused === null) p.settings.set(key, latest)
    else if (latest > refused) return false
    const label = slotLabel(slot.at, this.utc)
    this.warn(slot, 'qc', `Le contrôle qualité a refusé la vidéo du créneau ${label} : ${truncate((task.result ?? '').replace(/\s+/g, ' '), 300)} L'équipe la refait.`)
    this.followUp(slot, `Refaire la vidéo · ${label}`, [
      `The quality check refused video #${slot.videoId} (slot ${label}): ${truncate(task.result ?? '', 1500)}`,
      'Remake it: fix the cause (topic, script, settings), then project_prepare with video, fresh: true and the fixed title and idea (or script), then project_run as the production step did (real when your channel leaves production to the team).',
      'When the new run is done, have your quality eye check it (production.status, eyes.look, qc.check) and finish with done saying whether it passed.'
    ])
    return true
  }

  /** The production quote when it fits in this month's budget; else a warning and null. */
  private async budgetFor(slot: Slot): Promise<{ credits: number } | null> {
    const label = slotLabel(slot.at, this.utc)
    if (!this.port.available || slot.videoId === null) {
      this.warn(slot, 'production', `La production n’est pas encore branchée : le sujet et le script avancent, mais la vidéo du créneau ${label} ne peut pas être produite.`)
      return null
    }
    let credits: number
    try {
      const minutes = plannedMinutes(this.p.db, slot.videoId)
      credits = (await this.timed(this.port.quotePipeline({ videoId: slot.videoId, mode: 'usage_max', ...(minutes ? { minutes } : {}) }))).credits
    } catch (e) {
      this.warn(slot, 'production', `Pas de devis de production pour le créneau ${label} : ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
    const used = await this.usedThisMonth(slot.channelId)
    const left = slot.goals.budgetCredits - used
    if (credits > left) {
      this.warn(
        slot,
        'budget',
        `Budget du mois insuffisant pour produire la vidéo du créneau ${label} : le devis est de ${credits} crédits, il en reste ${Math.max(0, left)} sur ${slot.goals.budgetCredits} ce mois-ci. Augmente le budget dans la fiche de la chaîne, ou retire un créneau.`
      )
      return null
    }
    return { credits }
  }

  /**
   * Credits this month: every run of the channel's videos started this month (through the port), plus the quote of each
   * planned production that has no run yet, whatever month it was promised in. A production step that died or was
   * cancelled promises nothing any more.
   */
  private async usedThisMonth(channelId: number): Promise<number> {
    const p = this.p
    const month = monthOf(new Date(p.now()))
    const videos = new Set((p.db.prepare('SELECT id FROM videos WHERE channel_id = ?').all(channelId) as { id: number }[]).map((v) => v.id))
    const runs = (await this.timed(this.port.listRuns())).filter((r) => r.videoId !== null && videos.has(r.videoId))
    let used = runs.filter((r) => r.startedAt.slice(0, 7) === month).reduce((n, r) => n + r.credits, 0)
    const promised = p.db
      .prepare(
        `SELECT s.video_id, st.credits, st.task_id FROM orch_plan_steps st JOIN orch_plan_slots s ON s.channel_id = st.channel_id AND s.slot_at = st.slot_at
         WHERE st.channel_id = ? AND st.step = 'production' AND st.status = 'open' AND s.status != 'retired'`
      )
      .all(channelId) as { video_id: number | null; credits: number; task_id: number | null }[]
    for (const r of promised) {
      const task = r.task_id === null ? null : p.queue.find(r.task_id)
      if (!task || DEAD.has(task.status)) continue
      if (!runs.some((x) => x.videoId === r.video_id)) used += r.credits
    }
    return used
  }

  /** A port call bounded by `portTimeoutMs`. */
  private timed<T>(call: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`la production n'a pas répondu en ${Math.round(this.portTimeoutMs / 1000)} s`)), this.portTimeoutMs)
    })
    return Promise.race([call, limit]).finally(() => clearTimeout(timer))
  }

  /** Warns when the steps left cannot be finished before the slot. */
  private checkLate(slot: Slot, left: readonly StepDef[], from: number): void {
    const end = finishEstimate(left, from, slot.kind)
    if (end <= slot.at || left.length === 0) return
    const hours = Math.ceil((end - slot.at) / HOUR)
    const first = left[0] as StepDef
    this.warn(
      slot,
      'late',
      `Il reste ${left.map((d) => d.label).join(', ')} : au rythme habituel, la vidéo serait prête vers ${slotLabel(end, this.utc)}, environ ${hours} h après le créneau. L'étape en cours est « ${first.label} ».`
    )
  }

  /** An early warning in Charlie's inbox, once per slot and reason. */
  private warn(slot: Slot, reason: string, text: string): void {
    const p = this.p
    const at = iso(slot.at)
    const added = transaction(p.db, () => {
      const r = p.db
        .prepare(`INSERT OR IGNORE INTO orch_plan_warnings (channel_id, slot_at, reason, text, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(slot.channelId, at, reason, text, iso(p.now()))
      if (Number(r.changes) !== 1) return false
      const item = p.inbox.add({ taskId: null, agentId: slot.lead.id, kind: 'alert', title: `Créneau menacé · ${slot.channel} · ${slotLabel(slot.at, this.utc)}`, body: text })
      p.db.prepare('UPDATE orch_plan_warnings SET inbox_id = ? WHERE channel_id = ? AND slot_at = ? AND reason = ?').run(item.id, slot.channelId, at, reason)
      return true
    })
    if (!added) return
    p.events.add('plan-warning', `${slot.channel} · ${slotLabel(slot.at, this.utc)} : ${text}`, slot.lead.id)
    try {
      p.messaging.system(p.messaging.conversationFor('channel', slot.channelId, null), `Créneau ${slotLabel(slot.at, this.utc)} menacé : ${text}`)
    } catch {
      // chat unavailable (closing)
    }
  }
}
