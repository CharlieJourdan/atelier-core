// Read side of the runs for the screens: node outputs, artefact files, the library, voices, engine status, and the
// package folder opener.
import { existsSync } from 'node:fs'
import type { EngineStatus, LibraryItem, RunFile, RunOutput, RunVoices } from '../../../shared/runs'
import { t } from '../../../shared/fr'
import { fileRef, readRunFile } from './files'
import { nodeOutput } from './outputs'
import { readNode, readNodes, readRun, type RunRow } from './rows'
import type { ProductionRuns } from './service'
import { folderExists, listVoices, probeFfmpeg } from './system'
import { pipelineOf } from './rows'

export async function runOutput(runs: ProductionRuns, runId: unknown, nodeId: unknown): Promise<RunOutput> {
  const run = readRun(runs.db, runId)
  const node = readNode(runs.db, run.id, nodeId)
  return nodeOutput({ run, node, nodes: readNodes(runs.db, run.id), store: runs.storeFor(run.video_id), root: runs.artefactsDir(run.video_id) })
}

export async function runFile(runs: ProductionRuns, runId: unknown, ref: unknown): Promise<RunFile> {
  const run = readRun(runs.db, runId)
  if (run.example === 1 && !existsSync(runs.artefactsDir(run.video_id))) throw new Error(t('runs.example.noFiles'))
  return readRunFile(runs.artefactsDir(run.video_id), ref)
}

export async function library(runs: ProductionRuns, filter: unknown): Promise<LibraryItem[]> {
  let channelId: number | undefined
  if (filter !== undefined && filter !== null) {
    if (typeof filter !== 'object' || Array.isArray(filter)) throw new Error('Filtre de bibliothèque invalide.')
    const c = (filter as { channelId?: unknown }).channelId
    if (c !== undefined && (typeof c !== 'number' || !Number.isInteger(c) || c <= 0)) throw new Error('Filtre invalide : chaîne.')
    channelId = c as number | undefined
  }
  const rows = runs.db
    .prepare(
      `SELECT r.*, v.title AS video_title, c.name AS channel_name FROM video_runs r
       JOIN videos v ON v.id = r.video_id JOIN channels c ON c.id = v.channel_id
       WHERE r.status = 'succeeded' ${channelId !== undefined ? 'AND r.channel_id = ?' : ''}
       ORDER BY COALESCE(r.finished_at, r.created_at) DESC, r.id DESC LIMIT 500`
    )
    .all(...(channelId !== undefined ? [channelId] : [])) as unknown as RunRow[]
  const items: LibraryItem[] = []
  for (const r of rows) {
    const nodes = readNodes(runs.db, r.id)
    const p = pipelineOf(r)
    const pkg = nodes.find((n) => n.type.startsWith('package.youtube@') && n.fingerprint)
    let packageFiles: LibraryItem['packageFiles'] = []
    if (pkg?.fingerprint) {
      const stored = await runs.storeFor(r.video_id).getRun(pkg.fingerprint).catch(() => null)
      const files = Object.values(stored?.outputs ?? {}).find((a) => a.type === 'package.youtube')?.files ?? []
      packageFiles = await Promise.all(files.map((f) => fileRef(runs.artefactsDir(r.video_id), f)))
    }
    items.push({
      runId: r.id,
      videoId: r.video_id,
      title: r.video_title ?? '',
      channelId: r.channel_id,
      channelName: r.channel_name ?? '',
      durationS: r.duration_s,
      // the length of the finished film when known (an imported 66 s script is 1,1 min, not the pipeline's 12)
      minutes: r.duration_s !== null && r.duration_s > 0 ? Math.round((r.duration_s / 60) * 10) / 10 : r.minutes,
      pipelineId: p.id,
      pipelineLabel: r.pipeline_label,
      pipelineVersion: p.version,
      budgetMode: r.budget_mode,
      totalCredits: r.spent_credits,
      creditsByNode: nodes.map((n) => ({ nodeId: n.node_id, label: n.label, credits: n.credits })),
      videoFileRef: r.video_file,
      packageDir: r.package_dir,
      packageFiles,
      finishedAt: r.finished_at,
      demo: r.demo === 1,
      example: r.example === 1
    })
  }
  return items
}

let voicesCache: Promise<RunVoices> | null = null

export function voices(platform: NodeJS.Platform): Promise<RunVoices> {
  voicesCache ??= listVoices({ platform, pathEnv: '' }).then((v) => {
    if (!v.listed) voicesCache = null // try again next time
    return v
  })
  return voicesCache
}

export async function engineStatus(runs: ProductionRuns, platform: NodeJS.Platform, pathEnv: string): Promise<EngineStatus> {
  const ff = await probeFfmpeg({ platform, pathEnv })
  return {
    ...ff,
    systemVoice: platform === 'darwin' || platform === 'win32',
    platform,
    dataDir: runs.dataDir,
    productionDir: runs.productionDir,
    resourcesDir: runs.resourcesDir,
    resourcesFound: folderExists(runs.resourcesDir),
    activeRuns: runs.activeIds().length,
    activeRunIds: runs.activeIds(),
    cloudConnected: !runs.isDemo(),
    note: t('runs.engine.note')
  }
}

export async function revealPackage(runs: ProductionRuns, runId: unknown, opener: ((dir: string) => Promise<string>) | undefined): Promise<{ opened: boolean; path: string }> {
  const run = readRun(runs.db, runId)
  if (!run.package_dir) throw new Error('Cette fabrication n’a pas encore de paquet.')
  if (!folderExists(run.package_dir)) throw new Error('Le dossier du paquet n’existe plus sur le disque.')
  if (!opener) throw new Error('Impossible d’ouvrir un dossier depuis ici.')
  const err = await opener(run.package_dir)
  if (err) throw new Error(`Le dossier n’a pas pu être ouvert : ${err}`)
  return { opened: true, path: run.package_dir }
}
