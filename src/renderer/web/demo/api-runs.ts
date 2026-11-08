// Demo handlers: production and finished videos (see handlers.ts). Runs walk through their bricks on timers
// (api-runs-state.ts), their results are made in the browser (api-runs-outputs.ts), the agents' workflow around them is in
// api-runs-workflow.ts. Projects, the publication kit, the clip libraries, voices and the engine's status are here.
import type { ChannelClipsView } from '../../../shared/channel-clips'
import type { KitWithLinks } from '../../../shared/cloud-kit'
import type { ProjectDetail } from '../../../shared/recipes'
import type { EngineStatus, RunListFilter, RunStatus, RunVoices } from '../../../shared/runs'
import { toast } from '@/lib/toast'
import { changed, type DemoHandlers } from './bridge'
import { posterSvg, svgDataUrl, hueOf } from './api-runs-media'
import { fileOf, libraryItem, outputOf, packageFiles, packageTexts } from './api-runs-outputs'
import * as engine from './api-runs-state'
import { demoQuote } from './api-runs-template'
import { workflowHandlers } from './api-runs-workflow'
import { ago } from './world'

const { runs, seedRuns, summaryOf, getRun } = engine

/** Every read seeds the demo first (once), so the first screen opened already has its runs. */
function run(id: number) {
  seedRuns()
  return getRun(id)
}

// ---------------------------------------------------------------------------------------------- projects

const RECIPES = { docu: { id: 1, name: 'Documentaire narré', version: 3 }, story: { id: 2, name: 'Histoire racontée (short)', version: 2 }, top: { id: 3, name: 'Classement top 10', version: 4 } }

const projects = new Map<number, ProjectDetail>()

function project(id: number, recipe: keyof typeof RECIPES, channelId: number, title: string, idea: string, runId: number | null, daysAgo: number, minutes: number): ProjectDetail {
  const r = RECIPES[recipe]
  const videoId = runId !== null ? (runs.get(runId)?.videoId ?? null) : null
  return { id, title, recipeId: r.id, recipeName: r.name, recipeVersion: r.version, channelId, runId, runStatus: null, videoId, createdAt: ago(daysAgo * 1440), updatedAt: ago(daysAgo * 1440 - 30), idea, inputs: {}, adjustments: { minutes }, pins: {} }
}

let projectsReady = false
function seedProjects(): void {
  seedRuns()
  if (projectsReady) return
  projectsReady = true
  for (const p of [
    project(1, 'docu', 1, 'Le mystère du vol 19', 'La disparition de cinq avions au large de la Floride en 1945.', 1, 3, 11),
    project(2, 'top', 3, '10 villes fantômes du monde', 'Dix villes abandonnées et ce qu’il en reste.', 6, 0.1, 10),
    project(3, 'docu', 1, 'Le trésor perdu des Templiers', 'Ce que l’on sait vraiment du trésor du Temple après 1307.', 8, 1, 12),
    project(4, 'story', 2, 'Le colis qui n’était pas pour moi', 'Un colis livré par erreur, et la lettre qu’il contenait.', null, 0.5, 1),
    project(5, 'docu', 1, 'Le procès des animaux au Moyen Âge', 'Quand on jugeait des cochons et des sauterelles devant un tribunal.', null, 2, 9)
  ])
    projects.set(p.id, p)
}

/** The project as the list shows it, with its run's status now. */
function withStatus(p: ProjectDetail): ProjectDetail {
  const r = p.runId !== null ? runs.get(p.runId) : undefined
  return { ...p, runStatus: r?.status ?? null, videoId: r?.videoId ?? p.videoId }
}

function projectOf(id: number): ProjectDetail {
  seedProjects()
  const p = projects.get(id)
  if (p) return p
  // a project another fixture made (« Nouveau projet »): known from here on, on the first channel
  const made = project(id, 'docu', 1, `Projet n° ${id}`, 'Projet créé pendant la visite.', null, 0, 8)
  projects.set(id, made)
  return made
}

function runProject(id: number): ProjectDetail {
  const p = projectOf(id)
  if (p.channelId === null) throw new Error('Un projet doit avoir une chaîne pour être lancé.')
  const prev = p.runId !== null ? runs.get(p.runId) : undefined
  if (prev && (['failed', 'cancelled', 'interrupted'] as RunStatus[]).includes(prev.status)) engine.retry(prev.id)
  else if (prev) throw new Error('Ce projet est déjà lancé : suis-le dans « En cours ».')
  else {
    const r = engine.startRun({ channelId: p.channelId, title: p.title, topic: p.idea || p.title, minutes: p.adjustments.minutes ?? 8, budgetMode: 'usage_max', gateMode: 'all' })
    p.runId = r.id
    p.videoId = r.videoId
    p.updatedAt = ago(0)
  }
  changed('production')
  return withStatus(p)
}

const SCRIPT_SAMPLE =
  'Il est trois heures du matin quand le téléphone sonne.\n\nAu bout du fil, personne. Juste une respiration, puis un mot : « Pardon. »\n\nJe n’ai compris que dix ans plus tard qui avait appelé ce soir-là.'

// ---------------------------------------------------------------------------------------------- clip libraries

const clipLibs = new Map<number, ChannelClipsView>()
function clipsOf(channelId: number): ChannelClipsView {
  const v = clipLibs.get(channelId) ?? { channelId, folder: `Atelier/Chaînes/${channelId}/clips`, clips: channelId === 2 ? 24 : 0, fromStock: channelId === 2 ? 24 : 0, own: 0, avatar: null, music: null }
  clipLibs.set(channelId, v)
  return v
}
function setClips(channelId: number, patch: Partial<ChannelClipsView>): ChannelClipsView {
  const v = { ...clipsOf(channelId), ...patch }
  clipLibs.set(channelId, v)
  changed('production')
  return { ...v }
}

// ---------------------------------------------------------------------------------------------- publication kit

const published = new Set<number>()
const sha = (s: string): string => Array.from({ length: 8 }, (_, i) => hueOf(`${s}${i}`).toString(16).padStart(8, '0')).join('').slice(0, 64)

function kitOf(videoId: number): KitWithLinks | null {
  seedRuns()
  const r = [...runs.values()].find((x) => x.videoId === videoId && x.status === 'succeeded')
  if (!r || (!published.has(r.id) && r.id > 5)) return null
  const texts = packageTexts(r)
  const expires = ago(-90 * 1440)
  const url = (name: string): string => {
    if (/\.(png|jpg)$/.test(name)) return svgDataUrl(posterSvg(r.videoTitle, `${r.channelName} · miniature`, { seed: r.videoTitle }))
    if (/\.mp4$/.test(name)) return ''
    return `data:text/plain;charset=utf-8,${encodeURIComponent(name === 'description.txt' ? texts.description : JSON.stringify(texts))}`
  }
  return {
    ...texts,
    language: r.style.language ?? 'fr',
    demo: r.demo,
    durationS: r.durationS,
    id: `kit-demo-${r.id}`,
    videoId: `demo-${videoId}`,
    createdAt: r.finishedAt ?? ago(0),
    expiresAt: expires,
    files: packageFiles(r).map((f) => ({ name: f.name, mime: f.mime, size: f.size, sha256: sha(`${r.id}${f.name}`), url: url(f.name), expiresAt: ago(-60) }))
  }
}

// ---------------------------------------------------------------------------------------------- voices and engine

const VOICES: RunVoices = {
  voices: [
    { id: 'sys-fr-claire', name: 'Claire (voix système)', language: 'fr', system: true },
    { id: 'sys-fr-mathis', name: 'Mathis (voix système)', language: 'fr', system: true },
    { id: 'sys-fr-lucie', name: 'Lucie (voix système)', language: 'fr', system: true },
    { id: 'sys-en-grace', name: 'Grace (system voice)', language: 'en', system: true },
    { id: 'sys-en-owen', name: 'Owen (system voice)', language: 'en', system: true },
    { id: 'sys-es-lola', name: 'Lola (voz del sistema)', language: 'es', system: true }
  ],
  listed: true,
  note: 'Démo : voix inventées. Dans l’app, ce sont les voix installées sur ton ordinateur.'
}

function engineStatus(): EngineStatus {
  seedRuns()
  const active = [...runs.values()].filter((r) => r.live && (r.status === 'running' || r.status === 'queued' || r.status === 'waiting')).map((r) => r.id)
  return {
    ffmpeg: { found: true, path: 'ffmpeg (démo)', version: '7.1' },
    ffprobe: { found: true, path: 'ffprobe (démo)' },
    systemVoice: true,
    platform: 'web (démo)',
    dataDir: 'Démo — rien n’est écrit sur ce navigateur',
    productionDir: 'Démo — Atelier/Production',
    resourcesDir: 'Démo — ressources intégrées',
    resourcesFound: true,
    activeRuns: active.length,
    activeRunIds: active,
    cloudConnected: false,
    note: 'Démo : le moteur est simulé dans le navigateur, aucune vidéo n’est vraiment rendue.'
  }
}

function listRuns(filter?: RunListFilter) {
  seedRuns()
  const statuses = filter?.status === undefined ? null : Array.isArray(filter.status) ? filter.status : [filter.status]
  return [...runs.values()]
    .filter((r) => (filter?.videoId === undefined || r.videoId === filter.videoId) && (filter?.channelId === undefined || r.channelId === filter.channelId) && (!statuses || statuses.includes(r.status)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, filter?.limit ?? 100)
    .map(summaryOf)
}

/** Copies, so a screen never holds the engine's live objects. */
const copy = <T>(v: T): T => structuredClone(v)

export const runsHandlers: DemoHandlers = {
  ...workflowHandlers,
  'projects.list': (filter) => {
    seedProjects()
    return [...projects.values()]
      .filter((p) => filter?.channelId === undefined || p.channelId === filter.channelId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => {
        const { idea: _i, inputs: _in, adjustments: _a, pins: _p, ...summary } = withStatus(p)
        return summary
      })
  },
  'projects.get': (id) => copy(withStatus(projectOf(id))),
  'projects.run': (id) => copy(runProject(id)),
  'projects.quote': (id) => demoQuote(projectOf(id).adjustments.minutes ?? 8, undefined, 'usage_max'),
  'projects.readScript': (file) => {
    const text = `${SCRIPT_SAMPLE}\n\n(Démo : texte d’exemple à la place de « ${file.name} ».)`
    return { text, words: text.split(/\s+/).filter(Boolean).length }
  },
  'production.quote': (input) => demoQuote(input.minutes, input.style),
  'production.start': (input) => {
    seedRuns()
    return copy(engine.startRun(input))
  },
  'production.list': (filter) => listRuns(filter),
  'production.get': (id) => copy(run(id)),
  'production.approve': (id, nodeId) => (run(id), copy(engine.approve(id, nodeId))),
  'production.requestChanges': (id, nodeId, note) => (run(id), copy(engine.requestChanges(id, nodeId, note))),
  'production.cancel': (id) => (run(id), copy(engine.cancel(id))),
  'production.retry': (id) => (run(id), copy(engine.retry(id))),
  'production.redo': (id) => (run(id), copy(engine.redo(id))),
  'production.resume': (id) => (run(id), copy(engine.resume(id))),
  'production.output': (id, nodeId) => outputOf(run(id), nodeId),
  'production.file': (id, ref) => fileOf(run(id), ref),
  'production.library': (filter) => {
    seedRuns()
    return [...runs.values()]
      .filter((r) => r.status === 'succeeded' && (filter?.channelId === undefined || r.channelId === filter.channelId))
      .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))
      .map(libraryItem)
  },
  'production.voices': () => copy(VOICES),
  'production.engineStatus': () => engineStatus(),
  'production.revealPackage': (id) => {
    const r = run(id)
    toast.demo()
    return { opened: false, path: r.packageDir ?? `Atelier/Production/run-${r.id}/paquet` }
  },
  'production.pastRenders': () => [],
  'graph.run': () => null,
  'cloud.kitRef': (videoId) => `demo-${videoId}`,
  'cloud.kit': (videoId) => {
    const kit = kitOf(videoId)
    return kit ? { status: 'ok', kit } : { status: 'none' }
  },
  'cloud.kitPublish': (runId) => {
    const r = run(runId)
    if (r.status !== 'succeeded') throw new Error('Le paquet de cette vidéo n’est pas encore prêt.')
    published.add(r.id)
    changed('cloud')
    const files = packageFiles(r)
    return { files: files.length, bytes: files.reduce((s, f) => s + f.size, 0) }
  },
  'cloud.kitDownload': (videoId, name) => {
    const kit = kitOf(videoId)
    const names = kit ? kit.files.map((f) => f.name) : []
    return { saved: name ? names.filter((n) => n === name) : names, dir: null }
  },
  'channelClips.get': (channelId) => ({ ...clipsOf(channelId) }),
  'channelClips.fromStock': (channelId, req) => {
    const v = clipsOf(channelId)
    const added = Math.min(10, req?.count ?? 8) * Math.max(1, req?.queries?.length ?? 1)
    const next = setClips(channelId, { clips: v.clips + added, fromStock: v.fromStock + added })
    return { ...next, added, credits: req?.source === 'cloud' ? 1 : 0 }
  },
  'channelClips.addFiles': (channelId, files) => {
    const v = clipsOf(channelId)
    return { ...setClips(channelId, { clips: v.clips + files.length, own: v.own + files.length }), added: files.length }
  },
  'channelClips.setAvatar': (channelId, file) => setClips(channelId, { avatar: file }),
  'channelClips.setMusic': (channelId, file) => setClips(channelId, { music: file })
}
