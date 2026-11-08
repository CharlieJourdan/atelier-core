// The demo's agent workflow around the videos (api-runs*.ts): the videos list, the deliverables waiting for the owner
// (Validations), the agents' tasks and the inbox that gathers them with the production gates. Invented content only.
import type { InboxGate, HomeInbox } from '../../../shared/api/home'
import type { DeliverableRow, DeliverableType, PendingApproval, TaskRow, TaskStatus, VersionRow, VideoRow } from '../../../shared/workflow'
import { DELIVERABLE_GRAPH } from '../../../shared/workflow'
import { changed, type DemoHandlers } from './bridge'
import { runs, seedRuns, videos } from './api-runs-state'
import { ago } from './world'

interface Waiting {
  deliverable: DeliverableRow
  version: VersionRow
}

const pending = new Map<number, Waiting>()
const tasks = new Map<number, TaskRow>()
let ready = false

function deliverable(id: number, videoId: number, type: DeliverableType, minutesAgo: number): DeliverableRow {
  const def = DELIVERABLE_GRAPH.find((d) => d.type === type)
  return {
    id,
    videoId,
    type,
    status: 'waiting_approval',
    needsApproval: true,
    ownerGate: type === 'publish_package',
    currentVersionId: id * 10 + 1,
    approvedVersionId: null,
    dependsOn: [...(def?.dependsOn ?? [])],
    createdAt: ago(minutesAgo + 30),
    updatedAt: ago(minutesAgo)
  }
}

function version(d: DeliverableRow, author: string, content: string, minutesAgo: number): VersionRow {
  return { id: d.id * 10 + 1, deliverableId: d.id, number: 1, content, filePath: null, mime: 'text/markdown', costUsd: 0, author, taskId: null, createdAt: ago(minutesAgo) }
}

function task(id: number, videoId: number | null, title: string, assignee: string, status: TaskStatus, minutesAgo: number, extra: Partial<TaskRow> = {}): TaskRow {
  const finished = status === 'done' || status === 'failed' || status === 'cancelled'
  return {
    id,
    videoId,
    deliverableId: null,
    title,
    assigneeType: 'agent',
    assignee,
    status,
    attempts: status === 'ready' || status === 'blocked' ? 0 : 1,
    maxAttempts: 3,
    estCostUsd: 0,
    lastError: null,
    holdReason: null,
    startedAt: status === 'ready' || status === 'blocked' ? null : ago(minutesAgo + 6),
    finishedAt: finished ? ago(minutesAgo) : null,
    createdAt: ago(minutesAgo + 20),
    updatedAt: ago(minutesAgo),
    ...extra
  }
}

/** Two planned videos waiting on the owner's OK (thumbnail brief, metadata), and the agents' recent tasks. */
function seed(): void {
  if (ready) return
  ready = true
  seedRuns()
  const v1 = videos.get(110) ?? newPlanned(110, 1, 'L’homme au masque de fer', 'Qui était vraiment le prisonnier masqué de la Bastille ? Les six candidats sérieux.')
  const v2 = videos.get(111) ?? newPlanned(111, 3, '10 records que personne ne battra', 'Dix records sportifs et scientifiques hors d’atteinte, expliqués simplement.')
  const d1 = deliverable(51, v1.id, 'thumbnail_brief', 35)
  pending.set(d1.id, {
    deliverable: d1,
    version: version(d1, 'Iris (miniatures)', 'Miniature : un masque de fer sur fond noir, éclairage latéral.\nTexte : « QUI ÉTAIT-IL ? » en trois mots maximum.\nContraste fort, visage hors champ, cadre serré.', 35)
  })
  const d2 = deliverable(52, v2.id, 'metadata', 12)
  pending.set(d2.id, {
    deliverable: d2,
    version: version(d2, 'Léo (métadonnées)', 'Titre : 10 records que personne ne battra (et pourquoi)\nDescription : du saut en longueur de 1991 au plus long vol en apesanteur, dix records hors d’atteinte.\nTags : records, top 10, culture générale, sport, science', 12)
  })
  const rows: TaskRow[] = [
    task(201, 106, 'Recherche : villes fantômes', 'Nora (recherche)', 'done', 50),
    task(202, 106, 'Script : 10 villes fantômes du monde', 'Sacha (scénario)', 'done', 38),
    task(203, 110, 'Brief de miniature : le masque de fer', 'Iris (miniatures)', 'waiting_approval', 35),
    task(204, 111, 'Métadonnées : 10 records', 'Léo (métadonnées)', 'waiting_approval', 12),
    task(205, 107, 'Récit : la lettre de ma grand-mère', 'Sacha (scénario)', 'running', 3),
    task(206, null, 'Veille : sujets qui montent sur la niche « mystères »', 'Nora (recherche)', 'ready', 1),
    task(207, 109, 'Vérification des faits : col Dyatlov', 'Nora (recherche)', 'failed', 180, { lastError: 'Démo : une source citée ne répond plus.', attempts: 3 }),
    task(208, 108, 'Relecture : le trésor des Templiers', 'Toi', 'waiting_approval', 40, { assigneeType: 'owner' })
  ]
  for (const r of rows) tasks.set(r.id, r)
}

function newPlanned(id: number, channelId: number, title: string, brief: string): VideoRow {
  const v: VideoRow = { id, channelId, goalId: null, title, brief, status: 'waiting_approval', deadline: ago(-3 * 24 * 60), createdAt: ago(2 * 24 * 60), updatedAt: ago(30) }
  videos.set(id, v)
  return v
}

function approvalsList(): PendingApproval[] {
  seed()
  return [...pending.values()].flatMap((w) => {
    const video = videos.get(w.deliverable.videoId)
    return video ? [{ deliverable: { ...w.deliverable }, video: { ...video }, version: { ...w.version } }] : []
  })
}

function gatesList(): InboxGate[] {
  seed()
  return [...runs.values()].flatMap((r) =>
    r.nodes
      .filter((n) => n.gate === 'waiting')
      .map((n) => ({
        runId: r.id,
        nodeId: n.nodeId,
        nodeLabel: n.label,
        gateKind: n.gateKind === 'owner' ? ('owner' as const) : ('review' as const),
        videoId: r.videoId,
        videoTitle: r.videoTitle,
        channelId: r.channelId,
        channelName: r.channelName,
        pipelineLabel: r.pipelineLabel,
        demo: r.demo,
        step: n.step
      }))
  )
}

function decide(id: number, approved: boolean, note?: string): DeliverableRow {
  seed()
  const w = pending.get(id)
  if (!w) throw new Error('Ce livrable n’attend plus de décision.')
  if (!approved && !note?.trim()) throw new Error('Écris ce qu’il faut reprendre.')
  pending.delete(id)
  for (const t of tasks.values()) {
    if (t.videoId === w.deliverable.videoId && t.status === 'waiting_approval') tasks.set(t.id, { ...t, status: approved ? 'done' : 'ready', finishedAt: approved ? ago(0) : null, updatedAt: ago(0) })
  }
  const v = videos.get(w.deliverable.videoId)
  if (v) videos.set(v.id, { ...v, status: 'in_progress', updatedAt: ago(0) })
  changed('videos', 'agents')
  return { ...w.deliverable, status: approved ? 'approved' : 'revision_requested', approvedVersionId: approved ? w.version.id : null, updatedAt: ago(0) }
}

function setTask(id: number, patch: Partial<TaskRow>): TaskRow {
  seed()
  const t = tasks.get(id)
  if (!t) throw new Error('Cette tâche n’existe pas dans la démo.')
  const next = { ...t, ...patch, updatedAt: ago(0) }
  tasks.set(id, next)
  changed('agents', 'videos')
  return next
}

export const workflowHandlers: DemoHandlers = {
  'videos.list': (filter) => {
    seed()
    return [...videos.values()]
      .filter((v) => (filter?.channelId === undefined || v.channelId === filter.channelId) && (filter?.status === undefined || v.status === filter.status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((v) => ({ ...v }))
  },
  'videos.update': (id, patch) => {
    seed()
    const v = videos.get(id)
    if (!v) throw new Error('Cette vidéo n’existe pas dans la démo.')
    const next: VideoRow = { ...v, ...patch, updatedAt: ago(0) }
    videos.set(id, next)
    for (const r of runs.values()) if (r.videoId === id && patch.title) r.videoTitle = patch.title
    changed('videos', 'production')
    return { ...next }
  },
  'approvals.pending': () => approvalsList(),
  'approvals.history': () => [],
  'approvals.approve': (id, _note) => decide(id, true),
  'approvals.requestRevision': (id, note) => decide(id, false, note),
  'home.inbox': (): HomeInbox => {
    const approvals = approvalsList()
    const gates = gatesList()
    return { approvals, gates, total: approvals.length + gates.length }
  },
  'tasks.list': (filter) => {
    seed()
    return [...tasks.values()]
      .filter((t) => (filter?.videoId === undefined || t.videoId === filter.videoId) && (filter?.status === undefined || t.status === filter.status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((t) => ({ ...t }))
  },
  'tasks.retry': (id) => setTask(id, { status: 'ready', lastError: null, attempts: 0 }),
  'tasks.resume': (id) => setTask(id, { status: 'ready', holdReason: null })
}
