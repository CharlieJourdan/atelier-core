// The presenter's identity check: is this angle, or this frame of a talking video, the same person as
// the portrait? OpenCV's face detector YuNet finds the face, its recogniser SFace turns the aligned face into 128 numbers, and the
// cosine of two of them says how alike two faces are (real face recognition, where `face.ts` only compares skin patches). Both
// models are OpenCV Zoo's (Apache 2.0), fetched once from their public repository into the cache and checked against their
// SHA-256. Like the word timing (media/whisper.ts), a fixed Python program is spawned without a shell, the pictures go through a
// JSON file, the answer comes back in another; a computer without Python and OpenCV has no such check (`missing_tool`) and the
// caller keeps the skin check.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AbortError, EngineError } from '../errors'

/**
 * Cosine thresholds of SFace, measured on the bench (research note benchmark-2026-11 (old repository)): the portrait against its own angles
 * edited by GPT Image 2.5 and Seedream 5.0 Lite scored 0.78–0.90, against frames of a real HeyGen video of it 0.79–0.86, against
 * other people 0.01–0.24. KEEP sits midway; REJECT is OpenCV's documented same-identity bar (0.363). Between the two the angle is
 * made again.
 */
export const IDENTITY_KEEP = 0.5
export const IDENTITY_REJECT = 0.363

export const FACE_MODELS = {
  yunet: {
    file: 'face_detection_yunet_2023mar.onnx',
    url: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx',
    sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4'
  },
  sface: {
    file: 'face_recognition_sface_2021dec.onnx',
    url: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx',
    sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79'
  }
} as const

/**
 * Fixed Python program: for each pair of ATELIER_FACE_IN ({"pairs":[[a,b],…]}), the cosine of the largest faces (null when either
 * picture shows no face) and how many faces each shows, into ATELIER_FACE_OUT.
 */
export const FACE_SCRIPT = [
  'import json, os, cv2, numpy as np',
  "src = json.load(open(os.environ['ATELIER_FACE_IN'], encoding='utf-8'))",
  "det = cv2.FaceDetectorYN.create(os.environ['ATELIER_FACE_YUNET'], '', (320, 320), 0.8, 0.3, 5000)",
  "rec = cv2.FaceRecognizerSF.create(os.environ['ATELIER_FACE_SFACE'], '')",
  'cache = {}',
  'def feature(f):',
  '    if f in cache: return cache[f]',
  '    img = cv2.imdecode(np.fromfile(f, dtype=np.uint8), cv2.IMREAD_COLOR)',
  '    out = (None, 0)',
  '    if img is not None:',
  '        s = 1280.0 / max(img.shape[:2])',
  '        if s < 1: img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)',
  '        det.setInputSize((img.shape[1], img.shape[0]))',
  '        _, faces = det.detect(img)',
  '        if faces is not None and len(faces) > 0:',
  '            face = max(faces, key=lambda r: r[2] * r[3])',
  '            out = (rec.feature(rec.alignCrop(img, face)), len(faces))',
  '    cache[f] = out',
  '    return out',
  'res = []',
  "for a, b in src['pairs']:",
  '    fa, na = feature(a)',
  '    fb, nb = feature(b)',
  '    score = None if fa is None or fb is None else round(float(rec.match(fa, fb, cv2.FaceRecognizerSF_FR_COSINE)), 4)',
  "    res.append({'score': score, 'facesA': na, 'facesB': nb})",
  "json.dump({'results': res}, open(os.environ['ATELIER_FACE_OUT'], 'w', encoding='utf-8'))"
].join('\n')

export interface FacePairScore {
  /** Cosine of the two faces (−1..1; same person ≳ 0.5); null when either picture shows no face. */
  score: number | null
  facesA: number
  facesB: number
}

export interface FaceIdentity {
  /** Each pair's score, in order. */
  compare(pairs: readonly (readonly [string, string])[], signal: AbortSignal): Promise<FacePairScore[]>
}

type Exec = (file: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, signal: AbortSignal) => Promise<void>
export interface FaceIdentityOptions {
  platform: NodeJS.Platform
  /** Holds the models and the Python program. */
  cacheDir: string
  python?: { file: string; args: string[] }
  exec?: Exec
  /** Fetches a model (default: `fetch`); tests inject one. */
  download?: (url: string, signal: AbortSignal) => Promise<Uint8Array>
}

const defaultExec: Exec = (file, args, env, cwd, signal) =>
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

const defaultDownload = async (url: string, signal: AbortSignal): Promise<Uint8Array> => {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

function candidates(o: FaceIdentityOptions): { file: string; args: string[] }[] {
  if (o.python) return [o.python]
  const env = process.env.ATELIER_WHISPER_PYTHON
  if (env) return [{ file: env, args: [] }]
  if (o.platform === 'win32') return [{ file: 'py', args: ['-3.13'] }, { file: 'py', args: ['-3.12'] }, { file: 'python', args: [] }]
  return [{ file: '/opt/homebrew/bin/python3', args: [] }, { file: 'python3', args: [] }]
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

/** The identity check on this computer; `compare` throws `missing_tool` when no Python has OpenCV or a model cannot be had. */
export function localFaceIdentity(o: FaceIdentityOptions): FaceIdentity {
  const exec = o.exec ?? defaultExec
  const download = o.download ?? defaultDownload
  let ready: Promise<{ py: { file: string; args: string[] }; models: Record<keyof typeof FACE_MODELS, string> } | null> | null = null
  const program = path.join(o.cacheDir, 'face-id.py')
  const prepare = (signal: AbortSignal): Promise<{ py: { file: string; args: string[] }; models: Record<keyof typeof FACE_MODELS, string> } | null> => {
    ready ??= (async () => {
      await mkdir(o.cacheDir, { recursive: true })
      await writeFile(program, FACE_SCRIPT, 'utf8')
      let py: { file: string; args: string[] } | null = null
      for (const c of candidates(o)) {
        const ok = await exec(c.file, [...c.args, '-c', 'import cv2; cv2.FaceRecognizerSF'], { ...process.env }, o.cacheDir, signal).then(
          () => true,
          () => false
        )
        if (ok) {
          py = c
          break
        }
      }
      if (!py) return null
      const models = {} as Record<keyof typeof FACE_MODELS, string>
      for (const [k, m] of Object.entries(FACE_MODELS) as [keyof typeof FACE_MODELS, (typeof FACE_MODELS)[keyof typeof FACE_MODELS]][]) {
        const file = path.join(o.cacheDir, m.file)
        const have = await readFile(file).catch(() => null)
        if (!have || sha256(have) !== m.sha256) {
          const got = await download(m.url, signal)
          if (sha256(got) !== m.sha256) throw new EngineError('missing_tool', `the face model ${m.file} did not match its fingerprint`)
          await writeFile(file, got)
        }
        models[k] = file
      }
      return { py, models }
    })()
    // a failed preparation is tried again next time (no network for a moment)
    ready.catch(() => (ready = null))
    return ready
  }
  return {
    async compare(pairs, signal) {
      if (pairs.length === 0) return []
      const p = await prepare(signal)
      if (!p) throw new EngineError('missing_tool', 'OpenCV (opencv-python) is not installed on this computer')
      const key = createHash('sha256').update(JSON.stringify(pairs)).update(String(Date.now())).digest('hex').slice(0, 16)
      const input = path.join(o.cacheDir, `${key}.in.json`)
      const output = path.join(o.cacheDir, `${key}.out.json`)
      await writeFile(input, JSON.stringify({ pairs }), 'utf8')
      const env = { ...process.env, ATELIER_FACE_IN: input, ATELIER_FACE_OUT: output, ATELIER_FACE_YUNET: p.models.yunet, ATELIER_FACE_SFACE: p.models.sface, PYTHONIOENCODING: 'utf-8' }
      await exec(p.py.file, [...p.py.args, program], env, o.cacheDir, signal)
      const r = JSON.parse(await readFile(output, 'utf8')) as { results: FacePairScore[] }
      return r.results
    }
  }
}

/** What an angle's score means: kept, made again (doubtful), or another person / no face. */
export function identityVerdict(score: number | null): 'keep' | 'retry' | 'reject' {
  if (score === null || score < IDENTITY_REJECT) return 'reject'
  return score >= IDENTITY_KEEP ? 'keep' : 'retry'
}
