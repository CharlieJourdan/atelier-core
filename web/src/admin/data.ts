// Founder console fixtures. Everything is derived from research note BUSINESS-INFRA (old repository) (plan grid §6.2, margin math §6.3,
// VM tiers §1.5, provider unit costs §3-4) so the numbers hang together: MRR, margins and costs are computed from the
// user list below, not typed in. Names and e-mail addresses are invented (".test" domains).
import { PLANS, monthlyPrice, type PlanId } from '../plans'

/* ------------------------------------------------------------------ helpers */

export const eur = (n: number, decimals = n % 1 !== 0): string =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0 }).format(n)
export const num = (n: number): string => new Intl.NumberFormat('fr-FR').format(Math.round(n))
export const pct = (n: number, digits = 1): string => `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n)} %`

/** Small deterministic PRNG so the fixtures never change between renders and tests. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(2026)
const between = (lo: number, hi: number): number => lo + rnd() * (hi - lo)
const int = (lo: number, hi: number): number => Math.round(between(lo, hi))

export function agoLabel(minutes: number): string {
  if (minutes < 1) return 'à l’instant'
  if (minutes < 60) return `il y a ${Math.round(minutes)} min`
  if (minutes < 60 * 24) return `il y a ${Math.round(minutes / 60)} h`
  return `il y a ${Math.round(minutes / 1440)} j`
}

/* ------------------------------------------------------------------ cost model (BUSINESS-INFRA §6.3) */

export const DEFAULT_MARKUP = 1.3
/** VM cost per month per plan (Hetzner CX33 / CX43 / CX53, x2 and x4 for Agency and Network), EUR. */
export const VM_COST: Record<PlanId, number> = { starter: 8.99, creator: 16.49, studio: 29.99, agency: 59.98, network: 119.96 }
export const VM_TYPE: Record<PlanId, string> = { starter: 'CX33', creator: 'CX43', studio: 'CX53', agency: 'CX53', network: 'CX53' }
export const STORAGE_COST: Record<PlanId, number> = { starter: 0.33, creator: 0.97, studio: 2.6, agency: 6.5, network: 13 }
export const OVERHEAD: Record<PlanId, number> = { starter: 3, creator: 4, studio: 6, agency: 12, network: 25 }
export const HIBERNATED_COST = 0.9
/** Fixed monthly infrastructure (control plane, database, auth, object storage base, monitoring), EUR. */
export const FIXED_INFRA = 98
export const STRIPE_RATE = 0.057
export const STRIPE_FIXED = 0.25

/* ------------------------------------------------------------------ users */

export type UserStatus = 'trial' | 'active' | 'churn-risk'

export interface TimelineEvent {
  at: string
  text: string
}
export interface AdminUser {
  id: string
  name: string
  email: string
  plan: PlanId
  billing: 'monthly' | 'yearly'
  status: UserStatus
  channels: string[]
  channelCount: number
  videosMonth: number
  creditsUsed: number
  lastActiveMin: number
  joinedDaysAgo: number
  notes: { at: string; text: string }[]
  timeline: TimelineEvent[]
}

const FIRST = ['Camille', 'Hugo', 'Inès', 'Malo', 'Jade', 'Lucas', 'Manon', 'Théo', 'Chloé', 'Nathan', 'Léa', 'Raphaël', 'Sarah', 'Maxime', 'Zoé', 'Antoine', 'Clara', 'Louis', 'Emma', 'Paul', 'Lina', 'Adam', 'Alice', 'Yanis', 'Nora', 'Samuel', 'Eva', 'Noé', 'Anaïs', 'Victor', 'Mila', 'Gabriel', 'Jeanne', 'Tom', 'Ilyes', 'Margaux', 'Basile']
const LAST = ['Marchand', 'Lefèvre', 'Garnier', 'Roux', 'Fontaine', 'Chevalier', 'Perrin', 'Morel', 'Girard', 'Faure', 'Andre', 'Mercier', 'Blanc', 'Guerin', 'Boyer', 'Lemaire', 'Renard', 'Picard', 'Bertrand', 'Colin', 'Vidal', 'Huet', 'Masson', 'Leclerc', 'Robin', 'Clement', 'Meunier', 'Gaillard', 'Brun', 'Aubert', 'Lacroix', 'Noel', 'Barre', 'Jacob', 'Dupuis', 'Carpentier', 'Navarro']
const NICHES = ['Histoires vraies', 'Énigmes du passé', 'Top savoirs', 'Faits insolites', 'Mystères', 'Reddit en vidéo', 'Animaux', 'Cartes et géopolitique', 'Science simple', 'Finance perso', 'Jeux rétro', 'Cuisine du monde', 'Voyages', 'Psychologie', 'Légendes', 'Technologie', 'Histoire militaire', 'Espace', 'Architecture', 'Musique']

/** [plan, how many users] — a closed beta of 37 accounts. */
const MIX: [PlanId, number][] = [
  ['starter', 14],
  ['creator', 12],
  ['studio', 7],
  ['agency', 3],
  ['network', 1]
]
const VIDEOS: Record<PlanId, [number, number]> = { starter: [3, 12], creator: [8, 30], studio: [20, 70], agency: [50, 190], network: [150, 360] }

function buildUsers(): AdminUser[] {
  const out: AdminUser[] = []
  let i = 0
  for (const [plan, count] of MIX) {
    const p = PLANS.find((x) => x.id === plan)
    if (!p) continue
    for (let k = 0; k < count; k++) {
      const first = FIRST[(i * 7) % FIRST.length] ?? 'Alex'
      const last = LAST[(i * 11 + 3) % LAST.length] ?? 'Martin'
      const nChannels = Math.max(1, Math.min(p.channels, Math.round(p.channels * between(0.35, 1))))
      const channels = Array.from({ length: Math.min(nChannels, 4) }, (_, c) => NICHES[(i * 3 + c * 5) % NICHES.length] ?? 'Chaîne')
      const [vlo, vhi] = VIDEOS[plan]
      const usage = between(0.3, 1.25)
      out.push({
        id: `usr_${String(1000 + i * 7)}`,
        name: `${first} ${last}`,
        email: `${first.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}.${last.toLowerCase()}@${['courriel', 'exemple', 'mail'][i % 3]}.test`,
        plan,
        billing: rnd() < 0.28 ? 'yearly' : 'monthly',
        status: 'active',
        channels,
        channelCount: nChannels,
        videosMonth: int(vlo, vhi),
        creditsUsed: Math.round(p.credits * usage),
        lastActiveMin: Math.round(rnd() < 0.7 ? between(2, 60 * 20) : between(60 * 24, 60 * 24 * 6)),
        joinedDaysAgo: int(12, 240),
        notes: [],
        timeline: []
      })
      i++
    }
  }
  // The four newest accounts are on the free trial; three quiet ones are flagged as churn risks.
  const byJoin = [...out].sort((a, b) => a.joinedDaysAgo - b.joinedDaysAgo)
  byJoin.slice(0, 4).forEach((u, n) => {
    u.status = 'trial'
    u.joinedDaysAgo = [1, 3, 6, 9][n] ?? 2
    u.videosMonth = Math.min(u.videosMonth, 4)
    u.creditsUsed = Math.round(u.creditsUsed * 0.2)
  })
  out
    .filter((u) => u.status === 'active' && u.plan !== 'network')
    .sort((a, b) => a.creditsUsed / (PLANS.find((p) => p.id === a.plan)?.credits ?? 1) - b.creditsUsed / (PLANS.find((p) => p.id === b.plan)?.credits ?? 1))
    .slice(0, 3)
    .forEach((u, n) => {
      u.status = 'churn-risk'
      u.lastActiveMin = [60 * 24 * 9, 60 * 24 * 12, 60 * 24 * 8][n] ?? 60 * 24 * 9
      u.videosMonth = Math.min(u.videosMonth, 2)
      u.creditsUsed = Math.round(u.creditsUsed * 0.25)
    })
  // Timelines and a few notes.
  for (const u of out) {
    const planName = PLANS.find((p) => p.id === u.plan)?.name ?? u.plan
    u.timeline = [
      { at: `il y a ${u.joinedDaysAgo} j`, text: 'Compte créé' },
      { at: `il y a ${u.joinedDaysAgo} j`, text: `Plan ${planName} choisi, paiement confirmé` },
      { at: `il y a ${u.joinedDaysAgo} j`, text: 'Ordinateur d’équipe prêt en 3 min 12 s' },
      { at: `il y a ${Math.max(0, u.joinedDaysAgo - 1)} j`, text: 'Première chaîne scannée par l’onboarding' },
      { at: `il y a ${Math.max(0, u.joinedDaysAgo - 2)} j`, text: 'Première vidéo envoyée en validation' }
    ].slice(0, u.joinedDaysAgo < 3 ? 3 : 5)
    if (u.status === 'churn-risk') u.timeline.unshift({ at: agoLabel(u.lastActiveMin), text: 'Dernière activité : aucune vidéo lancée depuis' })
  }
  const first = out[0]
  if (first) first.notes = [{ at: 'il y a 12 j', text: 'Demande une intégration Discord pour ses validations. Prévenir quand c’est prêt.' }]
  const risk = out.find((u) => u.status === 'churn-risk')
  if (risk) risk.notes = [{ at: 'il y a 3 j', text: 'Relancé par message : bloqué sur la connexion à Claude Code. À rappeler.' }]
  return out
}

export const USERS: AdminUser[] = buildUsers()

export interface Economics {
  revenue: number
  topups: number
  vm: number
  credits: number
  storage: number
  overhead: number
  fees: number
  cost: number
  margin: number
  marginPct: number
}

export function userPlan(u: AdminUser) {
  return PLANS.find((p) => p.id === u.plan) ?? PLANS[0]!
}

/** Monthly economics of one account: subscription + top-ups against VM, provider cost of the credits, storage, overhead, Stripe. */
export function economics(u: AdminUser, markup = DEFAULT_MARKUP): Economics {
  const plan = userPlan(u)
  const sub = u.status === 'trial' ? 0 : monthlyPrice(plan, u.billing)
  const overage = Math.max(0, u.creditsUsed - plan.credits)
  const topups = u.status === 'trial' ? 0 : overage * 0.01
  const revenue = sub + topups
  const hibernated = u.status === 'churn-risk' && u.lastActiveMin > 60 * 24 * 7
  const vm = hibernated ? HIBERNATED_COST * plan.computers : VM_COST[u.plan]
  const credits = (u.creditsUsed * 0.01) / markup
  const storage = STORAGE_COST[u.plan]
  const overhead = OVERHEAD[u.plan]
  const fees = revenue > 0 ? STRIPE_RATE * revenue + STRIPE_FIXED : 0
  const cost = vm + credits + storage + overhead + fees
  const margin = revenue - cost
  return { revenue, topups, vm, credits, storage, overhead, fees, cost, margin, marginPct: revenue > 0 ? (margin / revenue) * 100 : -100 }
}

/* ------------------------------------------------------------------ aggregates */

export interface CostLine {
  key: string
  label: string
  amount: number
}

const ECON = USERS.map((u) => ({ u, e: economics(u) }))
const paying = ECON.filter((x) => x.u.status !== 'trial')

export const MRR = paying.reduce((s, x) => s + (x.e.revenue - x.e.topups), 0)
export const TOPUP_REVENUE = paying.reduce((s, x) => s + x.e.topups, 0)
export const REVENUE_MONTH = MRR + TOPUP_REVENUE

/** Provider spend of the month split by kind, from the credits really consumed (shares follow the typical video mix of §6.5). */
const PROVIDER_COST_TOTAL = ECON.reduce((s, x) => s + x.e.credits, 0)
export const COST_LINES: CostLine[] = [
  { key: 'vm', label: 'Machines d’équipe', amount: ECON.reduce((s, x) => s + x.e.vm, 0) },
  { key: 'voice', label: 'API voix', amount: PROVIDER_COST_TOTAL * 0.22 },
  { key: 'image', label: 'API images', amount: PROVIDER_COST_TOTAL * 0.27 },
  { key: 'video', label: 'API vidéo', amount: PROVIDER_COST_TOTAL * 0.31 },
  { key: 'llm', label: 'Relais LLM et yeux', amount: PROVIDER_COST_TOTAL * 0.2 },
  { key: 'storage', label: 'Stockage', amount: ECON.reduce((s, x) => s + x.e.storage, 0) },
  { key: 'stripe', label: 'Frais Stripe', amount: ECON.reduce((s, x) => s + x.e.fees, 0) },
  { key: 'infra', label: 'Infrastructure fixe', amount: FIXED_INFRA }
]
export const COST_TOTAL = COST_LINES.reduce((s, c) => s + c.amount, 0)
export const GROSS_MARGIN_EUR = REVENUE_MONTH - COST_TOTAL
export const GROSS_MARGIN_PCT = (GROSS_MARGIN_EUR / REVENUE_MONTH) * 100

export const ACTIVE_USERS = USERS.filter((u) => u.status !== 'trial' && u.lastActiveMin < 60 * 24 * 7).length
export const CHURN_RATE = 2.7
export const VIDEOS_MONTH = USERS.reduce((s, u) => s + u.videosMonth, 0)
export const CREDITS_MONTH = USERS.reduce((s, u) => s + u.creditsUsed, 0)

/** Last 12 months of MRR, ending on the computed figure (closed beta ramp-up). */
export const MONTHS = ['nov.', 'déc.', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.']
const RAMP = [0.06, 0.1, 0.15, 0.2, 0.27, 0.35, 0.46, 0.58, 0.7, 0.82, 0.92, 1]
export const MRR_SERIES = RAMP.map((r) => Math.round(MRR * r))
export const USERS_SERIES = RAMP.map((r) => Math.max(1, Math.round(paying.length * r)))
export const MARGIN_SERIES = [18, 24, 29, 33, 36, 38, 41, 43, 45, 46, 47, Math.round(GROSS_MARGIN_PCT)]

export interface PlanEconomics {
  id: PlanId
  name: string
  users: number
  revenue: number
  cost: number
  margin: number
  marginPct: number
}
export function planEconomics(markup = DEFAULT_MARKUP): PlanEconomics[] {
  return PLANS.map((p) => {
    const rows = USERS.filter((u) => u.plan === p.id).map((u) => economics(u, markup))
    const revenue = rows.reduce((s, e) => s + e.revenue, 0)
    const cost = rows.reduce((s, e) => s + e.cost, 0)
    return { id: p.id, name: p.name, users: rows.length, revenue, cost, margin: revenue - cost, marginPct: revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0 }
  })
}

/** Gross margin of a plan at 100 % use of its included credits for a given markup (the grid of §6.3). */
export function listMargin(planId: PlanId, markup: number): number {
  const p = PLANS.find((x) => x.id === planId)
  if (!p) return 0
  const cost = VM_COST[planId] + STORAGE_COST[planId] + OVERHEAD[planId] + (STRIPE_RATE * p.price + STRIPE_FIXED) + (p.credits * 0.01) / markup
  return ((p.price - cost) / p.price) * 100
}

/* ------------------------------------------------------------------ machines */

export type MachineStatus = 'running' | 'hibernated' | 'provisioning'
export interface Machine {
  id: string
  userId: string
  userName: string
  type: string
  region: string
  status: MachineStatus
  monthlyCost: number
  vcpu: number
  ramGb: number
  cpu: number
  ram: number
}

const SPEC: Record<string, [number, number]> = { CX33: [4, 8], CX43: [8, 16], CX53: [16, 32] }
const REGIONS = ['fsn1 · Falkenstein', 'nbg1 · Nuremberg', 'hel1 · Helsinki']

function buildMachines(): Machine[] {
  const out: Machine[] = []
  let n = 41
  const newest = [...USERS].sort((a, b) => a.joinedDaysAgo - b.joinedDaysAgo)[0]
  for (const u of USERS) {
    const plan = userPlan(u)
    for (let c = 0; c < plan.computers; c++) {
      const type = VM_TYPE[u.plan]
      const [vcpu, ramGb] = SPEC[type] ?? [4, 8]
      const hibernated = u.status === 'churn-risk' && u.lastActiveMin > 60 * 24 * 7
      const provisioning = u === newest && c === 0
      const status: MachineStatus = provisioning ? 'provisioning' : hibernated ? 'hibernated' : 'running'
      const perVm = VM_COST[u.plan] / plan.computers
      out.push({
        id: `atl-pc-${String(n++).padStart(4, '0')}`,
        userId: u.id,
        userName: u.name,
        type,
        region: REGIONS[(n + c) % REGIONS.length] ?? 'fsn1 · Falkenstein',
        status,
        monthlyCost: status === 'hibernated' ? HIBERNATED_COST : perVm,
        vcpu,
        ramGb,
        cpu: status === 'running' ? int(6, 78) : 0,
        ram: status === 'running' ? int(22, 71) : 0
      })
    }
  }
  return out
}
export const MACHINES: Machine[] = buildMachines()

export interface ProvisionRun {
  id: string
  user: string
  agoMin: number
  steps: { label: string; seconds: number }[]
  total: string
}
function steps(extra = 0): { label: string; seconds: number }[] {
  return [
    { label: 'Nouvel utilisateur créé', seconds: 2 },
    { label: 'Machine commandée chez Hetzner', seconds: 41 + extra },
    { label: 'Système démarré, agent de relais connecté', seconds: 58 },
    { label: 'Claude Code installé (binaire officiel)', seconds: 52 },
    { label: 'Pare-feu fermé, disque chiffré', seconds: 31 },
    { label: 'Prêt', seconds: 8 }
  ]
}
export const PROVISION_RUNS: ProvisionRun[] = [0, 1, 2, 3].map((k) => {
  const u = [...USERS].sort((a, b) => a.joinedDaysAgo - b.joinedDaysAgo)[k]
  const s = steps(k * 3)
  const total = s.reduce((t, x) => t + x.seconds, 0)
  return {
    id: `run_${204 - k}`,
    user: u?.name ?? 'Utilisateur',
    agoMin: [9, 60 * 26, 60 * 24 * 4, 60 * 24 * 7][k] ?? 30,
    steps: s,
    total: `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, '0')} s`
  }
})

/* ------------------------------------------------------------------ live production */

export interface Job {
  id: string
  user: string
  channel: string
  video: string
  pipeline: string
  node: string
  provider: string
  progress: number
  credits: number
  state: 'running' | 'queued' | 'error'
  error?: string
}

const U = (i: number): string => USERS[i % USERS.length]?.name ?? 'Utilisateur'
export const JOBS: Job[] = [
  { id: 'job_8841', user: U(9), channel: 'Énigmes du passé', video: 'Atlantide : ce que Platon n’a jamais dit', pipeline: 'Documentaire narré', node: 'Voix', provider: 'MiniMax speech-2.8-hd', progress: 62, credits: 118, state: 'running' },
  { id: 'job_8840', user: U(18), channel: 'Reddit en vidéo', video: 'Mon coloc a vendu mon chat', pipeline: 'Histoire Reddit + gameplay', node: 'Montage', provider: 'Moteur Atelier · PC d’équipe', progress: 84, credits: 31, state: 'running' },
  { id: 'job_8839', user: U(21), channel: 'Top savoirs', video: '10 animaux les plus rapides', pipeline: 'Top 10 illustré', node: 'Images IA', provider: 'fal.ai · Nano Banana', progress: 41, credits: 86, state: 'running' },
  { id: 'job_8838', user: U(30), channel: 'Mystères', video: 'Roswell 1947 : the full story', pipeline: 'Documentaire traduit (EN)', node: 'Voix', provider: 'MiniMax speech-2.8-hd', progress: 55, credits: 142, state: 'running' },
  { id: 'job_8837', user: U(4), channel: 'Faits insolites', video: 'Pourquoi le ciel est rouge sur Mars', pipeline: 'Documentaire narré', node: 'Analyse concurrents', provider: 'Gemini 3.1 Flash-Lite', progress: 23, credits: 6, state: 'running' },
  { id: 'job_8836', user: U(14), channel: 'Légendes', video: 'La nuit des chevaliers perdus', pipeline: 'Vidéo 100 % IA', node: 'Vidéo générée', provider: 'Veo 3.1 Lite', progress: 37, credits: 1480, state: 'running' },
  { id: 'job_8835', user: U(26), channel: 'Science simple', video: 'Comment fonctionne un trou noir', pipeline: 'Documentaire narré', node: 'Images IA', provider: 'fal.ai · Nano Banana', progress: 47, credits: 92, state: 'error', error: '429 : limite de débit fal.ai, nouvel essai dans 40 s' },
  { id: 'job_8834', user: U(2), channel: 'Histoire militaire', video: 'Verdun, 300 jours', pipeline: 'Documentaire narré', node: 'Rendu', provider: 'Moteur Atelier · PC d’équipe', progress: 71, credits: 14, state: 'error', error: 'Rendu interrompu : mémoire saturée sur atl-pc-0043, relance sur le cloud' },
  { id: 'job_8833', user: U(33), channel: 'Voyages', video: 'Lisbonne en 48 heures', pipeline: 'Top 10 illustré', node: 'Script', provider: 'Claude Code · abonnement utilisateur', progress: 12, credits: 0, state: 'queued' },
  { id: 'job_8832', user: U(11), channel: 'Psychologie', video: 'Pourquoi on procrastine', pipeline: 'Histoire Reddit + gameplay', node: 'Voix', provider: 'MiniMax speech-2.8-turbo', progress: 0, credits: 0, state: 'queued' }
]

/* ------------------------------------------------------------------ providers */

export interface Provider {
  id: string
  name: string
  usage: string
  keySet: boolean
  checked: string
  spend: number
}
export const PROVIDERS: Provider[] = [
  { id: 'minimax', name: 'MiniMax', usage: 'Voix (speech-2.8 HD et Turbo)', keySet: true, checked: 'il y a 2 h', spend: PROVIDER_COST_TOTAL * 0.22 },
  { id: 'fal', name: 'fal.ai', usage: 'Images, vidéo et avatars (agrégateur)', keySet: true, checked: 'il y a 2 h', spend: PROVIDER_COST_TOTAL * 0.45 },
  { id: 'google', name: 'Google AI', usage: 'Gemini (yeux), Nano Banana, Veo', keySet: true, checked: 'il y a 5 h', spend: PROVIDER_COST_TOTAL * 0.2 },
  { id: 'assembly', name: 'AssemblyAI', usage: 'Sous-titres et transcription', keySet: true, checked: 'hier', spend: PROVIDER_COST_TOTAL * 0.03 },
  { id: 'heygen', name: 'HeyGen', usage: 'Avatars parlants', keySet: false, checked: 'jamais', spend: 0 },
  { id: 'elevenlabs', name: 'ElevenLabs', usage: 'Voix de secours, musique', keySet: false, checked: 'jamais', spend: 0 },
  { id: 'anthropic', name: 'Anthropic (API)', usage: 'Atelier Brain : contrôle qualité et relais LLM', keySet: true, checked: 'il y a 1 h', spend: PROVIDER_COST_TOTAL * 0.1 },
  { id: 'pexels', name: 'Pexels', usage: 'Vidéos et photos d’archive', keySet: true, checked: 'hier', spend: 0 },
  { id: 'hetzner', name: 'Hetzner Cloud', usage: 'Ordinateurs d’équipe', keySet: true, checked: 'il y a 12 min', spend: COST_LINES[0]?.amount ?? 0 },
  { id: 'stripe', name: 'Stripe', usage: 'Abonnements, packs de crédits', keySet: true, checked: 'il y a 12 min', spend: COST_LINES[6]?.amount ?? 0 },
  { id: 'supabase', name: 'Supabase', usage: 'Base de données, authentification', keySet: true, checked: 'il y a 12 min', spend: 25 }
]

export interface UnitPrice {
  provider: string
  item: string
  unit: string
  /** Provider price in USD (EUR for Hetzner). */
  price: number
  currency: 'USD' | 'EUR'
  /** Number of credits one unit costs at markup 1.0 (1 USD = 92 credits, 1 EUR = 100). */
  creditsAt1: number
}
export const UNIT_PRICES: UnitPrice[] = [
  { provider: 'MiniMax', item: 'speech-2.8-hd', unit: '1 M caractères', price: 100, currency: 'USD', creditsAt1: 100 * 92 },
  { provider: 'MiniMax', item: 'speech-2.8-turbo', unit: '1 M caractères', price: 60, currency: 'USD', creditsAt1: 60 * 92 },
  { provider: 'fal.ai', item: 'Nano Banana (image)', unit: 'image', price: 0.0336, currency: 'USD', creditsAt1: 0.0336 * 92 },
  { provider: 'fal.ai', item: 'H3-Lite 480p (vidéo)', unit: 'seconde', price: 0.025, currency: 'USD', creditsAt1: 0.025 * 92 },
  { provider: 'Google AI', item: 'Veo 3.1 Lite 720p', unit: 'seconde', price: 0.05, currency: 'USD', creditsAt1: 0.05 * 92 },
  { provider: 'Google AI', item: 'Gemini 3.1 Flash-Lite (yeux)', unit: 'vidéo de 10 min', price: 0.023, currency: 'USD', creditsAt1: 0.023 * 92 },
  { provider: 'HeyGen', item: 'Avatar (estimation)', unit: 'minute', price: 1, currency: 'USD', creditsAt1: 92 },
  { provider: 'Hetzner', item: 'CX33 (4 vCPU, 8 Go)', unit: 'mois', price: 8.99, currency: 'EUR', creditsAt1: 899 },
  { provider: 'Hetzner', item: 'CX53 (16 vCPU, 32 Go)', unit: 'mois', price: 29.99, currency: 'EUR', creditsAt1: 2999 }
]

/* ------------------------------------------------------------------ overview feed */

export const ACTIVITY: { at: string; text: string; tone: 'ok' | 'warn' | 'err' | 'info' }[] = [
  { at: 'il y a 9 min', text: `${PROVISION_RUNS[0]?.user ?? 'Un utilisateur'} : ordinateur d’équipe prêt en ${PROVISION_RUNS[0]?.total ?? '3 min'}`, tone: 'ok' },
  { at: 'il y a 24 min', text: 'job_8835 : limite de débit fal.ai, relance automatique', tone: 'warn' },
  { at: 'il y a 1 h', text: 'job_8834 : rendu relancé sur le cloud (PC d’équipe saturé)', tone: 'err' },
  { at: 'il y a 3 h', text: 'Pack de 5 000 crédits acheté (Studio)', tone: 'info' },
  { at: 'il y a 6 h', text: 'Un compte passe en risque de départ : 9 jours sans activité', tone: 'warn' },
  { at: 'hier', text: 'Blueprint v3 publié pour tous les espaces', tone: 'info' }
]
