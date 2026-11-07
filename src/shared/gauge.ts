// The reproducibility gauge (PLAN-V2-PRODUCTION §2.3): how well our node catalogue can remake a FORMAT (not one video),
// as a note from 0 to 100. Pure and deterministic: same profile and state, same result. Hand-computed values for the
// three reference channels are in tests/unit/z1-analysis-gauge.test.ts.
//
//   V  = k × Σ(share × capability) + (1 − k) × 0.5      (k = the analyst's confidence: low confidence pulls V to the middle)
//   G  = round(100 × L × (0.55 V + 0.15 Vo + 0.15 S + 0.15 M))
//   L  = 0.5 when the format relies on clips of films, TV or other channels (clip share ≥ 20 %), 1 otherwise
//
// Inputs (camera, gameplay): unanswered → the component counts at its "without" capability (0); answered yes → its
// "with" capability; answered no → replaced by the default replacement of the budget mode (§2.7: avatar in Qualité max,
// animation in Usage max), counted at REPLACEMENT_FIDELITY × the replacement's capability (the video gets made, but it no
// longer looks like the example). An explicit replacement (Analyste chat) overrides the default.

export const BUDGET_MODE_IDS = ['qualite_max', 'usage_max'] as const
export type GaugeMode = (typeof BUDGET_MODE_IDS)[number]

export const COMPONENT_IDS = [
  'stock',
  'text_anim',
  'ai_image',
  'ai_video',
  'avatar',
  'face_camera',
  'gameplay',
  'cartoon',
  'three_d',
  'infographic',
  'map',
  'clip'
] as const
export type ComponentId = (typeof COMPONENT_IDS)[number]

export const INPUT_IDS = ['camera', 'gameplay'] as const
export type InputId = (typeof INPUT_IDS)[number]

export interface Capability {
  qualite_max: number
  usage_max: number
  /** Set for components made from the user's own footage: the capability once they provide it. */
  input?: InputId
  withInput?: number
}

export type CapabilityMatrix = Readonly<Record<ComponentId, Capability>>

/** Bumped whenever a value changes (a node got better): stored with every gauge. */
export const CAPABILITY_MATRIX_VERSION = 1

/**
 * Starting values of §2.3. `infographic` and `map` (listed by the video analyst, not in the §2.3 table) are made by the
 * same animation kit as text animations: 0.9. `clip` (extracts of films, TV, other channels) cannot be remade legally: 0.
 */
export const CAPABILITY_MATRIX: CapabilityMatrix = {
  stock: { qualite_max: 0.9, usage_max: 0.9 },
  text_anim: { qualite_max: 0.9, usage_max: 0.9 },
  ai_image: { qualite_max: 0.9, usage_max: 0.9 },
  ai_video: { qualite_max: 0.75, usage_max: 0.4 },
  avatar: { qualite_max: 0.8, usage_max: 0.5 },
  face_camera: { qualite_max: 0, usage_max: 0, input: 'camera', withInput: 0.9 },
  gameplay: { qualite_max: 0, usage_max: 0, input: 'gameplay', withInput: 0.95 },
  cartoon: { qualite_max: 0.4, usage_max: 0.2 },
  three_d: { qualite_max: 0.3, usage_max: 0.1 },
  infographic: { qualite_max: 0.9, usage_max: 0.9 },
  map: { qualite_max: 0.9, usage_max: 0.9 },
  clip: { qualite_max: 0, usage_max: 0 }
}

/** What a component made from the user's footage becomes when they answer "no" (§2.7). */
export const DEFAULT_REPLACEMENT: Readonly<Record<InputId, Record<GaugeMode, ComponentId>>> = {
  camera: { qualite_max: 'avatar', usage_max: 'text_anim' },
  gameplay: { qualite_max: 'ai_video', usage_max: 'stock' }
}

export const REPLACEMENT_FIDELITY = 0.5
/** The format "relies on clips" from this share of its time (L ≤ 0.5). */
export const CLIP_RELIANCE_SHARE = 0.2
export const CLIP_LIMIT = 0.5
export const WEIGHTS = { visuals: 0.55, voice: 0.15, script: 0.15, edit: 0.15 } as const
export const CONFIDENCE_FACTOR = { high: 1, medium: 0.85, low: 0.7 } as const
export type Confidence = keyof typeof CONFIDENCE_FACTOR
const CONF_ORDER: readonly Confidence[] = ['low', 'medium', 'high']

export const TIERS = ['reproductible', 'adaptations', 'partiel', 'special'] as const
export type Tier = (typeof TIERS)[number]

export function tierOf(score: number): Tier {
  if (score >= 80) return 'reproductible'
  if (score >= 50) return 'adaptations'
  if (score >= 30) return 'partiel'
  return 'special'
}

/** Colour of a time-band segment from its effective capability. */
export type SegmentTone = 'green' | 'amber' | 'red'
export function segmentTone(capability: number): SegmentTone {
  if (capability >= 0.75) return 'green'
  if (capability >= 0.4) return 'amber'
  return 'red'
}

export interface GaugeProfile {
  /** Share of the example video's time per visual component (sums to 1). */
  components: { component: ComponentId; share: number }[]
  /** Voice note Vo: 0.95 synthetic voice, 0.7 very typed human narrator. */
  voice: number
  /** Script note S: 0.9 by default, lower for interviews or on-site reporting. */
  script: number
  /** Edit note M: lower when the pace or sound effects exceed what our render does. */
  edit: number
  analystConfidence: Confidence
}

export interface GaugeState {
  mode: GaugeMode
  answers: Partial<Record<InputId, boolean>>
  /** Explicit replacements chosen in the Analyste chat (component → what makes it instead). */
  replace: Partial<Record<ComponentId, ComponentId>>
}

export type Adaptation =
  | { kind: 'input'; input: InputId; score: number }
  | { kind: 'mode'; mode: GaugeMode; score: number }
  | { kind: 'replace'; component: ComponentId; by: ComponentId; score: number }

export interface InputEffect {
  input: InputId
  /** Score once the user provides the footage. */
  with: number
  /** Score when they do not (the default replacement). */
  without: number
}

export interface GaugeResult {
  matrixVersion: number
  mode: GaugeMode
  score: number
  tier: Tier
  confidence: Confidence
  perMode: Record<GaugeMode, number>
  /** The four notes and the clip limit, unrounded, for the explanation panel. */
  v: number
  vo: number
  s: number
  m: number
  l: number
  inputsEffect: InputEffect[]
  adaptations: Adaptation[]
  /** Share of the time made of components we cannot produce at all (capability 0) in this state. */
  unproducibleShare: number
  /** §2.8: score under 30, or more than 40 % of the time unproducible. */
  supportSuggested: boolean
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

/** What actually makes a component in a state: itself, the user's footage, or a replacement. */
export function effectiveComponent(component: ComponentId, state: GaugeState, matrix: CapabilityMatrix = CAPABILITY_MATRIX): { by: ComponentId; capability: number; replaced: boolean; footage: boolean } {
  const cap = matrix[component]
  const explicit = state.replace[component]
  if (explicit && explicit !== component) {
    return { by: explicit, capability: clamp01(matrix[explicit][state.mode]) * REPLACEMENT_FIDELITY, replaced: true, footage: false }
  }
  if (cap.input) {
    const answer = state.answers[cap.input]
    if (answer === true) return { by: component, capability: clamp01(cap.withInput ?? 0), replaced: false, footage: true }
    if (answer === false) {
      const by = DEFAULT_REPLACEMENT[cap.input][state.mode]
      return { by, capability: clamp01(matrix[by][state.mode]) * REPLACEMENT_FIDELITY, replaced: true, footage: false }
    }
  }
  return { by: component, capability: clamp01(cap[state.mode]), replaced: false, footage: false }
}

/** Shares normalised to sum 1 (an empty profile has none). Duplicate components are merged. */
export function normaliseShares(components: GaugeProfile['components']): Map<ComponentId, number> {
  const out = new Map<ComponentId, number>()
  for (const c of components) out.set(c.component, (out.get(c.component) ?? 0) + Math.max(0, c.share))
  const total = [...out.values()].reduce((a, b) => a + b, 0)
  if (total > 0) for (const [k, v] of out) out.set(k, v / total)
  return out
}

/** The raw (unrounded) gauge in one state. */
export function rawGauge(profile: GaugeProfile, state: GaugeState, matrix: CapabilityMatrix = CAPABILITY_MATRIX): { raw: number; v: number; l: number; unproducible: number } {
  const shares = normaliseShares(profile.components)
  let sum = 0
  let unproducible = 0
  for (const [component, share] of shares) {
    const eff = effectiveComponent(component, state, matrix)
    sum += share * eff.capability
    if (eff.capability === 0) unproducible += share
  }
  const k = CONFIDENCE_FACTOR[profile.analystConfidence]
  const v = k * sum + (1 - k) * 0.5
  const l = (shares.get('clip') ?? 0) >= CLIP_RELIANCE_SHARE ? CLIP_LIMIT : 1
  const raw = 100 * l * (WEIGHTS.visuals * v + WEIGHTS.voice * clamp01(profile.voice) + WEIGHTS.script * clamp01(profile.script) + WEIGHTS.edit * clamp01(profile.edit))
  return { raw, v, l, unproducible }
}

/** Rounds like the hand computation (half up), shielded from binary noise such as 84.99999999. */
export function roundScore(raw: number): number {
  return Math.min(100, Math.max(0, Math.round(Math.round(raw * 1e6) / 1e6)))
}

export function scoreOf(profile: GaugeProfile, state: GaugeState, matrix: CapabilityMatrix = CAPABILITY_MATRIX): number {
  return roundScore(rawGauge(profile, state, matrix).raw)
}

/** Inputs the profile actually needs (its components made from the user's footage). */
export function neededInputs(profile: GaugeProfile, matrix: CapabilityMatrix = CAPABILITY_MATRIX): InputId[] {
  const out: InputId[] = []
  for (const [component, share] of normaliseShares(profile.components)) {
    const input = matrix[component].input
    if (input && share > 0 && !out.includes(input)) out.push(input)
  }
  return INPUT_IDS.filter((i) => out.includes(i))
}

export function computeGauge(profile: GaugeProfile, state: GaugeState, matrix: CapabilityMatrix = CAPABILITY_MATRIX): GaugeResult {
  const here = rawGauge(profile, state, matrix)
  const score = roundScore(here.raw)
  const perMode = {
    qualite_max: scoreOf(profile, { ...state, mode: 'qualite_max' }, matrix),
    usage_max: scoreOf(profile, { ...state, mode: 'usage_max' }, matrix)
  }
  const inputs = neededInputs(profile, matrix)
  const inputsEffect: InputEffect[] = inputs.map((input) => ({
    input,
    with: scoreOf(profile, { ...state, answers: { ...state.answers, [input]: true } }, matrix),
    without: scoreOf(profile, { ...state, answers: { ...state.answers, [input]: false } }, matrix)
  }))
  const adaptations: Adaptation[] = []
  for (const e of inputsEffect) {
    if (state.answers[e.input] !== true && e.with > score) adaptations.push({ kind: 'input', input: e.input, score: e.with })
  }
  for (const mode of BUDGET_MODE_IDS) {
    if (mode !== state.mode && perMode[mode] > score) adaptations.push({ kind: 'mode', mode, score: perMode[mode] })
  }
  for (const input of inputs) {
    if (state.answers[input] !== undefined) continue
    // unanswered: show what the default replacement would give, so "non" is an informed answer
    const component = (Object.keys(matrix) as ComponentId[]).find((c) => matrix[c].input === input)
    if (!component) continue
    const by = DEFAULT_REPLACEMENT[input][state.mode]
    const s = scoreOf(profile, { ...state, replace: { ...state.replace, [component]: by } }, matrix)
    if (s > score) adaptations.push({ kind: 'replace', component, by, score: s })
  }
  adaptations.sort((a, b) => b.score - a.score)
  let confidence = profile.analystConfidence
  if (inputs.some((i) => state.answers[i] === undefined) && confidence === 'high') confidence = 'medium'
  return {
    matrixVersion: CAPABILITY_MATRIX_VERSION,
    mode: state.mode,
    score,
    tier: tierOf(score),
    confidence,
    perMode,
    v: here.v,
    vo: clamp01(profile.voice),
    s: clamp01(profile.script),
    m: clamp01(profile.edit),
    l: here.l,
    inputsEffect,
    adaptations,
    unproducibleShare: here.unproducible,
    supportSuggested: score < 30 || here.unproducible > 0.4
  }
}

export function isConfidence(v: unknown): v is Confidence {
  return typeof v === 'string' && (CONF_ORDER as readonly string[]).includes(v)
}
export function isComponentId(v: unknown): v is ComponentId {
  return typeof v === 'string' && (COMPONENT_IDS as readonly string[]).includes(v)
}
export function isInputId(v: unknown): v is InputId {
  return typeof v === 'string' && (INPUT_IDS as readonly string[]).includes(v)
}
export function isGaugeMode(v: unknown): v is GaugeMode {
  return typeof v === 'string' && (BUDGET_MODE_IDS as readonly string[]).includes(v)
}
