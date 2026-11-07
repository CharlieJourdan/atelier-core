// The founder console's money dashboard (console-depenses, decision 0040): spending and profitability per team, per
// provider and engine, the fixed costs and the overall result. Platform admins only.
//
// A separate file from cloud-api.ts (already large): it imports only zod, so the Cloud (type stripping) and the web
// console both read it as it is. Money: provider costs are dollars (`…UsdCents`, may carry fractions of a cent),
// converted to euros with the dated rate of the settings (`…EurCents`); revenue is what billing charged, in euro cents.
import { z } from 'zod'

export const FINANCE_PERIODS = ['day', 'week', 'month', 'all'] as const
export const FinancePeriod = z.enum(FINANCE_PERIODS)
export type FinancePeriod = z.infer<typeof FinancePeriod>

/** `demo=1` also counts the calls the fakes answered (their cost is what the real provider would have billed). */
export const FinanceQuery = z.object({ period: FinancePeriod.default('month'), demo: z.enum(['0', '1']).optional() })

const Cents = z.number()
const Count = z.number().int()

export const FinanceTeamRow = z.object({
  teamId: z.string(),
  teamName: z.string(),
  ownerEmail: z.string().nullable(),
  /** Charlie's own team: pays the real cost (§4.10). */
  internal: z.boolean(),
  /** A test team (record 0066): its credits are test credits, its member never signs in with a password. */
  test: z.boolean().default(false),
  /** Credits an admin gave (grants and corrections) in the period. */
  creditsOffered: Count,
  /** Credits paid for (plans, packs, top-ups) in the period. */
  creditsBought: Count,
  /** Credits captured by finished jobs in the period. */
  creditsSpent: Count,
  balance: Count,
  /** Offered credits not spent yet, all time (spending uses the offered credits first). */
  offeredLeft: Count,
  jobs: Count,
  costUsdCents: Cents,
  costEurCents: Cents,
  revenueEurCents: Cents,
  marginEurCents: Cents,
  videos: Count,
  minutes: z.number(),
  costPerMinuteEurCents: Cents.nullable()
})
export type FinanceTeamRow = z.infer<typeof FinanceTeamRow>

export const FinanceTotals = FinanceTeamRow.omit({ teamId: true, teamName: true, ownerEmail: true, internal: true, test: true })
export type FinanceTotals = z.infer<typeof FinanceTotals>

export const FinanceProviderRow = z.object({
  provider: z.string(),
  engine: z.string().nullable(),
  demo: z.boolean(),
  calls: Count,
  succeeded: Count,
  /** Failed calls: their credits went back, nothing was billed. */
  failed: Count,
  cancelled: Count,
  creditsBilled: Count,
  costUsdCents: Cents,
  costEurCents: Cents,
  /** Succeeded calls whose provider reported no cost: counted at their quote's cost. */
  estimated: Count
})
export type FinanceProviderRow = z.infer<typeof FinanceProviderRow>

export const FinanceSpendPoint = z.object({ bucket: z.string(), costUsdCents: Cents, credits: Count })
export type FinanceSpendPoint = z.infer<typeof FinanceSpendPoint>

export const FinanceCurrency = z.enum(['USD', 'EUR'])

export const FinanceFixedCost = z.object({
  id: z.string(),
  label: z.string(),
  amountCents: Count,
  currency: FinanceCurrency,
  note: z.string().nullable(),
  monthlyEurCents: Cents,
  /** Computed by the Cloud (the team computers), not typed in. */
  auto: z.boolean(),
  /** A computed line on the fake machine provider: shown, not counted. */
  demo: z.boolean()
})
export type FinanceFixedCost = z.infer<typeof FinanceFixedCost>

export const FinanceAlert = z.object({
  jobId: z.string(),
  teamName: z.string(),
  provider: z.string(),
  engine: z.string().nullable(),
  at: z.string(),
  quotedUsdCents: Cents,
  realUsdCents: Cents,
  overPct: z.number()
})
export type FinanceAlert = z.infer<typeof FinanceAlert>

export const FinanceSettingsView = z.object({
  /** null: the grid's margin per line. 1 = sold at cost (the beta rule). */
  priceMultiplier: z.number().nullable(),
  eurPerUsd: z.number(),
  fxAsOf: z.string(),
  creditValueEur: z.number()
})
export type FinanceSettingsView = z.infer<typeof FinanceSettingsView>

export const FinanceDashboard = z.object({
  period: FinancePeriod,
  from: z.string().nullable(),
  to: z.string(),
  includeDemo: z.boolean(),
  demoCallsHidden: Count,
  paymentsSimulated: z.boolean(),
  settings: FinanceSettingsView,
  top: z.object({
    offeredLeftCredits: Count,
    /** What the offered credits left would cost us in provider fees if they were all spent. */
    offeredLeftCostEurCents: Cents,
    monthCostUsdCents: Cents,
    monthCostEurCents: Cents,
    monthCreditsSpent: Count,
    alerts: Count
  }),
  teams: z.array(FinanceTeamRow),
  totals: FinanceTotals,
  providers: z.array(FinanceProviderRow),
  spend: z.array(FinanceSpendPoint),
  fixed: z.object({
    costs: z.array(FinanceFixedCost),
    monthlyEurCents: Cents,
    /** This calendar month: revenue − provider costs − fixed costs. */
    month: z.object({ revenueEurCents: Cents, providerCostEurCents: Cents, fixedEurCents: Cents, resultEurCents: Cents, minutes: z.number() }),
    /** All time, from the finished videos that carry a length. */
    costPerMinuteEurCents: Cents.nullable(),
    marginPerMinuteEurCents: Cents.nullable(),
    /** Finished minutes a month that pay the fixed costs at the current margin; null when the margin is 0 or less. */
    breakEvenMinutes: z.number().nullable(),
    /** The same at a reference multiplier, to read what a margin would change. */
    breakEvenAt: z.object({ multiplier: z.number(), minutes: z.number().nullable() })
  }),
  alerts: z.array(FinanceAlert)
})
export type FinanceDashboard = z.infer<typeof FinanceDashboard>

export const FinanceSettingsRequest = z.object({
  priceMultiplier: z.number().min(1).max(5).nullable().optional(),
  eurPerUsd: z.number().gt(0).lt(10).optional(),
  fxAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
})

export const FixedCostRequest = z.object({
  id: z.string().max(60).optional(),
  label: z.string().min(1).max(120),
  amountCents: z.number().int().min(0).max(100_000_000),
  currency: FinanceCurrency,
  note: z.string().max(300).nullable().optional()
})

export const FixedCostResponse = z.object({ ok: z.literal(true), cost: FinanceFixedCost })
export const FinanceOkResponse = z.object({ ok: z.literal(true) })

export interface FinanceRoute {
  method: 'GET' | 'POST'
  path: string
  auth: 'platformAdmin'
  body?: z.ZodType
  query?: z.ZodType
  response: z.ZodType
}

export const ADMIN_FINANCE_ROUTES = {
  financeDashboard: { method: 'GET', path: '/v1/admin/finance', auth: 'platformAdmin', query: FinanceQuery, response: FinanceDashboard },
  financeSettings: { method: 'POST', path: '/v1/admin/finance/settings', auth: 'platformAdmin', body: FinanceSettingsRequest, response: FinanceSettingsView },
  financeSaveFixedCost: { method: 'POST', path: '/v1/admin/finance/fixed-costs', auth: 'platformAdmin', body: FixedCostRequest, response: FixedCostResponse },
  financeRemoveFixedCost: { method: 'POST', path: '/v1/admin/finance/fixed-costs/:id/remove', auth: 'platformAdmin', response: FinanceOkResponse }
} as const satisfies Record<string, FinanceRoute>
