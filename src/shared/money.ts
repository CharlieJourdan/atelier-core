// Monétisation (lot Z1): types and pure logic shared by main and renderer. Amounts are integer cents; nothing here
// touches the database, the clock or the network, so every figure is tested with hand numbers.

export const REVENUE_TYPES = ['adsense', 'sponsor', 'product', 'affiliate', 'other'] as const
export type RevenueType = (typeof REVENUE_TYPES)[number]
export const CURRENCIES = ['EUR', 'USD'] as const
export type Currency = (typeof CURRENCIES)[number]
export const REVENUE_SOURCES = ['manual', 'csv', 'example'] as const
export type RevenueSource = (typeof REVENUE_SOURCES)[number]

export const SPONSOR_STAGES = ['prospect', 'contacted', 'negotiation', 'signed', 'to_deliver', 'delivered', 'paid'] as const
export type SponsorStage = (typeof SPONSOR_STAGES)[number]
export const OFFER_KINDS = ['ebook', 'course', 'site', 'service', 'other'] as const
export type OfferKind = (typeof OFFER_KINDS)[number]
export const OFFER_STATUSES = ['idea', 'building', 'ready', 'live'] as const
export type OfferStatus = (typeof OFFER_STATUSES)[number]

/** 1 engine credit = 0,01 € (PLAN-V2-PRODUCTION). */
export const CENTS_PER_CREDIT = 1
export const DEFAULT_USD_TO_EUR = 0.92

/** Where a figure comes from; every number of the P&L carries one. */
export type FigureSource = 'measured' | 'entered' | 'estimated' | 'example' | 'demo'

export interface RevenueRow {
  id: number
  date: string
  channelId: number | null
  channelName: string | null
  videoId: number | null
  type: RevenueType
  amountCents: number
  currency: Currency
  source: RevenueSource
  note: string
  example: boolean
}

export interface RevenueInput {
  id?: number
  date: string
  channelId: number | null
  videoId?: number | null
  type: RevenueType
  amountCents: number
  currency: Currency
  note?: string
}

export interface SponsorDealInput {
  id?: number
  brand: string
  contact?: string
  amountCents?: number
  currency?: Currency
  terms?: string
  requiredPhrases?: string
  link?: string
  placement?: string
  dueDate?: string | null
  videoId?: number | null
  channelId?: number | null
  stage?: SponsorStage
}

export interface SponsorDealRow {
  id: number
  brand: string
  contact: string
  amountCents: number
  currency: Currency
  terms: string
  requiredPhrases: string
  link: string
  placement: string
  dueDate: string | null
  videoId: number | null
  channelId: number | null
  channelName: string | null
  stage: SponsorStage
  draftMessage: string
  example: boolean
}

export interface OfferPack {
  ideas: { title: string; pitch: string }[]
  names: string[]
  prices: { label: string; amountEur: number }[]
  funnel: { step: string; detail: string }[]
}

export interface OfferInput {
  id?: number
  channelId?: number | null
  name: string
  kind?: OfferKind
  priceCents?: number
  status?: OfferStatus
}

export interface OfferRow {
  id: number
  channelId: number | null
  channelName: string | null
  name: string
  kind: OfferKind
  priceCents: number
  status: OfferStatus
  pack: OfferPack | null
  example: boolean
}

// ---------------------------------------------------------------------------------------------------------------
// Months and weeks

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

/** The `n` months ending at (and including) the month of `now`, oldest first, as `YYYY-MM`. */
export function lastMonths(now: Date, n: number): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/** Monday (UTC) of the week holding `iso` (a date or a timestamp), as `YYYY-MM-DD`. */
export function weekStart(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  const back = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

/** The `n` weeks ending with the week of `now`, oldest first, identified by their Monday. */
export function lastWeeks(now: Date, n: number): string[] {
  const current = new Date(`${weekStart(now.toISOString())}T00:00:00Z`)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(current)
    d.setUTCDate(d.getUTCDate() - 7 * i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// P&L

export interface PnlRevenue {
  date: string
  channelId: number | null
  type: RevenueType
  amountCents: number
  currency: Currency
  /** `demo` rows are in-memory examples of a screen: they never count. */
  source: RevenueSource | 'demo'
}

export interface PnlInput {
  months: readonly string[]
  channels: readonly { id: number; example: boolean }[]
  revenues: readonly PnlRevenue[]
  /** Spend ledger, USD, by channel and month (`channelId` null = not attributed to a channel). */
  aiUsd: readonly { channelId: number | null; month: string; usd: number }[]
  /** Engine credits of real runs (demo = 0) by channel and month. */
  credits: readonly { channelId: number | null; month: string; credits: number }[]
  /** Tool costs in cents (0 until real executions exist, lot 18). */
  toolsCents?: readonly { channelId: number | null; month: string; cents: number }[]
  /** Published videos by channel and month. */
  published: readonly { channelId: number | null; month: string; count: number }[]
  /** Views by channel and month: only when YouTube is connected. */
  views?: readonly { channelId: number | null; month: string; views: number }[] | null
  usdToEur: number
}

export interface PnlRow {
  channelId: number | null
  month: string
  revenueByType: Record<RevenueType, number>
  revenueCents: number
  aiCents: number
  engineCents: number
  toolsCents: number
  costCents: number
  marginCents: number
  /** RPM in cents per 1000 views; null while the views are unknown. */
  rpmCents: number | null
  views: number | null
  publishedVideos: number
  /** Cost of a published video; null when none was published that month. */
  costPerVideoCents: number | null
  /** Videos needed at the month's average revenue per video to pay its costs; null when it cannot be said. */
  breakEvenVideos: number | null
  sources: { revenue: FigureSource; ai: FigureSource; engine: FigureSource; tools: FigureSource; margin: FigureSource; rpm: FigureSource }
}

export const emptyByType = (): Record<RevenueType, number> => ({ adsense: 0, sponsor: 0, product: 0, affiliate: 0, other: 0 })

/** USD cents → EUR cents at the typed rate. */
export function usdToEurCents(usdCents: number, rate: number): number {
  return Math.round(usdCents * rate)
}

/** A revenue counts unless it is a demo row, or an example row outside an example channel. */
export function revenueCounts(r: PnlRevenue, exampleChannelIds: ReadonlySet<number>): boolean {
  if (r.source === 'demo') return false
  if (r.source === 'example') return r.channelId !== null && exampleChannelIds.has(r.channelId)
  return true
}

export function computePnl(input: PnlInput): PnlRow[] {
  const exampleIds = new Set(input.channels.filter((c) => c.example).map((c) => c.id))
  const ids: (number | null)[] = input.channels.map((c) => c.id)
  const hasUnassigned =
    input.revenues.some((r) => r.channelId === null) || input.aiUsd.some((r) => r.channelId === null && r.usd > 0) || input.credits.some((r) => r.channelId === null && r.credits > 0)
  if (hasUnassigned) ids.push(null)
  const sum = <T extends { channelId: number | null; month: string }>(rows: readonly T[], id: number | null, month: string, pick: (r: T) => number): number =>
    rows.filter((r) => r.channelId === id && r.month === month).reduce((s, r) => s + pick(r), 0)
  const rows: PnlRow[] = []
  for (const id of ids) {
    const isExample = id !== null && exampleIds.has(id)
    for (const month of input.months) {
      const mine = input.revenues.filter((r) => r.channelId === id && monthOf(r.date) === month && revenueCounts(r, exampleIds))
      const revenueByType = emptyByType()
      let anyEntered = false
      for (const r of mine) {
        revenueByType[r.type] += r.currency === 'USD' ? usdToEurCents(r.amountCents, input.usdToEur) : r.amountCents
        if (r.source !== 'example') anyEntered = true
      }
      const revenueCents = REVENUE_TYPES.reduce((s, k) => s + revenueByType[k], 0)
      const aiCents = Math.round(sum(input.aiUsd, id, month, (r) => r.usd) * 100 * input.usdToEur)
      const engineCents = Math.round(sum(input.credits, id, month, (r) => r.credits) * CENTS_PER_CREDIT)
      const toolsCents = sum(input.toolsCents ?? [], id, month, (r) => r.cents)
      const costCents = aiCents + engineCents + toolsCents
      const publishedVideos = sum(input.published, id, month, (r) => r.count)
      const viewsRows = input.views ?? null
      const views = viewsRows === null ? null : sum(viewsRows, id, month, (r) => r.views)
      const rpmCents = views !== null && views > 0 ? Math.round((revenueCents / views) * 1000) : null
      const perVideoRevenue = publishedVideos > 0 ? revenueCents / publishedVideos : 0
      const base: FigureSource = isExample ? 'example' : 'measured'
      rows.push({
        channelId: id,
        month,
        revenueByType,
        revenueCents,
        aiCents,
        engineCents,
        toolsCents,
        costCents,
        marginCents: revenueCents - costCents,
        rpmCents,
        views,
        publishedVideos,
        costPerVideoCents: publishedVideos > 0 ? Math.round(costCents / publishedVideos) : null,
        breakEvenVideos: publishedVideos > 0 && perVideoRevenue > 0 && costCents > 0 ? Math.ceil(costCents / perVideoRevenue) : null,
        sources: {
          revenue: isExample && !anyEntered ? 'example' : 'entered',
          ai: base,
          engine: base,
          tools: 'estimated',
          margin: isExample ? 'example' : 'estimated',
          rpm: views === null ? 'estimated' : 'measured'
        }
      })
    }
  }
  return rows
}

/** Figures of the example workspace: always apart from the real totals, shown with an EXEMPLE badge. */
export interface ExampleFigures {
  revenueCents: number
  costCents: number
  marginCents: number
  /** Per week (Monday): filled by the overview, `[]` from `totalsFor`. */
  weekly: { week: string; revenueCents: number; costCents: number }[]
}

export interface PnlTotals {
  revenueCents: number
  costCents: number
  marginCents: number
  views: number | null
  rpmCents: number | null
  /** The example channels' figures of the month (NOT in the fields above); null when there are none. */
  example: ExampleFigures | null
}

/** Totals of the REAL rows of one month (all channels); example rows are summed apart in `example`. */
export function totalsFor(rows: readonly PnlRow[], month: string): PnlTotals {
  const inMonth = rows.filter((r) => r.month === month)
  const mine = inMonth.filter((r) => r.sources.margin !== 'example')
  const ex = inMonth.filter((r) => r.sources.margin === 'example')
  const revenueCents = mine.reduce((s, r) => s + r.revenueCents, 0)
  const costCents = mine.reduce((s, r) => s + r.costCents, 0)
  const known = mine.length > 0 && mine.every((r) => r.views !== null)
  const views = known ? mine.reduce((s, r) => s + (r.views ?? 0), 0) : null
  const exRevenue = ex.reduce((s, r) => s + r.revenueCents, 0)
  const exCost = ex.reduce((s, r) => s + r.costCents, 0)
  return {
    revenueCents,
    costCents,
    marginCents: revenueCents - costCents,
    views,
    rpmCents: views !== null && views > 0 ? Math.round((revenueCents / views) * 1000) : null,
    example: ex.length > 0 ? { revenueCents: exRevenue, costCents: exCost, marginCents: exRevenue - exCost, weekly: [] } : null
  }
}

// ---------------------------------------------------------------------------------------------------------------
// CSV import: date;montant;devise;chaîne;type;note (`;` or `,`, French decimals)

export interface CsvChannel {
  id: number
  name: string
}

export interface CsvLine {
  /** 1-based line number in the pasted text. */
  line: number
  ok: boolean
  error?: string
  value?: { date: string; amountCents: number; currency: Currency; channelId: number | null; type: RevenueType; note: string }
}

const TYPE_WORDS: Record<string, RevenueType> = {
  adsense: 'adsense',
  youtube: 'adsense',
  pub: 'adsense',
  publicite: 'adsense',
  sponsor: 'sponsor',
  sponsoring: 'sponsor',
  product: 'product',
  produit: 'product',
  produits: 'product',
  stripe: 'product',
  affiliate: 'affiliate',
  affiliation: 'affiliate',
  other: 'other',
  autre: 'other',
  autres: 'other'
}

const stripAccents = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Splits one CSV line on `sep`, honouring double quotes. */
export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === sep) {
      out.push(cur.trim())
      cur = ''
    } else cur += c
  }
  out.push(cur.trim())
  return out
}

/** « 12,50 » « 1 234,50 » « 1.234,50 » « 12.5 » « 12,50 € » → cents, or null when it is not an amount. */
export function parseAmountCents(raw: string): number | null {
  let s = raw.replace(/[\s\u00a0\u202f\u20ac$]/g, '')
  if (!/^-?[\d.,]+$/.test(s) || !/\d/.test(s)) return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) {
    // The later separator is the decimal one; the other groups thousands.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (lastComma >= 0) {
    if (s.split(',').length > 2) return null
    s = s.replace(',', '.')
  } else if (s.split('.').length > 2) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

/** `2026-10-05` or `05/10/2026` → `2026-10-05`, or null. */
export function parseDate(raw: string): string | null {
  let y: number, m: number, d: number
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  const fr = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(raw)
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (fr) [d, m, y] = [Number(fr[1]), Number(fr[2]), Number(fr[3])]
  else return null
  const check = new Date(Date.UTC(y, m - 1, d))
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const HEADER_WORDS = ['date', 'montant', 'amount', 'devise', 'currency']

export function parseRevenueCsv(text: string, channels: readonly CsvChannel[]): CsvLine[] {
  const raw = text.replace(/^\ufeff/, '').split(/\r?\n/)
  const lines = raw.map((content, i) => ({ content, line: i + 1 })).filter((l) => l.content.trim() !== '')
  if (lines.length === 0) return []
  const first = lines[0]!.content
  const sep = first.includes(';') ? ';' : ','
  const firstCells = splitCsvLine(first, sep).map((c) => stripAccents(c.toLowerCase()))
  const hasHeader = firstCells.some((c) => HEADER_WORDS.includes(c)) && parseDate(firstCells[0] ?? '') === null
  const out: CsvLine[] = []
  for (const { content, line } of hasHeader ? lines.slice(1) : lines) {
    const cells = splitCsvLine(content, sep)
    const [dateRaw = '', amountRaw = '', currencyRaw = '', channelRaw = '', typeRaw = '', ...noteParts] = cells
    const fail = (error: string): void => void out.push({ line, ok: false, error })
    const date = parseDate(dateRaw)
    if (!date) {
      fail(`Date illisible « ${dateRaw} » (attendu : AAAA-MM-JJ ou JJ/MM/AAAA).`)
      continue
    }
    const amountCents = parseAmountCents(amountRaw)
    if (amountCents === null) {
      fail(`Montant illisible « ${amountRaw} » (exemple : 12,50).`)
      continue
    }
    const cur = currencyRaw.trim().toUpperCase().replace('€', 'EUR').replace('$', 'USD')
    const currency: Currency | null = cur === '' ? 'EUR' : (CURRENCIES as readonly string[]).includes(cur) ? (cur as Currency) : null
    if (!currency) {
      fail(`Devise inconnue « ${currencyRaw} » (EUR ou USD).`)
      continue
    }
    let channelId: number | null = null
    if (channelRaw !== '') {
      const wanted = stripAccents(channelRaw.toLowerCase())
      const found = channels.find((c) => stripAccents(c.name.toLowerCase()) === wanted) ?? channels.find((c) => String(c.id) === channelRaw)
      if (!found) {
        fail(`Chaîne inconnue « ${channelRaw} ».`)
        continue
      }
      channelId = found.id
    }
    const typeKey = stripAccents(typeRaw.toLowerCase())
    const type = typeKey === '' ? 'other' : TYPE_WORDS[typeKey]
    if (!type) {
      fail(`Type inconnu « ${typeRaw} » (adsense, sponsor, produit, affiliation, autre).`)
      continue
    }
    out.push({ line, ok: true, value: { date, amountCents, currency, channelId, type, note: noteParts.join(sep).trim() } })
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Offer pack (answer of the model: one fenced ```atelier-offer {json}``` block)

/** The JSON of the first ```atelier-offer block of `text`, or null. */
export function extractOfferBlock(text: string): string | null {
  const m = /```atelier-offer[ \t]*\r?\n([\s\S]*?)```/.exec(text)
  return m ? m[1]!.trim() : null
}

// ---------------------------------------------------------------------------------------------------------------
// Formatting

export function centsToEur(cents: number): number {
  return cents / 100
}
