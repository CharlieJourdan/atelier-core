// Plan grid: research note BUSINESS-INFRA (old repository) section 6.2 (prices in EUR excl. VAT, credits, team computer, storage).
import { fmtNum, type Lang } from './i18n'

export type PlanId = 'starter' | 'creator' | 'studio' | 'agency' | 'network'

export interface Plan {
  id: PlanId
  name: string
  /** EUR per month, excl. VAT, billed monthly. */
  price: number
  seats: number
  channels: number
  credits: number
  /** Number of team computers and the spec of each. */
  computers: number
  vcpu: number
  ramGb: number
  diskGb: number
  /** Cloud object storage in GB. */
  storageGb: number
  /** Agent jobs / renders in parallel. */
  jobs: [number, number]
  /** Documentaries and shorts covered by the included credits. */
  docs: number
  shorts: number
  featured?: boolean
  features: string[]
}

export const YEARLY_DISCOUNT = 0.2

export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: 49.99,
    seats: 1,
    channels: 1,
    credits: 1500,
    computers: 1,
    vcpu: 4,
    ramGb: 8,
    diskGb: 80,
    storageGb: 50,
    jobs: [2, 1],
    docs: 4,
    shorts: 37,
    features: ['feat.team', 'feat.eyes', 'feat.presets', 'feat.discord']
  },
  {
    id: 'creator',
    name: 'Creator',
    price: 99.99,
    seats: 2,
    channels: 3,
    credits: 3000,
    computers: 1,
    vcpu: 8,
    ramGb: 16,
    diskGb: 160,
    storageGb: 150,
    jobs: [4, 2],
    docs: 8,
    shorts: 75,
    features: ['feat.team', 'feat.eyes', 'feat.presets', 'feat.custom', 'feat.translate', 'feat.discord']
  },
  {
    id: 'studio',
    name: 'Studio',
    price: 199.99,
    seats: 3,
    channels: 8,
    credits: 6500,
    computers: 1,
    vcpu: 16,
    ramGb: 32,
    diskGb: 320,
    storageGb: 400,
    jobs: [8, 4],
    docs: 17,
    shorts: 160,
    featured: true,
    features: ['feat.team', 'feat.eyes', 'feat.custom', 'feat.translate', 'feat.discord', 'feat.brain', 'feat.roles']
  },
  {
    id: 'agency',
    name: 'Agency',
    price: 399.99,
    seats: 6,
    channels: 20,
    credits: 14000,
    computers: 2,
    vcpu: 16,
    ramGb: 32,
    diskGb: 320,
    storageGb: 1000,
    jobs: [16, 8],
    docs: 38,
    shorts: 350,
    features: ['feat.team', 'feat.eyes', 'feat.custom', 'feat.translate', 'feat.brain', 'feat.roles', 'feat.clients', 'feat.support']
  },
  {
    id: 'network',
    name: 'Network',
    price: 799.99,
    seats: 12,
    channels: 50,
    credits: 30000,
    computers: 4,
    vcpu: 16,
    ramGb: 32,
    diskGb: 320,
    storageGb: 2000,
    jobs: [32, 16],
    docs: 81,
    shorts: 750,
    features: ['feat.team', 'feat.eyes', 'feat.custom', 'feat.translate', 'feat.brain', 'feat.roles', 'feat.clients', 'feat.support', 'feat.onboarding']
  }
]

export const ENTERPRISE = {
  id: 'enterprise' as const,
  name: 'Entreprise',
  from: 1999,
  features: ['feat.sso', 'feat.dedicated', 'feat.clients', 'feat.support', 'feat.onboarding']
}

export interface CreditPack {
  credits: number
  price: number
  /** Percent off the list price of 0,01 EUR per credit. */
  off: number
}

export const CREDIT_PACKS: CreditPack[] = [
  { credits: 2000, price: 20, off: 0 },
  { credits: 5000, price: 47.5, off: 5 },
  { credits: 20000, price: 180, off: 10 }
]

/** Credit cost of typical videos (BUSINESS-INFRA §6.5): credits and EUR for the user. */
export const VIDEO_COSTS: { key: string; credits: [number, number?]; approx?: boolean }[] = [
  { key: 'pr.cost.c1', credits: [40], approx: true },
  { key: 'pr.cost.c2', credits: [370], approx: true },
  { key: 'pr.cost.c3', credits: [1200], approx: true },
  { key: 'pr.cost.c4', credits: [2900, 5200] }
]

export function monthlyPrice(plan: Plan, billing: 'monthly' | 'yearly'): number {
  const p = billing === 'yearly' ? plan.price * (1 - YEARLY_DISCOUNT) : plan.price
  return Math.round(p * 100) / 100
}

export function yearlyTotal(plan: Plan): number {
  return Math.round(monthlyPrice(plan, 'yearly') * 12 * 100) / 100
}

export function planById(id: string | undefined): Plan | undefined {
  return PLANS.find((p) => p.id === id)
}

/** "4 vCPU · 8 Go · 80 Go" for one computer, prefixed by the count when there are several. */
export function computerSpec(plan: Plan, lang: Lang): string {
  const gb = lang === 'fr' ? 'Go' : 'GB'
  const disk = plan.diskGb >= 1000 ? `${fmtNum(plan.diskGb / 1000, lang)} ${lang === 'fr' ? 'To' : 'TB'}` : `${plan.diskGb} ${gb}`
  const one = `${plan.vcpu} vCPU · ${plan.ramGb} ${gb} · ${disk}`
  if (plan.computers === 1) return one
  return lang === 'fr' ? `${plan.computers} × ${one}` : `${plan.computers} × ${one}`
}

export function storageLabel(gbs: number, lang: Lang): string {
  if (gbs >= 1000) return `${fmtNum(gbs / 1000, lang)} ${lang === 'fr' ? 'To' : 'TB'}`
  return `${gbs} ${lang === 'fr' ? 'Go' : 'GB'}`
}
