// « Coûts et rentabilité » on the real Atelier Cloud: the shapes of GET /v1/admin/finance (src/shared/cloud-admin-finance.ts,
// copied here as types: the site does not bundle zod contracts), the formatting in French and the calls. Pure helpers,
// tested in tests/unit/site-admin-costs.test.tsx.
import { cloudCall } from '../cloud'

export type FinancePeriod = 'day' | 'week' | 'month' | 'all'
export type Currency = 'USD' | 'EUR'

export interface FinanceTeamRow {
  teamId: string
  teamName: string
  ownerEmail: string | null
  internal: boolean
  /** A test team (record 0066): its credits are test credits. */
  test?: boolean
  creditsOffered: number
  creditsBought: number
  creditsSpent: number
  balance: number
  offeredLeft: number
  jobs: number
  costUsdCents: number
  costEurCents: number
  revenueEurCents: number
  marginEurCents: number
  videos: number
  minutes: number
  costPerMinuteEurCents: number | null
}

export type FinanceTotals = Omit<FinanceTeamRow, 'teamId' | 'teamName' | 'ownerEmail' | 'internal' | 'test'>

export interface FinanceProviderRow {
  provider: string
  engine: string | null
  demo: boolean
  calls: number
  succeeded: number
  failed: number
  cancelled: number
  creditsBilled: number
  costUsdCents: number
  costEurCents: number
  estimated: number
}

export interface FinanceFixedCost {
  id: string
  label: string
  amountCents: number
  currency: Currency
  note: string | null
  monthlyEurCents: number
  auto: boolean
  demo: boolean
}

export interface FinanceAlert {
  jobId: string
  teamName: string
  provider: string
  engine: string | null
  at: string
  quotedUsdCents: number
  realUsdCents: number
  overPct: number
}

export interface FinanceSettings {
  priceMultiplier: number | null
  eurPerUsd: number
  fxAsOf: string
  creditValueEur: number
}

export interface FinanceDashboard {
  period: FinancePeriod
  from: string | null
  to: string
  includeDemo: boolean
  demoCallsHidden: number
  paymentsSimulated: boolean
  settings: FinanceSettings
  top: { offeredLeftCredits: number; offeredLeftCostEurCents: number; monthCostUsdCents: number; monthCostEurCents: number; monthCreditsSpent: number; alerts: number }
  teams: FinanceTeamRow[]
  totals: FinanceTotals
  providers: FinanceProviderRow[]
  spend: { bucket: string; costUsdCents: number; credits: number }[]
  fixed: {
    costs: FinanceFixedCost[]
    monthlyEurCents: number
    month: { revenueEurCents: number; providerCostEurCents: number; fixedEurCents: number; resultEurCents: number; minutes: number }
    costPerMinuteEurCents: number | null
    marginPerMinuteEurCents: number | null
    breakEvenMinutes: number | null
    breakEvenAt: { multiplier: number; minutes: number | null }
  }
  alerts: FinanceAlert[]
}

export const PERIODS: { id: FinancePeriod; label: string }[] = [
  { id: 'day', label: 'Aujourd’hui' },
  { id: 'week', label: '7 derniers jours' },
  { id: 'month', label: 'Ce mois-ci' },
  { id: 'all', label: 'Depuis le début' }
]

/** Euros from cents; amounts under one euro keep their cents, bigger ones too (money is never rounded away here). */
export const eur = (cents: number): string => (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
/** Dollars from cents, with fractions of a cent when the amount is small (an image costs 0,3 cent). */
export const usd = (cents: number): string =>
  (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: Math.abs(cents) < 100 && cents !== 0 ? 4 : 2 })
export const num = (n: number): string => n.toLocaleString('fr-FR')
export const minutes = (n: number): string => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
export const multiplierLabel = (m: number | null): string => (m === null ? 'marges de la grille' : `× ${m.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
export const marginPctLabel = (m: number | null): string => (m === null ? 'par ligne' : `${Math.round((m - 1) * 100)} %`)

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

/** A spend bucket's label: « 14 h » (a day), « 01/11 » (a week, a month), « nov. 26 » (all time). */
export function bucketLabel(bucket: string): string {
  if (bucket.length === 13) return `${Number(bucket.slice(11, 13))} h`
  if (bucket.length === 10) return `${bucket.slice(8, 10)}/${bucket.slice(5, 7)}`
  return `${MONTHS[Number(bucket.slice(5, 7)) - 1] ?? bucket.slice(5, 7)} ${bucket.slice(2, 4)}`
}

export type TeamSortKey = 'teamName' | 'creditsOffered' | 'creditsBought' | 'creditsSpent' | 'costEurCents' | 'revenueEurCents' | 'marginEurCents' | 'videos' | 'minutes' | 'costPerMinuteEurCents'

/** Sorted copy; names A → Z by default, numbers biggest first; a missing cost per minute sorts last. */
export function sortTeams(rows: readonly FinanceTeamRow[], key: TeamSortKey, dir: 'asc' | 'desc'): FinanceTeamRow[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (key === 'teamName') return sign * a.teamName.localeCompare(b.teamName, 'fr')
    const x = a[key]
    const y = b[key]
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    return sign * (x - y)
  })
}

export const financePath = (period: FinancePeriod, includeDemo: boolean): string => `/v1/admin/finance?period=${period}${includeDemo ? '&demo=1' : ''}`

export const fetchFinance = (period: FinancePeriod, includeDemo: boolean): Promise<FinanceDashboard> => cloudCall<FinanceDashboard>(financePath(period, includeDemo))

export const saveSettings = (body: { priceMultiplier?: number | null; eurPerUsd?: number; fxAsOf?: string }): Promise<FinanceSettings> =>
  cloudCall<FinanceSettings>('/v1/admin/finance/settings', { method: 'POST', body })

export const saveFixedCost = (body: { id?: string; label: string; amountCents: number; currency: Currency; note?: string | null }): Promise<{ ok: true; cost: FinanceFixedCost }> =>
  cloudCall('/v1/admin/finance/fixed-costs', { method: 'POST', body })

export const removeFixedCost = (id: string): Promise<{ ok: true }> => cloudCall(`/v1/admin/finance/fixed-costs/${encodeURIComponent(id)}/remove`, { method: 'POST' })

/** « 49 » or « 49,5 » typed in a form → cents; null when it is not an amount. */
export function parseAmount(text: string): number | null {
  const v = Number(text.trim().replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(v) && v >= 0 && v <= 1_000_000 ? Math.round(v * 100) : null
}
