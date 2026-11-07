// The engines registry of the Cloud (decision 0021, docs/specs/production-model.md §3): what each engine is, what it
// costs per unit, where it runs. The Cloud publishes it on `GET /v1/engines` (src/shared/cloud-engines.ts); the app reads
// it through `engines.list`, and the estimator (production-11) will read the same grid to price a plan.
//
// PRICES: `costUsdPerUnit` are the PUBLIC prices read on 2026-10-30 / 31 / 11-01 and written in docs/specs/pipeline-avatar.md
// §6 and §9 (production-10 grid: Charlie's providers of 11-01). They are provisional: recheck every one on the provider's own
// page before any real call. `planMonthlyUsd` is a provider plan an engine spends (HeyGen's web plan behind its MCP engine):
// a fixed monthly cost, published apart and never inside a price per unit. Every entry is `draft` until
// a test render has validated it (R3.6) and has only its fake behind it for now (decision 0003).
import type { PriceItem, Usage } from '../../../src/shared/cloud-api.ts'
import type { EngineFamily, EngineInfo } from '../../../src/shared/cloud-engines.ts'
import { PRESENTER_ENGINE_CAN, isPresenterEngine } from '../../../src/shared/presenter-engines.ts'
import { clipLengthFor } from '../../../src/shared/visual-engines.ts'
import { USAGE_ITEM, ceilCredits, type GridMoney } from '../pricing.ts'
import type { ProviderRegistry } from './registry.ts'

export type EngineUnit = EngineInfo['unit']

/** One engine as the Cloud declares it; the published `EngineInfo` adds the live fields (price in credits, health, served). */
export interface EngineDecl {
  id: string
  /** Plain words: the provider and the model. */
  label: string
  family: EngineFamily
  /** The Cloud usage it spends; null for an engine that spends none (local code, the team's LLM). */
  usage: Usage | null
  unit: EngineUnit
  /** Provisional US$ per unit (see the header). 0 for local code and for the LLM (the team backend's cost, 0013 / 0026). */
  costUsdPerUnit: number
  placement: EngineInfo['placement']
  limits: Partial<EngineInfo['limits']>
  needs: string[]
  status: EngineInfo['status']
  /** The provider plan this engine spends, US $ a month (fixed, shown apart from the price per unit); absent: none. */
  planMonthlyUsd?: number
}

const draft = (d: Omit<EngineDecl, 'status' | 'limits' | 'needs' | 'placement'> & Partial<Pick<EngineDecl, 'limits' | 'needs' | 'placement'>>): EngineDecl => ({
  placement: 'api',
  limits: {},
  needs: [],
  ...d,
  status: 'draft'
})

/** A presenter engine; its longest call comes from the engines table the engine side shares (src/shared/presenter-engines.ts). */
const presenter = (id: string, label: string, costUsdPerUnit: number, extra: Partial<Pick<EngineDecl, 'placement' | 'needs' | 'planMonthlyUsd'>> = {}): EngineDecl => {
  const full = `presenter:${id}`
  return draft({
    id: full,
    label,
    family: 'presenter',
    usage: 'talkingAvatar',
    unit: 'second',
    costUsdPerUnit,
    limits: isPresenterEngine(full) ? { maxSecondsPerCall: PRESENTER_ENGINE_CAN[full].maxCallS } : {},
    ...extra,
    needs: [...(extra.needs ?? []), 'reference-image']
  })
}

const image = (id: string, label: string, costUsdPerUnit: number): EngineDecl =>
  draft({ id: `image:${id}`, label, family: 'image', usage: 'generateImage', unit: 'image', costUsdPerUnit })

/** A clip engine billed per call (`clip`, at most 8 s) or per second of video. */
const clip = (id: string, label: string, costUsdPerUnit: number, unit: 'clip' | 'second'): EngineDecl =>
  draft({
    id: `clip:${id}`,
    label,
    family: 'clip',
    usage: 'generateVideo',
    unit,
    costUsdPerUnit,
    limits: unit === 'clip' ? { maxSecondsPerCall: 8 } : {}
  })

const voice = (id: string, label: string, costUsdPerUnit: number): EngineDecl =>
  draft({ id: `voice:${id}`, label, family: 'voice', usage: 'synthesize', unit: 'kchars', costUsdPerUnit })

/** The plan assumed until config.json says (Pro, the coordinator's advice of 11-01); `withHeygenPlan` sets the founder's. */
const HEYGEN_PLANS_DEFAULT_USD = 49

export const FAKE_ENGINES: readonly EngineDecl[] = [
  // HeyGen Avatar IV Photo Look on the founder's HeyGen Business plan through HeyGen's MCP server (OAuth sign-in, no key): 16
  // credits a minute at about 0.05 USD a credit; the plan (Pro 49 or Business 149 USD a month, heygen.com/pricing, read 2026-11-01)
  presenter('heygen-mcp', 'HeyGen Avatar IV (forfait HeyGen)', (16 * 0.05) / 60, { needs: ['signin'], planMonthlyUsd: HEYGEN_PLANS_DEFAULT_USD }),
  presenter('heygen-avatar4', 'HeyGen Avatar IV (API)', 0.05),
  presenter('hedra-c3', 'Hedra Character-3', 0.025),
  presenter('kling-avatar2-std', 'Kling Avatar 2 (standard)', 0.056),
  presenter('infinitetalk-fast', 'InfiniteTalk (hébergé, rapide)', 0.015),
  // ≈ 0.005 $/s is an estimate: it needs a benchmark on the rented GPU (decision 0015 allows 20 $).
  presenter('infinitetalk-gpu', 'InfiniteTalk (GPU loué)', 0.005, { placement: 'gpu' }),
  presenter('infinitetalk-std', 'InfiniteTalk (hébergé, standard 720p)', 0.06),
  presenter('pruna-avatar', 'Pruna P-Video Avatar (WaveSpeed, 720p)', 0.025),
  presenter('kling-avatar-kie', 'Kling AI Avatar standard (Kie.ai)', 0.04),

  image('gpt-image-25-low', 'GPT Image 2.5 (qualité basse)', 0.0059),
  image('gpt-image-25-medium', 'GPT Image 2.5 (qualité moyenne)', 0.0132),
  image('gpt-image-25-high', 'GPT Image 2.5 (haute qualité)', 0.0527),
  // the same model on fal (secours 1, same token price: 0.0060 / 0.0133 USD for 1024², fal.ai/gpt-image-2.5, read 2026-11-01)
  image('gpt-image-25-fal-low', 'GPT Image 2.5 sur fal (basse)', 0.006),
  image('gpt-image-25-fal-medium', 'GPT Image 2.5 sur fal (moyenne)', 0.0133),
  // and on Kie.ai (secours 2): 6 credits = 0.03 USD a 1K picture (kie.ai/gpt-image-2-5)
  image('gpt-image-25-kie', 'GPT Image 2.5 sur Kie.ai', 0.03),
  image('flux-schnell', 'FLUX schnell', 0.003),
  image('nano-banana-2', 'Nano Banana 2', 0.067),
  // unifically.com (vrais-tests): the « from » prices of unifically.com/pricing, read 2026-11-01; each real call is billed what
  // unifically's dry run quotes for it (unifically.ts), these lines are the estimate before
  image('flux3-klein', 'FLUX 3 Klein (UnificAlly)', 0.0072),
  image('z-image-turbo', 'Z-Image Turbo (UnificAlly)', 0.0135),
  image('nano-banana-2-lite', 'Nano Banana 2 Lite (UnificAlly)', 0.02),
  image('nano-banana-21', 'Nano Banana 2.1 (UnificAlly)', 0.02),
  image('seedream-50-lite', 'Seedream 5.0 Lite (UnificAlly)', 0.028),

  clip('veo31-lite-relaxed', 'Veo 3.1 Lite (file lente)', 0.075, 'clip'),
  clip('veo31-lite-vertex', 'Veo 3.1 Lite (officiel, sans audio)', 0.03, 'second'),
  clip('veo31-lite', 'Veo 3.1 Lite (file rapide)', 0.15, 'clip'),
  clip('minimax-h3-lite', 'MiniMax Hailuo 3 Lite', 0.03, 'second'),
  clip('wan22', 'Wan 2.2 (480p)', 0.04, 'second'),
  clip('veo31-fast', 'Veo 3.1 Fast', 0.3, 'clip'),
  clip('veo31-fast-1080p', 'Veo 3.1 Fast (1080p)', 0.325, 'clip'),
  // Kie.ai's Veo 3.1 Lite, 720p: 30 credits = 0.15 USD a clip (1080p 0.175; kie.ai/veo-3-1, read 2026-11-01)
  clip('veo31-lite-kie', 'Veo 3.1 Lite (Kie.ai)', 0.15, 'clip'),
  // unifically.com (vrais-tests), per second of silent video, the « from » prices of unifically.com/pricing (2026-11-01)
  // measured by unifically's dry run on the first real calls (vrais-tests): 0.05 $ for 3 s, 0.065 $ for 4 s, 0.095 $ for 6 s
  clip('grok-imagine-15-lite', 'Grok Imagine 1.5 Lite (UnificAlly, 720p)', 0.01625, 'second'),
  clip('seedance-20-mini-480p', 'SeeDance 2.0 Mini (UnificAlly, 480p)', 0.022, 'second'),
  clip('seedance-20-mini', 'SeeDance 2.0 Mini (UnificAlly, 720p)', 0.044, 'second'),
  clip('seedance-15-pro', 'SeeDance 1.5 Pro (UnificAlly, 720p)', 0.015, 'second'),
  clip('hailuo-23-fast', 'Hailuo 2.3 Fast (UnificAlly, 768p)', 0.0253, 'second'),
  clip('kling-25-turbo', 'Kling 2.5 Turbo (UnificAlly, 720p)', 0.0378, 'second'),

  voice('elevenlabs-v2', 'ElevenLabs Multilingual v2', 0.08),
  voice('minimax-28-hd', 'MiniMax Speech 2.8 HD', 0.1),
  voice('fish-s2', 'Fish Audio S2', 0.015),
  // PLACEHOLDER, not a read price: Charlie chose ai33.pro himself (10-31); it is now « OpenSpeaker » and sells 1 M credits for
  // USD 5 but does not publish credits per character (openspeaker.ai/pricing, read 2026-11-01). Its adapter bills each task's
  // own `credit_cost`; replace this line once the dashboard is read (docs/PROVIDERS.md §6, decision 0029).
  // PLACEHOLDER (production-10): 0.0067 USD per 1 000 characters = 0.006 USD a minute of French narration, Charlie's figure of
  // 11-01 « to verify » on the dashboard; the cheapest pack reads as about 1 700 minutes for 5 USD (≈ 0.003 USD a minute).
  voice('ai33', 'ai33.pro (OpenSpeaker)', 0.0067),

  // The LLM cost is the team backend's (Claude Code on the user's subscription or the API key), not the Cloud's: decisions
  // 0013 and 0026. They are listed so a recipe can name them; the Cloud bills nothing for them (cost 0 here).
  draft({ id: 'llm:anthropic-sonnet-55', label: 'Claude Sonnet 5.5', family: 'llm', usage: null, unit: 'mtokens', costUsdPerUnit: 0 }),
  draft({ id: 'llm:anthropic-haiku-55', label: 'Claude Haiku 5.5', family: 'llm', usage: null, unit: 'mtokens', costUsdPerUnit: 0 }),

  draft({ id: 'music:library', label: 'Bibliothèque de musiques', family: 'music', usage: null, unit: 'minute', costUsdPerUnit: 0, placement: 'local' }),
  draft({ id: 'music:elevenlabs-music', label: 'ElevenLabs Music', family: 'music', usage: null, unit: 'minute', costUsdPerUnit: 0.15 })
]

/** HeyGen's web plans (heygen.com/pricing, read 2026-11-01): the monthly fee of the plan the founder has (config.json `heygen.plan`). */
export const HEYGEN_PLANS = { pro: 49, business: 149 } as const
export type HeygenPlan = keyof typeof HEYGEN_PLANS

/** The declarations with the HeyGen MCP engine carrying the fee of the founder's plan. */
export function withHeygenPlan(decls: readonly EngineDecl[], plan: HeygenPlan): EngineDecl[] {
  return decls.map((d) => (d.id === 'presenter:heygen-mcp' ? { ...d, planMonthlyUsd: HEYGEN_PLANS[plan] } : d))
}

/** The margin used when the engine's grid item is not priced by a percent margin, or the engine has no usage (§4.4 far tier). */
const DEFAULT_MARGIN_PCT = 25

/** Credits per unit of one engine on a grid: cost × usd→eur × (1 + overhead) × (1 + margin) ÷ credit value, the global
 *  price multiplier standing for (1 + margin) when set (decision 0040); 0 without a grid. */
export function engineCreditsPerUnit(decl: EngineDecl, grid: (GridMoney & { items: PriceItem[] }) | null, internal = false): number {
  if (!grid || !(grid.creditValueEur > 0)) return 0
  const item = decl.usage ? grid.items.find((i) => i.item === USAGE_ITEM[decl.usage as Usage]) : undefined
  const marginPct = item && item.pricing.mode === 'percent' ? item.pricing.marginPct : DEFAULT_MARGIN_PCT
  // an internal team pays the cost, as `priceLine` does
  const factor = internal ? 1 : (grid.priceMultiplier ?? 1 + marginPct / 100)
  const credits = (decl.costUsdPerUnit * grid.usdToEur * (1 + grid.overheadPct / 100) * factor) / grid.creditValueEur
  return Math.round(credits * 1e6) / 1e6
}

/** The usages whose input names an engine and whose grid line is one quantity of that engine's unit. */
const ENGINE_PRICED_USAGES: ReadonlySet<Usage> = new Set<Usage>(['synthesize', 'generateImage', 'generateVideo', 'talkingAvatar'])

/**
 * What one usage costs in credits on the ENGINE its input names, from the engine's published price (`GET /v1/engines`): a
 * quote, an estimate and so a job's hold read this instead of the grid line's worst case (issue #89, reserve-devis). `quantity`
 * is the grid line's own (characters, images, seconds). Null when the engine is unknown, has another usage, or its unit does
 * not convert (the grid line then prices it). Whole credits, at least 1; an engine that costs nothing costs nothing.
 */
export function engineLineCredits(
  usage: Usage,
  engineId: string,
  quantity: number,
  grid: (GridMoney & { items: PriceItem[] }) | null,
  internal = false,
  /** The dated dollar rate a capture converts at (finance-settings fxRate): the hold never converts below it. */
  eurPerUsd?: number
): number | null {
  if (grid && eurPerUsd !== undefined && eurPerUsd > grid.usdToEur) grid = { ...grid, usdToEur: eurPerUsd }
  const decl = FAKE_ENGINES.find((e) => e.id === engineId)
  if (!decl || decl.usage !== usage || !ENGINE_PRICED_USAGES.has(usage) || !grid || !(quantity >= 0) || !Number.isFinite(quantity)) return null
  let units: number
  switch (decl.unit) {
    case 'second':
      // a per-second clip engine only makes fixed lengths and bills the one it makes (6 s for 1 s asked on Hailuo): hold that
      units = decl.family === 'clip' && quantity > 0 ? clipLengthFor(engineId, quantity) : quantity
      break
    case 'image':
      units = quantity
      break
    case 'kchars':
      units = quantity / 1000
      break
    case 'clip':
    case 'call': {
      const per = decl.limits.maxSecondsPerCall
      units = per && per > 0 ? Math.max(1, Math.ceil(quantity / per - 1e-9)) : 1
      break
    }
    default:
      return null
  }
  const exact = units * engineCreditsPerUnit(decl, grid, internal)
  return exact > 0 ? Math.max(1, ceilCredits(exact)) : 0
}

/**
 * What `GET /v1/engines` answers: the declarations, with who serves each one now (the registry's answer for its usage),
 * its health and its price in credits on the current grid.
 */
export function publishEngines(
  decls: readonly EngineDecl[],
  registry: Pick<ProviderRegistry, 'resolve'> & Partial<Pick<ProviderRegistry, 'resolveFor'>>,
  grid: (GridMoney & { items: PriceItem[] }) | null,
  down: ReadonlySet<string> = new Set()
): EngineInfo[] {
  return decls.map((d) => ({
    id: d.id,
    label: d.label,
    family: d.family,
    usage: d.usage,
    unit: d.unit,
    priceCredits: engineCreditsPerUnit(d, grid),
    placement: d.placement,
    limits: {
      maxSecondsPerCall: d.limits.maxSecondsPerCall ?? null,
      aspects: d.limits.aspects ?? [],
      languages: d.limits.languages ?? []
    },
    needs: [...d.needs],
    planMonthlyUsd: d.planMonthlyUsd ?? null,
    // « down » while its key or access is refused on a real call (key-health.ts); else « ok »
    health: down.has(d.id) ? 'down' : 'ok',
    status: d.status,
    // issue #88: an engine is served for real when a job naming it would run on its real adapter (paidCalls on, listed in
    // realEngines, its key in the vault), or when it is the usage's configured real provider
    served: d.usage ? servedStatus(d, registry) : d.placement === 'local' ? 'real' : 'demo'
  }))
}

function servedStatus(d: EngineDecl, registry: Pick<ProviderRegistry, 'resolve'> & Partial<Pick<ProviderRegistry, 'resolveFor'>>): 'real' | 'demo' {
  const usage = d.usage as Usage
  if (registry.resolveFor?.(usage, { engine: d.id }).status === 'real') return 'real'
  const plain = registry.resolve(usage)
  return plain.status === 'real' && plain.adapter.id === d.id ? 'real' : 'demo'
}
