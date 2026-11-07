// « Reproduire un style » (production-15, docs/specs/production-model.md §10.3; Charlie, 01/11: « on envoie des chaînes
// YouTube et il essaie de répliquer le style, ensuite il montre des exemples, ça coûte un peu de crédits, ensuite il y a un
// score de rapprochabilité »). The owner pastes 1 to 5 links → the eyes measure them (references.ts) → the closest
// pipelines from the bricks (engine style-propose.ts: base, mix and curve, options, engines, styles; `voiceover@1` when no
// presenter is seen) with price per minute and a free likeness estimate → « Voir un exemple »: the sample is quoted first
// (the estimator, a few credits) and runs only with the owner's click on that very quote, as a normal run (its own quote,
// cache and ledger) → its edit plan is measured and scored against the references (likeness.ts) with its three biggest
// gaps; applying a gap is an edit on the variant (diff, Δ cost, Δ score) and the sample becomes « à refaire » → « Utiliser
// cette pipeline » saves the variant as the team's pipeline. The agent (one optional model call) only words the style and
// writes the sample's two sentences: every number is the code's. A style is reproduced, never a person: the presenter and
// the voice are the channel's own or designed to a similar type (production-5 and -7 rules).
import { createHash, randomUUID } from 'node:crypto'
import type { EditPlan } from '../../../engine/formats/editplan'
import { applyOps, basePipeline, optionProblem, type EditOp, type RecipeDoc, type TechnologyRegistry } from '../../../engine/technologies'
import type { CostInput } from '../../../engine/technologies/cost'
import { measurePlan, sampleDoc, sampleFacts, sampleQuote, sampleScript, SAMPLE_SECONDS } from '../../../engine/technologies/style-sample'
import type { ChangeTopic } from '../../../shared/api'
import type { VariantKindId } from '../../../shared/pipeline-agent'
import type { RecipeDetail, RecipeDocument } from '../../../shared/recipes'
import { INSPIRATION_AXES, STUDY_PATHS, type InspirationAxisId, type StudyInput, type StudyPath, type StudySummary, type StudyView } from '../../../shared/style-agent'
import type { DifferentiatorProposal } from '../../../engine/technologies/differentiators'
import type { Db } from '../../db'
import type { ChannelIntelPort } from '../../eyes/port'
import type { YoutubeMetaPort } from '../../eyes/youtube-meta'
import { assessFeasibility, mergeAgentFeasibility } from './feasibility'
import { checkLinks, measureReferences, parseLink, type MeasuredReference } from './references'
import { StudyStore, type StoredInspiration, type StudyState } from './store'
import { axesOf, buildView, currentGaps, differentiatorsOf, profileText, profileView, proposalOf, variantDoc } from './view'
import { parseStyleBlock, styleSystem, stylePrompt } from './prompt'

/** What a sample run gives back: its state, and once done its edit plan, what it spent, and the eyes' look of its frames. */
export interface SampleResult {
  status: 'running' | 'done' | 'failed'
  error: string | null
  plan: EditPlan | null
  credits: number
  /** The eyes' reading of the sample's frames (null: not looked at, the style's own look is used). */
  lookFamily: string | null
}

/** Runs a sample as a normal run of the app (sample-runner.ts), or a fake in tests. */
export interface SamplePort {
  /** What the run would hold from the wallet while it runs (its own worst-case quote), in credits. */
  hold(o: { doc: RecipeDoc; channelId: number; script: string }): Promise<{ credits: number; debited: boolean }>
  start(o: { doc: RecipeDoc; channelId: number; script: string; title: string; credits: number }): Promise<number>
  result(runId: number): Promise<SampleResult>
}

/** One model call without tools (the « pipeline_architect » route); the answer carries an `atelier-style` block. */
export type StyleModel = (req: { system: string; prompt: string }) => Promise<{ text: string; model: string }>

export interface StyleAgentDeps {
  db: Db
  reg: TechnologyRegistry
  costInput: () => Promise<CostInput | null>
  /** The eyes (Atelier Cloud), or their demonstration when it is not connected. */
  intel: () => ChannelIntelPort
  /** The public pages read on the owner's machine (a video's real title, length, channel and description); absent: not read. */
  meta?: YoutubeMetaPort
  sampler: SamplePort | null
  model: StyleModel | null
  /** Saves a variant as the team's pipeline (production-12's adoption: a first version and its conversation). */
  adopt: (input: { doc: RecipeDocument; kind: VariantKindId; summary?: string }) => RecipeDetail
  /** « Retravailler un style » : one of the team's pipelines (its name and current document), and a new version of it. */
  recipe?: (id: number) => { name: string; doc: RecipeDoc } | null
  rework?: (id: number, ops: EditOp[], note: string) => RecipeDetail
  /** The team's channels, by id (a sample is made for one: a run needs a channel; it is never published). */
  channels: () => number[]
  /** Credits of the eyes' minutes (absent: not priced). */
  measureCredits?: (minutes: number) => number
  notify?: (topic: ChangeTopic) => void
  now?: () => Date
}

/** Words that ask for no presenter on screen (used when no example video says it). */
const NO_PRESENTER = /voix[- ]off|sans pr[ée]sentateur|pas de pr[ée]sentateur|sans visage|faceless|no presenter|voice[- ]over/i
/** Words that put someone on screen (style-test-2: « parle face caméra dans son atelier »). */
const PRESENTER = /face (?:à la )?cam[ée]ra|face ?cam|pr[ée]sentateur|avatar|parle (?:à|devant) la cam[ée]ra|on camera|presenter/i
/** Words that ask for a documentary over archives and cards (style-markets: « archives », « cartes animées », « documentaire historique »). */
const DOCUMENTARY = /documentaire|documentary|archives?\b|histoire|historique|history|cartes? (?:anim[ée]es?|g[ée]ographiques?)|animated maps?|frises?|timelines?/i
/** Words that ask for a story short (clone-reddit-shorts: « histoires Reddit », « story time », clips « satisfaisants » or gameplay behind). */
const STORY = /reddit|story ?time|histoires? (?:vraies?|lues?|racont[ée]es?)|satisfy(?:ing)?|satisfaisant|gameplay|minecraft|subway surfers/i
/** Words that ask for a 2D motion-design « POV » story (clone-monde-pov: « POV », « dessin animé », « animation 2D », « et si… »). */
const POV = /\bpov\b|dessins? anim[ée]s?|animation 2d|2d animation|motion design|bonhommes?|stick ?figures?|vectoriel|\bet si\b|what if/i
const baseFromWords = (text: string): string | null =>
  STORY.test(text) && !PRESENTER.test(text)
    ? 'story-short@1'
    : POV.test(text) && !PRESENTER.test(text)
      ? 'pov@1'
      : DOCUMENTARY.test(text) && !PRESENTER.test(text)
      ? 'documentary@2'
      : NO_PRESENTER.test(text)
        ? 'voiceover@1'
        : PRESENTER.test(text)
          ? 'avatar@1'
          : null

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const KINDS: readonly VariantKindId[] = ['faithful', 'cheap', 'premium']
/** The smallest cap of a sample run, in credits. */
const SAMPLE_CAP_MIN = 100
export const docKey = (doc: RecipeDoc): string => createHash('sha256').update(JSON.stringify(doc)).digest('hex').slice(0, 24)

export class StyleAgentService {
  readonly store: StudyStore

  constructor(private readonly deps: StyleAgentDeps) {
    this.store = new StudyStore(deps.db, deps.now)
  }

  private checkOption(doc: RecipeDoc) {
    const decls = basePipeline(doc.base)?.options ?? []
    return (o: string, v: unknown): string | null => optionProblem(decls, o, v)
  }

  private kind(v: unknown): VariantKindId {
    if (typeof v !== 'string' || !KINDS.includes(v as VariantKindId)) throw new Error('Variante inconnue (fidèle, économique ou premium).')
    return v as VariantKindId
  }

  private async view(id: number): Promise<StudyView> {
    const row = this.store.get(id)
    return buildView(row, this.deps.reg, await this.deps.costInput())
  }

  // --------------------------------------------------------------------------------------------------------- study

  /**
   * « Créer une pipeline »: a few words, and (recommended) 1 to 5 example links the eyes measure; then the closest pipelines
   * (the agent words the style, writes the sample's narration and, without measured references, picks the base). The way in
   * (parcours-utilisateur) sets what is measured and proposed: an inspiration per axis (each link measured once, whatever the axes
   * it serves), the owner's own channel (two proposals at most), a translation (a language is needed), a rework (the team's
   * pipeline as it is). A channel read whose videos the eyes could not watch still gives a study, from its numbers and the words.
   */
  async study(input: StudyInput, signal: AbortSignal = new AbortController().signal): Promise<StudyView> {
    const started = Date.now()
    const text = typeof input?.text === 'string' ? input.text.trim().slice(0, 1500) : ''
    const instructions = typeof input?.instructions === 'string' ? input.instructions.trim().slice(0, 1500) : ''
    const given = Array.isArray(input?.links) ? input.links.filter((l) => typeof l === 'string' && l.trim()) : []
    const axesIn = (Array.isArray(input?.inspirations) ? input.inspirations : []).filter(
      (a): a is { axis: InspirationAxisId; link: string } => !!a && (INSPIRATION_AXES as readonly string[]).includes(a.axis) && typeof a.link === 'string' && a.link.trim() !== ''
    )
    const path: StudyPath = (STUDY_PATHS as readonly string[]).includes(input?.path as string) ? (input.path as StudyPath) : axesIn.length > 0 ? 'inspire' : input?.own ? 'own' : input?.language ? 'translate' : given.length > 1 ? 'mix' : 'clone'
    const own = input?.own === true || path === 'own'
    const language = typeof input?.language === 'string' && /^[a-z]{2}$/.test(input.language.trim().toLowerCase()) ? input.language.trim().toLowerCase() : undefined
    if (path === 'translate' && !language) throw new Error('Choisis la langue de ta nouvelle chaîne.')
    const scope = input?.scope === 'channel' ? 'channel' : 'video'
    let rework: StudyState['rework']
    if (path === 'rework' || input?.recipeId !== undefined) {
      const found = typeof input?.recipeId === 'number' ? this.deps.recipe?.(input.recipeId) : null
      if (!found) throw new Error('Choisis la pipeline à retravailler.')
      rework = { id: input.recipeId as number, name: found.name, doc: found.doc }
    }
    if (!rework && given.length === 0 && axesIn.length === 0 && text.length < 3) throw new Error('Décris ta vidéo en quelques mots, ou ajoute des vidéos d’exemple.')
    // every link once, the plain ones first, then the axes' (the same channel may give its editing and its scripts)
    const urls = [...new Set([...given, ...axesIn.map((a) => a.link)].map((l) => l.trim()))]
    const links = urls.length > 0 ? checkLinks(urls) : []
    let measured: MeasuredReference[] = []
    let eyesNote: string | null = null
    if (links.length > 0) {
      const intel = this.deps.intel()
      if (!intel.connected()) throw new Error('Connecte Atelier Cloud : ce sont ses yeux qui mesurent les vidéos.')
      measured = await measureReferences(links, intel, signal, { own, ...(input?.format ? { format: input.format } : {}), ...(this.deps.meta ? { meta: this.deps.meta } : {}), scope })
      if (measured.every((r) => r.measures.length === 0)) {
        const problem = measured.map((r) => r.problem).find(Boolean) ?? 'aucune vidéo mesurée'
        // never a dead end: the channel's numbers, the owner's words, or at least the channel's name carry the study
        const read = measured.some((r) => r.insight)
        const from = read ? 'J’ai lu la chaîne (formats, vues, titres) et je propose d’après elle' : text.length >= 3 ? 'Je propose d’après tes mots' : 'Je propose d’après le nom de la chaîne ; décris-la en quelques mots pour une proposition plus juste'
        eyesNote = `Je n’ai pas pu regarder les vidéos (${problem}). ${from} ; relance l’analyse plus tard pour mesurer la ressemblance.`
      }
    }
    const byUrl = (link: string): MeasuredReference | undefined => {
      const p = parseLink(link)
      return measured.find((r) => r.url === (p?.url ?? link.trim()))
    }
    // the proposal reads the content axis (or every plain link); the other axes are applied on it
    const contentLink = axesIn.find((a) => a.axis === 'content')?.link
    const refs = axesIn.length > 0 ? [...given.map(byUrl), ...(contentLink ? [byUrl(contentLink)] : [])].filter((r): r is MeasuredReference => !!r) : measured
    const inspirations: StoredInspiration[] = axesIn.map((a) => {
      const r = byUrl(a.link)
      return { axis: a.axis, url: r?.url ?? a.link, title: r?.title ?? a.link, measures: r?.measures ?? [], subjects: r?.subjects ?? [], problem: r?.problem ?? null }
    })
    const watched = measured.reduce((a, r) => a + (r.demo ? 0 : r.watched), 0)
    // the eyes' demonstration is an example, not a reading of the owner's videos: their words still pick the base
    const read = refs.some((r) => !r.demo && r.measures.length > 0)
    const contentRef = contentLink ? byUrl(contentLink) : undefined
    const contentBase = !read && contentRef ? baseFromWords([contentRef.title, ...contentRef.subjects].join(' ')) : null
    const subject = (read ? refs.flatMap((r) => r.subjects)[0] : undefined) ?? (text || refs.flatMap((r) => r.subjects)[0] || '')
    const state: StudyState = {
      path,
      text,
      ...(instructions ? { instructions } : {}),
      links: links.map((l) => l.url),
      refs: [...new Set(refs)],
      ...(inspirations.length > 0 ? { inspirations } : {}),
      ...(rework ? { rework } : {}),
      // unread references: the content axis's channel first (its name says the genre), then the owner's words, then every channel's
      // name and titles (« RedditChroniques » is a story channel)
      baseId: read || rework ? null : (contentBase ?? baseFromWords(`${text} ${instructions}`) ?? baseFromWords(refs.flatMap((r) => [r.title, ...r.subjects]).join(' '))),
      summary: null,
      agentNote: eyesNote,
      script: sampleScript(subject) || 'Presque tout le monde fait cette erreur sans le savoir. Voici pourquoi, et la bonne méthode.',
      answers: {},
      edits: {},
      channelId: this.deps.channels()[0] ?? null,
      ...(own ? { own: true } : {}),
      ...(language ? { language } : {}),
      quote: null,
      sample: null,
      measureCredits: watched > 0 && this.deps.measureCredits ? this.deps.measureCredits(watched) : 0,
      ...(scope === 'channel' ? { scope } : {})
    }
    // can Atelier make it? said early, from what was read (the demonstration's measures are not the reference's)
    if (!rework && measured.length > 0) {
      const unread = measured.map((r) => r.unread).filter(Boolean).join(' ; ') || null
      state.feasibility = assessFeasibility(measured.map((r) => ({ measures: r.demo ? [] : r.measures, words: r.words ?? '' })), unread)
    }
    const cost = await this.deps.costInput()
    const proposalNow = (): { proposal: ReturnType<typeof proposalOf>; diffs: DifferentiatorProposal[] } => {
      const proposal = proposalOf(state, this.deps.reg, cost)
      const rec = proposal.variants.find((v) => v.kind === proposal.recommended) ?? proposal.variants[0]
      return { proposal, diffs: rec ? differentiatorsOf(state, rec.doc, this.deps.reg, null) : [] }
    }
    if (input.agent !== false) {
      if (!this.deps.model) state.agentNote = [eyesNote, 'L’agent n’est pas disponible ici : voici la proposition calculée.'].filter(Boolean).join(' ')
      else {
        try {
          const { proposal, diffs } = proposalNow()
          const axes = axesOf(state).map((a) => `${a.axis}: ${a.title}${a.refs.length === 0 ? ' (not measured)' : ''}`)
          const f = state.feasibility
          const feasibility = f ? `${f.share} % (${f.parts.map((x) => `${x.title}: ${x.share} %, ${x.can}`).join('; ')}); missing ${f.missing.map((x) => x.id).join(', ') || 'none'}; humans ${f.humans.map((x) => x.id).join(', ') || 'none'}` : undefined
          const ctx = { path, own, language: language ?? null, instructions, axes, proposals: diffs.map((d) => ({ id: d.id, title: d.title, effect: d.effect })), ...(feasibility ? { feasibility } : {}) }
          const res = await this.deps.model({ system: styleSystem, prompt: stylePrompt(state.text, state.refs, proposal, ctx) })
          const b = parseStyleBlock(res.text)
          state.summary = b.summary
          if (b.script) state.script = sampleScript(b.script)
          if (b.ask) state.ask = b.ask
          if (state.feasibility !== undefined) state.feasibility = mergeAgentFeasibility(state.feasibility, b.feasibility)
          // without references read for real, the agent may pick the base from the words
          if (!read && !rework && !contentBase && b.base) state.baseId = b.base
          // a style out of reach: the agent picks the nearest pipeline Atelier makes well for the same subject (essais-utilisateur:
          // Yarnhub's 3D battles → an archive documentary, not generated clips that imitate the 3D badly)
          else if (read && !rework && !contentBase && b.base && state.feasibility?.verdict === 'no') state.baseId = b.base
          const known = new Set(proposalNow().diffs.map((d) => d.id))
          state.suggested = b.suggested.filter((id) => known.has(id))
        } catch (e) {
          state.agentNote = [eyesNote, `L’agent n’a pas pu répondre (${errText(e).slice(0, 200)}) : voici la proposition calculée.`].filter(Boolean).join(' ')
        }
      }
    }
    // « Un peu différent » : two changes ticked from the start (the agent's, else the first two that differ), the owner unticks freely
    if (path === 'different') {
      const diffs = proposalNow().diffs
      const first = [...(state.suggested ?? []), ...diffs.filter((d) => d.effect === 'differ').map((d) => d.id)]
      state.picks = [...new Set(first)].filter((id) => diffs.some((d) => d.id === id)).slice(0, 2)
    }
    state.analysisS = Math.round((Date.now() - started) / 100) / 10
    const id = this.store.create(state)
    this.deps.notify?.('production')
    return this.view(id)
  }

  /** The study, its sample read again when it is still running. */
  async get(id: number): Promise<StudyView> {
    await this.refresh(id)
    return this.view(id)
  }

  list(): StudySummary[] {
    return this.store.list().map((r) => {
      const first = r.state.refs.find((x) => x.measures.length > 0)
      const title = r.state.rework ? `Retravailler « ${r.state.rework.name} »` : (first?.title ?? (r.state.text || r.state.inspirations?.[0]?.title || r.state.refs[0]?.title || r.state.links[0] || 'Étude'))
      return { id: r.id, title, base: proposalOf(r.state, this.deps.reg, null).base, score: null, createdAt: r.createdAt }
    })
  }

  private update(id: number, change: (s: StudyState) => void): void {
    const row = this.store.get(id)
    change(row.state)
    this.store.save(id, row.state)
    this.deps.notify?.('production')
  }

  /** Answers to the questions the references leave open (each answer is edit operations in every variant). */
  async answer(id: number, answers: Record<string, string>): Promise<StudyView> {
    if (typeof answers !== 'object' || answers === null) throw new Error('Réponses invalides.')
    this.update(id, (s) => {
      for (const [k, v] of Object.entries(answers)) if (typeof v === 'string') s.answers[k] = v
      s.quote = null
    })
    return this.view(id)
  }

  /** The differentiators the owner keeps (« Comment veux-tu te différencier ? »): unknown ids are refused, the sample is « à refaire ». */
  async pick(id: number, ids: unknown): Promise<StudyView> {
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string') || ids.length > 8) throw new Error('Choix invalides.')
    const view = await this.view(id)
    const known = new Set(view.differentiators.map((d) => d.id))
    const bad = (ids as string[]).filter((x) => !known.has(x))
    if (bad.length > 0) throw new Error(`Proposition inconnue : ${bad.join(', ')}.`)
    this.update(id, (s) => {
      s.picks = [...new Set(ids as string[])]
      s.quote = null
    })
    return this.view(id)
  }

  /** The owner's choice for one ingredient (« importer les miens, l'agent les trouve, générer, cloner »): unknown ones refused. */
  async choose(id: number, ingredient: unknown, option: unknown): Promise<StudyView> {
    const view = await this.view(id)
    const ing = view.ingredients.find((i) => i.id === ingredient)
    if (!ing || typeof option !== 'string' || !ing.options.some((o) => o.id === option)) throw new Error('Choix inconnu pour cet ingrédient.')
    this.update(id, (s) => {
      s.choices = { ...(s.choices ?? {}), [ing.id]: option }
      s.quote = null
    })
    return this.view(id)
  }

  /** The channel a sample is made for (its presenter, voice and style are that channel's). */
  async setChannel(id: number, channelId: number): Promise<StudyView> {
    if (!this.deps.channels().includes(channelId)) throw new Error('Chaîne inconnue.')
    this.update(id, (s) => {
      s.channelId = channelId
      s.quote = null
    })
    return this.view(id)
  }

  /** The sample's narration, as the owner rewrote it. */
  async setScript(id: number, script: string): Promise<StudyView> {
    const text = typeof script === 'string' ? script.trim() : ''
    if (text.split(/\s+/).length < 6) throw new Error('Écris une ou deux phrases pour l’exemple.')
    this.update(id, (s) => {
      s.script = sampleScript(text, 70)
      s.quote = null
    })
    return this.view(id)
  }

  // --------------------------------------------------------------------------------------------------------- sample

  /** « Voir un exemple »: what the sample of this variant costs, before anything is spent. */
  async quote(id: number, variant: unknown): Promise<StudyView> {
    const kind = this.kind(variant)
    const row = this.store.get(id)
    const cost = await this.deps.costInput()
    if (!cost) throw new Error('Les prix des moteurs ne sont pas encore connus : connecte Atelier Cloud une fois pour les lire.')
    if (row.state.channelId === null) throw new Error('Crée d’abord une chaîne : l’exemple se fabrique pour une chaîne (il n’est jamais publié).')
    const doc = variantDoc(row.state, kind, this.deps.reg, cost)
    const s = sampleDoc(doc, this.deps.reg, { checkOption: this.checkOption(doc) })
    if (!s.ok) throw new Error(`Cet exemple ne peut pas se fabriquer : ${s.errors.join(' ; ')}`)
    const credits = sampleQuote(s.doc, this.deps.reg, cost)
    if (!credits) throw new Error('Cet exemple ne peut pas être chiffré.')
    const hold = this.deps.sampler ? await this.deps.sampler.hold({ doc: s.doc, channelId: row.state.channelId, script: row.state.script }) : null
    row.state.quote = { id: randomUUID(), variant: kind, docKey: docKey(s.doc), credits, hold: hold?.credits ?? null, debited: hold?.debited ?? true, seconds: SAMPLE_SECONDS, script: row.state.script, channelId: row.state.channelId }
    this.store.save(id, row.state)
    return this.view(id)
  }

  /** Runs the sample: only with the quote the owner clicked (same variant, same pipeline, same narration). */
  async sample(id: number, variant: unknown, quoteId: unknown): Promise<StudyView> {
    const kind = this.kind(variant)
    const row = this.store.get(id)
    const q = row.state.quote
    if (!q || typeof quoteId !== 'string' || q.id !== quoteId || q.variant !== kind) throw new Error('Regarde d’abord le devis de l’exemple, puis clique « Lancer l’exemple ».')
    if (!this.deps.sampler) throw new Error('Les exemples ne se fabriquent pas ici.')
    const cost = await this.deps.costInput()
    const doc = variantDoc(row.state, kind, this.deps.reg, cost)
    const s = sampleDoc(doc, this.deps.reg, { checkOption: this.checkOption(doc) })
    if (!s.ok || docKey(s.doc) !== q.docKey || q.script !== row.state.script || q.channelId !== row.state.channelId) {
      throw new Error('La pipeline a changé depuis le devis : redemande le devis de l’exemple.')
    }
    // the run's own quote is a worst case it holds from the wallet (and gives back unspent): the owner saw it, it is the cap,
    // so a run quoted above what the owner clicked on does not start
    s.doc.capCredits = Math.max(SAMPLE_CAP_MIN, Math.ceil(q.hold ?? q.credits.max * 3))
    const runId = await this.deps.sampler.start({ doc: s.doc, channelId: q.channelId, script: q.script, title: `Exemple de style — ${doc.name}`.slice(0, 200), credits: q.credits.max })
    row.state.sample = { variant: kind, runId, docKey: docKey(doc), edits: structuredClone(row.state.edits[kind] ?? []), status: 'running', error: null, measures: null, lookFromStyle: true, credits: 0 }
    row.state.quote = null
    this.store.save(id, row.state)
    this.deps.notify?.('production')
    return this.view(id)
  }

  /** Reads a running sample's run; once done, measures its edit plan. */
  async refresh(id: number): Promise<void> {
    const row = this.store.get(id)
    const sample = row.state.sample
    if (!sample || sample.status !== 'running' || !this.deps.sampler) return
    const r = await this.deps.sampler.result(sample.runId)
    if (r.status === 'running') return
    sample.status = r.status
    sample.error = r.error
    sample.credits = r.credits
    if (r.status === 'done') {
      if (!r.plan) {
        sample.status = 'failed'
        sample.error = 'L’exemple est fini mais son plan de montage est introuvable.'
      } else {
        const atSample = variantDoc({ ...row.state, edits: { ...row.state.edits, [sample.variant]: sample.edits } }, sample.variant, this.deps.reg, null)
        const words = row.state.script.split(/\s+/).filter(Boolean).length
        sample.measures = measurePlan(r.plan, sampleFacts(atSample, this.deps.reg, words, r.lookFamily))
        sample.lookFromStyle = r.lookFamily === null
      }
    }
    this.store.save(id, row.state)
    this.deps.notify?.('production')
  }

  /** Applies a gap's edit to the sample's variant (the sample becomes « à refaire »). */
  async applyGap(id: number, index: unknown): Promise<StudyView> {
    const row = this.store.get(id)
    const sample = row.state.sample
    if (!sample || sample.status !== 'done') throw new Error('Il faut d’abord un exemple mesuré.')
    const cost = await this.deps.costInput()
    const gaps = currentGaps(row.state, this.deps.reg, cost)
    const gap = typeof index === 'number' ? gaps[index] : undefined
    if (!gap) throw new Error('Écart inconnu.')
    if (gap.ops.length === 0) throw new Error('Aucun réglage de la pipeline ne corrige cet écart.')
    const doc = variantDoc(row.state, sample.variant, this.deps.reg, cost)
    const r = applyOps(doc, gap.ops, this.deps.reg, { checkOption: this.checkOption(doc) })
    if (!r.ok) throw new Error(`Cette correction n’est pas valide : ${r.errors.map((e) => e.message).join(' ; ')}`)
    row.state.edits[sample.variant] = [...(row.state.edits[sample.variant] ?? []), ...(gap.ops as EditOp[])]
    row.state.quote = null
    this.store.save(id, row.state)
    this.deps.notify?.('production')
    return this.view(id)
  }

  /** « Utiliser cette pipeline »: the variant (with its applied edits) becomes the team's pipeline. */
  async adopt(id: number, variant: unknown): Promise<RecipeDetail> {
    const kind = this.kind(variant)
    const row = this.store.get(id)
    const cost = await this.deps.costInput()
    // « Retravailler » : the picked changes and the gaps' edits become a new version of the same pipeline
    const rw = row.state.rework
    if (rw && this.deps.rework) {
      const base = proposalOf(row.state, this.deps.reg, null).variants[0]
      const picked = base ? differentiatorsOf(row.state, base.doc, this.deps.reg, null).filter((d) => (row.state.picks ?? []).includes(d.id)) : []
      const ops = [...picked.flatMap((d) => d.ops), ...(row.state.edits.faithful ?? [])]
      if (ops.length === 0) throw new Error('Coche au moins un changement à faire sur ta pipeline.')
      const note = [`Retravaillée avec l’agent : ${picked.map((d) => d.title).join(', ') || 'corrections de l’exemple'}.`, row.state.instructions ? `Consignes : ${row.state.instructions}` : ''].filter(Boolean).join(' ')
      return this.deps.rework(rw.id, ops, note.slice(0, 500))
    }
    const doc = variantDoc(row.state, kind, this.deps.reg, cost)
    const said = row.state.summary ?? `Pipeline préparée par l’agent pour reproduire le style de ${row.state.refs.find((r) => r.measures.length > 0)?.title ?? 'tes références'}.`
    // the references' measured profile stays with the pipeline it made (style-japanese), when they were read for real
    const read = row.state.refs.filter((r) => !r.demo).flatMap((r) => r.measures)
    const profile = profileView(read)
    const line = profile ? profileText(profile, read.length) : ''
    // what each inspiration gave, the owner's own instructions and the channels' numbers stay with the pipeline they made
    const view = buildView(row, this.deps.reg, cost)
    const axes = view.inspirations.filter((a) => a.said).map((a) => `- ${a.said}`)
    // the owner's ingredients and what they bring for them (« tes clips, ta photo de profil… »)
    const chosen = view.ingredients
      .filter((i) => i.chosen !== i.current)
      .map((i) => {
        const o = i.options.find((x) => x.id === i.chosen)
        return o ? `- ${i.title} : ${o.title}${o.needs ? ` (à fournir : ${o.needs})` : ''}` : ''
      })
      .filter(Boolean)
    const extra = [chosen.length > 0 ? `Tes ingrédients :\n${chosen.join('\n')}` : '', axes.length > 0 ? `Inspirations :\n${axes.join('\n')}` : '', row.state.instructions ? `Consignes : ${row.state.instructions}` : '', ...view.insights.flatMap((i) => i.lines)].filter(Boolean)
    const summary = [said, line, ...extra].filter(Boolean).join('\n\n')
    return this.deps.adopt({ doc: doc as unknown as RecipeDocument, kind, summary })
  }
}
