// Example workspace rows of the "runs" area (lot Z1). `seed` inserts rows marked example = 1, `clear` deletes them.
// - one example grant of 2 000 credits in the wallet (source 'example');
// - a finished run for each published example video (all nodes done, no files kept: `production.output` answers
//   « Fichiers non conservés pour l'exemple »);
// - a run of the `templiers` video waiting at the script gate (research done). Approving it resumes it: the engine
//   really starts in demo mode, reaches the script gate again, which is approved at once, and goes on.
import { productionRegistry } from '../../engine/nodes'
import { validatePipeline } from '../../engine/validate'
import { creditsForUnits } from '../credits/prices'
import type { Db } from '../db'
import { nodeLabel } from '../production/runs/labels'
import { DEFAULT_RUN_STYLE, templatePipeline } from '../production/runs/pipeline'
import type { ExampleArea, ExampleSeed, ExampleVideoKey } from './types'

const FINISHED: readonly { key: ExampleVideoKey; minutes: number; daysAgo: number; topic: string }[] = [
  { key: 'gevaudan', minutes: 9, daysAgo: 42, topic: 'La Bête du Gévaudan : ce que disent vraiment les archives' },
  { key: 'bermudes', minutes: 11, daysAgo: 21, topic: 'Le Triangle des Bermudes, enquête sur une légende' },
  { key: 'inventions', minutes: 8, daysAgo: 28, topic: '10 inventions qui ont changé le quotidien' }
]

/** Credits an example node "cost" (priced like a real run: voice by characters, pictures by count). */
function exampleCredits(type: string, minutes: number): number {
  if (type.startsWith('voice.tts@')) return creditsForUnits([{ unit: 'chars', qty: Math.round(minutes * 900) }])
  if (type.startsWith('visuals.fulfil@')) return creditsForUnits([{ unit: 'images', qty: Math.round(minutes * 12) }])
  return 0
}

function insertRun(
  db: Db,
  o: { videoId: number; channelId: number; minutes: number; topic: string; status: 'succeeded' | 'waiting'; demo: boolean; at: Date },
  nodeState: (nodeId: string, index: number) => { state: string; gate: string }
): void {
  const style = { ...DEFAULT_RUN_STYLE }
  const doc = templatePipeline(o.minutes, style)
  const v = validatePipeline(doc, productionRegistry(), { styleFields: Object.keys(style) })
  if (!v.ok) throw new Error('example pipeline invalid')
  const iso = o.at.toISOString()
  const end = new Date(o.at.getTime() + o.minutes * 4 * 60_000).toISOString()
  const done = o.status === 'succeeded'
  const credits = v.plan.order.map((id) => (done && !o.demo ? exampleCredits(v.plan.nodes.get(id)?.def.type ?? '', o.minutes) : 0))
  const total = credits.reduce((a, b) => a + b, 0)
  const res = db
    .prepare(
      `INSERT INTO video_runs (video_id, channel_id, pipeline_json, pipeline_label, topic, minutes, budget_mode, gate_mode, style_json,
         status, demo, quote_credits, spent_credits, attempt, duration_s, created_at, started_at, finished_at, example)
       VALUES (?, ?, ?, ?, ?, ?, 'usage_max', 'step', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 1)`
    )
    .run(
      o.videoId,
      o.channelId,
      JSON.stringify(doc),
      doc.name,
      o.topic,
      o.minutes,
      JSON.stringify(style),
      o.status,
      o.demo ? 1 : 0,
      total,
      total,
      done ? Math.round(o.minutes * 60 + 7) : null,
      iso,
      iso,
      done ? end : null
    )
  const runId = Number(res.lastInsertRowid)
  const ins = db.prepare(
    `INSERT INTO video_run_nodes (run_id, node_id, position, type, label, state, progress, quote_credits, credits, gate, gate_kind, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const [i, id] of v.plan.order.entries()) {
    const rn = v.plan.nodes.get(id)
    const type = rn?.def.type ?? ''
    const s = nodeState(id, i)
    const finished = s.state === 'done'
    const gate = finished && (rn?.gate ?? 'none') !== 'none' ? 'approved' : s.gate
    ins.run(
      runId,
      id,
      i,
      type,
      nodeLabel(id, type),
      s.state,
      finished || s.state === 'waiting_gate' ? 1 : 0,
      credits[i] ?? 0,
      credits[i] ?? 0,
      gate,
      rn?.gate ?? 'none',
      finished || s.state === 'waiting_gate' ? iso : null,
      finished ? (done ? end : iso) : null
    )
  }
}

export const runsExample: ExampleArea = {
  name: 'runs',
  seed: (db: Db, seed: ExampleSeed) => {
    const now = new Date()
    db.prepare(
      `INSERT INTO credit_entries (kind, amount, idempotency_key, source, note, created_at, example)
       VALUES ('grant', 2000, ?, 'example', 'Crédits de l’espace d’exemple', ?, 1)`
    ).run(`example-grant-${now.getTime()}`, now.toISOString())
    const channelOf = (key: ExampleVideoKey): number =>
      (db.prepare('SELECT channel_id FROM videos WHERE id = ?').get(seed.videos[key]) as { channel_id: number }).channel_id
    for (const f of FINISHED) {
      insertRun(
        db,
        { videoId: seed.videos[f.key], channelId: channelOf(f.key), minutes: f.minutes, topic: f.topic, status: 'succeeded', demo: false, at: new Date(now.getTime() - f.daysAgo * 86_400_000) },
        (_id, _i) => ({ state: 'done', gate: 'none' })
      )
    }
    insertRun(
      db,
      {
        videoId: seed.videos.templiers,
        channelId: channelOf('templiers'),
        minutes: 1,
        topic: 'Le trésor des Templiers a-t-il existé ?',
        status: 'waiting',
        demo: true,
        at: new Date(now.getTime() - 2 * 3_600_000)
      },
      (id) => (id === 'research' ? { state: 'done', gate: 'none' } : id === 'script' ? { state: 'waiting_gate', gate: 'waiting' } : { state: 'pending', gate: 'none' })
    )
  },
  clear: (db: Db) => {
    db.prepare('DELETE FROM credit_entries WHERE example = 1').run()
    // the engine's state of example runs that were resumed (decisions are per video, records per engine run)
    db.prepare("DELETE FROM production_gate_decisions WHERE scope IN (SELECT 'video-' || video_id FROM video_runs WHERE example = 1)").run()
    db.prepare("DELETE FROM production_node_records WHERE EXISTS (SELECT 1 FROM video_runs r WHERE r.example = 1 AND production_node_records.engine_run_id LIKE 'vr-' || r.id || '-%')").run()
    db.prepare('DELETE FROM video_runs WHERE example = 1').run()
  }
}
