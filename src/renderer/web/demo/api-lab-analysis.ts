// Demo fixtures, lab: Analyser — three invented reference channels, the analyses already made, a new analysis that reads
// the channel (a short wait), lets the visitor pick the example videos, then runs its steps over about ten seconds (each
// step announced with changed('analysis')), the reproducibility gauge (the app's own pure formula, src/shared/gauge.ts),
// the Analyste chat and « Créer la pipeline ». A pasted link is never read: no real channel is analysed in the demo.
import type { Adjust, AnalysisDetail, AnalysisSummary, FormatProfile, ReferenceSummary, ReferenceVideo, ScriptStyleCard, StepId, TimelineSegment } from '../../../shared/analysis'
import { STEP_IDS } from '../../../shared/analysis'
import { BUDGET_MODE_IDS, computeGauge, neededInputs, type ComponentId, type GaugeMode } from '../../../shared/gauge'
import { changed, wait, type DemoHandlers } from './bridge'
import { addLibraryPipeline, builderSources, costOf, pipelineJson, saveStyle, styleSheetFor } from './api-lab-library'
import { ago, channelName, nextId } from './world'

interface Ref {
  summary: ReferenceSummary
  uploadsPerWeek: number
  components: { component: ComponentId; share: number }[]
  notes: FormatProfile['notes']
  summaryText: string
  voice: FormatProfile['voice']
  minutes: number
  titles: string[]
}

const REFS: Ref[] = [
  {
    summary: { id: 'ref-archives-ciel', name: 'Archives du Ciel', niche: 'Astronomie et histoire des sciences', format: 'Documentaires narrés de 15 à 20 minutes', subscribers: 412_000 },
    uploadsPerWeek: 1,
    components: [{ component: 'ai_image', share: 0.4 }, { component: 'stock', share: 0.25 }, { component: 'map', share: 0.15 }, { component: 'text_anim', share: 0.1 }, { component: 'infographic', share: 0.1 }],
    notes: { voice: 0.85, script: 0.8, edit: 0.75, voiceWhy: 'Une voix posée, sans effet : une voix de synthèse soignée suffit.', scriptWhy: 'Structure en trois actes, très régulière d’une vidéo à l’autre.', editWhy: 'Zooms lents et cartes : rien que le moteur ne sache faire.' },
    summaryText: 'Un narrateur calme sur des gravures, des cartes du ciel et des photos d’archives, avec des titres sobres.',
    voice: { kind: 'human', gender: 'homme', energy: 'calme', wpm: 138 },
    minutes: 17,
    titles: ['La comète qui a fait peur à tout Paris', 'Le télescope perdu de l’observatoire', 'Pourquoi la Lune semble plus grosse à l’horizon', 'L’astronome qui comptait les étoiles à la main', 'La nuit où le ciel est devenu rouge', 'Le mystère des taches solaires', 'La carte céleste de 1600', 'L’éclipse qui a changé un traité']
  },
  {
    summary: { id: 'ref-petites-histoires', name: 'Petites Histoires du Soir', niche: 'Récits racontés à la première personne', format: 'Shorts verticaux d’une minute, fond de jeu vidéo', subscribers: 1_250_000 },
    uploadsPerWeek: 10,
    components: [{ component: 'gameplay', share: 0.7 }, { component: 'text_anim', share: 0.2 }, { component: 'ai_image', share: 0.1 }],
    notes: { voice: 0.9, script: 0.85, edit: 0.9, voiceWhy: 'Voix de synthèse rapide : reproductible telle quelle.', scriptWhy: 'Récits courts avec une chute : facile à écrire dans ce ton.', editWhy: 'Sous-titres mot à mot et fond continu.' },
    summaryText: 'Une voix rapide raconte une histoire courte sur un fond de jeu vidéo, sous-titres mot à mot.',
    voice: { kind: 'synthetic', gender: 'femme', energy: 'vive', wpm: 172 },
    minutes: 1,
    titles: ['Mon voisin m’a laissé une lettre étrange', 'J’ai trouvé une clé dans un livre', 'Le colis qui n’était pas pour moi', 'Ma sœur a gardé un secret 10 ans', 'Le message sur le miroir', 'Le chat qui rentrait toujours à 3 h', 'J’ai gagné un voyage que je n’avais pas joué', 'La photo de classe avec un inconnu']
  },
  {
    summary: { id: 'ref-labo-5', name: 'Le Labo en 5 minutes', niche: 'Science expliquée, expériences filmées', format: 'Vidéos de 6 à 8 minutes, présentatrice face caméra', subscribers: 236_000 },
    uploadsPerWeek: 2,
    components: [{ component: 'face_camera', share: 0.45 }, { component: 'infographic', share: 0.25 }, { component: 'stock', share: 0.15 }, { component: 'ai_video', share: 0.15 }],
    notes: { voice: 0.7, script: 0.8, edit: 0.7, voiceWhy: 'La présentatrice parle elle-même : il faudra une voix ou un avatar.', scriptWhy: 'Une question, une expérience, une explication : structure claire.', editWhy: 'Schémas animés et coupes nettes.' },
    summaryText: 'Une présentatrice face caméra, des schémas animés et quelques plans d’expérience.',
    voice: { kind: 'human', gender: 'femme', energy: 'enjouée', wpm: 158 },
    minutes: 7,
    titles: ['Pourquoi la glace flotte', 'L’expérience du ballon qui ne brûle pas', 'Combien pèse un nuage ?', 'Le sel fait-il bouillir l’eau plus vite ?', 'Pourquoi le ciel est bleu', 'La bougie qui remonte l’eau', 'Faire un arc-en-ciel dans sa cuisine', 'Le mystère des bulles de savon']
  }
]

const videosOf = (r: Ref): ReferenceVideo[] =>
  r.titles.map((title, i) => ({
    id: `${r.summary.id}-v${i + 1}`,
    title,
    views: Math.round(r.summary.subscribers * (i === 1 ? 2.4 : 0.25 + ((i * 37) % 60) / 100)),
    durationS: Math.round(r.minutes * 60 * (0.85 + ((i * 13) % 30) / 100)),
    publishedDaysAgo: Math.round((i + 1) * (7 / r.uploadsPerWeek)),
    outlier: i === 1
  }))

function segmentsOf(r: Ref, v: ReferenceVideo): TimelineSegment[] {
  const out: TimelineSegment[] = []
  let at = 0
  let k = 0
  while (at < v.durationS) {
    const c = r.components[k % r.components.length]!
    const len = Math.max(4, Math.round(v.durationS * c.share * 0.25))
    out.push({ startS: at, endS: Math.min(v.durationS, at + len), component: c.component, note: '' })
    at += len
    k++
  }
  return out
}

const scriptCardOf = (r: Ref): ScriptStyleCard => ({
  structure: r.minutes <= 1 ? ['Accroche choc', 'Situation', 'Rebondissement', 'Chute'] : ['Accroche', 'Contexte', 'Trois rebondissements', 'Révélation', 'Ouverture'],
  hook: r.minutes <= 1 ? 'Une phrase qui commence au milieu de l’action' : 'Une question posée dans les dix premières secondes',
  tone: r.voice.energy,
  wpm: r.voice.wpm,
  lengthMin: r.minutes,
  vocabulary: 'simple, concret',
  shape: r.minutes <= 1 ? 'récit court' : 'enquête',
  skills: ['hook', 'retention']
})

const analyses: AnalysisDetail[] = []

function baseDetail(r: Ref, minutesAgo: number): AnalysisDetail {
  const videos = videosOf(r)
  return {
    id: nextId(),
    referenceId: r.summary.id,
    channelName: r.summary.name,
    sourceLink: `demo://${r.summary.id}`,
    status: 'choose_examples',
    score: null,
    example: false,
    createdAt: ago(minutesAgo),
    mode: 'qualite_max',
    reference: { ...r.summary, uploadsPerWeek: r.uploadsPerWeek, recentVideos: videos, proposedExamples: videos.filter((_, i) => i < 3).map((v) => v.id) },
    chosenExamples: [],
    examples: [],
    steps: STEP_IDS.map((id) => ({ id, status: id === 'read' ? 'done' : id === 'examples' ? 'waiting' : 'pending', n: id === 'read' ? videos.length : 0 })),
    profile: null,
    scriptCard: null,
    styleDraft: null,
    questions: [],
    answers: {},
    replace: {},
    adjust: {},
    gauge: null,
    cost: null,
    proposedPipelineJson: null,
    createdPipelineId: null,
    messages: []
  }
}

const refOf = (a: AnalysisDetail): Ref => REFS.find((r) => r.summary.id === a.referenceId) ?? REFS[0]!

/** Recomputes the gauge, the cost and the score from the profile and the current answers. */
function regauge(a: AnalysisDetail): void {
  const r = refOf(a)
  if (!a.profile) return
  const g = { components: a.profile.components, voice: r.notes.voice, script: r.notes.script, edit: r.notes.edit, analystConfidence: a.profile.analystConfidence }
  a.questions = neededInputs(g)
  a.gauge = computeGauge(g, { mode: a.mode, answers: a.answers, replace: a.replace })
  a.score = a.gauge.score
  const minutes = a.adjust.minutes ?? r.minutes
  a.proposedPipelineJson = pipelineJson(`${r.summary.name} — format reproduit`, minutes)
  const cost = costOf(a.proposedPipelineJson)
  a.cost = { minutes, modes: Object.fromEntries(BUDGET_MODE_IDS.map((m) => [m, { credits: cost.modes[m].credits, perMinute: cost.modes[m].perMinute }])) as Record<GaugeMode, { credits: number; perMinute: number }> }
}

function finish(a: AnalysisDetail): void {
  const r = refOf(a)
  a.status = 'done'
  a.examples = a.chosenExamples.map((id) => a.reference.recentVideos.find((v) => v.id === id)).filter((v): v is ReferenceVideo => !!v).map((video) => ({ video, segments: segmentsOf(r, video) }))
  a.profile = {
    summary: r.summaryText,
    components: r.components,
    cutsPerMinute: r.minutes <= 1 ? 26 : 11,
    onScreenText: 'Titres courts, dates et lieux',
    subtitles: r.minutes <= 1 ? 'Mot à mot, au centre' : 'Aucun',
    voice: r.voice,
    music: 'Nappe discrète sous la voix',
    thumbnail: 'Un objet au centre, trois mots en majuscules',
    notes: r.notes,
    analystConfidence: 'high'
  }
  a.scriptCard = scriptCardOf(r)
  a.styleDraft = styleSheetFor(1, r.summary.name)
  regauge(a)
}

function step(a: AnalysisDetail, id: StepId, n: number): void {
  const at = a.steps.findIndex((s) => s.id === id)
  a.steps = a.steps.map((s, i) => (i === at ? { ...s, status: 'done', n } : i === at + 1 ? { ...s, status: 'waiting' } : s))
}

// two analyses already made, one waiting for its examples
for (const [r, m, done] of [[REFS[0], 60 * 26, true], [REFS[1], 60 * 50, true], [REFS[2], 30, false]] as const) {
  const a = baseDetail(r!, m)
  if (done) {
    a.chosenExamples = a.reference.proposedExamples
    for (const [id, n] of [['examples', 3], ['video', 142], ['script', 1], ['synthesis', 1]] as const) step(a, id, n)
    finish(a)
    a.messages = [
      { id: nextId(), author: 'user', body: 'Et si on faisait des vidéos plus courtes ?', applied: null, createdAt: ago(m - 10) },
      { id: nextId(), author: 'analyst', body: 'On peut descendre à 10 minutes sans casser la structure : j’ai ajusté la durée.', applied: { minutes: 10 }, createdAt: ago(m - 11) }
    ]
    a.adjust = { minutes: 10 }
    regauge(a)
  }
  analyses.push(a)
}

builderSources.analysisJson = (id) => {
  const a = analyses.find((x) => x.id === id)
  return a?.proposedPipelineJson ? { title: a.channelName, json: a.proposedPipelineJson } : null
}

function find(id: number): AnalysisDetail {
  const a = analyses.find((x) => x.id === id)
  if (!a) throw new Error('Analyse introuvable.')
  return a
}

const summaryOf = (a: AnalysisDetail): AnalysisSummary => ({ id: a.id, referenceId: a.referenceId, channelName: a.channelName, sourceLink: a.sourceLink, status: a.status, score: a.score, example: a.example, createdAt: a.createdAt })
const copy = (a: AnalysisDetail): AnalysisDetail => structuredClone(a)

/** What the Analyste answers, and the adjustment it applies (a few phrases it understands). */
function analystReply(a: AnalysisDetail, text: string): { body: string; applied: Adjust | null } {
  const low = text.toLowerCase()
  const minutes = /(\d{1,3})\s*min/.exec(low)
  if (minutes) {
    const n = Math.min(120, Math.max(1, Number(minutes[1])))
    return { body: `D’accord pour ${n} minutes : la structure reste la même, le coût suit la durée.`, applied: { minutes: n } }
  }
  if (/moins cher|économ|budget/.test(low)) return { body: 'Je passe en mode « usage max » : moins de clips générés, plus d’images fixes.', applied: { mode: 'usage_max' } }
  if (/qualit/.test(low)) return { body: 'Je passe en mode « qualité max » : plus de clips, rendu plus fin.', applied: { mode: 'qualite_max' } }
  if (/cam[ée]ra|face/.test(low)) return { body: 'Si tu peux te filmer, la part face caméra devient reproductible : je note « oui ».', applied: { answers: { camera: true } } }
  return { body: `Démo : l’Analyste répond ici à quelques demandes (une durée, « moins cher », « qualité », « je peux me filmer »). Sur ${a.channelName}, le plus dur à reproduire reste ${a.gauge && a.gauge.score < 70 ? 'la part filmée' : 'le rythme du montage'}.`, applied: null }
}

function apply(a: AnalysisDetail, adj: Adjust): void {
  if (adj.mode) a.mode = adj.mode
  if (adj.answers) a.answers = { ...a.answers, ...adj.answers }
  if (adj.replace) a.replace = { ...a.replace, ...adj.replace }
  if (adj.minutes !== undefined) a.adjust = { ...a.adjust, minutes: adj.minutes }
  if (adj.maxCreditsPerVideo !== undefined) a.adjust = { ...a.adjust, maxCreditsPerVideo: adj.maxCreditsPerVideo }
  regauge(a)
}

export const analysisHandlers: DemoHandlers = {
  'analysis.references': () => REFS.map((r) => ({ ...r.summary })),
  'analysis.list': () => analyses.map(summaryOf).sort((x, y) => y.createdAt.localeCompare(x.createdAt)),
  'analysis.get': (id) => copy(find(id)),
  'analysis.start': async (input) => {
    const r = REFS.find((x) => x.summary.id === input.referenceId)
    if (!r) return { kind: 'unavailable', link: input.link ?? '', references: REFS.map((x) => ({ ...x.summary })) }
    await wait(1200)
    const a = baseDetail(r, 0)
    analyses.unshift(a)
    changed('analysis')
    return { kind: 'started', analysis: copy(a) }
  },
  'analysis.chooseExamples': async (id, videoIds) => {
    const a = find(id)
    if (videoIds.length === 0) throw new Error('Choisis au moins une vidéo d’exemple.')
    a.chosenExamples = [...videoIds]
    step(a, 'examples', videoIds.length)
    changed('analysis')
    for (const [s, n] of [['video', 40 + videoIds.length * 34], ['script', 1], ['synthesis', 1]] as const) {
      await wait(3200)
      step(a, s, n)
      if (s === 'synthesis') finish(a)
      changed('analysis')
    }
    return copy(a)
  },
  'analysis.answer': (id, input, value) => {
    const a = find(id)
    if (value === null) delete a.answers[input]
    else a.answers[input] = value
    regauge(a)
    changed('analysis')
    return copy(a)
  },
  'analysis.setMode': (id, mode) => {
    const a = find(id)
    a.mode = mode
    regauge(a)
    changed('analysis')
    return copy(a)
  },
  'analysis.chat': async (id, text) => {
    const a = find(id)
    a.messages.push({ id: nextId(), author: 'user', body: text, applied: null, createdAt: new Date().toISOString() })
    await wait(1100)
    const { body, applied } = analystReply(a, text)
    if (applied) apply(a, applied)
    a.messages.push({ id: nextId(), author: 'analyst', body, applied, createdAt: new Date().toISOString() })
    changed('analysis')
    return { analysis: copy(a), applied, adjustRejected: false }
  },
  'analysis.createPipeline': (id, channelId) => {
    const a = find(id)
    if (a.status !== 'done' || !a.proposedPipelineJson) throw new Error('L’analyse n’est pas terminée.')
    const pipeline = addLibraryPipeline(`${a.channelName} → ${channelName(channelId)}`, a.proposedPipelineJson, 'analysis', channelId, `Créée depuis l’analyse de ${a.channelName}`)
    const styleVersion = saveStyle(channelId, { ...styleSheetFor(channelId), script: { ...styleSheetFor(channelId).script, lengthMin: a.adjust.minutes ?? refOf(a).minutes } }, `Depuis l’analyse de ${a.channelName}`)
    a.createdPipelineId = pipeline.id
    changed('analysis')
    return { pipeline, styleVersion }
  },
  'analysis.delete': (id) => {
    const at = analyses.findIndex((x) => x.id === id)
    if (at >= 0) analyses.splice(at, 1)
    changed('analysis')
  }
}
