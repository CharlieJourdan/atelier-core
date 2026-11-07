// `npm run engine:style-demo` — production-15's samples on fakes, end to end on this machine (free, offline): for two sets
// of reference measures, an avatar channel and a voice-over channel without a presenter, the agent's closest pipeline
// (`avatar@1`, then `voiceover@1` « sans présentateur ») is cut down to its sample, compiled, quoted by the estimator, run by
// the engine (template voice, drawn pictures and presenter; cuts, captions, render are the real code) with an imported
// two-sentence narration, then measured from its edit plan and scored against the references. Exits 1 if a check fails:
//   1. the voice-over references get `voiceover@1`, the avatar ones `avatar@1`;
//   2. each sample runs to the end, its film is 12 to 30 s, and costs a few credits on the estimator;
//   3. the sample's measures: no presenter for the voice-over, a presenter for the avatar; a likeness score out of 100;
//   4. one frame of each sample saved (docs/screens/engine/style-sample-*.png).
// Options: --data <dir> (default <tmp>/atelier-style-demo) --frames <dir>.
import { mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { EditPlan } from '../src/engine/formats/editplan'
import { nodeHost } from '../src/engine/host'
import { probe } from '../src/engine/media/probe'
import { FULL_FFMPEG_HINT, systemMediaService } from '../src/engine/media/tools'
import { productionRegistry } from '../src/engine/nodes'
import { DEFAULT_SIMPLE_STYLE } from '../src/engine/pipelines/simple-video'
import { withSpeakers } from '../src/engine/pipelines/speakers'
import { startRun } from '../src/engine/scheduler'
import { MemoryNodeStateStore } from '../src/engine/state'
import { FsArtefactStore } from '../src/engine/store'
import { basePipeline, compileRecipe, optionProblem, technologyRegistry, type RecipeDoc } from '../src/engine/technologies'
import type { PriceBook } from '../src/engine/technologies/cost'
import type { VideoMeasure } from '../src/engine/technologies/fit'
import { likeness } from '../src/engine/technologies/likeness'
import { proposeForStyle } from '../src/engine/technologies/style-propose'
import { measurePlan, sampleDoc, sampleFacts, sampleQuote } from '../src/engine/technologies/style-sample'
import { validatePipeline } from '../src/engine/validate'
import { BASE_STYLES } from '../src/main/production/styles/seeds'

const ROOT = path.resolve(import.meta.dirname, '..')
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}
const dataDir = path.resolve(arg('data', path.join(os.tmpdir(), 'atelier-style-demo')))
const framesDir = path.resolve(arg('frames', path.join(ROOT, 'docs', 'screens', 'engine')))
const out = (s: string): void => void process.stdout.write(s + '\n')
let failed = 0
const check = (name: string, ok: boolean, detail: string): void => {
  if (!ok) failed++
  out(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
}

const found = systemMediaService({ platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' })
if (!found) {
  out(`ffmpeg est introuvable : installe-le (${FULL_FFMPEG_HINT}) puis relance « npm run engine:style-demo ».`)
  process.exit(1)
}
const media = found

// the Cloud's default grid, in credits (fakes: what the estimator would read from the engines)
const book: PriceBook = {
  currency: 'credits',
  engines: {
    'presenter:infinitetalk-fast': { unit: 'second', perUnit: 1.8 },
    'presenter:hedra-c3': { unit: 'second', perUnit: 3 },
    'image:gpt-image-25-low': { unit: 'image', perUnit: 0.7 },
    'image:gpt-image-25-medium': { unit: 'image', perUnit: 1.6 },
    'clip:veo31-lite-relaxed': { unit: 'clip', perUnit: 9, maxSecondsPerCall: 8 },
    'clip:veo31-lite-vertex': { unit: 'second', perUnit: 3.6 },
    'voice:elevenlabs-v2': { unit: 'kchars', perUnit: 9.7 },
    'voice:minimax-28-hd': { unit: 'kchars', perUnit: 12 },
    'music:library': { unit: 'minute', perUnit: 0 }
  },
  llm: null
}
const cost = { book, backend: 'subscription' as const }
const SCRIPT =
  'Presque tout le monde range sa cuisine à l’envers, et c’est pour ça que les placards débordent toujours. Voici la méthode des trois boîtes, que les grands-mères utilisaient déjà : elle libère un placard entier en dix minutes, sans rien acheter.'

const CASES: { name: string; base: string; refs: VideoMeasure[] }[] = [
  {
    name: 'voiceover',
    base: 'voiceover@1',
    refs: [
      { minutes: 10, presenterShare: 0, kinds: { stock: 0.4, imageAi: 0.6 }, shotS: 6, wordsPerMinute: 150, captions: true, lookFamily: 'photoreal', look: 'phone-real', curve: 'flat' },
      { minutes: 11, presenterShare: 0.01, kinds: { stock: 0.35, imageAi: 0.65 }, shotS: 6.5, wordsPerMinute: 156, captions: true, lookFamily: 'photoreal', look: 'phone-real', curve: 'flat' }
    ]
  },
  {
    name: 'avatar',
    base: 'avatar@1',
    refs: [
      { minutes: 13, presenterShare: 0.3, layouts: ['full'], kinds: { clipAi: 0.15, imageAi: 0.85 }, shotS: 4.5, wordsPerMinute: 180, captions: false, lookFamily: 'photoreal', look: 'phone-real', curve: 'flat' },
      { minutes: 14, presenterShare: 0.26, layouts: ['full'], kinds: { clipAi: 0.1, imageAi: 0.9 }, shotS: 5, wordsPerMinute: 172, captions: false, lookFamily: 'photoreal', look: 'phone-real', curve: 'flat' }
    ]
  }
]

async function runSample(name: string, doc: RecipeDoc): Promise<{ status: string; video: string | null; plan: EditPlan | null; errors: string[] }> {
  const reg = technologyRegistry()
  const compiled = compileRecipe(doc, reg, { id: `style-${name}`, styles: Object.fromEntries(BASE_STYLES.map((s) => [s.id, s])) })
  if (!compiled.ok) throw new Error(`${name}: the sample does not compile: ${compiled.errors.map((e) => `${e.code} ${e.path.join('.')}`).join(', ')}`)
  const style: Record<string, unknown> = { ...DEFAULT_SIMPLE_STYLE, pace: 'fit' }
  const v = validatePipeline(withSpeakers(compiled.pipeline, style), productionRegistry(), { styleFields: Object.keys(style) })
  if (!v.ok) throw new Error(`${name}: the sample pipeline is invalid: ${v.errors.map((e) => `${e.code} ${e.path}`).join(', ')}`)
  const dir = path.join(dataDir, name)
  const host = nodeHost({ dataDir: dir, resourcesDir: path.join(ROOT, 'resources') })
  const store = new FsArtefactStore(path.join(dir, 'artefacts'))
  const fps = new Map<string, string>()
  const errors: string[] = []
  const run = startRun({
    plan: v.plan,
    store,
    state: new MemoryNodeStateStore(),
    scope: `style-${name}`,
    inputs: { topic: { value: SCRIPT }, script: { value: SCRIPT } },
    style,
    budgetMode: compiled.pipeline.budget.default,
    gateMode: 'all',
    minutes: compiled.pipeline.format.minutes.default,
    useFakes: true,
    services: host.services,
    onEvent: (e) => {
      if (e.kind === 'gate') queueMicrotask(() => run.approve(e.nodeId))
      if (e.kind === 'done' || e.kind === 'cached') fps.set(e.nodeId, e.fingerprint)
      if (e.kind === 'error') errors.push(`${e.nodeId}: ${e.code} ${e.message}`)
    }
  })
  const result = await run.done
  const output = async (nodeId: string, o: string) => {
    const fp = fps.get(nodeId)
    return fp ? (await store.getRun(fp))?.outputs[o] : undefined
  }
  const video = (await output('render', 'video'))?.files?.[0] ?? null
  const plan = ((await output('director', 'plan'))?.value as EditPlan | undefined) ?? null
  await host.cleanup()
  return { status: result.status, video, plan, errors }
}

rmSync(dataDir, { recursive: true, force: true })
mkdirSync(framesDir, { recursive: true })
const reg = technologyRegistry()
for (const c of CASES) {
  const p = proposeForStyle({ refs: c.refs, cost, name: `Style ${c.name}` }, reg)
  check(`${c.name}: base`, p.base === c.base, `${p.base} (${p.reason})`)
  const variant = p.variants.find((v) => v.kind === 'faithful')
  if (!variant) continue
  const decls = basePipeline(variant.doc.base)?.options ?? []
  const s = sampleDoc(variant.doc, reg, { checkOption: (o, val) => optionProblem(decls, o, val) })
  if (!s.ok) {
    check(`${c.name}: sample`, false, s.errors.join('; '))
    continue
  }
  const q = sampleQuote(s.doc, reg, cost)
  check(`${c.name}: quote`, q !== null && q.avg > 0 && q.avg < 100, `${q?.min}–${q?.max} credits (avg ${q?.avg})`)
  const t0 = Date.now()
  const r = await runSample(c.name, s.doc)
  const len = r.video ? (await probe(media, r.video, new AbortController().signal)).durationS : 0
  check(`${c.name}: run`, r.status === 'done' && r.video !== null && len >= 12 && len <= 30, `${r.status} in ${Math.round((Date.now() - t0) / 1000)} s, film ${len.toFixed(1)} s${r.errors.length ? ` — ${r.errors.join('; ')}` : ''}`)
  if (!r.plan) {
    check(`${c.name}: plan`, false, 'no edit plan')
    continue
  }
  const m = measurePlan(r.plan, sampleFacts(variant.doc, reg, SCRIPT.split(/\s+/).length))
  const l = likeness(c.refs, m)
  const presenterOk = c.name === 'voiceover' ? m.presenterShare === 0 : (m.presenterShare ?? 0) > 0
  check(`${c.name}: measures`, presenterOk && l.score !== null, `presenter ${Math.round((m.presenterShare ?? 0) * 100)} %, shots ${m.shotS?.toFixed(1)} s, ${Math.round(m.wordsPerMinute ?? 0)} words/min, kinds ${JSON.stringify(m.kinds)}; likeness ${l.score}/100 (${l.dimensions.map((d) => `${d.id} ${d.score === null ? '—' : d.score.toFixed(2)}`).join(', ')})`)
  if (r.video) {
    const frame = path.join(framesDir, `style-sample-${c.name}.png`)
    await media.run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, len / 2)), '-i', r.video, '-frames:v', '1', '-vf', 'scale=960:-2', frame], { signal: new AbortController().signal })
    out(`      frame: ${path.relative(ROOT, frame)}`)
  }
}
out(failed === 0 ? 'Tout est bon.' : `${failed} vérification(s) en échec.`)
process.exit(failed === 0 ? 0 : 1)
