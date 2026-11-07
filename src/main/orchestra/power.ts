// The team's power switch (docs/AGENT-RUNTIME.md §25): off, on, paused until a time, and the red stop. The state lives in
// the settings (`orchestra.enabled`, `orchestra.pausedUntil`) so it survives a restart of the app or of the team
// computer; `apply()` makes the background loop match it at once (no restart needed). The loop never runs before a
// Claude account passed « Vérifier » (state `ready` with a check time): switched on without one, the team is `blocked`
// and starts by itself when an account is checked. A pause lets the watchdog run but starts no turn and fires no routine;
// it ends by itself at its time (missed routines then fire once). The red stop kills every run, puts their tasks back in
// the queue with the attempt in flight given back, cancels every production run still going (queued, running or waiting
// at a gate: nothing more is spent on them) and switches the team off.
import type { PowerInput, PowerView, StopResult } from '../../shared/api/autopilot'
import { AGENT_ACCOUNT_KINDS } from './accounts'
import { SETTINGS, type RuntimeParts } from './parts'
import type { Supervisor } from './supervisor'
import { iso, isRecord } from './util'

const MAX_PAUSE_MS = 30 * 24 * 3_600_000

export class PowerSwitch {
  private readonly p: RuntimeParts
  private readonly sup: Supervisor
  private intervalMs = 5000

  constructor(p: RuntimeParts, sup: Supervisor) {
    this.p = p
    this.sup = sup
    sup.paused = () => this.isPaused()
  }

  /**
   * An enabled subscription account (Claude Code, Codex: the beta rule, decision 0038) that passed « Vérifier ».
   * The account made by default is never checked.
   */
  claudeConnected(): boolean {
    return this.p.accounts
      .list()
      .some((a) => AGENT_ACCOUNT_KINDS.includes(a.kind) && a.enabled && (a.state ?? 'ready') === 'ready' && typeof a.checkedAt === 'string' && a.checkedAt !== '')
  }

  private enabled(): boolean {
    return this.p.settings.get<boolean>(SETTINGS.enabled, false) === true
  }

  private pausedUntilMs(): number | null {
    const v = this.p.settings.get<string | null>(SETTINGS.pausedUntil, null)
    const ms = typeof v === 'string' ? Date.parse(v) : NaN
    return Number.isFinite(ms) ? ms : null
  }

  /** Paused now. A pause whose time has come ends here (once), and the team works again. */
  isPaused(): boolean {
    const until = this.pausedUntilMs()
    if (until === null) return false
    if (until > this.p.now()) return true
    this.p.settings.set(SETTINGS.pausedUntil, null)
    this.p.events.add('power', 'La pause est finie : le travail reprend.')
    return false
  }

  view(): PowerView {
    const enabled = this.enabled()
    const connected = this.claudeConnected()
    const paused = enabled && this.isPaused()
    const until = this.pausedUntilMs()
    return {
      state: !enabled ? 'off' : !connected ? 'blocked' : paused ? 'paused' : 'on',
      pausedUntil: paused && until !== null ? iso(until) : null,
      claudeConnected: connected,
      loopRunning: this.sup.started
    }
  }

  /** Makes the background loop match the switch (at start, after a change, after an account check). */
  apply(intervalMs?: number): PowerView {
    if (intervalMs !== undefined) this.intervalMs = intervalMs
    if (this.enabled() && this.claudeConnected()) this.sup.start(this.intervalMs)
    else this.sup.stop()
    return this.view()
  }

  set(input: PowerInput): PowerView {
    if (!isRecord(input) || !['on', 'off', 'paused'].includes(String(input.state))) throw new Error('État inconnu : allumé, éteint ou en pause.')
    const { settings, events } = this.p
    if (input.state === 'off') {
      settings.set(SETTINGS.enabled, false)
      settings.set(SETTINGS.pausedUntil, null)
      events.add('power', "L'équipe a été éteinte : les tours en cours finissent, rien de nouveau ne démarre.")
      return this.apply()
    }
    if (!this.claudeConnected()) {
      throw new Error("Connecte d'abord Claude : Réglages › Claude › « Ajouter mon compte », puis « Vérifier ». L'équipe ne démarre pas avant.")
    }
    if (input.state === 'on') {
      settings.set(SETTINGS.enabled, true)
      settings.set(SETTINGS.pausedUntil, null)
      events.add('power', "L'équipe a été allumée.")
      return this.apply()
    }
    const until = typeof input.until === 'string' ? Date.parse(input.until) : NaN
    const now = this.p.now()
    if (!Number.isFinite(until) || until <= now || until - now > MAX_PAUSE_MS) throw new Error('Une pause finit dans le futur, dans 30 jours au plus.')
    settings.set(SETTINGS.enabled, true)
    settings.set(SETTINGS.pausedUntil, iso(until))
    events.add('power', `L'équipe est en pause jusqu'au ${iso(until)}.`)
    return this.apply()
  }

  /** « Tout arrêter »: every run killed, its task queued again as it was, the team off. */
  stop(): StopResult {
    const { settings, events, queue, tree, messaging } = this.p
    settings.set(SETTINGS.enabled, false)
    settings.set(SETTINGS.pausedUntil, null)
    this.sup.stop()
    let killed = 0
    let requeued = 0
    for (const h of [...this.sup.running.values()]) {
      this.sup.kill(h, 'arrêt demandé par le propriétaire')
      killed++
      if (queue.requeue(h.taskId, 'arrêt demandé par le propriétaire')) requeued++
      tree.refreshStatus(h.agentId)
    }
    // the fabrications too: a run left going would keep spending credits (« Moteur réel »)
    const prod = this.p.services.production
    const going = (prod?.list({ limit: 500 }) ?? []).filter((r) => r.status === 'queued' || r.status === 'running' || r.status === 'waiting')
    for (const r of going) void prod?.cancel(r.id).catch(() => undefined)
    const runsStopped = going.length
    const text = `Tout a été arrêté : ${killed} tour(s) interrompu(s), leurs tâches attendent dans la file ; ${runsStopped} fabrication(s) arrêtée(s). L'équipe est éteinte.`
    events.add('stop', text)
    try {
      const principal = this.p.tree.principal()
      const conv = messaging.conversationFor('principal', null, null)
      if (principal) messaging.post(principal, conv, text, 99)
      else messaging.system(conv, text)
    } catch {
      // chat unavailable (closing)
    }
    return { power: this.view(), killed, requeued, runsStopped }
  }
}
