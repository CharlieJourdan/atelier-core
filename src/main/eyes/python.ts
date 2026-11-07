// The Python that has faster-whisper on this computer, found once (moteur-assemblage, A's request): the same candidates
// as the speech recogniser (`src/engine/media/whisper.ts`): `ATELIER_WHISPER_PYTHON`, else `py -3.13`, `py -3.12`,
// `python` on Windows, `python3` elsewhere. Returns the interpreter's own path (`sys.executable`), so callers that take a
// single program name (the whole-video watcher) can run it. Null when none has it (the watcher then says so).
import type { RunFn } from '../../engine/sourcing/types'

const PROBE = 'import faster_whisper, sys; print(sys.executable)'

export function pythonCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): { file: string; args: string[] }[] {
  if (env.ATELIER_WHISPER_PYTHON) return [{ file: env.ATELIER_WHISPER_PYTHON, args: [] }]
  if (platform === 'win32') return [{ file: 'py', args: ['-3.13'] }, { file: 'py', args: ['-3.12'] }, { file: 'python', args: [] }]
  return [{ file: '/opt/homebrew/bin/python3', args: [] }, { file: 'python3', args: [] }]
}

export function whisperPythonFinder(run: RunFn, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): () => Promise<string | null> {
  let found: Promise<string | null> | null = null
  return () => {
    found ??= (async () => {
      for (const c of pythonCandidates(platform, env)) {
        try {
          const { stdout } = await run(c.file, [...c.args, '-c', PROBE], { timeoutMs: 60_000 })
          const exe = stdout.trim().split(/\r?\n/).pop()?.trim()
          if (exe) return exe
        } catch {
          // this candidate is absent or lacks faster-whisper: try the next one
        }
      }
      return null
    })()
    return found
  }
}
