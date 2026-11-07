// The edit review on a film already made (qualite-montage): the same review `render.assemble` runs on every render (src/engine/review/),
// read from a run's artefacts folder, without fixing anything. For a film made before the review existed (the « before » list) or to
// re-read a delivered one. `--look` asks Claude (the Claude Code CLI on the user's subscription, fast tier) to look at every picture shot.
//
//   node --import ./scripts/ts-transpile.mjs scripts/edit-review.ts --artefacts <run>/artefacts --film <video.mp4> --out <report.json> [--look]
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { EditPlan, type Shot } from '../src/engine/formats/editplan'
import { WordsValue } from '../src/engine/formats/timing'
import { systemMediaService } from '../src/engine/media/tools'
import { greyThumbOf } from '../src/engine/nodes/visuals-checks'
import type { RunCtx } from '../src/engine/registry'
import { renderReviewed } from '../src/engine/review'
import type { SeenShot } from '../src/engine/review/checks'
import { fmtS } from '../src/engine/review/types'
import type { ClaudeService } from '../src/engine/services'
import { ClaudeCodeProvider } from '../src/main/llm/claude-code'

const { values } = parseArgs({ options: { artefacts: { type: 'string' }, film: { type: 'string' }, out: { type: 'string' }, look: { type: 'boolean', default: false } } })
if (!values.artefacts || !values.film) {
  console.error('usage: edit-review.ts --artefacts <dir> --film <mp4> [--out <json>] [--look]')
  process.exit(2)
}
const dir = values.artefacts
const film = values.film

type Out = { files?: string[]; value?: unknown; meta?: Record<string, unknown> }
const outs = new Map<string, { out: Out; root: string }>()
for (const d of readdirSync(dir)) {
  const f = path.join(dir, d, 'run.json')
  if (!existsSync(f)) continue
  const run = JSON.parse(readFileSync(f, 'utf8')) as { outputs?: Record<string, Out> }
  for (const [k, v] of Object.entries(run.outputs ?? {})) outs.set(k, { out: v, root: path.join(dir, d) })
}
const file = (k: string, i: number): string | undefined => {
  const o = outs.get(k)
  const rel = o?.out.files?.[i]
  return o && rel ? path.join(o.root, rel) : undefined
}
const video = outs.get('video')?.out
const plan = EditPlan.parse((video?.meta?.reviewedPlan as unknown) ?? outs.get('plan')?.out.value)
const words = WordsValue.parse(outs.get('words')?.out.value)
const voice = file('audio', 0) as string
const media = systemMediaService({ platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' })
if (!media) throw new Error('ffmpeg not found')

const records = <T>(k: string): T[] => (Array.isArray(outs.get(k)?.out.value) ? (outs.get(k)?.out.value as T[]) : [])
const clips = new Map(records<{ itemId: string; file: number; durationS: number }>('clips').map((r) => [r.itemId, { file: file('clips', r.file), durationS: r.durationS }]))
const images = new Map(records<{ itemId: string; file: number }>('images').map((r) => [r.itemId, file('images', r.file)]))
const cards = new Map(records<{ shotId: string; file: number; base?: boolean }>('graphics').filter((r) => r.base).map((r) => [r.shotId, file('graphics', r.file)]))

const claude: ClaudeService | undefined = values.look
  ? (() => {
      const cli = new ClaudeCodeProvider()
      return { ask: async (req) => ({ text: (await cli.complete({ model: 'claude-haiku-5-5', prompt: req.prompt, system: req.system, ...(req.images ? { images: req.images } : {}) }, { signal: req.signal })).text }) }
    })()
  : undefined
const ctx = { services: { media, ...(claude ? { claude } : {}) }, signal: new AbortController().signal, emit: () => undefined, notes: [], seed: 0 } as unknown as RunCtx

const hash = (f: string): string => createHash('sha256').update(readFileSync(f)).digest('hex')
const seen: SeenShot[] = []
const byId = new Map(plan.shots.map((s) => [s.id, s]))
for (const id of plan.tracks.base) {
  const s = byId.get(id) as Shot
  const card = cards.get(s.id)
  const clip = s.genItem ? clips.get(s.genItem)?.file : undefined
  const pic = s.genItem ? images.get(s.genItem) : undefined
  const src = card ?? clip ?? pic
  if (!src) continue
  // a picture's grey thumbnail, or an archive film's first frame (as the render does)
  const still = pic ?? (clip && s.kind !== 'motion' ? clip : undefined)
  seen.push({ id: s.id, source: hash(src), ...(still && s.kind !== 'motion' ? { grey: await greyThumbOf(ctx, still) } : {}) })
}

const work = path.join(path.dirname(path.resolve(values.out ?? film)), 'review-frames')
await mkdir(work, { recursive: true })
const { report } = await renderReviewed({
  ctx,
  plan,
  words,
  voice,
  music: Boolean(file('music', 0)),
  rounds: 0,
  look: Boolean(values.look),
  clipS: (s) => (s.kind !== 'motion' && s.genItem ? clips.get(s.genItem)?.durationS : undefined),
  isCard: (s) => s.kind === 'motion' && cards.has(s.id),
  dir: work,
  render: async () => ({ file: film, seen })
})
if (values.out) writeFileSync(values.out, JSON.stringify(report, null, 2))
for (const d of report.left) console.log(`${fmtS(d.atS)}  ${d.severity.padEnd(4)}  ${d.kind.padEnd(14)}  ${d.detail}`)
console.log(`${report.left.length} defect(s); looked: ${report.looked}; ${report.notes.join(' ')}`)
