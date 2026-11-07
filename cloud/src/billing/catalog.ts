// What Atelier sells (archived note RECAP (old repository) §3): five monthly plans from 49,99 € (VAT excluded) plus Entreprise on quote,
// credit packs, and the yearly price (−20 %, as the website shows it: web/src/plans.ts). 1 credit = 0,01 €. Amounts
// are in euro cents.
import type { PlanId } from '../machines/plans.ts'

export interface Plan {
  id: PlanId
  name: string
  monthlyCents: number
  yearlyCents: number
  seats: number
  channels: number
  /** Credits granted at each paid period (monthly; ×12 at once for a yearly period). */
  includedCredits: number
  /** Platform storage of the team's publication kits, in bytes (« Stockage » of the pricing page, 1 Go = 10⁹ bytes). */
  storageBytes: number
}

const GB = 1_000_000_000

const yearly = (monthly: number): number => Math.round(monthly * 12 * 0.8)

export const PLANS: Record<PlanId, Plan> = {
  starter: { id: 'starter', name: 'Starter', monthlyCents: 4999, yearlyCents: yearly(4999), seats: 1, channels: 1, includedCredits: 1500, storageBytes: 50 * GB },
  creator: { id: 'creator', name: 'Creator', monthlyCents: 9999, yearlyCents: yearly(9999), seats: 2, channels: 3, includedCredits: 3000, storageBytes: 150 * GB },
  studio: { id: 'studio', name: 'Studio', monthlyCents: 19999, yearlyCents: yearly(19999), seats: 3, channels: 8, includedCredits: 6500, storageBytes: 400 * GB },
  agency: { id: 'agency', name: 'Agency', monthlyCents: 39999, yearlyCents: yearly(39999), seats: 6, channels: 20, includedCredits: 14000, storageBytes: 1000 * GB },
  network: { id: 'network', name: 'Network', monthlyCents: 79999, yearlyCents: yearly(79999), seats: 12, channels: 50, includedCredits: 30000, storageBytes: 2000 * GB }
}

export const PACK_IDS = ['pack2k', 'pack5k', 'pack20k'] as const
export type PackId = (typeof PACK_IDS)[number]

export interface Pack {
  id: PackId
  credits: number
  cents: number
}

export const PACKS: Record<PackId, Pack> = {
  pack2k: { id: 'pack2k', credits: 2000, cents: 2000 },
  pack5k: { id: 'pack5k', credits: 5000, cents: 4750 },
  pack20k: { id: 'pack20k', credits: 20000, cents: 18000 }
}

export const BILLING_PERIODS = ['month', 'year'] as const
export type BillingPeriod = (typeof BILLING_PERIODS)[number]

export const isPackId = (v: unknown): v is PackId => (PACK_IDS as readonly unknown[]).includes(v)
export const isPeriod = (v: unknown): v is BillingPeriod => (BILLING_PERIODS as readonly unknown[]).includes(v)

export function planPrice(plan: Plan, period: BillingPeriod): number {
  return period === 'year' ? plan.yearlyCents : plan.monthlyCents
}

/** Credits granted when a period is paid. */
export function periodCredits(plan: Plan, period: BillingPeriod): number {
  return period === 'year' ? plan.includedCredits * 12 : plan.includedCredits
}
