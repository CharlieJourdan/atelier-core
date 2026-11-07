// The local speech recogniser (record 0059, « Minutage des mots »): faster-whisper on this computer, free. It hears the
// narration we ship and returns every word with its time; `words.align` matches them to the script. The program is spawned
// directly (no shell) with a fixed Python program; the audio path and the settings go through environment variables, the
// answer through a JSON file. The graphics card first (CUDA), else the processor (int8, slower); a computer without Python
// or faster-whisper has no recogniser and the brick keeps the voice's own times. Answers are cached by the audio's bytes.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AbortError, EngineError } from '../errors'
import type { AsrService, TimedWord } from '../services'

/** The model: large-v3 (the references' transcripts, research notes of the old repository). */
export const WHISPER_MODEL = 'large-v3'

/**
 * The model on a computer without a graphics card (vps-rendu, measured in the 4 vCPU / 8 GB box of decision 0084): large-v3 on
 * the processor takes more than 16× the audio and fills 8 GB; `small` runs at about real time in ≈ 1 GB. Overridden by
 * `ATELIER_WHISPER_CPU_MODEL`; a host that wants large-v3 everywhere sets it to `large-v3`.
 */
export const WHISPER_CPU_MODEL = 'small'

/** Fixed Python program: transcribes ATELIER_ASR_AUDIO with word times into ATELIER_ASR_OUT, on CUDA then on the CPU. */
export const WHISPER_SCRIPT = [
  'import json, os, sys, glob, site',
  // the CUDA libraries pip installs (nvidia-cublas-cu12, nvidia-cudnn-cu12) are not on the DLL path by themselves (Windows)
  "for d in [d for p in site.getsitepackages() + [site.getusersitepackages()] for d in glob.glob(os.path.join(p, 'nvidia', '*', 'bin'))]:",
  "    os.environ['PATH'] = d + os.pathsep + os.environ.get('PATH', '')",
  "    hasattr(os, 'add_dll_directory') and os.add_dll_directory(d)",
  'from faster_whisper import WhisperModel',
  "audio, out, lang, model = os.environ['ATELIER_ASR_AUDIO'], os.environ['ATELIER_ASR_OUT'], os.environ['ATELIER_ASR_LANG'], os.environ['ATELIER_ASR_MODEL']",
  "cpu_model = os.environ.get('ATELIER_ASR_CPU_MODEL') or model",
  'def run(device, compute, name):',
  '    m = WhisperModel(name, device=device, compute_type=compute)',
  '    segs, info = m.transcribe(audio, language=lang, word_timestamps=True, vad_filter=True, beam_size=5)',
  "    return [{'w': w.word.strip(), 's': round(w.start, 3), 'e': round(w.end, 3)} for s in segs for w in s.words]",
  "device = os.environ.get('ATELIER_ASR_DEVICE', 'auto')",
  'words = None',
  // no graphics card: never load (nor download) the GPU model only to fail on it
  'import ctranslate2',
  "if device == 'auto' and ctranslate2.get_cuda_device_count() == 0:",
  "    device = 'cpu'",
  "if device in ('auto', 'cuda'):",
  '    try:',
  "        words, used, name = run('cuda', 'float16', model), 'cuda', model",
  '    except Exception as e:',
  "        sys.stderr.write('cuda: %s\\n' % e)",
  'if words is None:',
  "    words, used, name = run('cpu', 'int8', cpu_model), 'cpu', cpu_model",
  "json.dump({'words': words, 'device': used, 'model': name}, open(out, 'w', encoding='utf-8'), ensure_ascii=False)"
].join('\n')

export interface WhisperOptions {
  platform: NodeJS.Platform
  /** Holds the cached answers (`<sha>.json`) and the Python program. */
  cacheDir: string
  /** The Python to run; default: `ATELIER_WHISPER_PYTHON`, else `py -3.13`/`py -3.12`/`python` (Windows), `python3` (macOS). */
  python?: { file: string; args: string[] }
  model?: string
  /** The model when the graphics card is not used (default `ATELIER_WHISPER_CPU_MODEL`, else WHISPER_CPU_MODEL). */
  cpuModel?: string
  /** `auto` (CUDA, else CPU), `cuda` or `cpu`. */
  device?: 'auto' | 'cuda' | 'cpu'
  /** Runs a program without a shell; resolves when it exits 0. */
  exec?: (file: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, signal: AbortSignal) => Promise<void>
}

const defaultExec = (file: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.on('data', (d: Buffer) => void (err = (err + d.toString('utf8')).slice(-4000)))
    const abort = (): void => void child.kill()
    signal.addEventListener('abort', abort, { once: true })
    child.on('error', (e) => reject(e))
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(new AbortError())
      else if (code === 0) resolve()
      else reject(new Error(err.trim().split(/\r?\n/).slice(-3).join(' ') || `exit ${code}`))
    })
  })

/** The Pythons to try, in order. */
function candidates(o: WhisperOptions): { file: string; args: string[] }[] {
  if (o.python) return [o.python]
  const env = process.env.ATELIER_WHISPER_PYTHON
  if (env) return [{ file: env, args: [] }]
  if (o.platform === 'win32') return [{ file: 'py', args: ['-3.13'] }, { file: 'py', args: ['-3.12'] }, { file: 'python', args: [] }]
  return [{ file: '/opt/homebrew/bin/python3', args: [] }, { file: 'python3', args: [] }]
}

/** A recogniser that runs faster-whisper locally; it throws `missing_tool` when no Python on this computer has it. */
export function localWhisperService(o: WhisperOptions): AsrService {
  const exec = o.exec ?? defaultExec
  const model = o.model ?? process.env.ATELIER_WHISPER_MODEL ?? WHISPER_MODEL
  const cpuModel = o.cpuModel ?? process.env.ATELIER_WHISPER_CPU_MODEL ?? WHISPER_CPU_MODEL
  let found: Promise<{ file: string; args: string[] } | null> | null = null
  const program = path.join(o.cacheDir, 'whisper.py')
  const locate = (signal: AbortSignal): Promise<{ file: string; args: string[] } | null> => {
    found ??= (async () => {
      await mkdir(o.cacheDir, { recursive: true })
      await writeFile(program, WHISPER_SCRIPT, 'utf8')
      for (const c of candidates(o)) {
        const ok = await exec(c.file, [...c.args, '-c', 'import faster_whisper'], { ...process.env }, o.cacheDir, signal).then(
          () => true,
          () => false
        )
        if (ok) return c
      }
      return null
    })()
    return found
  }
  return {
    async transcribe(req, signal) {
      const bytes = await readFile(req.audio)
      const key = createHash('sha256').update(bytes).update(`\0${req.language}\0${model}`).digest('hex').slice(0, 32)
      const cached = path.join(o.cacheDir, `${key}.json`)
      if (!existsSync(cached)) {
        const py = await locate(signal)
        if (!py) throw new EngineError('missing_tool', 'faster-whisper is not installed on this computer')
        const env = { ...process.env, ATELIER_ASR_AUDIO: req.audio, ATELIER_ASR_OUT: `${cached}.tmp`, ATELIER_ASR_LANG: req.language.slice(0, 2), ATELIER_ASR_MODEL: model, ATELIER_ASR_CPU_MODEL: cpuModel, ATELIER_ASR_DEVICE: o.device ?? 'auto', PYTHONIOENCODING: 'utf-8' }
        await exec(py.file, [...py.args, program], env, o.cacheDir, signal)
        await writeFile(cached, await readFile(`${cached}.tmp`))
      }
      const r = JSON.parse(await readFile(cached, 'utf8')) as { words: { w: string; s: number; e: number }[]; device: string; model?: string }
      const words: TimedWord[] = r.words.filter((w) => w.w.trim()).map((w) => ({ word: w.w.trim(), start: w.s, end: w.e }))
      return { words, engine: `whisper-${r.model ?? model}-${r.device}` }
    }
  }
}
