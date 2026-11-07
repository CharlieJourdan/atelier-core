// The estimate and the fit % of pipelines in the app (decision 0023): the pure estimator and fit of the engine, priced with
// the Cloud's engines (read at most every few minutes, kept in settings for offline use) and the model prices, on the
// team's LLM backend (Claude Code = « mon abonnement », the API key = « ma clé API »; « crédits Atelier » once it ships),
// and compared with the channel's own videos as the eyes measured them.
import type { JsonValue } from '../../../shared/api'
import type { EngineInfo } from '../../../shared/cloud-engines'
import type { EstimateCardsView, FitView, PipelineCardEstimate, PipelineEstimateView } from '../../../shared/estimates'
import type { RecipeDocument } from '../../../shared/recipes'
import { estimateCost, optionCostDeltas, type CostEstimate, type CostInput, type LlmBackend, type PriceBook } from '../../../engine/technologies/cost'
import { fitOf, predictProfile, type FitContext, type VideoMeasure } from '../../../engine/technologies/fit'
import { fitGaps } from '../../../engine/technologies/fit-gaps'
import { parseRecipe, type RecipeDoc } from '../../../engine/technologies/recipe'
import { t } from '../../../shared/fr'
import type { Db } from '../../db'
import { EyesStore } from '../../eyes/store'
import type { PricesStore } from '../../llm/prices'
import type { RoutesStore } from '../../llm/routes'
import type { SettingsStore } from '../../settings'
import { RecipeStore } from '../recipes'
import { RENDER_TIME_LENGTHS, type RenderTimeView } from '../../../shared/render-times'
import { CREDIT_EUR, creditsBook, ENGINES_CACHE_KEY, readEnginesCache } from './book'
import { renderTime } from './duration'
import { channelMeasures } from './measure'

/** How long the Cloud's engines list is reused before it is read again. */
const REFRESH_MS = 5 * 60_000
const EUR_PER_USD = 0.92

export interface EstimatesDeps {
  db: Db
  settings: SettingsStore
  prices: PricesStore
  routes: RoutesStore
  /** The Cloud's engines now, or null (signed out, offline). */
  liveEngines: () => Promise<EngineInfo[] | null>
  now?: () => Date
}

interface Priced {
  book: PriceBook
  prices: { at: string; source: 'live' | 'cache' }
  /** Engine id → its label (for the fixed monthly plans). */
  labels: Record<string, string>
}

const EMPTY_RANGE = { min: 0, avg: 0, max: 0 }
const labelsOf = (engines: readonly EngineInfo[]): Record<string, string> => Object.fromEntries(engines.map((e) => [e.id, e.label]))

export class EstimatesService {
  private readonly recipes: RecipeStore
  private readonly eyes: EyesStore
  private fetched: { atMs: number; engines: EngineInfo[] } | null = null
  /** When the Cloud was last asked (answered or not): a Cloud that does not answer is asked again only after a while. */
  private askedMs: number | null = null

  constructor(private readonly deps: EstimatesDeps) {
    this.recipes = new RecipeStore(deps.db)
    this.eyes = new EyesStore(deps.db)
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  /** The book: the Cloud's engines (fresh, else the kept copy) and the model prices; null when no price was ever read. */
  private async priced(): Promise<Priced | null> {
    const nowMs = this.now().getTime()
    if (this.askedMs === null || nowMs - this.askedMs > REFRESH_MS) {
      this.askedMs = nowMs
      const live = await this.deps.liveEngines().catch(() => null)
      if (live && live.length > 0) {
        this.fetched = { atMs: nowMs, engines: live }
        this.deps.settings.set(ENGINES_CACHE_KEY, { at: this.now().toISOString(), engines: live as unknown as JsonValue })
      }
    }
    const models = this.deps.prices.list()
    if (this.fetched && nowMs - this.fetched.atMs <= REFRESH_MS) {
      return { book: creditsBook(this.fetched.engines, models), prices: { at: new Date(this.fetched.atMs).toISOString(), source: 'live' }, labels: labelsOf(this.fetched.engines) }
    }
    const cache = readEnginesCache(this.deps.settings.get(ENGINES_CACHE_KEY))
    return cache ? { book: creditsBook(cache.engines, models), prices: { at: cache.at, source: 'cache' }, labels: labelsOf(cache.engines) } : null
  }

  /** The team's LLM backend: Claude Code is « mon abonnement », the Anthropic key « ma clé API ». */
  backend(): LlmBackend {
    return this.deps.routes.defaultProvider() === 'claude-code' ? 'subscription' : 'api-key'
  }

  /** The book and the team's backend the agent prices its proposals with (production-12); null: no price ever read. */
  async costInput(): Promise<CostInput | null> {
    const priced = await this.priced()
    return priced ? { book: priced.book, backend: this.backend() } : null
  }

  /** The channel's own measured videos and what they say about its sponsor. */
  measured(channelId: number): { videos: VideoMeasure[]; demo: boolean; ctx: FitContext } {
    const { videos, demo } = channelMeasures(this.eyes.analyses(channelId))
    const said = videos.map((v) => v.sponsor).filter((s): s is boolean => typeof s === 'boolean')
    return { videos, demo, ctx: { channelHasSponsor: said.length === 0 ? null : said.includes(true) } }
  }

  /** The fit to a channel; with `priced`, its gaps and what closing each costs (the cards need only the percent). */
  private fit(doc: RecipeDoc, channelId: number | null | undefined, priced: Priced | null, withGaps = true): FitView {
    if (channelId === null || channelId === undefined) return { state: 'no-channel' }
    const { videos, demo, ctx } = this.measured(channelId)
    const predicted = predictProfile(doc, this.recipes.registry, ctx)
    if (!predicted) return { state: 'nothing-measured', channelId, videos: videos.length }
    const r = fitOf(videos, predicted)
    if (!r.ok) return { state: r.reason, channelId, videos: r.videos }
    const gaps = !withGaps ? [] : fitGaps(doc, videos, this.recipes.registry, ctx, priced ? { book: priced.book, backend: this.backend() } : undefined)
    return { state: 'ok', channelId, percent: r.percent, videos: r.videos, demo, dimensions: r.dimensions, gaps }
  }

  /** The render times of a document: its own length first, then the usual lengths (none when the options do not apply). */
  private renderTimes(doc: RecipeDoc): RenderTimeView[] {
    const lengths = [doc.format.minutes, ...RENDER_TIME_LENGTHS.filter((m) => m !== doc.format.minutes)]
    return lengths.map((m) => renderTime(doc, this.recipes.registry, m)).filter((r): r is RenderTimeView => r !== null)
  }

  private estimate(doc: RecipeDoc, book: PriceBook): CostEstimate | null {
    const r = estimateCost(doc, this.recipes.registry, { book, backend: this.backend() })
    return r.ok ? r.estimate : null
  }

  /** The estimate of a document as edited, and its fit to a channel. */
  async pipeline(raw: RecipeDocument, channelId?: number | null): Promise<PipelineEstimateView> {
    const parsed = parseRecipe(raw)
    const priced = await this.priced()
    const empty: PipelineEstimateView = {
      available: false,
      reason: null,
      prices: priced?.prices ?? null,
      creditEur: CREDIT_EUR,
      minutes: 0,
      perMinute: EMPTY_RANGE,
      perVideo: EMPTY_RANGE,
      lines: [],
      assumedMix: false,
      llm: { backend: this.backend(), tasks: [], onCreditsPerVideo: 0, apiKeyEurPerVideo: 0, included: false },
      optionDeltas: {},
      fixedMonthly: [],
      renderTimes: [],
      fit: { state: 'no-channel' }
    }
    if (!parsed.success) return { ...empty, reason: t('est.err.invalid') }
    const doc = parsed.data
    const fit = this.fit(doc, channelId, priced)
    const renderTimes = this.renderTimes(doc)
    if (!priced) return { ...empty, reason: t('est.err.noPrices'), fit, renderTimes }
    const e = this.estimate(doc, priced.book)
    if (!e) return { ...empty, reason: t('est.err.invalid'), fit, renderTimes }
    const input = { book: priced.book, backend: this.backend() }
    return {
      available: true,
      reason: null,
      prices: priced.prices,
      creditEur: CREDIT_EUR,
      minutes: e.minutes,
      perMinute: e.perMinute,
      perVideo: e.perVideo,
      lines: e.lines,
      assumedMix: e.assumedMix,
      llm: {
        backend: e.llm.backend,
        tasks: e.llm.tasks,
        onCreditsPerVideo: e.llm.onCreditsPerMinute.avg * e.minutes,
        apiKeyEurPerVideo: e.llm.usdPerMinute.avg * e.minutes * EUR_PER_USD,
        included: e.llm.included
      },
      optionDeltas: optionCostDeltas(doc, this.recipes.registry, input),
      fixedMonthly: e.fixedMonthly.map((f) => ({ ...f, label: priced.labels[f.engine] ?? f.engine })),
      renderTimes,
      fit
    }
  }

  /** Credits per minute and fit of the base pipelines and of the team's pipelines (archived ones left out). */
  async cards(channelId?: number | null): Promise<EstimateCardsView> {
    const priced = await this.priced()
    const card = (doc: RecipeDoc): PipelineCardEstimate | null => {
      const e = priced ? this.estimate(doc, priced.book) : null
      const f = this.fit(doc, channelId, null, false)
      const time = renderTime(doc, this.recipes.registry, doc.format.minutes)
      if (!e && f.state !== 'ok' && !time) return null
      return { perMinute: e?.perMinute ?? EMPTY_RANGE, ...(e ? { perVideo: e.perVideo } : {}), fit: f.state === 'ok' ? f.percent : null, renderTime: time }
    }
    const bases: Record<string, PipelineCardEstimate> = {}
    for (const b of this.recipes.bases()) {
      // as a pipeline made from the base (`fromBase`): its default options apply (the clips' engine and shots per generation)
      const c = card({ ...(b.doc as RecipeDoc), base: b.id })
      if (c) bases[b.id] = c
    }
    const recipes: Record<number, PipelineCardEstimate> = {}
    for (const r of this.recipes.list().filter((x) => !x.archived)) {
      const parsed = parseRecipe(this.recipes.get(r.id).doc)
      const c = parsed.success ? card(parsed.data) : null
      if (c) recipes[r.id] = c
    }
    return { available: priced !== null, reason: priced ? null : t('est.err.noPrices'), creditEur: CREDIT_EUR, bases, recipes }
  }
}
