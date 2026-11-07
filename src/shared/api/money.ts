// IPC contract, module "money" (lot Z1): Monetisation: revenues, sponsors, offers and the P&L per channel.
// Every method added here must also be listed in MONEY_METHODS and counted, with a comment, in its area's unit test.
import type {
  CsvLine,
  OfferInput,
  OfferRow,
  PnlRow,
  PnlTotals,
  RevenueInput,
  RevenueRow,
  SponsorDealInput,
  SponsorDealRow,
  SponsorStage
} from '../money'

export interface MoneyChannel {
  id: number
  name: string
  example: boolean
}

export interface WeekPoint {
  /** Monday of the week, `YYYY-MM-DD`. */
  week: string
  revenueCents: number
  costCents: number
}

export interface MoneyOverview {
  /** Current month, `YYYY-MM`. */
  month: string
  /** The last 6 months, oldest first. */
  months: string[]
  channels: MoneyChannel[]
  rows: PnlRow[]
  totals: PnlTotals
  weekly: WeekPoint[]
  /** Typed USD → EUR rate (setting `money.usdToEur`). */
  usdToEur: number
  /** YouTube is not connected, so views (and the RPM) are unknown. */
  viewsKnown: boolean
}

export interface RevenueFilter {
  channelId?: number | null
  month?: string
}

export interface CsvPreview {
  lines: CsvLine[]
  valid: number
  invalid: number
}

export interface CsvImportResult {
  imported: number
  skipped: number
}

export interface MoneyContract {
  'money.overview': { args: []; result: MoneyOverview }

  'money.setRate': { args: [usdToEur: number]; result: void }

  'money.revenues.list': { args: [filter?: RevenueFilter]; result: RevenueRow[] }

  'money.revenues.save': { args: [input: RevenueInput]; result: RevenueRow }

  'money.revenues.delete': { args: [id: number]; result: void }

  'money.revenues.previewCsv': { args: [text: string]; result: CsvPreview }

  'money.revenues.importCsv': { args: [text: string]; result: CsvImportResult }

  'money.sponsors.list': { args: []; result: SponsorDealRow[] }

  'money.sponsors.save': { args: [input: SponsorDealInput]; result: SponsorDealRow }

  'money.sponsors.move': { args: [id: number, stage: SponsorStage]; result: SponsorDealRow }

  'money.sponsors.delete': { args: [id: number]; result: void }

  /** Asks the Rédacteur sponsor for a DRAFT message and stores it on the deal. Nothing is ever sent. */
  'money.sponsors.draft': { args: [id: number]; result: SponsorDealRow }

  'money.offers.list': { args: []; result: OfferRow[] }

  'money.offers.save': { args: [input: OfferInput]; result: OfferRow }

  'money.offers.delete': { args: [id: number]; result: void }

  /** One model call: 3 ideas, 5 names, prices and a sales funnel, parsed and stored on the offer. */
  'money.offers.pack': { args: [id: number]; result: OfferRow }
}

export const MONEY_METHODS = [
  'money.overview',
  'money.setRate',
  'money.revenues.list',
  'money.revenues.save',
  'money.revenues.delete',
  'money.revenues.previewCsv',
  'money.revenues.importCsv',
  'money.sponsors.list',
  'money.sponsors.save',
  'money.sponsors.move',
  'money.sponsors.delete',
  'money.sponsors.draft',
  'money.offers.list',
  'money.offers.save',
  'money.offers.delete',
  'money.offers.pack'
] as const satisfies readonly (keyof MoneyContract)[]
