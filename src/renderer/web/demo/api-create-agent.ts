// The pipeline agent of the demo (production/agent and the editor's « Parler à l'agent »): three variants for a target
// with price and likeness, the questions the references leave open, « Choisir cette pipeline » that saves it, then the
// pipeline's conversation where every change the agent proposes is a diff with its cost before → after, saved as a new
// version only when accepted. Prices are credits (1 credit = 0,01 €). Invented, scripted, instant.
import type { EstimateRange, FitDimensionId } from '../../../shared/estimates'
import type { AgentTarget, AssignView, ChangeView, ProposalView, ProposeOptions, QuestionView, ThreadMessageView, ThreadView, VariantKindId, VariantView } from '../../../shared/pipeline-agent'
import type { RecipeDetail, RecipeDocument } from '../../../shared/recipes'
import { createdRecipe, documentaryDoc, registerRecipe, updateRecipe } from './api-create-recipes'
import { ago, channelName, DEMO_CHANNELS } from './world'

const CREDIT_EUR = 0.01

const range = (avg: number): EstimateRange => ({ min: Math.round(avg * 0.85), avg, max: Math.round(avg * 1.2) })

const VARIANT: Record<VariantKindId, { perMinute: number; fit: number; why: string; opts: Parameters<typeof documentaryDoc>[1]; ops: VariantView['ops'] }> = {
  faithful: { perMinute: 42, fit: 91, why: 'Garde le rythme posé, les archives et la carte du ciel animée : c’est ce qui fait la chaîne.', opts: {}, ops: [{ op: 'set-option', option: 'music', value: 'library' }, { op: 'set-mix', archive: 0.5, imageAi: 0.25 }] },
  cheap: { perMinute: 24, fit: 78, why: 'Moins d’images générées, plus d’archives du domaine public : presque deux fois moins cher.', opts: { editing: 'simple', music: 'library' }, ops: [{ op: 'set-mix', archive: 0.7, imageAi: 0.05 }, { op: 'remove-brick', tech: 'visuals.motion' }] },
  premium: { perMinute: 68, fit: 95, why: 'Ajoute des cartes animées plus riches et une musique composée pour chaque vidéo.', opts: { music: 'generated', editing: 'advanced' }, ops: [{ op: 'set-option', option: 'music', value: 'generated' }, { op: 'set-option', option: 'editing', value: 'advanced' }] }
}

const QUESTIONS: Omit<QuestionView, 'answer'>[] = [
  { id: 'script', choices: ['agent', 'agent-review', 'import'], default: 'agent-review' },
  { id: 'captions', choices: ['no', 'yes'], default: 'no' },
  { id: 'presenter', choices: ['low', 'medium', 'high'], default: 'low' }
]

function targetName(target: AgentTarget): string {
  if (target.kind === 'concept') {
    const words = target.text.trim().split(/\s+/).slice(0, 6).join(' ')
    return words.length > 0 ? words.charAt(0).toUpperCase() + words.slice(1) : 'Nouvelle chaîne'
  }
  return channelName(target.channelId)
}

export function propose(target: AgentTarget, options: ProposeOptions = {}): ProposalView {
  const name = targetName(target)
  const answers = options.answers ?? {}
  const captions = (answers['captions'] ?? 'no') === 'yes'
  const presenterShare = { low: 0, medium: 6, high: 12 }[answers['presenter'] ?? 'low'] ?? 0
  const variants = (['faithful', 'cheap', 'premium'] as const).map((kind): VariantView => {
    const v = VARIANT[kind]
    const doc = documentaryDoc(`${name} — ${{ faithful: 'fidèle', cheap: 'économique', premium: 'premium' }[kind]}`, { ...v.opts, captions })
    const perMinute = v.perMinute + presenterShare + (captions ? 2 : 0)
    return { kind, doc, ops: v.ops, perMinute: range(perMinute), perVideo: range(perMinute * doc.format.minutes), fit: v.fit - (answers['script'] === 'import' ? 3 : 0), why: options.agent === false ? '' : v.why }
  })
  const draft = options.draft ?? {
    summary: `Pour « ${name} », je pars d’un documentaire narré : archives anciennes, cartes du ciel animées, une voix calme et des plans longs. La version fidèle est la plus proche de tes références ; l’économique garde l’essentiel pour moitié prix.`,
    why: { faithful: VARIANT.faithful.why, cheap: VARIANT.cheap.why, premium: VARIANT.premium.why },
    ops: { faithful: VARIANT.faithful.ops, cheap: VARIANT.cheap.ops, premium: VARIANT.premium.ops }
  }
  const unmeasured: FitDimensionId[] = target.kind === 'concept' ? ['sponsor', 'presenter'] : ['sponsor']
  return {
    target,
    base: 'documentaire@1',
    measured: target.kind === 'concept' ? 0 : 12,
    demo: false,
    unmeasured,
    variants,
    recommended: 'faithful',
    questions: QUESTIONS.map((q) => ({ ...q, answer: answers[q.id] ?? null })),
    draft,
    agentNote: null,
    model: 'claude-opus-5-5',
    pricesAvailable: true,
    creditEur: CREDIT_EUR
  }
}

// ── The conversation of each pipeline ────────────────────────────────────────────────────────────────────────────────

interface Thread { messages: ThreadMessageView[]; changes: ChangeView[]; channels: number[] }
const threads = new Map<number, Thread>()
let seq = 1

const message = (role: ThreadMessageView['role'], text: string, changeId: number | null = null): ThreadMessageView => ({ id: seq++, role, text, changeId, errors: [], createdAt: ago(0) })

function threadOf(recipeId: number): Thread {
  let th = threads.get(recipeId)
  if (!th) {
    th = { messages: [message('agent', 'Je connais cette pipeline. Dis-moi ce que tu veux changer : « moins cher », « plus rythmé », « avec des sous-titres »… Je te montre chaque changement avant de l’enregistrer.')], changes: [], channels: [] }
    threads.set(recipeId, th)
  }
  return th
}

function view(recipeId: number): ThreadView {
  const th = threadOf(recipeId)
  const version = createdRecipe(recipeId)?.version ?? 1
  return { recipeId, version, messages: [...th.messages], pending: th.changes.find((c) => c.status === 'pending') ?? null, changes: [...th.changes], creditEur: CREDIT_EUR }
}

export function adopt(input: { doc: RecipeDocument; kind: VariantKindId; summary?: string; channelIds?: number[] }): RecipeDetail {
  const d = registerRecipe(input.doc, input.summary ? 'Proposée par l’agent' : 'Choisie parmi les variantes')
  const channelIds = input.channelIds ?? []
  if (channelIds.length > 0) updateRecipe(d.id, { channelIds })
  const th = threadOf(d.id)
  th.channels = channelIds
  if (input.summary) th.messages.push(message('agent', input.summary))
  return createdRecipe(d.id) ?? d
}

export const thread = (recipeId: number): ThreadView => view(recipeId)

/** One scripted answer: the agent proposes ONE change, the one the message asks for. */
function proposalFor(text: string, doc: RecipeDocument | undefined): { note: string; reply: string; key: string; before: unknown; after: unknown; delta: number; fit: number } {
  const opts = doc?.options ?? {}
  if (/cher|co[uû]t|prix|budget|[ée]conom/i.test(text)) return { note: 'Musique de la bibliothèque au lieu d’une musique composée', reply: 'La musique composée pour chaque vidéo coûte le plus cher : je propose la bibliothèque. Le style reste le même.', key: 'music', before: opts['music'] ?? 'generated', after: 'library', delta: -9, fit: -2 }
  if (/sous-titr|caption/i.test(text)) return { note: 'Sous-titres incrustés', reply: 'J’ajoute des sous-titres incrustés, dans la police des bas de titre.', key: 'captions', before: opts['captions'] ?? false, after: !(opts['captions'] === true), delta: 2, fit: 1 }
  if (/rythm|dynam|rapide|nerveu/i.test(text)) return { note: 'Montage dynamique, plans plus courts', reply: 'Je passe au montage dynamique : des plans plus courts, surtout dans l’accroche.', key: 'editing', before: opts['editing'] ?? 'simple', after: 'dynamic', delta: 3, fit: -4 }
  return { note: 'Chapitres à l’écran', reply: 'Je propose d’ajouter les chapitres à l’écran : la référence en montre un toutes les trois minutes environ.', key: 'chapters', before: opts['chapters'] ?? false, after: true, delta: 1, fit: 2 }
}

export function say(recipeId: number, text: string): ThreadView {
  const th = threadOf(recipeId)
  th.messages.push(message('user', text))
  for (const c of th.changes) if (c.status === 'pending') c.status = 'replaced'
  const recipe = createdRecipe(recipeId)
  const p = proposalFor(text, recipe?.doc)
  const base = 42
  const change: ChangeView = {
    id: seq++,
    status: 'pending',
    author: 'agent',
    note: p.note,
    ops: [{ op: 'set-option', option: p.key, value: p.after }],
    changes: [{ kind: 'option', key: p.key, before: p.before, after: p.after }],
    perMinute: { before: range(base), after: range(base + p.delta) },
    fit: { before: 91, after: 91 + p.fit },
    baseVersion: recipe?.version ?? 1,
    savedVersion: null,
    createdAt: ago(0)
  }
  th.changes.unshift(change)
  th.messages.push(message('agent', p.reply, change.id))
  return view(recipeId)
}

export function accept(recipeId: number, changeId: number): ThreadView {
  const th = threadOf(recipeId)
  const c = th.changes.find((x) => x.id === changeId)
  if (c && c.status === 'pending') {
    const recipe = createdRecipe(recipeId)
    const first = c.changes[0]
    if (recipe && first?.key) {
      const doc: RecipeDocument = { ...recipe.doc, options: { ...recipe.doc.options, [first.key]: first.after as string | number | boolean } }
      updateRecipe(recipeId, { doc, note: c.note })
    }
    c.status = 'accepted'
    c.savedVersion = createdRecipe(recipeId)?.version ?? c.baseVersion + 1
    th.messages.push(message('system', `Enregistré : version ${c.savedVersion}.`))
  }
  return view(recipeId)
}

export function reject(recipeId: number, changeId: number): ThreadView {
  const th = threadOf(recipeId)
  const c = th.changes.find((x) => x.id === changeId)
  if (c && c.status === 'pending') {
    c.status = 'rejected'
    th.messages.push(message('system', 'Changement refusé : la pipeline ne change pas.'))
  }
  return view(recipeId)
}

// ── The channels a pipeline serves ───────────────────────────────────────────────────────────────────────────────────

const VOICES = ['Voix « Basalte »', 'Voix « Opaline »', 'Voix « Cèdre »', 'Voix « Lumen »']

export function assignment(recipeId: number): AssignView {
  const th = threadOf(recipeId)
  const fromRecipe = createdRecipe(recipeId)?.channels.map((c) => c.channelId) ?? []
  const ids = th.channels.length > 0 ? th.channels : fromRecipe
  return {
    recipeId,
    videoType: createdRecipe(recipeId)?.videoType ?? 'documentaire',
    channels: ids.map((channelId) => {
      const i = Math.max(0, DEMO_CHANNELS.findIndex((c) => c.id === channelId))
      return {
        channelId,
        name: channelName(channelId),
        inputs: [
          { input: 'topic', source: 'project', value: null },
          { input: 'voice', source: 'channel', value: VOICES[i % VOICES.length] ?? null },
          { input: 'style', source: 'channel', value: i % 2 === 0 ? 'Fiche de style v2' : null }
        ]
      }
    })
  }
}

export function assign(recipeId: number, channelIds: number[]): AssignView {
  threadOf(recipeId).channels = [...channelIds]
  updateRecipe(recipeId, { channelIds })
  return assignment(recipeId)
}
