// The engines registry (decision 0021, docs/specs/production-model.md §3): an engine is a provider + model + technical
// settings that does a brick's work. It lives in Atelier Cloud (adapter + usage + price line + fake, decision 0003); the
// Cloud publishes what it serves through ONE route, `GET /v1/engines`, and the app reads it through the API method
// `engines.list`. Engines of one family share the brick's contract, so they never collide (R3.2).
// Self-contained (zod only, no relative import): the Cloud imports this file with its `.ts` extension, the app without.
import { z } from 'zod'

/** The brick families an engine serves. A technology declares the family it runs on (`engineFamily`). */
export const ENGINE_FAMILIES = ['presenter', 'image', 'clip', 'voice', 'llm', 'music'] as const
export type EngineFamily = (typeof ENGINE_FAMILIES)[number]

/**
 * Families whose engine must not change in the middle of a video (R3.4): a voice or a face looks different on another
 * engine, so their fallback applies to the WHOLE video before it starts. Stills, clips, music and text fall back per item.
 */
export const VIDEO_WIDE_FAMILIES: readonly EngineFamily[] = ['voice', 'presenter']
export const fallbackScope = (family: EngineFamily): 'video' | 'item' => (VIDEO_WIDE_FAMILIES.includes(family) ? 'video' : 'item')

/** `<family>:<provider>-<model>[-variant]`, e.g. `presenter:heygen-avatar4`, `clip:veo31-lite-relaxed` (R3.1). */
export const ENGINE_ID_PATTERN = `^(?:${ENGINE_FAMILIES.join('|')}):[a-z0-9]+(?:[.-][a-z0-9]+)*$`
export const ENGINE_ID = new RegExp(ENGINE_ID_PATTERN)
/** The family an engine id names (its prefix), or null when it is not an engine id. */
export function engineFamilyOf(id: string): EngineFamily | null {
  return ENGINE_ID.test(id) ? (id.slice(0, id.indexOf(':')) as EngineFamily) : null
}

/**
 * The engine a brick runs on when its pipeline names none (`engine: null`), and its fallbacks: Charlie's providers of
 * 2026-11-01 (production-10, docs/specs/pipeline-avatar.md §6), principal first.
 * The estimator prices a brick left open with these; the Cloud serves the same defaults.
 */
export const DEFAULT_ENGINES: Readonly<Record<EngineFamily, { engine: string; fallbacks: readonly string[] }>> = {
  presenter: { engine: 'presenter:heygen-mcp', fallbacks: ['presenter:heygen-avatar4', 'presenter:pruna-avatar', 'presenter:kling-avatar-kie', 'presenter:infinitetalk-gpu'] },
  image: { engine: 'image:gpt-image-25-low', fallbacks: ['image:gpt-image-25-fal-low', 'image:gpt-image-25-kie'] },
  // vrais-tests (01/11, research note model-benchmark-2026-11 (old repository)): Grok Imagine 1.5 Lite, twice as fast and as cheap per usable shot,
  // is the first fallback of the relaxed queue (Vertex and Kie.ai have no key yet)
  clip: { engine: 'clip:veo31-lite-relaxed', fallbacks: ['clip:grok-imagine-15-lite', 'clip:veo31-lite-vertex', 'clip:veo31-lite-kie'] },
  voice: { engine: 'voice:ai33', fallbacks: ['voice:minimax-28-hd'] },
  llm: { engine: 'llm:anthropic-sonnet-55', fallbacks: [] },
  music: { engine: 'music:library', fallbacks: [] }
}

/** What one unit of work is, for the price (R3.1). */
export const ENGINE_UNITS = ['second', 'clip', 'image', 'kchars', 'mtokens', 'minute', 'call'] as const
/** Where it runs (R3.5): a hosted API, a rented GPU, the team computer, or local deterministic code. */
export const ENGINE_PLACEMENTS = ['api', 'gpu', 'team-pc', 'local'] as const
export const ENGINE_HEALTH = ['ok', 'slow', 'down'] as const
export const ENGINE_STATUSES = ['draft', 'validated'] as const

export const EngineInfoSchema = z.object({
  id: z.string().regex(ENGINE_ID),
  /** What the user sees (provider and model, in plain words). */
  label: z.string().min(1).max(120),
  family: z.enum(ENGINE_FAMILIES),
  /** The Cloud usage it spends (`talkingAvatar`…); null for an engine that spends none (local code, the team's LLM). */
  usage: z.string().nullable(),
  unit: z.enum(ENGINE_UNITS),
  /**
   * ESTIMATED credits per unit (may be fractional: per 1 000 characters, per second): the engine's own provider cost
   * with its usage's margin on the current grid. Billing still prices the usage's grid line until the grid has one line
   * per engine (production-11); show it as « ≈ ».
   */
  priceCredits: z.number().min(0),
  placement: z.enum(ENGINE_PLACEMENTS),
  limits: z.object({
    maxSecondsPerCall: z.number().positive().nullable().default(null),
    aspects: z.array(z.enum(['16:9', '9:16', '1:1'])).default([]),
    languages: z.array(z.string().min(2).max(10)).default([])
  }),
  /** What it needs before it can run: `registration` (a face registered with the provider), `signin` (an OAuth sign-in of the
   *  founder's account, HeyGen's MCP), `reference-image`… */
  needs: z.array(z.string().min(1).max(40)).default([]),
  /** A provider plan the engine spends (US $ a month, HeyGen's web plan): a fixed cost, never in `priceCredits`. */
  planMonthlyUsd: z.number().min(0).nullable().default(null),
  health: z.enum(ENGINE_HEALTH),
  status: z.enum(ENGINE_STATUSES),
  /** Who serves it now: its real adapter, or the fake (demo) while paid calls are off or the key is missing. */
  served: z.enum(['real', 'demo'])
})
export type EngineInfo = z.infer<typeof EngineInfoSchema>

export const EnginesResponse = z.object({ engines: z.array(EngineInfoSchema) })
export type EnginesResponse = z.infer<typeof EnginesResponse>

/** The one route the Cloud serves the registry on (registered beside CLOUD_ROUTES, same `route()` helper). */
export const ENGINES_ROUTE = { method: 'GET', path: '/v1/engines', auth: 'user', response: EnginesResponse } as const

/** What the app's `engines.list` answers: the Cloud's registry, or why it is not available (signed out, offline). */
export interface EnginesView {
  available: boolean
  /** A French reason when `available` is false. */
  reason: string | null
  engines: EngineInfo[]
}
