// Charlie's video orders (equipe-3-chaines): « lance-moi 3 vidéos, une par chaîne, avec ces scripts ». Code, no model: Atlas
// hands the order over (tool `videos.order`), this makes each video on its channel's pipeline with the owner's script word for
// word (its `[PUB]` marker becomes the channel's promo, text/ad-marker.ts), launches it within its cap, follows it to the end,
// runs the final quality pass (the render's blocking checks, its edit review, a blind judge against the channel's own video),
// remakes the steps a real error points to ONCE, and only then tells Charlie: inbox, the channel's room, Atlas, the app's toast.
// Nothing waits for an answer nobody gives: every end (ready, refused by its cap, failed) is said.
import type { Db } from '../../db'
import type { RunFinished } from '../../production/runs/video-status'
import { iso, truncate, type Clock, type EventLog } from '../util'
import type { Inbox } from '../inbox'
import { titleOf, type OrderItem } from './parse'

import type { BlockingError, FinalReport, OrderStatus, OrderView } from '../../../shared/api/orders'

export type { BlockingError, FinalReport, OrderStatus, OrderView } from '../../../shared/api/orders'

export interface OrderRun {
  status: string
  error: string | null
  videoId: number | null
  /** Steps waiting for a validation (the pipeline's owner checkpoints). */
  waitingNodes: string[]
  /** What the run spent so far, in dollars. */
  spentUsd: number
}

/** What an order needs from production (orders/app.ts on the app's real stores; fakes in tests). */
export interface OrderProduction {
  /** The channel's own pipeline, made to read the owner's script (a copy « · script importé » made once when it does not). */
  importRecipe(channelId: number): number
  /** A new video of the channel and its project on that pipeline, the script attached; nothing launched. */
  prepare(o: { channelId: number; recipeId: number; title: string; script: string }): { videoId: number; projectId: number }
  quoteUsd(projectId: number, real: boolean): Promise<number>
  /** Launches the project (a failed or interrupted run is relaunched: its finished steps are kept); the run id. */
  launch(projectId: number, real: boolean): Promise<number>
  /**
   * The same run made again with the steps named made afresh (new seeds), on the same video; the new run id. Refused (it
   * throws, nothing launched) when its quote on the video's cache is above `maxUsd`.
   */
  remake(runId: number, steps: readonly BlockingError['step'][], maxUsd: number | null): Promise<number>
  run(runId: number): OrderRun | null
  /** Passes a step waiting for a validation: Charlie's order is his yes for the videos he ordered. */
  approve(runId: number, nodeId: string): void
}

export interface FinalPass {
  /** `real`: a demo order is never judged by a paid model. */
  check(o: { orderId: number; runId: number; channelId: number; title: string; real: boolean }): Promise<FinalReport>
}

interface Row {
  id: number
  batch: string
  channel_id: number
  title: string
  script: string
  real: number
  max_usd: number | null
  video_id: number | null
  project_id: number | null
  run_id: number | null
  runs_json: string
  status: OrderStatus
  fixes: number
  report_json: string | null
  error: string | null
  notified_at: string | null
  created_at: string
  updated_at: string
}

export interface OrdersDeps {
  db: Db
  now: Clock
  events: EventLog
  inbox: Inbox
  production: OrderProduction
  finalPass: FinalPass
  /** A line in the channel's room and in Atlas's conversation. */
  say(channelId: number, text: string): void
  /** The money a channel may still spend this month (its confirmed goals), null when it has none. */
  budgetLeftUsd?(channelId: number): number | null
  notify?(): void
  /** Fix rounds after a real error (default 1: one remake, then Charlie is told what is left). */
  maxFixes?: number
}

const VOICE_KINDS = new Set(['audio_dropout', 'word_cut', 'timing_drift', 'sound_hole'])
const PICTURE_KINDS = new Set(['duplicate', 'frozen', 'held', 'black', 'film_short'])

/** The step a real error comes from (pure): the voice's breaks, the pictures' repeats and holds, else the render. */
export function stepOf(kind: string): BlockingError['step'] {
  if (VOICE_KINDS.has(kind)) return 'voice'
  if (PICTURE_KINDS.has(kind)) return 'pictures'
  return 'render'
}

/** The real errors a refused render lists in its message (« verify_failed »: one « kind at 1:23 » per line), pure. */
export function errorsOfRefusal(message: string): BlockingError[] {
  const out: BlockingError[] = []
  for (const m of message.matchAll(/\b(audio_dropout|word_cut|sound_hole|timing_drift|music_loud|frozen|held|film_short|black|duplicate|text_unsaid|text_form|text_language|map_legend)\b[^\n;]*/gu)) {
    const at = /(\d+):(\d{2}(?:\.\d+)?)/u.exec(m[0])
    out.push({ kind: m[1] as string, atS: at ? Number(at[1]) * 60 + Number(at[2]) : null, what: truncate(m[0].trim(), 200), step: stepOf(m[1] as string) })
  }
  return out
}

const mmss = (s: number | null): string => (s === null ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`)

export class VideoOrders {
  private readonly busy = new Set<number>()
  private readonly pending = new Set<Promise<void>>()

  constructor(private readonly d: OrdersDeps) {}

  /** Every ordered video, newest first (`batch`: one order only). */
  list(batch?: string): OrderView[] {
    const rows = (batch
      ? this.d.db.prepare('SELECT * FROM video_orders WHERE batch = ? ORDER BY id').all(batch)
      : this.d.db.prepare('SELECT * FROM video_orders ORDER BY id DESC LIMIT 200').all()) as unknown as Row[]
    return rows.map((r) => this.view(r))
  }

  get(id: number): OrderView {
    return this.view(this.row(id))
  }

  /** Settles when every final pass started so far is over (tests, a clean stop). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending])
  }

  /**
   * Places the order: each script becomes a video of its channel on the channel's pipeline, quoted, then launched when the
   * quote fits its cap (`maxUsdEach`) and the channel's budget left; one that does not fit is refused and said, the others go.
   */
  async place(o: { items: readonly OrderItem[]; real: boolean; maxUsdEach?: number; batch?: string }): Promise<OrderView[]> {
    if (o.items.length === 0) throw new Error('No script to make')
    if (o.items.length > 12) throw new Error('At most 12 videos in one order')
    const batch = o.batch ?? `order-${this.d.now().toString(36)}`
    const ids: number[] = []
    for (const it of o.items) {
      const t = iso(this.d.now())
      const title = truncate(it.title?.trim() || titleOf(it.script) || `Vidéo pour ${it.channelName}`, 200)
      const r = this.d.db
        .prepare(`INSERT INTO video_orders (batch, channel_id, title, script, real, max_usd, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`)
        .run(batch, it.channelId, title, it.script, o.real ? 1 : 0, o.maxUsdEach ?? null, t, t)
      ids.push(Number(r.lastInsertRowid))
    }
    for (const id of ids) await this.start(id)
    this.d.notify?.()
    return ids.map((id) => this.get(id))
  }

  /** A run ended: the order it belongs to is checked, fixed or closed. Never throws. */
  runFinished(e: RunFinished): void {
    const r = this.d.db.prepare('SELECT * FROM video_orders WHERE run_id = ?').get(e.runId) as unknown as Row | undefined
    if (!r || (r.status !== 'producing' && r.status !== 'fixing')) return
    this.track(this.afterRun(r.id, e.status, e.error ?? null))
  }

  /** The watchdog (supervisor pass): an order whose run ended unseen (a restart), or a pass cut short, goes on. */
  tick(): void {
    const rows = this.d.db.prepare(`SELECT * FROM video_orders WHERE status IN ('queued','producing','fixing','checking')`).all() as unknown as Row[]
    for (const r of rows) {
      if (this.busy.has(r.id)) continue
      if (r.status === 'queued') {
        this.track(this.start(r.id))
        continue
      }
      if (r.run_id === null) continue
      const run = this.d.production.run(r.run_id)
      // a run gone (deleted) or left interrupted by a stop of the app: handled as a failure (relaunched once, else said)
      if (!run) {
        this.track(this.afterRun(r.id, 'failed', 'La fabrication a disparu.'))
        continue
      }
      if (run.status === 'interrupted' && r.status !== 'checking') {
        this.track(this.afterRun(r.id, 'failed', 'La fabrication a été interrompue (arrêt de l’app).'))
        continue
      }
      if (run.waitingNodes.length > 0 && (r.status === 'producing' || r.status === 'fixing')) {
        this.passGates(r, run)
        continue
      }
      if (r.status === 'checking') this.track(this.afterRun(r.id, 'succeeded', null))
      else if (['succeeded', 'failed', 'cancelled'].includes(run.status)) this.track(this.afterRun(r.id, run.status as RunFinished['status'], run.error))
    }
  }

  /** A run stopped at its pipeline's checkpoints (topic, thumbnail…): Charlie ordered this video, so the order passes them. */
  private passGates(r: Row, run: OrderRun): void {
    for (const node of run.waitingNodes) {
      try {
        this.d.production.approve(r.run_id as number, node)
        this.d.events.add('auto-approved', `commande #${r.id} : étape « ${node} » validée par la commande de Charlie (run #${r.run_id})`)
      } catch {
        // already passed, or the run moved on
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------- the steps

  private async start(id: number): Promise<void> {
    if (this.busy.has(id)) return
    this.busy.add(id)
    try {
      const r = this.row(id)
      if (r.status !== 'queued') return
      const recipeId = this.d.production.importRecipe(r.channel_id)
      const made = r.project_id !== null ? { videoId: r.video_id as number, projectId: r.project_id } : this.d.production.prepare({ channelId: r.channel_id, recipeId, title: r.title, script: r.script })
      this.set(id, { video_id: made.videoId, project_id: made.projectId })
      const usd = await this.d.production.quoteUsd(made.projectId, r.real === 1)
      const left = this.d.budgetLeftUsd?.(r.channel_id) ?? null
      const over = r.max_usd !== null && usd > r.max_usd ? `son devis (${usd.toFixed(2)} $) dépasse le plafond de ${r.max_usd.toFixed(2)} $` : r.real === 1 && left !== null && usd > left ? `son devis (${usd.toFixed(2)} $) dépasse ce qui reste du budget de la chaîne ce mois-ci (${Math.max(0, left).toFixed(2)} $)` : null
      if (over) {
        this.close(id, 'failed', null, `Pas lancée : ${over}.`)
        return
      }
      const runId = await this.d.production.launch(made.projectId, r.real === 1)
      this.set(id, { run_id: runId, runs_json: JSON.stringify([runId]), status: 'producing' })
      this.d.events.add('order', `commande #${id} lancée : run #${runId} (devis ${usd.toFixed(2)} $)`)
      this.d.say(r.channel_id, `Je fabrique « ${truncate(r.title, 100)} » (commande de Charlie, devis ${usd.toFixed(2)} $).`)
    } catch (e) {
      this.close(id, 'failed', null, `Pas lancée : ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      this.busy.delete(id)
    }
  }

  private async afterRun(id: number, status: RunFinished['status'], error: string | null): Promise<void> {
    if (this.busy.has(id)) return
    this.busy.add(id)
    try {
      const r = this.row(id)
      const maxFixes = this.d.maxFixes ?? 1
      if (status === 'cancelled') return this.close(id, 'failed', null, 'La fabrication a été arrêtée.')
      if (status === 'failed') {
        const blocking = errorsOfRefusal(error ?? '')
        if (r.fixes >= maxFixes) return this.close(id, 'failed', blocking.length ? reportOf(blocking) : null, error ?? 'La fabrication a échoué.')
        // a render refused for a real error: the step it comes from is made again; any other failure: relaunched once
        const runId = await this.fix(r, blocking)
        if (runId === null) return
        this.d.events.add('order', `commande #${id} : ${blocking.length ? `erreur réelle (${blocking.map((b) => b.kind).join(', ')}), refaite` : 'échec, relancée'} (run #${runId})`)
        return
      }
      this.set(id, { status: 'checking' })
      const report = await this.d.finalPass.check({ orderId: id, runId: r.run_id as number, channelId: r.channel_id, title: r.title, real: r.real === 1 })
      if (report.blocking.length > 0 && r.fixes < maxFixes) {
        this.set(id, { report_json: JSON.stringify(report) })
        const runId = await this.fix(r, report.blocking, report)
        if (runId === null) return
        this.d.events.add('order', `commande #${id} : ${report.blocking.length} erreur(s) réelle(s) mesurée(s), refaite (run #${runId})`)
        return
      }
      const run = this.d.production.run(r.run_id as number)
      if (run?.videoId) this.set(id, { video_id: run.videoId })
      this.close(id, report.blocking.length > 0 ? 'failed' : 'ready', report, report.blocking.length > 0 ? 'Des erreurs réelles restent après la réparation : la vidéo n’est pas livrée comme prête.' : null)
    } catch (e) {
      this.close(id, 'failed', null, `La vérification finale a échoué : ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      this.busy.delete(id)
    }
  }

  /**
   * One fix round within what is left of the video's cap (its runs' spend so far): the steps the real errors point to are made
   * again on the same video, or a run that failed for another reason is relaunched (its finished steps kept). The new run is
   * written with its round in ONE update once it exists. A fix refused by the cap closes the order and says why. Null when
   * closed.
   */
  private async fix(r: Row, blocking: readonly BlockingError[], report?: FinalReport): Promise<number | null> {
    const spent = this.spentUsd(r)
    const left = r.real === 1 && r.max_usd !== null ? r.max_usd - spent : null
    try {
      if (left !== null && left <= 0) throw new Error(`le plafond de ${(r.max_usd as number).toFixed(2)} $ est déjà dépensé (${spent.toFixed(2)} $)`)
      const runId = blocking.length > 0 ? await this.d.production.remake(r.run_id as number, steps(blocking), left) : await this.d.production.launch(r.project_id as number, r.real === 1)
      const runs = [...(JSON.parse(r.runs_json) as number[]), runId].filter((x, i, a) => a.indexOf(x) === i)
      this.set(r.id, { fixes: r.fixes + 1, status: 'fixing', run_id: runId, runs_json: JSON.stringify(runs) })
      return runId
    } catch (e) {
      this.close(r.id, 'failed', report ?? (blocking.length ? reportOf([...blocking]) : null), `Réparation non lancée : ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }

  /** What every run of the order spent so far, in dollars. */
  private spentUsd(r: Row): number {
    return (JSON.parse(r.runs_json) as number[]).reduce((n, id) => n + (this.d.production.run(id)?.spentUsd ?? 0), 0)
  }

  /** The end of an order: its state, then Charlie is told once (inbox, rooms, Atlas, the app's toast reads `notifiedAt`). */
  private close(id: number, status: 'ready' | 'failed', report: FinalReport | null, error: string | null): void {
    this.set(id, { status, report_json: report ? JSON.stringify(report) : this.row(id).report_json, error })
    const o = this.get(id)
    if (o.notifiedAt !== null) return
    const what = `« ${truncate(o.title, 90)} »`
    const lines = notice(o)
    const title = status === 'ready' ? `Vidéo prête · ${o.channelName} · ${truncate(o.title, 80)}` : `Vidéo non livrée · ${o.channelName} · ${truncate(o.title, 80)}`
    try {
      this.d.inbox.add({ taskId: null, agentId: null, channelId: o.channelId, kind: 'alert', title, body: lines.join('\n') })
    } catch {
      // closing
    }
    this.d.say(o.channelId, status === 'ready' ? `${what} est prête (vérifiée). ${lines[0] ?? ''}` : `${what} n’est pas livrée : ${error ?? ''}${o.report?.blocking.length ? ` Erreurs mesurées (run #${o.runId}) : ${o.report.blocking.slice(0, 6).map((b) => b.what).join(' · ')}` : ''}`)
    this.d.events.add(status === 'ready' ? 'video-ready' : 'order', `${title}${error ? ` — ${error}` : ''}`)
    this.set(id, { notified_at: iso(this.d.now()) })
    this.d.notify?.()
  }

  private track(p: Promise<void>): void {
    const q = p.catch(() => undefined).finally(() => this.pending.delete(q))
    this.pending.add(q)
  }

  private row(id: number): Row {
    const r = this.d.db.prepare('SELECT * FROM video_orders WHERE id = ?').get(id) as unknown as Row | undefined
    if (!r) throw new Error(`No order #${id}`)
    return r
  }

  private set(id: number, f: Partial<Pick<Row, 'video_id' | 'project_id' | 'run_id' | 'runs_json' | 'status' | 'fixes' | 'report_json' | 'error' | 'notified_at'>>): void {
    const keys = Object.keys(f) as (keyof typeof f)[]
    if (keys.length === 0) return
    this.d.db.prepare(`UPDATE video_orders SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => f[k] ?? null), iso(this.d.now()), id)
  }

  private view(r: Row): OrderView {
    const ch = this.d.db.prepare('SELECT name FROM channels WHERE id = ?').get(r.channel_id) as { name: string } | undefined
    return {
      id: r.id,
      batch: r.batch,
      channelId: r.channel_id,
      channelName: ch?.name ?? `#${r.channel_id}`,
      title: r.title,
      real: r.real === 1,
      status: r.status,
      videoId: r.video_id,
      projectId: r.project_id,
      runId: r.run_id,
      runs: JSON.parse(r.runs_json) as number[],
      fixes: r.fixes,
      report: r.report_json ? (JSON.parse(r.report_json) as FinalReport) : null,
      error: r.error,
      notifiedAt: r.notified_at,
      createdAt: r.created_at
    }
  }
}

const steps = (b: readonly BlockingError[]): BlockingError['step'][] => [...new Set(b.map((x) => x.step))]

const reportOf = (blocking: BlockingError[]): FinalReport => ({ blocking, checked: true, review: [], judge: null, judgeSkipped: 'la vidéo n’a pas été finie', costUsd: 0, film: null, durationS: null })

/** What Charlie reads (pure): the film, the errors left, the review's remarks, the judge's verdict and defects. */
export function notice(o: OrderView): string[] {
  const r = o.report
  const lines: string[] = []
  if (o.status === 'ready') lines.push(`Fichier : ${r?.film ?? '(dans Production)'}${r?.durationS ? ` · ${mmss(r.durationS)}` : ''}${o.fixes > 0 ? ` · réparée ${o.fixes} fois avant livraison` : ''}.`)
  if (o.error) lines.push(o.error)
  if (r) {
    if (r.blocking.length > 0) lines.push('Erreurs réelles restantes :', ...r.blocking.map((b) => `- ${b.kind}${b.atS !== null ? ` à ${mmss(b.atS)}` : ''} : ${b.what}`))
    else if (!r.checked) lines.push('Contrôles bloquants : NON relus (le rendu n’a pas laissé son rapport) : regarde la vidéo avant de la publier.')
    else lines.push('Contrôles bloquants : aucune erreur réelle (voix, trous de son, images figées ou en double, textes, musique).')
    if (r.judge) lines.push(`Juge à l’aveugle (contre une vraie vidéo de la chaîne) : ${r.judge.sameChannel === 'yes' ? 'même chaîne' : 'pas encore la même chaîne'}, ${r.judge.score}/100 — ${truncate(r.judge.reason, 300)}`)
    else if (r.judgeSkipped) lines.push(`Juge à l’aveugle : pas fait (${r.judgeSkipped}).`)
    const left = [...(r.judge?.defects ?? []), ...r.review]
    if (left.length > 0) lines.push('Défauts restants (à juger par toi, pas des erreurs) :', ...left.slice(0, 15).map((d) => `- ${truncate(d, 220)}`))
  }
  return lines
}
