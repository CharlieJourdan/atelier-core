// The cache of whole-video logs: one JSON file per video and method in a folder of the app's data. Reading a video twice costs
// nothing the second time; a file that no longer matches the schema is ignored (read again), never trusted.
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { WholeVideoLog } from '../../shared/shot-log.ts'

/** The key of a video: its YouTube id when the link has one, else the link itself (or a file's path and size). */
export function videoKey(urlOrFile: string): string {
  const id = /(?:[?&]v=|youtu\.be\/|\/shorts\/)([\w-]{11})/.exec(urlOrFile)?.[1]
  return id ?? createHash('sha256').update(urlOrFile).digest('hex').slice(0, 20)
}

export class WatchCache {
  private readonly dir: string
  constructor(dir: string) {
    this.dir = dir
  }

  private file(key: string): string {
    return path.join(this.dir, `${key.replace(/[^\w-]/g, '_')}.json`)
  }

  async get(key: string): Promise<WholeVideoLog | null> {
    try {
      const parsed = WholeVideoLog.safeParse(JSON.parse(await readFile(this.file(key), 'utf8')))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  async put(key: string, log: WholeVideoLog): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const tmp = `${this.file(key)}.tmp`
    await writeFile(tmp, JSON.stringify(log), 'utf8')
    await rename(tmp, this.file(key))
  }
}
