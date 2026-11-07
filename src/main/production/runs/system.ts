// What this computer offers the engine: system voices (the demo voice of `voice.tts`) and ffmpeg (Réglages › Moteur).
import { existsSync } from 'node:fs'
import { systemSpeechService } from '../../../engine/media/speech'
import { createMediaService, locateTool } from '../../../engine/media/tools'
import { t } from '../../../shared/fr'
import type { RunVoice, RunVoices } from '../../../shared/runs'

export interface SystemProbe {
  platform: NodeJS.Platform
  pathEnv: string
}

/** Shown when the OS list cannot be read: the voices usually installed with French and English. */
export function fallbackVoices(platform: NodeJS.Platform): RunVoice[] {
  const list: [string, string][] =
    platform === 'darwin'
      ? [
          ['Thomas', 'fr'],
          ['Amélie', 'fr'],
          ['Samantha', 'en']
        ]
      : platform === 'win32'
        ? [
            ['Microsoft Hortense Desktop', 'fr'],
            ['Microsoft Zira Desktop', 'en'],
            ['Microsoft David Desktop', 'en']
          ]
        : []
  return list.map(([name, language]) => ({ id: name, name, language, system: true }))
}

export async function listVoices(p: SystemProbe, timeoutMs = 15_000): Promise<RunVoices> {
  const speech = systemSpeechService({ platform: p.platform })
  if (speech) {
    try {
      const voices = await speech.voices(AbortSignal.timeout(timeoutMs))
      if (voices.length > 0) {
        return { voices: voices.map((v) => ({ ...v, system: true })), listed: true, note: t('runs.voices.system') }
      }
    } catch {
      // fall through to the static list
    }
  }
  return { voices: fallbackVoices(p.platform), listed: false, note: t('runs.voices.fallback') }
}

export interface FfmpegInfo {
  ffmpeg: { found: boolean; path: string | null; version: string | null }
  ffprobe: { found: boolean; path: string | null }
}

export async function probeFfmpeg(p: SystemProbe, timeoutMs = 10_000): Promise<FfmpegInfo> {
  const ffmpeg = locateTool('ffmpeg', { platform: p.platform, pathEnv: p.pathEnv })
  const ffprobe = locateTool('ffprobe', { platform: p.platform, pathEnv: p.pathEnv })
  let version: string | null = null
  if (ffmpeg && ffprobe) {
    try {
      const media = createMediaService({ ffmpeg, ffprobe })
      const res = await media.run('ffmpeg', ['-version'], { signal: AbortSignal.timeout(timeoutMs) })
      const first = res.stdout.toString('utf8').split(/\r?\n/)[0] ?? ''
      version = /version\s+(\S+)/.exec(first)?.[1] ?? (first.trim() || null)
    } catch {
      version = null
    }
  }
  return { ffmpeg: { found: ffmpeg !== null, path: ffmpeg, version }, ffprobe: { found: ffprobe !== null, path: ffprobe } }
}

export const folderExists = (dir: string): boolean => existsSync(dir)
