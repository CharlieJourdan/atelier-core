// The demo's production runs (api-runs*.ts): every run and its video in memory, and a small "engine" made of timers that
// walks a run through its bricks, stops at its gates and ends with a finished video, telling the screens at each step
// (`changed('production')`), as the desktop app does. Seeded with finished videos, runs in progress and one at a gate.
import type { RunBudgetMode, RunDetail, RunGateMode, RunNode, RunStartInput, RunStatus, RunStyle, RunSummary } from '../../../shared/runs'
import type { VideoRow, VideoStatus } from '../../../shared/workflow'
import { changed } from './bridge'
import { BRICKS, PIPELINE, freshNodes } from './api-runs-template'
import { ago, channelName, nextId } from './world'

export const runs = new Map<number, RunDetail>()
export const videos = new Map<number, VideoRow>()
/** The change notes sent at a node's gate (`runId:nodeId`), oldest first: the review rebuilds each version from them. */
export const revisions = new Map<string, string[]>()

const timers = new Map<number, ReturnType<typeof setTimeout>>()
/** Milliseconds between two steps of a run (launched runs take ~25 s, the seeded ones a few minutes). */
const pace = new Map<number, number>()
const LAUNCH_PACE = 700

const now = (): string => new Date().toISOString()
const DONE: readonly RunNode['state'][] = ['done', 'cached']
const fingerprint = (runId: number, nodeId: string): string => `demo-${runId}-${nodeId}-${Date.now().toString(36)}`

export function summaryOf(run: RunDetail): RunSummary {
  const { nodes: _nodes, notes: _notes, ...summary } = run
  return { ...summary, style: { ...run.style }, waitingNodes: [...run.waitingNodes] }
}

export function getRun(id: number): RunDetail {
  const run = runs.get(id)
  if (!run) throw new Error('Cette fabrication n’existe pas (ou plus) dans la démo.')
  return run
}

function setVideo(videoId: number, status: VideoStatus): void {
  const v = videos.get(videoId)
  if (v) videos.set(videoId, { ...v, status, updatedAt: now() })
}

/** Global progress, the running brick, the gates waiting: derived from the nodes. */
function recompute(run: RunDetail): void {
  const n = run.nodes.length
  run.progress = run.nodes.reduce((s, x) => s + (DONE.includes(x.state) ? 1 : x.state === 'running' || x.state === 'waiting_gate' ? x.progress : 0), 0) / n
  const cur = run.nodes.find((x) => x.state === 'running')
  run.current = cur ? { nodeId: cur.nodeId, label: cur.label, step: cur.step } : null
  run.waitingNodes = run.nodes.filter((x) => x.gate === 'waiting').map((x) => x.nodeId)
  run.spentCredits = run.nodes.reduce((s, x) => s + x.credits, 0)
}

function engineOf(node: RunNode): RunNode['engines'] {
  if (node.quoteCredits === 0) return []
  const id = { voice: 'voice:voix-studio', visuals: 'image:images-studio', music: 'music:musique-libre', thumbnail: 'image:miniatures-studio' }[node.nodeId]
  return id ? [{ id, real: true, jobs: node.nodeId === 'visuals' ? 14 : 1, credits: node.quoteCredits }] : []
}

function finishNode(run: RunDetail, node: RunNode): void {
  node.state = 'done'
  node.progress = 1
  node.step = null
  node.finishedAt = now()
  node.fingerprint = fingerprint(run.id, node.nodeId)
  if (!run.demo) {
    node.credits = node.quoteCredits
    node.engines = run.cloud ? engineOf(node) : []
  }
}

function finishRun(run: RunDetail): void {
  run.status = 'succeeded'
  run.live = false
  run.finishedAt = now()
  run.videoFileRef = 'render/video.mp4'
  run.packageDir = `Atelier/Production/run-${run.id}/paquet`
  run.durationS = Math.round(run.minutes * 60 + 7)
  setVideo(run.videoId, 'ready')
}

function stop(runId: number): void {
  const t = timers.get(runId)
  if (t !== undefined) clearTimeout(t)
  timers.delete(runId)
}

function schedule(run: RunDetail): void {
  stop(run.id)
  timers.set(run.id, setTimeout(() => tick(run.id), pace.get(run.id) ?? LAUNCH_PACE))
}

/** One step of the engine: start the next brick, move the running one, stop at its gate, or finish the run. */
function tick(runId: number): void {
  timers.delete(runId)
  const run = runs.get(runId)
  if (!run || (run.status !== 'running' && run.status !== 'queued')) return
  run.status = 'running'
  const node = run.nodes.find((x) => !DONE.includes(x.state))
  if (!node) {
    finishRun(run)
    recompute(run)
    changed('production', 'videos')
    return
  }
  const steps = BRICKS.find((b) => b.nodeId === node.nodeId)?.steps ?? ['Travail en cours']
  if (node.state !== 'running') {
    node.state = 'running'
    node.startedAt = now()
    node.progress = 0.04
    node.step = node.changeNote && node.gate === 'changes_requested' ? `Reprise avec ta note : « ${node.changeNote.slice(0, 60)} »` : (steps[0] ?? null)
  } else if (node.progress < 1 - 1e-6) {
    const k = Math.min(steps.length, Math.round(node.progress * steps.length) + 1)
    node.progress = k / steps.length
    node.step = steps[Math.min(k, steps.length - 1)] ?? null
    if (k >= steps.length) node.step = 'Vérification du résultat'
  } else if (node.gateKind !== 'none' && node.gate !== 'approved') {
    node.state = 'waiting_gate'
    node.gate = 'waiting'
    node.step = node.gateKind === 'owner' ? 'Attend ton accord avant de finir' : 'Attend ta relecture'
    node.fingerprint = fingerprint(run.id, node.nodeId)
    run.status = 'waiting'
    setVideo(run.videoId, 'waiting_approval')
    recompute(run)
    changed('production', 'videos')
    return
  } else {
    finishNode(run, node)
  }
  recompute(run)
  changed('production')
  schedule(run)
}

function startEngine(run: RunDetail): void {
  run.live = true
  if (run.status !== 'waiting') run.status = 'running'
  run.startedAt ??= now()
  setVideo(run.videoId, run.status === 'waiting' ? 'waiting_approval' : 'in_progress')
  recompute(run)
  schedule(run)
}

export function newVideo(channelId: number, title: string, brief: string, status: VideoStatus = 'in_progress', id = nextId(), minutesAgo = 0): VideoRow {
  const v: VideoRow = { id, channelId, goalId: null, title, brief, status, deadline: null, createdAt: ago(minutesAgo + 60), updatedAt: ago(minutesAgo) }
  videos.set(id, v)
  return v
}

interface RunSeed {
  id?: number
  videoId: number
  topic: string
  minutes: number
  budgetMode: RunBudgetMode
  gateMode: RunGateMode
  style?: RunStyle
  demo?: boolean
  cloud?: boolean
  ownerGate?: boolean
  redoOf?: number | null
  createdAgo?: number
}

export function makeRun(seed: RunSeed): RunDetail {
  const video = videos.get(seed.videoId)
  if (!video) throw new Error('Vidéo inconnue dans la démo.')
  const id = seed.id ?? nextId()
  const demo = seed.demo ?? true
  const nodes = freshNodes(seed.minutes, seed.budgetMode, seed.gateMode, seed.ownerGate ?? false)
  const run: RunDetail = {
    id,
    videoId: video.id,
    videoTitle: video.title,
    channelId: video.channelId,
    channelName: channelName(video.channelId),
    pipelineId: PIPELINE.id,
    pipelineLabel: PIPELINE.label,
    pipelineVersion: PIPELINE.version,
    topic: seed.topic,
    minutes: seed.minutes,
    budgetMode: seed.budgetMode,
    gateMode: seed.gateMode,
    style: seed.style ?? {},
    status: 'queued',
    demo,
    cloud: seed.cloud ?? false,
    live: false,
    quoteCredits: nodes.reduce((s, n) => s + n.quoteCredits, 0),
    spentCredits: 0,
    progress: 0,
    waitingNodes: [],
    current: null,
    error: null,
    videoFileRef: null,
    packageDir: null,
    durationS: null,
    attempt: 1,
    redoOf: seed.redoOf ?? null,
    createdAt: ago(seed.createdAgo ?? 0),
    startedAt: null,
    finishedAt: null,
    example: false,
    nodes,
    notes: []
  }
  runs.set(id, run)
  return run
}

/** `production.start`: the video (made when only a channel and a title are given), then the run, which starts at once. */
export function startRun(input: RunStartInput): RunDetail {
  let videoId = input.videoId
  if (videoId === undefined) {
    if (input.channelId === undefined) throw new Error('Choisis une chaîne pour cette vidéo.')
    videoId = newVideo(input.channelId, (input.title ?? input.topic).slice(0, 200), input.topic).id
  }
  const run = makeRun({ videoId, topic: input.topic, minutes: input.minutes, budgetMode: input.budgetMode, gateMode: input.gateMode, ...(input.style ? { style: input.style } : {}) })
  pace.set(run.id, LAUNCH_PACE)
  startEngine(run)
  changed('production', 'videos')
  return run
}

export function approve(runId: number, nodeId: string): RunDetail {
  const run = getRun(runId)
  const node = run.nodes.find((n) => n.nodeId === nodeId)
  if (!node || node.gate !== 'waiting') throw new Error('Cette étape n’attend plus de validation.')
  node.gate = 'approved'
  finishNode(run, node)
  run.status = 'running'
  pace.set(run.id, LAUNCH_PACE)
  startEngine(run)
  changed('production', 'videos')
  return run
}

export function requestChanges(runId: number, nodeId: string, note: string): RunDetail {
  const run = getRun(runId)
  const node = run.nodes.find((n) => n.nodeId === nodeId)
  if (!node || node.gate !== 'waiting') throw new Error('Cette étape n’attend plus de validation.')
  if (!note.trim()) throw new Error('Écris ce qu’il faut changer.')
  const key = `${runId}:${nodeId}`
  revisions.set(key, [...(revisions.get(key) ?? []), note.trim()])
  node.changeNote = note.trim().slice(0, 2000)
  node.gate = 'changes_requested'
  node.state = 'pending'
  node.progress = 0
  run.status = 'running'
  pace.set(run.id, LAUNCH_PACE)
  startEngine(run)
  changed('production', 'videos')
  return run
}

export function cancel(runId: number): RunDetail {
  const run = getRun(runId)
  stop(runId)
  for (const n of run.nodes) {
    if (n.state === 'running' || n.state === 'waiting_gate' || n.state === 'queued') {
      n.state = 'cancelled'
      n.gate = n.gate === 'waiting' ? 'none' : n.gate
      n.step = null
    }
  }
  run.status = 'cancelled'
  run.live = false
  run.finishedAt = now()
  setVideo(run.videoId, 'cancelled')
  recompute(run)
  changed('production', 'videos', 'credits')
  return run
}

/** Relaunches the same run: finished bricks come back « Réutilisé », the others run again. */
export function retry(runId: number): RunDetail {
  const run = getRun(runId)
  if (!(['failed', 'cancelled', 'interrupted'] as RunStatus[]).includes(run.status)) throw new Error('Cette fabrication n’est pas à relancer.')
  for (const n of run.nodes) {
    if (n.state === 'done') n.state = 'cached'
    else if (n.state !== 'cached') Object.assign(n, { state: 'pending', progress: 0, step: null, error: null })
  }
  run.status = 'running'
  run.error = null
  run.finishedAt = null
  run.attempt += 1
  pace.set(run.id, LAUNCH_PACE)
  startEngine(run)
  changed('production', 'videos')
  return run
}

/** « Refaire pareil »: the same settings on a new video of the same channel. */
export function redo(runId: number): RunDetail {
  const src = getRun(runId)
  const video = newVideo(src.channelId, `${src.videoTitle} (nouvelle version)`, src.topic)
  const run = makeRun({ videoId: video.id, topic: src.topic, minutes: src.minutes, budgetMode: src.budgetMode, gateMode: src.gateMode, style: { ...src.style }, redoOf: src.id })
  pace.set(run.id, LAUNCH_PACE)
  startEngine(run)
  changed('production', 'videos')
  return run
}

export function resume(runId: number): RunDetail {
  const run = getRun(runId)
  if (run.status === 'interrupted') run.status = 'running'
  run.attempt += 1
  pace.set(run.id, LAUNCH_PACE)
  if (run.status === 'waiting') {
    run.live = true
    recompute(run)
  } else startEngine(run)
  changed('production')
  return run
}

// ---------------------------------------------------------------------------------------------- seeds

/** Puts a seeded run at a point of its life: `upTo` bricks done, the next one at `progress` (running), or finished. */
function placeRun(run: RunDetail, upTo: number, status: RunStatus, startedAgo: number, progress = 0.5): void {
  const span = 2 + run.minutes * 1.2
  run.startedAt = ago(startedAgo)
  run.nodes.forEach((n, i) => {
    if (i < upTo) {
      n.startedAt = ago(startedAgo - (i * span) / run.nodes.length)
      finishNode(run, n)
      n.finishedAt = ago(startedAgo - ((i + 1) * span) / run.nodes.length)
      if (n.gateKind !== 'none') n.gate = 'approved'
    } else if (i === upTo && status !== 'succeeded') {
      n.startedAt = ago(Math.max(0, startedAgo - (i * span) / run.nodes.length))
      n.progress = progress
      const steps = BRICKS[i]?.steps ?? []
      n.step = steps[Math.min(steps.length - 1, Math.floor(progress * steps.length))] ?? null
      n.state = status === 'waiting' ? 'waiting_gate' : status === 'failed' ? 'error' : 'running'
      if (status === 'waiting') {
        n.progress = 1
        n.gate = 'waiting'
        n.step = 'Attend ta relecture'
        n.fingerprint = fingerprint(run.id, n.nodeId)
      }
    }
  })
  run.status = status
  if (status === 'succeeded') {
    finishRun(run)
    run.finishedAt = ago(startedAgo - span)
  }
  recompute(run)
}

let seeded = false

/** Fills the demo once (on the first production call): 5 finished videos, 2 runs in progress, 1 at a gate, 1 failed. */
export function seedRuns(): void {
  if (seeded) return
  seeded = true
  const DAY = 24 * 60
  const done: [number, number, string, string, number, RunBudgetMode, boolean, number, RunStyle?][] = [
    [1, 1, 'Le mystère du vol 19', 'La disparition de cinq avions au large de la Floride en 1945, et ce que l’enquête a vraiment conclu.', 11, 'qualite_max', false, 2 * DAY],
    [2, 1, 'La cité engloutie d’Ys', 'La légende bretonne de la ville noyée, ses versions et ce qu’en disent les historiens.', 9, 'usage_max', true, 6 * DAY],
    [3, 2, 'Mon voisin cachait un secret depuis vingt ans', 'Une histoire racontée à la première personne, ton intime, chute à la fin.', 1, 'usage_max', true, DAY + 300],
    [4, 3, '10 inventions nées d’une erreur', 'Dix découvertes accidentelles, de la pénicilline au micro-ondes, classées de la moins à la plus surprenante.', 12, 'usage_max', false, 3 * DAY],
    [5, 4, 'The Lighthouse Keepers Who Vanished', 'Three keepers disappear from a remote lighthouse in 1900: the facts, the theories, the likely answer.', 10, 'usage_max', true, 4 * DAY, { language: 'en' }]
  ]
  for (const [id, channelId, title, topic, minutes, budgetMode, demo, startedAgo, style] of done) {
    newVideo(channelId, title, topic, 'ready', 100 + id, startedAgo)
    const run = makeRun({ id, videoId: 100 + id, topic, minutes, budgetMode, gateMode: 'all', demo, cloud: !demo, createdAgo: startedAgo + 2, ...(style ? { style } : {}) })
    placeRun(run, run.nodes.length, 'succeeded', startedAgo)
  }
  // in progress: one well advanced, one just started (slow pace, so a visitor sees them move for a few minutes)
  newVideo(3, '10 villes fantômes du monde', 'Dix villes abandonnées, pourquoi elles se sont vidées et ce qu’il en reste.', 'in_progress', 106, 25)
  const r6 = makeRun({ id: 6, videoId: 106, topic: 'Dix villes abandonnées, pourquoi elles se sont vidées et ce qu’il en reste.', minutes: 10, budgetMode: 'usage_max', gateMode: 'all', createdAgo: 26 })
  placeRun(r6, 4, 'running', 25, 0.4)
  pace.set(6, 5_000)
  newVideo(2, 'J’ai retrouvé la lettre de ma grand-mère', 'Une lettre jamais envoyée, retrouvée dans un grenier : récit court et émouvant.', 'in_progress', 107, 4)
  const r7 = makeRun({ id: 7, videoId: 107, topic: 'Une lettre jamais envoyée, retrouvée dans un grenier : récit court et émouvant.', minutes: 1, budgetMode: 'usage_max', gateMode: 'all', createdAgo: 5 })
  placeRun(r7, 1, 'running', 4, 0.3)
  pace.set(7, 6_500)
  // at a gate: the script waits for the owner's read
  newVideo(1, 'Le trésor perdu des Templiers', 'Ce que l’on sait vraiment du trésor de l’ordre du Temple après 1307, sans céder aux légendes.', 'waiting_approval', 108, 40)
  const r8 = makeRun({ id: 8, videoId: 108, topic: 'Ce que l’on sait vraiment du trésor de l’ordre du Temple après 1307, sans céder aux légendes.', minutes: 12, budgetMode: 'usage_max', gateMode: 'step', ownerGate: true, createdAgo: 42 })
  placeRun(r8, 1, 'waiting', 40)
  r8.live = true
  // failed: the pictures' provider did not answer (« Relancer » finishes it)
  newVideo(4, 'The Dyatlov Pass, Explained', 'Nine hikers, one night in 1959: the evidence and the most solid explanation.', 'failed', 109, 3 * 60)
  const r9 = makeRun({ id: 9, videoId: 109, topic: 'Nine hikers, one night in 1959: the evidence and the most solid explanation.', minutes: 10, budgetMode: 'usage_max', gateMode: 'all', style: { language: 'en' }, createdAgo: 3 * 60 + 2 })
  placeRun(r9, 4, 'failed', 3 * 60, 0.6)
  const failed = r9.nodes[4]!
  failed.error = { code: 'provider_timeout', message: 'Le fournisseur d’images n’a pas répondu à temps. Relance la fabrication : ce qui est fait sera réutilisé.', detail: 'demo: image provider timed out after 120 s' }
  failed.step = null
  r9.error = 'Une étape a échoué : Images.'
  r9.finishedAt = ago(3 * 60 - 8)
  // the runs in progress move on their own
  for (const r of [r6, r7]) {
    r.live = true
    schedule(r)
  }
}
