// Demo handlers: Production › « Créer une pipeline » (see handlers.ts). The clone flow end to end — the intake
// conversation, the progress played in ~36 s, the illustrated report — plus the pipeline agent (propose, choose, talk,
// assign) and a shared code. One finished clone of a fictional channel is there from the start, so its report can be
// read at once. A clone that finishes saves its pipeline, as the real engine does (`api-create-recipes.ts`).
import type { IntakeState } from '../../../shared/clone'
import type { CloneSummary } from '../../../shared/api/clone'
import { type DemoHandlers, changed } from './bridge'
import { frameSvg, pairSvg, previewSvg, type Scene, SCENES } from './api-create-art'
import { accept, adopt, assign, assignment, propose, reject, say, thread } from './api-create-agent'
import { DEMO_SOURCE_NAME, DEMO_SOURCE_URL, intakeTurn } from './api-create-intake'
import { CAPTIONS, type DemoClone, frameScene, isDone, progressOf, reportOf, runState, spentOf } from './api-create-report'
import { codeOf, documentaryDoc, registerRecipe } from './api-create-recipes'
import sampleVideo from '../../../../resources/fake-media/sample.mp4?url'

export { createdRecipe, createdRecipes } from './api-create-recipes'

const DAY_MS = 86_400_000

/** The clones of the tour, newest first: one finished three days ago on the fictional channel. */
const clones: DemoClone[] = [
  {
    id: 'clone-archives-du-ciel',
    title: DEMO_SOURCE_URL,
    createdAt: new Date(Date.now() - 3 * DAY_MS).toISOString(),
    startedAt: Date.now() - 3 * DAY_MS,
    intent: 'copy-channel',
    budgetUsd: 10,
    language: 'fr',
    supplies: { face: false, voice: false, footage: false },
    recipeId: null
  }
]

const find = (id: string): DemoClone => {
  const c = clones.find((x) => x.id === id)
  if (!c) throw new Error('Cette création n’existe plus.')
  return c
}

const summary = (c: DemoClone): CloneSummary => ({ id: c.id, title: c.title, createdAt: c.createdAt, state: runState(c), spentUsd: spentOf(c), budgetUsd: c.budgetUsd })

/** A clone that just finished saves its pipeline, once (as the engine's P5 → recipes.save). */
function saveWhenDone(c: DemoClone): void {
  if (c.recipeId !== null || !isDone(c)) return
  const name = c.title === DEMO_SOURCE_URL ? `${DEMO_SOURCE_NAME} — documentaire` : `Pipeline de ${c.title.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}`
  c.recipeId = registerRecipe(documentaryDoc(name, { language: c.language }), 'Créée par « Créer une pipeline »').id
  changed('production')
}

// the seeded clone's pipeline is already among his pipelines
for (const c of clones) saveWhenDone(c)

let cloneSeq = 1

function start(state: IntakeState): { cloneId: string } {
  const d = state.draft
  const now = Date.now()
  const c: DemoClone = {
    id: `clone-demo-${cloneSeq++}`,
    title: d.references[0]?.url ?? DEMO_SOURCE_URL,
    createdAt: new Date(now).toISOString(),
    startedAt: now,
    intent: d.intent ?? 'copy-channel',
    budgetUsd: d.testBudgetUsd ?? 10,
    language: d.language ?? 'fr',
    supplies: d.humanInputs ?? { face: false, voice: false, footage: false },
    recipeId: null
  }
  clones.unshift(c)
  changed('production')
  return { cloneId: c.id }
}

const encoder = new TextEncoder()
const svgFile = (svg: string): { mime: string; bytes: Uint8Array } => ({ mime: 'image/svg+xml', bytes: encoder.encode(svg) })

/** A picture or the example film of a clone, by its path (drawn on the fly; the film is the repo's synthetic sample). */
async function file(rel: string): Promise<{ mime: string; bytes: Uint8Array }> {
  if (rel.endsWith('.mp4')) {
    const res = await fetch(sampleVideo)
    return { mime: 'video/mp4', bytes: new Uint8Array(await res.arrayBuffer()) }
  }
  const pair = /^pairs\/(\d+)\.svg$/.exec(rel)
  if (pair) {
    const i = Number(pair[1])
    const scene: Scene = SCENES[i % SCENES.length]!
    return svgFile(pairSvg(scene, i * 17, i % 2 === 0 ? (CAPTIONS[i % CAPTIONS.length] ?? '') : ''))
  }
  const preview = /^previews\/(as-example|own-voice|short)\.svg$/.exec(rel)
  if (preview) return svgFile(previewSvg(preview[1] as 'as-example' | 'own-voice' | 'short'))
  const f = frameScene(rel)
  return svgFile(frameSvg(f.scene, f.seed, f.ours ? 'ours' : 'ref', f.text))
}

export const createHandlers: DemoHandlers = {
  'clone.intakeStart': () => ({ draft: { intent: null, references: [], style: undefined, language: null, sourceLanguage: null, testBudgetUsd: null, humanInputs: null, ownChannel: null }, said: [], asked: null }),
  'clone.intakeTurn': (state, message) => intakeTurn(state, message),
  'clone.start': (state) => start(state),
  'clone.list': () => clones.map(summary),
  'clone.progress': (cloneId) => {
    const c = find(cloneId)
    saveWhenDone(c)
    return { ...progressOf(c), state: runState(c) }
  },
  'clone.report': (cloneId) => {
    const c = find(cloneId)
    if (!isDone(c)) return null
    saveWhenDone(c)
    return reportOf(c)
  },
  'clone.resume': (cloneId, budgetUsd) => {
    const c = find(cloneId)
    if (budgetUsd !== undefined) c.budgetUsd = budgetUsd
    return summary(c)
  },
  'clone.answer': (cloneId) => summary(find(cloneId)),
  'clone.file': (_cloneId, rel) => file(rel),
  'clone.remove': (cloneId) => {
    const i = clones.findIndex((c) => c.id === cloneId)
    if (i >= 0) clones.splice(i, 1)
    changed('production')
    return { removed: i >= 0 }
  },

  'pipelineAgent.propose': (target, options) => propose(target, options),
  'pipelineAgent.adopt': (input) => adopt(input),
  'pipelineAgent.thread': (recipeId) => thread(recipeId),
  'pipelineAgent.say': (recipeId, text) => say(recipeId, text),
  'pipelineAgent.accept': (recipeId, changeId) => accept(recipeId, changeId),
  'pipelineAgent.reject': (recipeId, changeId) => reject(recipeId, changeId),
  'pipelineAgent.assignment': (recipeId) => assignment(recipeId),
  'pipelineAgent.assign': (recipeId, channelIds) => assign(recipeId, channelIds),

  'recipes.fromCode': (text) => {
    const code = /[0-9A-Z]{4}-[0-9A-Z]{4}/i.exec(text)?.[0]?.toUpperCase() ?? codeOf(Date.now() % 9973)
    return registerRecipe(documentaryDoc(`Pipeline partagée ${code}`), `Importée du code ${code}`)
  }
}
