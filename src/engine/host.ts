// Host services for a plain Node process (the demo script, tests, the future local worker of lot P5): ffmpeg found on
// the PATH the caller gives (on macOS the login shell's, plus Homebrew), the operating system's voice, the local speech
// recogniser (faster-whisper when this computer has it, record 0059), working folders
// under one data folder, and Atelier's resources. The Electron app builds the same services from src/main.
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { systemSpeechService } from './media/speech'
import { chromiumService } from './media/browser'
import { systemMediaService } from './media/tools'
import { localWhisperService } from './media/whisper'
import type { EngineServices } from './services'

export interface NodeHostOptions {
  /** Holds `cache/` (inner caches that survive runs) and `scratch/` (thrown away by `cleanup`). */
  dataDir: string
  resourcesDir: string
  platform?: NodeJS.Platform
  pathEnv?: string
  /** Extra or replacement services (claude, cloud, asr…). */
  extra?: Partial<EngineServices>
}

export interface NodeHost {
  services: EngineServices
  /** Removes the scratch folders of the runs made with this host. */
  cleanup(): Promise<void>
}

export function nodeHost(o: NodeHostOptions): NodeHost {
  const platform = o.platform ?? process.platform
  const pathEnv = o.pathEnv ?? process.env.PATH ?? process.env.Path ?? ''
  const media = systemMediaService({ platform, pathEnv })
  const speech = systemSpeechService({ platform })
  // the browser of the motion templates starts only when a graphic is drawn (nothing is loaded or launched before)
  const browser = chromiumService()
  const scratchRoot = path.join(o.dataDir, 'scratch', `${process.pid}-${Date.now().toString(36)}`)
  let n = 0
  const services: EngineServices = {
    ...(media ? { media } : {}),
    ...(speech ? { speech } : {}),
    // found on its first use; a computer without faster-whisper answers « missing_tool » and words.align keeps the voice's times
    asr: localWhisperService({ platform, cacheDir: path.join(o.dataDir, 'cache', 'asr') }),
    browser,
    workspace: {
      scratch: async (label) => {
        const d = path.join(scratchRoot, `${String(++n).padStart(3, '0')}-${label.replace(/[^a-z0-9-]/gi, '_')}`)
        await mkdir(d, { recursive: true })
        return d
      },
      cache: async (kind) => {
        const d = path.join(o.dataDir, 'cache', kind.replace(/[^a-z0-9-]/gi, '_'))
        await mkdir(d, { recursive: true })
        return d
      }
    },
    library: { root: o.resourcesDir },
    host: { platform, ffmpeg: media !== null, systemVoice: speech !== null },
    ...o.extra
  }
  return {
    services,
    cleanup: async () => {
      await services.browser?.close?.().catch(() => undefined)
      await rm(scratchRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }
}
