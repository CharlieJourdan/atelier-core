// Lot Z1, Monétisation: the pure P&L, weeks and months, CSV parsing (hand numbers).
import { describe, expect, it } from 'vitest'
import {
  computePnl,
  lastMonths,
  lastWeeks,
  parseAmountCents,
  parseDate,
  parseRevenueCsv,
  splitCsvLine,
  totalsFor,
  weekStart,
  extractOfferBlock,
  type PnlInput
} from '../../src/shared/money'

const base = (over: Partial<PnlInput> = {}): PnlInput => ({
  months: ['2026-10'],
  channels: [{ id: 1, example: false }],
  revenues: [],
  aiUsd: [],
  credits: [],
  published: [],
  usdToEur: 0.5,
  ...over
})

describe('P&L (hand numbers)', () => {
  it('adds revenues by type, converts USD at the typed rate and derives margin, cost per video and break-even', () => {
    const rows = computePnl(
      base({
        revenues: [
          { date: '2026-10-03', channelId: 1, type: 'adsense', amountCents: 10000, currency: 'EUR', source: 'manual' },
          { date: '2026-10-09', channelId: 1, type: 'sponsor', amountCents: 2000, currency: 'USD', source: 'csv' },
          { date: '2026-09-30', channelId: 1, type: 'adsense', amountCents: 99999, currency: 'EUR', source: 'manual' }
        ],
        aiUsd: [{ channelId: 1, month: '2026-10', usd: 3 }],
        credits: [{ channelId: 1, month: '2026-10', credits: 250 }],
        published: [{ channelId: 1, month: '2026-10', count: 2 }]
      })
    )
    expect(rows).toHaveLength(1)
    const r = rows[0]!
    expect(r.revenueByType).toEqual({ adsense: 10000, sponsor: 1000, product: 0, affiliate: 0, other: 0 })
    expect(r.revenueCents).toBe(11000)
    expect(r.aiCents).toBe(150) // 3 USD * 100 * 0.5
    expect(r.engineCents).toBe(250) // 250 credits, 1 credit = 0,01 EUR
    expect(r.toolsCents).toBe(0)
    expect(r.costCents).toBe(400)
    expect(r.marginCents).toBe(10600)
    expect(r.costPerVideoCents).toBe(200)
    expect(r.breakEvenVideos).toBe(1) // ceil(400 / (11000 / 2))
    expect(r.rpmCents).toBeNull() // views unknown
    expect(r.views).toBeNull()
    expect(r.sources.ai).toBe('measured')
    expect(r.sources.revenue).toBe('entered')
    expect(r.sources.tools).toBe('estimated')
  })

  it('computes the RPM only when the views are known (revenue / views * 1000)', () => {
    const rows = computePnl(
      base({
        revenues: [{ date: '2026-10-03', channelId: 1, type: 'adsense', amountCents: 11000, currency: 'EUR', source: 'manual' }],
        views: [{ channelId: 1, month: '2026-10', views: 50000 }]
      })
    )
    expect(rows[0]!.rpmCents).toBe(220)
    expect(totalsFor(rows, '2026-10').rpmCents).toBe(220)
  })

  it('never counts a demo row, and counts an example row only for an example channel', () => {
    const rows = computePnl(
      base({
        channels: [
          { id: 1, example: false },
          { id: 2, example: true }
        ],
        revenues: [
          { date: '2026-10-03', channelId: 1, type: 'adsense', amountCents: 5000, currency: 'EUR', source: 'demo' },
          { date: '2026-10-03', channelId: 1, type: 'adsense', amountCents: 7000, currency: 'EUR', source: 'example' },
          { date: '2026-10-03', channelId: 2, type: 'adsense', amountCents: 3000, currency: 'EUR', source: 'example' }
        ]
      })
    )
    const byChannel = Object.fromEntries(rows.map((r) => [r.channelId, r]))
    expect(byChannel[1]!.revenueCents).toBe(0)
    expect(byChannel[2]!.revenueCents).toBe(3000)
    expect(byChannel[2]!.sources.revenue).toBe('example')
  })

  it('has no cost per video or break-even without a published video, and keeps an unassigned line when needed', () => {
    const rows = computePnl(base({ aiUsd: [{ channelId: null, month: '2026-10', usd: 2 }] }))
    const un = rows.find((r) => r.channelId === null)!
    expect(un.aiCents).toBe(100)
    expect(un.costPerVideoCents).toBeNull()
    expect(un.breakEvenVideos).toBeNull()
    expect(un.marginCents).toBe(-100)
  })

  it('totals a month over all channels', () => {
    const rows = computePnl(
      base({
        channels: [
          { id: 1, example: false },
          { id: 2, example: false }
        ],
        revenues: [
          { date: '2026-10-01', channelId: 1, type: 'adsense', amountCents: 100, currency: 'EUR', source: 'manual' },
          { date: '2026-10-02', channelId: 2, type: 'product', amountCents: 250, currency: 'EUR', source: 'manual' }
        ],
        credits: [{ channelId: 2, month: '2026-10', credits: 50 }]
      })
    )
    expect(totalsFor(rows, '2026-10')).toMatchObject({ revenueCents: 350, costCents: 50, marginCents: 300, views: null, rpmCents: null })
  })
})

describe('months and weeks', () => {
  it('lists the last months across a year boundary', () => {
    expect(lastMonths(new Date('2026-02-10T00:00:00Z'), 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })

  it('finds the Monday of a week and the last 8 weeks', () => {
    expect(weekStart('2026-10-20T12:00:00Z')).toBe('2026-10-19') // a Tuesday
    expect(weekStart('2026-10-18')).toBe('2026-10-12') // a Sunday belongs to the week before
    const weeks = lastWeeks(new Date('2026-10-20T12:00:00Z'), 8)
    expect(weeks).toHaveLength(8)
    expect(weeks[7]).toBe('2026-10-19')
    expect(weeks[0]).toBe('2026-08-31')
  })
})

describe('CSV import parsing', () => {
  const channels = [
    { id: 1, name: 'Les Grandes Énigmes' },
    { id: 2, name: 'Top Savoirs' }
  ]

  it('reads French amounts', () => {
    expect(parseAmountCents('12,50')).toBe(1250)
    expect(parseAmountCents('1 234,50')).toBe(123450)
    expect(parseAmountCents('1.234,50')).toBe(123450)
    expect(parseAmountCents('1,234.50')).toBe(123450)
    expect(parseAmountCents('12.5 €')).toBe(1250)
    expect(parseAmountCents('-3,2')).toBe(-320)
    expect(parseAmountCents('abc')).toBeNull()
    expect(parseAmountCents('1,2,3')).toBeNull()
  })

  it('reads ISO and French dates and refuses impossible ones', () => {
    expect(parseDate('2026-10-05')).toBe('2026-10-05')
    expect(parseDate('5/10/2026')).toBe('2026-10-05')
    expect(parseDate('31/02/2026')).toBeNull()
    expect(parseDate('hier')).toBeNull()
  })

  it('splits quoted cells', () => {
    expect(splitCsvLine('a;"b;c";d', ';')).toEqual(['a', 'b;c', 'd'])
    expect(splitCsvLine('2026-10-01,"12,50",EUR', ',')).toEqual(['2026-10-01', '12,50', 'EUR'])
  })

  it('parses a semicolon file with a header, decimals, channel by name and type words', () => {
    const csv = ['date;montant;devise;chaîne;type;note', '2026-10-01;12,50;EUR;Top Savoirs;adsense;relevé', '05/10/2026;1 200,00;usd;les grandes enigmes;sponsoring;Lumière; suite', '', '2026-10-09;5;;;;'].join('\n')
    const lines = parseRevenueCsv(csv, channels)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ line: 2, ok: true, value: { date: '2026-10-01', amountCents: 1250, currency: 'EUR', channelId: 2, type: 'adsense', note: 'relevé' } })
    expect(lines[1]).toMatchObject({ line: 3, ok: true, value: { date: '2026-10-05', amountCents: 120000, currency: 'USD', channelId: 1, type: 'sponsor' } })
    expect(lines[1]!.value!.note).toBe('Lumière;suite')
    expect(lines[2]).toMatchObject({ line: 5, ok: true, value: { channelId: null, type: 'other', currency: 'EUR', amountCents: 500 } })
  })

  it('parses a comma file without header, with quoted decimals', () => {
    const lines = parseRevenueCsv('2026-10-01,"12,50",EUR,Top Savoirs,affiliation,x', channels)
    expect(lines[0]).toMatchObject({ ok: true, value: { amountCents: 1250, type: 'affiliate', channelId: 2 } })
  })

  it('reports one French error per bad line, with its line number', () => {
    const csv = ['date;montant', '32/13/2026;5', '2026-10-01;beaucoup', '2026-10-01;5;CHF', '2026-10-01;5;EUR;Inconnue', '2026-10-01;5;EUR;;cadeau'].join('\n')
    const lines = parseRevenueCsv(csv, channels)
    expect(lines.map((l) => l.ok)).toEqual([false, false, false, false, false])
    expect(lines.map((l) => l.line)).toEqual([2, 3, 4, 5, 6])
    expect(lines[0]!.error).toContain('Date illisible')
    expect(lines[1]!.error).toContain('Montant illisible')
    expect(lines[2]!.error).toContain('Devise inconnue')
    expect(lines[3]!.error).toContain('Chaîne inconnue')
    expect(lines[4]!.error).toContain('Type inconnu')
  })

  it('returns nothing for an empty text', () => {
    expect(parseRevenueCsv('  \n\n', channels)).toEqual([])
  })
})

describe('offer block', () => {
  it('extracts the fenced atelier-offer block', () => {
    expect(extractOfferBlock('texte\n```atelier-offer\n{"a":1}\n```\nfin')).toBe('{"a":1}')
    expect(extractOfferBlock('```json\n{}\n```')).toBeNull()
  })
})
