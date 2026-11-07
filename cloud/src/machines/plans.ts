// The team computer of each plan (archived note RECAP (old repository) §4, research note BUSINESS-INFRA (old repository) §1.5): Hetzner Cloud shared vCPU
// machines in the EU, one or several per plan. Prices are Hetzner's monthly list prices (EUR, VAT excluded, October
// 2026) used for the margin; the provider bills by the hour while a machine exists, so a hibernated one costs only its
// snapshot.
export const PLAN_IDS = ['starter', 'creator', 'studio', 'agency', 'network'] as const
export type PlanId = (typeof PLAN_IDS)[number]

export interface ServerType {
  /** Hetzner server type name. */
  id: 'cx33' | 'cx43' | 'cx53'
  vcpu: number
  ramGb: number
  diskGb: number
  /** EUR per month. */
  monthlyEur: number
}

export const SERVER_TYPES: Record<ServerType['id'], ServerType> = {
  cx33: { id: 'cx33', vcpu: 4, ramGb: 8, diskGb: 80, monthlyEur: 8.99 },
  cx43: { id: 'cx43', vcpu: 8, ramGb: 16, diskGb: 160, monthlyEur: 16.49 },
  cx53: { id: 'cx53', vcpu: 16, ramGb: 32, diskGb: 320, monthlyEur: 29.99 }
}

export interface MachinePlan {
  plan: PlanId
  serverType: ServerType['id']
  /** How many machines the plan includes. */
  count: number
}

export const MACHINE_PLANS: Record<PlanId, MachinePlan> = {
  starter: { plan: 'starter', serverType: 'cx33', count: 1 },
  creator: { plan: 'creator', serverType: 'cx43', count: 1 },
  studio: { plan: 'studio', serverType: 'cx53', count: 1 },
  agency: { plan: 'agency', serverType: 'cx53', count: 2 },
  network: { plan: 'network', serverType: 'cx53', count: 4 }
}

/** Falkenstein first; Nuremberg and Helsinki when a type is out of stock there. */
export const LOCATIONS = ['fsn1', 'nbg1', 'hel1'] as const
export type Location = (typeof LOCATIONS)[number]

/** A snapshot costs about this per GB-month (Hetzner list price): what a hibernated machine still costs. */
export const SNAPSHOT_EUR_PER_GB_MONTH = 0.011

export function isPlanId(v: unknown): v is PlanId {
  return (PLAN_IDS as readonly unknown[]).includes(v)
}

/** Monthly cost of a plan's machines while they run. */
export function planMonthlyEur(plan: PlanId): number {
  const p = MACHINE_PLANS[plan]
  return Math.round(SERVER_TYPES[p.serverType].monthlyEur * p.count * 100) / 100
}
