// P6 — the real `runs` service (spec §2 P6): produce the reference passage with the plan's compiled recipe on the
// engines, within the money left. Our OWN script on the same subject and structure (the idea gives the subject, the
// outline and the hook pattern measured by P2, never the reference's words). The engine reuses every node whose
// fingerprint did not change, so a round re-renders only what its changes touched; the round records which bricks re-ran.
// Engine calibration rules (compare/calibration.ts) are applied to the recipe's settings before the run. A finished
// production is saved in its folder first, so a crash or a resume never pays for it twice.
import { withPassageObjects } from '../pipeline/values-pov'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Production, type OurShot, type PipelinePlan, type StyleDefinition, type VideoAnalysis } from '../../../../shared/clone'
import type { CloneServices } from '../services'
import type { Folder } from '../store'
import { factorOf, loadCalibration, type Calibration } from './calibration'
import { brickKeys, rerunPlan, settingOf } from './cache'

/** What one engine run gives back. */
export interface ProducedRun {
  runId: string
  spentUsd: number
  /** Absolute path of the final render. */
  videoFile: string
  /** Measured length of the render (seconds). */
  durationS: number
  scriptText: string
  /** Node states of the run (`cached` = reused from an earlier run). */
  nodes: { id: string; state: string }[]
  timeline: OurShot[] | null
}

/** The engines, behind one call (the brain through scripts/brain-run.mjs for a session, the app's runs service later). */
export interface Producer {
  produce(o: { recipe: unknown; title: string; idea: string; minutes: number; maxUsd: number; workDir: string }): Promise<ProducedRun>
}

interface RecipeBrick { tech: string; settings: Record<string, unknown> }

/** The recipe with calibration factors applied (pure): a plan setting `<node>.<name>` reading a calibrated field gets its
 *  number multiplied in the recipe brick whose `tech` is that node. */
export function calibrate(recipe: unknown, plan: PipelinePlan, c: Calibration): unknown {
  if (!recipe || typeof recipe !== 'object' || !Array.isArray((recipe as { bricks?: unknown }).bricks)) return recipe
  const doc = structuredClone(recipe) as { bricks: RecipeBrick[] }
  for (const b of doc.bricks) {
    for (const s of plan.settings) {
      if (!settingOf(s.key, b.tech)) continue
      const name = s.key.split('.').pop()!
      if (typeof b.settings[name] !== 'number') continue
      const factor = s.fields.reduce((f, field) => f * factorOf(c, b.tech.split('@')[0]!, field) * (b.tech.includes('@') ? factorOf(c, b.tech, field) : 1), 1)
      if (factor !== 1) b.settings[name] = Math.round((b.settings[name] as number) * factor * 1000) / 1000
    }
  }
  return doc
}

/** The recipe with the render's blocking checks set (pure, decision 0102): a comparison round's film is a test render that must still be
 *  compared, its real errors reported (they block the example through the review's defects); the full example (P9) is refused while
 *  one is left. */
export function withBlocking(recipe: unknown, mode: 'refuse' | 'report'): unknown {
  if (!recipe || typeof recipe !== 'object' || !Array.isArray((recipe as { bricks?: unknown }).bricks)) return recipe
  const doc = structuredClone(recipe) as { bricks: RecipeBrick[] }
  for (const b of doc.bricks) if (b.tech.startsWith('render.assemble')) b.settings = { ...(b.settings ?? {}), editBlocking: mode }
  return doc
}

/** The recipe without the « DÉMO » mark on the film: the free gate's judge copy only (decision 0106), never shown to the user. */
export function withoutWatermark(recipe: unknown): unknown {
  if (!recipe || typeof recipe !== 'object' || !Array.isArray((recipe as { bricks?: unknown }).bricks)) return recipe
  const doc = structuredClone(recipe) as { bricks: RecipeBrick[] }
  for (const b of doc.bricks) if (b.tech.startsWith('render.assemble')) b.settings = { ...(b.settings ?? {}), watermark: 'off' }
  return doc
}

/** The search words of a person of the definition's presenter type (pure): the look-alike's type, else the measured identity;
 *  short (a stock search reads a few words); null when the style has no presenter. */
export function standInPerson(def: StyleDefinition): string | null {
  const p = def.presenter
  if (p.kind.value === 'none' || p.mode.value === 'none') return null
  const t = p.placeholder.value?.type ?? p.identity.value
  if (!t) return null
  const words = [t.gender, t.age, t.wardrobe].join(' ').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean)
  const q = [...words.slice(0, 7), 'portrait'].join(' ')
  return q.length > 'portrait'.length ? q.slice(0, 120) : null
}

/** The recipe of a FREE demo with found stand-ins (pure, decision 0109): every picture a free stock photograph, video items stills
 *  (no drawn clip), the presenter a photograph of the planned type. Only the demo's recipe: a paid run never carries these. */
export function withFoundStandIns(recipe: unknown, def: StyleDefinition): unknown {
  if (!recipe || typeof recipe !== 'object' || !Array.isArray((recipe as { bricks?: unknown }).bricks)) return recipe
  const doc = structuredClone(recipe) as { bricks: RecipeBrick[] }
  const person = standInPerson(def)
  for (const b of doc.bricks) {
    if (b.tech.startsWith('visuals.fulfil') || b.tech.startsWith('clip.make')) b.settings = { ...(b.settings ?? {}), standIns: 'found' }
    if (b.tech.startsWith('avatar.speak')) b.settings = { ...(b.settings ?? {}), standIns: 'found', ...(person ? { standInPerson: person } : {}) }
  }
  return doc
}

const said = (f: { source: string }): boolean => f.source !== 'default'

/** The idea given to the script brick: the passage's subject and outline, in our own words (pure). */
/** The app refuses a project idea over this many characters (`projects.create`). */
export const IDEA_MAX_CHARS = 2000
const clip = (text: string, n: number): string => (text.length <= n ? text : `${text.slice(0, n - 1).trimEnd()}…`)

export function passageIdea(a: VideoAnalysis | null, def: StyleDefinition, seconds: number): { title: string; idea: string } {
  const title = clip(a?.title ?? def.channel.name, 200)
  // the essentials first, the long measured grammar after, each clipped: a long outline (Markets of the Past: 2000+
  // characters) must never make the app refuse the round (the proof of 2026-11-06)
  const head = [
    `Subject: ${title}.`,
    `Write OUR OWN script (never the reference's words) for the first ${Math.round(seconds)} seconds of a video on this subject, in ${def.channel.language}.`,
    `About ${def.script.wordsPerMinute.value} words a minute.`
  ]
  const rest = [
    // the script grammar comes from the DEFINITION (so a P8 change to it reaches the next render), and only its fields
    // that were measured or said by the user: a definition default describes nothing of this channel
    `Hook pattern: ${clip(said(def.script.hookPattern) ? def.script.hookPattern.value : a?.script.hookPattern ?? 'as the reference', 300)}.`,
    `Promise: ${clip(said(def.script.promise) ? def.script.promise.value : a?.script.promise ?? title, 250)}.`,
    said(def.script.tone) ? `Tone: ${clip(def.script.tone.value, 200)}.` : (a ? `Tone: ${clip(a.script.tone, 200)}.` : ''),
    said(def.script.frame) ? `Frame: ${clip(String(def.script.frame.value), 120)}.` : '',
    said(def.script.addressMode) ? `Address the viewer as: ${def.script.addressMode.value}.` : '',
    said(def.script.payoff) ? `Payoff: ${clip(def.script.payoff.value, 200)}.` : '',
    said(def.script.cta) ? `Call to action: ${clip(def.script.cta.value || 'none', 150)}.` : '',
    a ? `Outline of the reference: ${clip(a.script.structure.join(' → '), 500)}.` : '',
    said(def.script.devices) && def.script.devices.value.length ? `Devices: ${clip(def.script.devices.value.join('; '), 250)}.` : '',
    said(def.script.bannedOpenings) && def.script.bannedOpenings.value.length ? `Never open with: ${clip(def.script.bannedOpenings.value.join('; '), 200)}.` : ''
  ].filter(Boolean)
  const lines = [...head]
  for (const l of rest) if ([...lines, l].join('\n').length <= IDEA_MAX_CHARS) lines.push(l)
  return { title, idea: lines.join('\n') }
}

export interface RunnerDeps {
  producer: Producer
  /** Data folder (engine-wide calibration). */
  dataDir: string
  analysis(videoId: string): VideoAnalysis | null
  now?(): number
}

/** The real `runs` service. Previous rounds' brick keys are read from the sibling round folders. */
export function planRunner(d: RunnerDeps): CloneServices['runs'] {
  const now = d.now ?? Date.now
  return {
    async produce(plan, def, passage, dir: Folder, maxUsd): Promise<Production> {
      const saved = path.join(dir.abs, 'production.json')
      if (existsSync(saved)) return Production.parse(JSON.parse(readFileSync(saved, 'utf8')))
      if (!plan.recipe) throw new Error('the plan has no compiled recipe: P5 must compile it before a real run')
      const calibration = loadCalibration(d.dataDir)
      // moteur-pov-2: the passage handles the things its own video handles there (measured on its first-person shots)
      const recipe = withPassageObjects(withBlocking(calibrate(plan.recipe, plan, calibration), /(^|\/)p9-/.test(dir.rel) ? 'refuse' : 'report'), d.analysis(passage.videoId), passage, def)
      writeFileSync(path.join(dir.abs, 'recipe.json'), JSON.stringify(recipe, null, 2) + '\n', 'utf8')
      const seconds = passage.toS - passage.fromS
      const { title, idea } = passageIdea(d.analysis(passage.videoId), def, seconds)
      const started = now()
      const run = await d.producer.produce({ recipe, title, idea, minutes: Math.round((seconds / 60) * 100) / 100, maxUsd, workDir: dir.abs })
      const makeSeconds = Math.round((now() - started) / 1000)
      copyFileSync(run.videoFile, path.join(dir.abs, 'ours.mp4'))
      writeFileSync(path.join(dir.abs, 'script.txt'), run.scriptText, 'utf8')
      const durationS = run.durationS
      const keys = brickKeys(plan, calibration)
      const predicted = rerunPlan(plan, keys, previousKeys(dir))
      const cached = new Set(run.nodes.filter((n) => n.state === 'cached').map((n) => n.id))
      const minutes = durationS / 60
      const production: Production = {
        passage, videoPath: `${dir.rel}/ours.mp4`, scriptPath: `${dir.rel}/script.txt`, durationS,
        costUsd: run.spentUsd, makeSeconds, usdPerMinute: run.spentUsd / minutes, makeSecondsPerMinute: makeSeconds / minutes, runs: [run.runId],
        ...(run.timeline ? { timeline: run.timeline } : {}),
        bricks: { keys, rerun: run.nodes.length ? run.nodes.filter((n) => !cached.has(n.id)).map((n) => n.id) : predicted.rerun, reused: run.nodes.length ? [...cached] : predicted.reused }
      }
      writeFileSync(saved, JSON.stringify(production, null, 2) + '\n', 'utf8')
      return production
    }
  }
}

/** Brick keys of the previous round (`p6-round-<NN-1>/production.json`), null for the first round. */
function previousKeys(dir: Folder): Record<string, string> | null {
  const m = /(\d+)$/.exec(dir.rel)
  if (!m) return null
  const prev = path.join(path.dirname(dir.abs), dir.rel.replace(/\d+$/, String(Number(m[1]) - 1).padStart(m[1]!.length, '0')), 'production.json')
  if (!existsSync(prev)) return null
  const p = Production.safeParse(JSON.parse(readFileSync(prev, 'utf8')))
  return p.success ? p.data.bricks?.keys ?? null : null
}
