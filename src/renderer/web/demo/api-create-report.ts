// What a demo clone shows: its progress through the nine stages (played in ~36 s from the time it started, read again by
// the screen every 4 s) and its final report (verdict, example, side-by-side frames, scores, ingredients, technologies,
// proposals with previews). All about a fictional channel; every number is invented but consistent.
import type { CloneIntent, CloneProgress, ProgressFact, ProgressStep, ProgressStepView, Report } from '../../../shared/clone'
import { PROGRESS_STEPS } from '../../../shared/clone'
import type { CloneRunState } from '../../../shared/api/clone'
import { type Scene, SCENES } from './api-create-art'

/** A clone of the tour, started by the visitor or seeded as already finished. */
export interface DemoClone {
  id: string
  /** The reference link (the history shows it). */
  title: string
  createdAt: string
  /** ms since epoch; the stages are played from here. */
  startedAt: number
  intent: CloneIntent
  budgetUsd: number
  language: string
  supplies: { face: boolean; voice: boolean; footage: boolean }
  /** The pipeline the clone saved when it finished (once). */
  recipeId: number | null
}

/** Seconds each stage after the brief takes in the demo (8 stages: about 36 s in all). */
const STEP_S = 4.5
const WORK_STEPS = PROGRESS_STEPS.length - 1
export const TOTAL_S = STEP_S * WORK_STEPS
const SPENT_SHARE = 0.68

const elapsedS = (c: DemoClone, now = Date.now()): number => Math.max(0, (now - c.startedAt) / 1000)
export const isDone = (c: DemoClone, now = Date.now()): boolean => elapsedS(c, now) >= TOTAL_S

const round2 = (x: number): number => Math.round(x * 100) / 100

export function runState(c: DemoClone): CloneRunState {
  return isDone(c) ? { kind: 'done', outcome: 'cloned' } : { kind: 'running' }
}

export function spentOf(c: DemoClone, now = Date.now()): number {
  return round2(c.budgetUsd * SPENT_SHARE * Math.min(1, elapsedS(c, now) / TOTAL_S))
}

const fact = (key: string, vars: Record<string, string | number> = {}): ProgressFact => ({ key: `clone.progress.fact.${key}`, vars })

/** The pictures a stage shows (paths the `clone.file` handler draws). */
const frames = (step: ProgressStep, n: number): string[] => Array.from({ length: n }, (_, i) => `frames/${step}-${i + 1}.svg`)

/** What one stage found, `frac` = how far it is (0..1, 1 = done). */
function stepView(c: DemoClone, step: ProgressStep, frac: number): Omit<ProgressStepView, 'status'> {
  const live = (max: number): number => Math.max(1, Math.min(max, Math.ceil(frac * max)))
  switch (step) {
    case 'intake': return { step, facts: [fact('intent', { intent: c.intent }), fact('budget', { usd: c.budgetUsd })], frames: [] }
    case 'channel': return { step, facts: [fact('videos', { n: 12, of: 148 })], frames: frac >= 1 ? frames('channel', 6) : [] }
    case 'watch': return { step, facts: [fact('watched', { n: live(12), of: 12 }), fact('shots', { n: Math.round(live(12) * 71.5) })], frames: frames('watch', Math.min(6, live(6))) }
    case 'can': return { step, facts: [fact('can', { share: 94 })], frames: [] }
    case 'definition': return { step, facts: [fact('style.dominant', { n: 2, videos: 9, of: 12 }), fact('definition', { version: frac >= 1 ? 2 : 1 })], frames: [] }
    case 'pipeline': return { step, facts: [fact('pipeline', { bricks: 11, slots: c.supplies.voice ? 1 : 2 })], frames: [] }
    case 'rounds': {
      const n = live(3)
      return { step, facts: [fact('rounds', { n }), fact('sameChannel', { answer: frac >= 1 ? 'yes' : 'no' })], frames: frames('rounds', n * 2) }
    }
    case 'example': return { step, facts: frac >= 1 ? [fact('example', { answer: 'yes' })] : [], frames: frac >= 1 ? frames('example', 3) : [] }
    case 'report': return { step, facts: frac >= 1 ? [fact('report')] : [], frames: [] }
  }
}

const RECENT: CloneProgress['recent'] = [
  { phase: 'P8', decision: 'Plans d’archives allongés de 4,9 s à 5,8 s', why: 'Le juge trouvait notre rythme plus nerveux que la référence.' },
  { phase: 'P5', decision: 'Carte du ciel animée gardée', why: 'Elle occupe 14 % de l’écran sur les 12 vidéos regardées.' },
  { phase: 'P3', decision: 'Vues 3D du ciel laissées de côté', why: 'Aucune brique ne les fait : 6 % de l’écran, dit dans le rapport.' }
]

export function progressOf(c: DemoClone, now = Date.now()): CloneProgress {
  const e = elapsedS(c, now)
  const done = e >= TOTAL_S
  let current: ProgressStep = 'report'
  let n = 1
  const steps: ProgressStepView[] = []
  PROGRESS_STEPS.forEach((step, i) => {
    const start = (i - 1) * STEP_S
    const frac = i === 0 ? 1 : Math.min(1, Math.max(0, (e - start) / STEP_S))
    if (frac >= 1) steps.push({ ...stepView(c, step, 1), status: 'done' })
    else if (e >= start) {
      current = step
      n = Math.max(1, Math.ceil(frac * 3))
      steps.push({ ...stepView(c, step, frac), status: 'running' })
    } else steps.push({ step, status: 'waiting', facts: [], frames: [] })
  })
  const at = current as ProgressStep
  const nowFact = done ? fact('finished') : at === 'rounds' ? fact('now.rounds', { n }) : fact(`now.${at}`)
  const passed = Math.min(RECENT.length, Math.floor(e / (TOTAL_S / 4)))
  return { cloneId: c.id, steps, spentUsd: spentOf(c, now), budgetUsd: c.budgetUsd, now: nowFact, stoppedBecause: null, recent: RECENT.slice(RECENT.length - passed) }
}

/** Which scene and caption a frame path shows (stable for a path). */
export function frameScene(rel: string): { scene: Scene; seed: number; ours: boolean; text: string } {
  const m = /([a-z]+)-(\d+)\.svg$/.exec(rel)
  const step = m?.[1] ?? 'watch'
  const i = Number(m?.[2] ?? 1)
  const offset = step.length
  const scene = SCENES[(i + offset) % SCENES.length]!
  const ours = step === 'rounds' || step === 'example'
  return { scene, seed: i * 13 + offset * 7, ours, text: ours && i % 2 === 1 ? CAPTIONS[i % CAPTIONS.length]! : '' }
}

export const CAPTIONS = ['1887 · La carte du ciel', 'Le premier cliché d’une nébuleuse', 'Une plaque de verre, 40 minutes de pose', 'L’observatoire au sommet', 'Ce point n’était pas une étoile', 'La comète de l’hiver 1910']

/** Side-by-side moments of the report (path `pairs/<n>.svg`). */
const PAIR_AT = [14, 72, 151, 236, 318, 402]

/** The final report of a finished clone. */
export function reportOf(c: DemoClone): Report {
  const finished = new Date(c.startedAt + TOTAL_S * 1000).toISOString()
  const voiceNow = c.supplies.voice ? 'import' : 'generate'
  return {
    schema: 'atelier.clone.report/1',
    cloneId: c.id,
    createdAt: finished,
    outcome: 'cloned',
    verdict: 'reproducible-with-human-inputs',
    reproducibleShare: 0.94,
    alert: null,
    alternatives: [],
    example: { videoPath: 'example/example.mp4', durationS: 10 },
    sideBySide: PAIR_AT.map((atS, i) => ({ atS, reference: `pairs/ref-${i + 1}.svg`, ours: `pairs/ours-${i + 1}.svg`, sideBySide: `pairs/${i + 1}.svg` })),
    humanInputs: [
      { slot: 'voice', what: 'La voix du narrateur', placeholder: c.supplies.voice ? null : 'une voix de synthèse grave et posée, marquée « provisoire »' },
      { slot: 'archives', what: 'Les plaques photographiques anciennes', placeholder: 'des plaques du domaine public, trouvées par l’agent' }
    ],
    usdPerMinute: 0.42,
    makeMinutesPerMinute: 3.5,
    rounds: 3,
    spentUsd: round2(c.budgetUsd * SPENT_SHARE),
    proposals: [
      { title: 'clone.proposal.asExample', previewPath: 'previews/as-example.svg', usdPerMinute: 0.42, makeMinutesPerMinute: 3.5, look: 'clone.proposal.asExample.look' },
      { title: 'clone.proposal.slot:voice', previewPath: 'previews/own-voice.svg', usdPerMinute: 0.36, makeMinutesPerMinute: 3.1, look: 'clone.proposal.slot.look' },
      { title: 'La version courte verticale', previewPath: 'previews/short.svg', usdPerMinute: 0.55, makeMinutesPerMinute: 2.4, look: 'Les mêmes plaques recadrées en 9:16, une découverte par plan, sous-titres mot à mot.' }
    ],
    ingredients: [
      { slot: 'voice', what: 'La voix du narrateur', options: ['import', 'generate', 'clone'], current: voiceNow },
      { slot: 'archives', what: 'Les plaques photographiques anciennes', options: ['import', 'find', 'generate'], current: 'find' }
    ],
    technologies: [
      { node: 'script.write', role: 'Écrit le récit, phrases longues et ton émerveillé' },
      { node: 'script.factcheck', role: 'Vérifie les dates et les noms' },
      { node: 'voice.tts', role: 'La voix du narrateur (provisoire)' },
      { node: 'director.plan', role: 'Découpe en plans de 5,8 s en moyenne' },
      { node: 'archive.find', role: 'Trouve les plaques du domaine public' },
      { node: 'visuals.image', role: 'Complète les trous en style plaque photographique' },
      { node: 'visuals.motion', role: 'Les cartes du ciel animées' },
      { node: 'edit.assemble', role: 'Monte, ajoute musique et bas de titre' }
    ],
    cannot: [{ what: 'Les vues 3D du ciel en mouvement', share: 0.06, technology: 'Rendu 3D de planétarium', buildCostUsd: 1800, importCostUsd: 40 }],
    axisScores: [
      { axis: 'layout', score: 96, defects: [] },
      { axis: 'cadence', score: 91, defects: ['plans du milieu un peu plus courts'] },
      { axis: 'illustration', score: 88, defects: ['deux plaques plus nettes que celles de la référence'] },
      { axis: 'motion', score: 84, defects: ['zoom des cartes plus rapide'] },
      { axis: 'palette', score: 95, defects: [] },
      { axis: 'voice', score: 79, defects: ['voix provisoire plus aiguë', 'moins de pauses'] },
      { axis: 'sound', score: 90, defects: ['musique un peu plus forte sous la voix'] },
      { axis: 'script', score: 93, defects: [] },
      { axis: 'captions', score: 97, defects: [] }
    ],
    framesFrom: 'example',
    summaryKey: 'clone.report.cloned',
    summaryVars: { rounds: 3 }
  }
}
