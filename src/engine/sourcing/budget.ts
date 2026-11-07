// The cost rules of the footage chain, as code. Every paid call (today: Gemini watching a video) is checked against a ledger BEFORE it is made
// and recorded after; free steps (archives, yt-dlp, ffmpeg, Claude on the subscription) cost 0 and are only counted. A film gets a budget
// from its length: so many searches and videos watched per finished minute, and a dollar ceiling per minute. The ledger refuses a call that
// would pass the ceiling, which is how « the quoted costs are respected » is enforced rather than hoped for.
export interface FootageBudget {
  /** Searches allowed (yt-dlp, archives: each provider call counts as one). */
  searches: number
  /** Videos watched by Gemini. */
  watches: number
  /** Ceiling in dollars for the whole run. */
  costUsd: number
}

/** About 16 searches and 14 watched videos per finished minute; 0.5 $ a minute ceiling (a watch is ≈ 0.004 $ per minute watched). */
export function footageBudget(filmMinutes: number, o: { searchesPerMin?: number; watchesPerMin?: number; costPerMinUsd?: number } = {}): FootageBudget {
  const m = Math.max(0.25, filmMinutes)
  return { searches: Math.ceil(m * (o.searchesPerMin ?? 16)), watches: Math.ceil(m * (o.watchesPerMin ?? 14)), costUsd: Math.round(m * (o.costPerMinUsd ?? 0.5) * 100) / 100 }
}

export class BudgetExceeded extends Error {
  readonly what: 'searches' | 'watches' | 'cost'
  readonly limit: number
  constructor(what: 'searches' | 'watches' | 'cost', limit: number) {
    super(`budget reached: ${what} ${limit}`)
    this.name = 'BudgetExceeded'
    this.what = what
    this.limit = limit
  }
}

export interface LedgerEntry {
  label: string
  costUsd: number
  ms?: number
}

export class CostLedger {
  readonly entries: LedgerEntry[] = []
  searches = 0
  watches = 0
  private readonly budget: FootageBudget

  constructor(budget: FootageBudget) {
    this.budget = budget
  }

  get totalUsd(): number {
    return Math.round(this.entries.reduce((s, e) => s + e.costUsd, 0) * 1e6) / 1e6
  }

  /** Throws `BudgetExceeded` when one more search would pass the limit. */
  countSearch(): void {
    if (this.searches >= this.budget.searches) throw new BudgetExceeded('searches', this.budget.searches)
    this.searches++
  }

  /** Throws when one more watch, or its worst-case cost, would pass the limit. Call BEFORE the paid call. */
  reserveWatch(maxCostUsd: number): void {
    if (this.watches >= this.budget.watches) throw new BudgetExceeded('watches', this.budget.watches)
    if (this.totalUsd + maxCostUsd > this.budget.costUsd + 1e-9) throw new BudgetExceeded('cost', this.budget.costUsd)
    this.watches++
  }

  record(label: string, costUsd: number, ms?: number): void {
    this.entries.push({ label, costUsd, ...(ms !== undefined ? { ms } : {}) })
  }

  summary(): { searches: number; watches: number; totalUsd: number; budget: FootageBudget } {
    return { searches: this.searches, watches: this.watches, totalUsd: this.totalUsd, budget: this.budget }
  }
}
