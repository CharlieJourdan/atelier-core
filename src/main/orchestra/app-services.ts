// The agents' technologies on the app's real services (core.ts): channels through the very IPC handlers the screens call
// (`channels.create` writes the channel, then its memory and team), the eyes, our engine's runs, the computer's ffmpeg,
// and Atelier Cloud's video analysis — used only when the Cloud says it is real (its Gemini key set, paid calls on).
import path from 'node:path'
import { createMediaService, locateTool } from '../../engine/media/tools'
import type { MediaService } from '../../engine/services'
import type { ApiHandlers } from '../../shared/api'
import type { ChannelVideo } from '../../shared/cloud-api'
import type { ChannelInput, ChannelRow } from '../../shared/workflow'
import type { AppCloud } from '../cloud'
import type { Db } from '../db'
import type { EyesService } from '../eyes/service'
import { ProjectStore, RecipeStore } from '../production/recipes'
import { libraryPipeline } from '../production/runs/pipeline'
import type { ProductionRuns } from '../production/runs/service'
import type { RunMedia, YoutubeFacts } from './eyes-look'
import { plannedMinutes } from './plan'
import type { OrchestraServices } from './services'

export interface AppServicesInput {
  db: Db
  /** The IPC handlers (late: they are built after the runtime). */
  api: () => ApiHandlers | null
  eyes: EyesService
  runs: ProductionRuns
  cloud: AppCloud
  platform?: NodeJS.Platform
  pathEnv?: string
}

export function appServices(o: AppServicesInput): OrchestraServices {
  let media: MediaService | null | undefined
  const projects = new ProjectStore(o.db, new RecipeStore(o.db), o.runs)
  return {
    channels: {
      create: (input: ChannelInput): ChannelRow => {
        const api = o.api()
        if (!api) throw new Error('The app is starting: try again in a moment')
        const row = api['channels.create'](input)
        if (row instanceof Promise) throw new Error('channels.create must answer at once')
        return row
      },
      list: () => {
        const api = o.api()
        const rows = api ? api['channels.list']() : []
        return rows instanceof Promise ? [] : rows
      }
    },
    eyes: {
      profileFor: (id) => o.eyes.profileFor(id),
      profileVersion: (id) => o.eyes.profileVersion(id),
      outliers: (id) => o.eyes.outliers(id),
      inspirationFor: (id, limit) => o.eyes.inspirationFor(id, { includeDemo: true, limit, lang: 'en' }),
      read: (id, signal) => o.eyes.read(id, signal),
      youtubeFacts: (videoId) => youtubeFacts(o.db, videoId)
    },
    production: {
      quote: (input) => o.runs.quote(input),
      start: (input) => o.runs.start(input),
      get: (id) => o.runs.get(id),
      list: (filter) => o.runs.list(filter),
      approve: (id, node) => o.runs.approve(id, node),
      cancel: (id) => o.runs.cancel(id),
      media: (id) => runMedia(o.runs, id),
      output: (id, node) => o.runs.output(id, node),
      pipelineInputs: (pipelineId) => {
        if (pipelineId === undefined) return []
        return libraryPipeline(o.db, pipelineId, 8).inputs.map((i) => i.id).filter((i) => i !== 'topic')
      }
    },
    projects: {
      list: (filter) => projects.list(filter)
    },
    teamProjects: {
      ensureForVideo: (videoId, recipeId) => projects.ensureForVideo(videoId, recipeId, plannedMinutes(o.db, videoId)),
      get: (id) => projects.get(id),
      setTopic: (videoId, title, idea) => projects.setVideoTopic(videoId, title, idea),
      remake: (videoId) => projects.remakeForVideo(videoId),
      setScript: (id, script) => projects.setScript(id, script),
      scriptOf: (id) => projects.scriptOf(id),
      takesScript: (id) => projects.takesScript(id),
      quote: (id, real) => projects.quote(id, real ? { real: true } : {}),
      run: (id, real) => projects.run(id, real ? { real: true } : {})
    },
    media: () => {
      if (media !== undefined) return media
      const env = { platform: o.platform ?? process.platform, pathEnv: o.pathEnv ?? process.env.PATH ?? process.env.Path ?? '' }
      const ffmpeg = locateTool('ffmpeg', env)
      const ffprobe = locateTool('ffprobe', env)
      media = ffmpeg && ffprobe ? createMediaService({ ffmpeg, ffprobe }) : null
      return media
    },
    youtube: {
      ready: async (signal) => {
        if (!o.cloud.intel.connected()) return false
        try {
          const catalog = await Promise.race([o.cloud.api.catalog(), new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))])
          // the eyes' analysis is real only when its provider is (the Cloud's Gemini key) and paid calls are on
          return catalog.paidCalls === true && catalog.providers.some((x) => x.usage === 'analyseVideo' && x.status === 'real')
        } catch {
          return false
        }
      },
      analyse: (url, minutes, signal) => o.cloud.intel.analyseVideo(url, minutes, signal, `Œil d’un agent : ${url.slice(0, 60)}`),
      whole: (url, durationS, signal) => o.cloud.intel.watchWhole(url, { durationS }, signal)
    }
  }
}

/** The run's final video (absolute path) and the voice's word timings. */
async function runMedia(runs: ProductionRuns, runId: number): Promise<RunMedia> {
  const run = runs.get(runId)
  const video = run.videoFileRef ? path.resolve(runs.artefactsDir(run.videoId), run.videoFileRef) : null
  const voice = run.nodes.find((n) => /^voice\./.test(n.type) && (n.state === 'done' || n.state === 'cached'))
  let words: RunMedia['words'] = []
  if (voice) {
    const out = await runs.output(run.id, voice.nodeId).catch(() => null)
    if (out?.kind === 'audio') words = out.words
  }
  return { video, words, title: run.videoTitle || run.topic }
}

/** What Atelier already read about a YouTube video (the eyes' channel reads), or null. */
function youtubeFacts(db: Db, videoId: string): YoutubeFacts | null {
  const rows = db.prepare('SELECT videos_json FROM channel_reads').all() as { videos_json: string }[]
  for (const r of rows) {
    let videos: ChannelVideo[]
    try {
      videos = JSON.parse(r.videos_json) as ChannelVideo[]
    } catch {
      continue
    }
    const v = videos.find((x) => x.id === videoId)
    if (v) return { title: v.title, views: v.views, durationS: v.durationS, publishedAt: v.publishedAt }
  }
  return null
}
