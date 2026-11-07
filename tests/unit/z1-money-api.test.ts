// Lot Z1, Monétisation: the money IPC methods, stores, overview, drafts, offer packs and the example rows.
import { describe, expect, it } from 'vitest'
import { MONEY_METHODS } from '../../src/shared/api'
import { FakeProvider } from '../../src/main/llm/fake'
import { moneyApi } from '../../src/main/api/money'
import { lastMonths } from '../../src/shared/money'
import { memoryCore } from './helpers'

const NOW = new Date()
const today = NOW.toISOString().slice(0, 10)
const month = today.slice(0, 7)

const PACK = {
  ideas: [
    { title: 'Guide PDF', pitch: 'Les 50 énigmes' },
    { title: 'Mini-cours', pitch: 'Raconter sans visage' },
    { title: 'Modèles de scripts', pitch: 'Prêts à remplir' }
  ],
  names: ['Énigmes', 'Dossiers Secrets', 'Mystères Vérifiés', 'Archives Vivantes', 'Le Carnet']
  ,
  prices: [{ label: 'Guide', amountEur: 14.9 }],
  funnel: [
    { step: 'Vidéo', detail: 'Appel dans la vidéo' },
    { step: 'Page de vente', detail: 'Présentation et prix' }
  ]
}
const packReply = (pack: unknown = PACK): string => `Voici ton pack.\n\`\`\`atelier-offer\n${JSON.stringify(pack)}\n\`\`\`\n`

function channel(core: ReturnType<typeof memoryCore>, name = 'Ma chaîne'): number {
  return Number(core.db.prepare('INSERT INTO channels (name) VALUES (?)').run(name).lastInsertRowid)
}

describe('money module', () => {
  it('lists its IPC methods (one comment per method)', () => {
    expect([...MONEY_METHODS]).toEqual([
      'money.overview', // P&L per channel and month, tiles, weekly curve
      'money.setRate', // the typed USD to EUR rate
      'money.revenues.list', // revenues, filterable by channel and month
      'money.revenues.save', // add or edit a revenue
      'money.revenues.delete', // delete a revenue
      'money.revenues.previewCsv', // CSV preview with per-line errors
      'money.revenues.importCsv', // import the valid CSV lines
      'money.sponsors.list', // sponsor deals
      'money.sponsors.save', // add or edit a deal
      'money.sponsors.move', // change the stage of a deal
      'money.sponsors.delete', // delete a deal
      'money.sponsors.draft', // model-written DRAFT message stored on the deal
      'money.offers.list', // offers
      'money.offers.save', // add or edit an offer
      'money.offers.delete', // delete an offer
      'money.offers.pack' // model-written offer pack parsed and stored
    ])
  })

  it('saves, edits, lists and deletes a revenue, and refuses bad arguments in French', async () => {
    const core = memoryCore()
    try {
      const cid = channel(core)
      const r = await core.api['money.revenues.save']({ date: today, channelId: cid, type: 'adsense', amountCents: 1234, currency: 'EUR', note: ' relevé ' })
      expect(r).toMatchObject({ channelName: 'Ma chaîne', amountCents: 1234, source: 'manual', note: 'relevé', example: false })
      const e = await core.api['money.revenues.save']({ id: r.id, date: today, channelId: cid, type: 'sponsor', amountCents: 2000, currency: 'USD' })
      expect(e).toMatchObject({ id: r.id, type: 'sponsor', currency: 'USD' })
      expect(await core.api['money.revenues.list']({ month })).toHaveLength(1)
      expect(await core.api['money.revenues.list']({ month: '2001-01' })).toHaveLength(0)
      expect(() => core.api['money.revenues.save']({ date: 'hier', channelId: cid, type: 'adsense', amountCents: 1, currency: 'EUR' })).toThrow('Date invalide')
      expect(() => core.api['money.revenues.save']({ date: today, channelId: 999, type: 'adsense', amountCents: 1, currency: 'EUR' })).toThrow('Chaîne introuvable')
      expect(() => core.api['money.revenues.save']({ date: today, channelId: cid, type: 'cadeau' as never, amountCents: 1, currency: 'EUR' })).toThrow('Type')
      expect(() => core.api['money.revenues.save']({ date: today, channelId: cid, type: 'adsense', amountCents: 1.5, currency: 'EUR' })).toThrow('Montant')
      expect(() => core.api['money.revenues.list']({ month: 'octobre' })).toThrow('Mois invalide')
      await core.api['money.revenues.delete'](r.id)
      expect(await core.api['money.revenues.list']()).toHaveLength(0)
      expect(() => core.api['money.revenues.delete'](r.id)).toThrow('introuvable')
    } finally {
      core.close()
    }
  })

  it('previews and imports a CSV: valid lines in, bad lines reported, nothing imported when all are bad', async () => {
    const core = memoryCore()
    try {
      channel(core, 'Top Savoirs')
      const csv = `date;montant;devise;chaîne;type;note\n${today};12,50;EUR;Top Savoirs;adsense;a\n${today};oups;EUR;;;\n${today};3;USD;;produit;b`
      const preview = await core.api['money.revenues.previewCsv'](csv)
      expect(preview).toMatchObject({ valid: 2, invalid: 1 })
      expect(preview.lines[1]!.error).toContain('Montant illisible')
      expect(await core.api['money.revenues.list']()).toHaveLength(0) // a preview writes nothing
      expect(await core.api['money.revenues.importCsv'](csv)).toEqual({ imported: 2, skipped: 1 })
      const rows = await core.api['money.revenues.list']()
      expect(rows.map((r) => r.source)).toEqual(['csv', 'csv'])
      expect(rows.map((r) => r.amountCents).sort((a, b) => a - b)).toEqual([300, 1250])
      expect(() => core.api['money.revenues.importCsv'](`${today};x`)).toThrow('Aucune ligne valide')
      expect(() => core.api['money.revenues.importCsv']('  ')).toThrow('vide')
    } finally {
      core.close()
    }
  })

  it('moves a sponsor deal across the pipeline and validates the deal sheet', async () => {
    const core = memoryCore()
    try {
      const cid = channel(core)
      const d = await core.api['money.sponsors.save']({ brand: ' Lumière ', channelId: cid, amountCents: 50000, link: 'https://exemple.fr', dueDate: '2026-12-01' })
      expect(d).toMatchObject({ brand: 'Lumière', stage: 'prospect', currency: 'EUR', dueDate: '2026-12-01' })
      const moved = await core.api['money.sponsors.move'](d.id, 'signed')
      expect(moved.stage).toBe('signed')
      const edited = await core.api['money.sponsors.save']({ id: d.id, brand: 'Lumière', terms: 'Une mention' })
      expect(edited).toMatchObject({ stage: 'signed', terms: 'Une mention', amountCents: 0 })
      expect(() => core.api['money.sponsors.move'](d.id, 'perdu' as never)).toThrow('Étape')
      expect(() => core.api['money.sponsors.save']({ brand: '  ' })).toThrow('Marque')
      expect(() => core.api['money.sponsors.save']({ brand: 'X', link: 'javascript:alert(1)' })).toThrow('Lien')
      expect(() => core.api['money.sponsors.save']({ brand: 'X', dueDate: '31/02/2026' })).toThrow('Échéance')
      await core.api['money.sponsors.delete'](d.id)
      expect(await core.api['money.sponsors.list']()).toEqual([])
    } finally {
      core.close()
    }
  })

  it('drafts a sponsor message through the sponsor_writer route, stores it and books the call in the ledger', async () => {
    const provider = new FakeProvider(['Objet : Collaboration\n\nBonjour Camille, …'])
    const core = memoryCore({ chatProvider: () => provider })
    try {
      const d = await core.api['money.sponsors.save']({ brand: 'Lumière', contact: 'Camille', terms: 'Intégration de 60 s' })
      const drafted = await core.api['money.sponsors.draft'](d.id)
      expect(drafted.draftMessage).toContain('Bonjour Camille')
      expect(provider.calls[0]!.prompt).toContain('Marque : Lumière')
      expect(provider.calls[0]!.system).toContain('n’envoie rien')
      expect((await core.api['spend.entries']()).filter((e) => e.status === 'settled')).toHaveLength(1)
      await expect(core.api['money.sponsors.draft'](9999)).rejects.toThrow('Deal introuvable')
    } finally {
      core.close()
    }
  })

  it('generates an offer pack, parses the atelier-offer block and stores it', async () => {
    const provider = new FakeProvider([packReply()])
    const core = memoryCore({ chatProvider: () => provider })
    try {
      const o = await core.api['money.offers.save']({ name: 'Guide', kind: 'ebook', priceCents: 1490 })
      const packed = await core.api['money.offers.pack'](o.id)
      expect(packed.pack?.names).toHaveLength(5)
      expect(packed.pack?.ideas[0]!.title).toBe('Guide PDF')
      expect((await core.api['money.offers.list']())[0]!.pack?.funnel).toHaveLength(2)
    } finally {
      core.close()
    }
  })

  it.each([
    ['no block', 'Pas de bloc ici.', 'bloc'],
    ['bad JSON', '```atelier-offer\n{oups\n```', 'JSON valide'],
    ['wrong shape', packReply({ ...PACK, names: ['un seul'] }), 'incomplet'],
    ['not 3 ideas', packReply({ ...PACK, ideas: PACK.ideas.slice(0, 2) }), 'incomplet']
  ])('refuses an invalid pack (%s) and saves nothing', async (_label, reply, message) => {
    const core = memoryCore({ chatProvider: () => new FakeProvider([reply]) })
    try {
      const o = await core.api['money.offers.save']({ name: 'Guide' })
      await expect(core.api['money.offers.pack'](o.id)).rejects.toThrow(message)
      expect((await core.api['money.offers.list']())[0]!.pack).toBeNull()
    } finally {
      core.close()
    }
  })

  it('validates offers', async () => {
    const core = memoryCore()
    try {
      expect(() => core.api['money.offers.save']({ name: '' })).toThrow('Nom')
      expect(() => core.api['money.offers.save']({ name: 'X', priceCents: -1 })).toThrow('Prix')
      expect(() => core.api['money.offers.save']({ name: 'X', status: 'vendu' as never })).toThrow('Statut')
      const o = await core.api['money.offers.save']({ name: 'X', status: 'live', kind: 'site', priceCents: 100 })
      expect(o).toMatchObject({ status: 'live', kind: 'site' })
      await core.api['money.offers.delete'](o.id)
      expect(() => core.api['money.offers.delete'](o.id)).toThrow('introuvable')
    } finally {
      core.close()
    }
  })

  it('stores the typed rate and refuses nonsense', async () => {
    const core = memoryCore()
    try {
      expect((await core.api['money.overview']()).usdToEur).toBe(0.92)
      await core.api['money.setRate'](0.9)
      expect((await core.api['money.overview']()).usdToEur).toBe(0.9)
      for (const bad of [0, -1, 7, Number.NaN, '0,9' as never]) expect(() => core.api['money.setRate'](bad)).toThrow('Taux invalide')
    } finally {
      core.close()
    }
  })
})

describe('money overview', () => {
  it('is empty on a fresh install, with 6 months and 8 weeks', async () => {
    const core = memoryCore()
    try {
      const o = await core.api['money.overview']()
      expect(o.months).toEqual(lastMonths(NOW, 6))
      expect(o.rows).toEqual([])
      expect(o.weekly).toHaveLength(8)
      expect(o.viewsKnown).toBe(false)
      expect(o.totals).toMatchObject({ revenueCents: 0, costCents: 0, marginCents: 0, rpmCents: null })
    } finally {
      core.close()
    }
  })

  it('counts revenues, the spend ledger (USD to EUR) and, defensively, the engine credits of real runs only', async () => {
    const core = memoryCore()
    try {
      const cid = channel(core)
      await core.api['money.setRate'](0.5)
      await core.api['money.revenues.save']({ date: today, channelId: cid, type: 'adsense', amountCents: 10000, currency: 'EUR' })
      await core.api['money.revenues.save']({ date: today, channelId: cid, type: 'sponsor', amountCents: 2000, currency: 'USD' })
      const h = core.ledger.reserve({ providerId: 'anthropic', model: 'claude-opus-5-5', channelId: cid, estimate: { usd: 4 } })
      core.ledger.settle(h, { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, { costUsd: 3 })
      core.db.prepare("INSERT INTO videos (channel_id, title, status) VALUES (?, 'V', 'published')").run(cid)

      // 1. the engine's table does not exist (yet): the engine cost is 0
      core.db.exec('DROP TABLE video_runs')
      let o = await core.api['money.overview']()
      let row = o.rows.find((r) => r.channelId === cid && r.month === month)!
      expect(row).toMatchObject({ revenueCents: 11000, aiCents: 150, engineCents: 0, costCents: 150, marginCents: 10850, publishedVideos: 1, costPerVideoCents: 150 })
      expect(o.totals.revenueCents).toBe(11000)
      expect(o.weekly.reduce((s, w) => s + w.revenueCents, 0)).toBe(11000)
      expect(o.weekly.reduce((s, w) => s + w.costCents, 0)).toBe(150)

      // 2. the table exists (columns of lot P6): real runs count, demo runs never do
      core.db.exec(`CREATE TABLE video_runs (id INTEGER PRIMARY KEY, channel_id INTEGER, spent_credits INTEGER, demo INTEGER, status TEXT, finished_at TEXT)`)
      const ins = core.db.prepare('INSERT INTO video_runs (channel_id, spent_credits, demo, status, finished_at) VALUES (?,?,?,?,?)')
      ins.run(cid, 250, 0, 'done', `${today}T10:00:00.000Z`)
      ins.run(cid, 9999, 1, 'done', `${today}T10:00:00.000Z`)
      ins.run(cid, 500, 0, 'running', null)
      o = await core.api['money.overview']()
      row = o.rows.find((r) => r.channelId === cid && r.month === month)!
      expect(row).toMatchObject({ engineCents: 250, costCents: 400, marginCents: 10600 })
      expect(o.weekly.reduce((s, w) => s + w.costCents, 0)).toBe(400)

      // 3. a table with another shape does not break the screen
      core.db.exec('DROP TABLE video_runs; CREATE TABLE video_runs (id INTEGER PRIMARY KEY)')
      o = await core.api['money.overview']()
      expect(o.rows.find((r) => r.channelId === cid && r.month === month)!.engineCents).toBe(0)
    } finally {
      core.close()
    }
  })

  it('reads the real video_runs table of lot P6: real runs count, demo runs do not', async () => {
    const core = memoryCore()
    try {
      const cid = channel(core)
      const vid = Number(core.db.prepare("INSERT INTO videos (channel_id, title) VALUES (?, 'V')").run(cid).lastInsertRowid)
      const ins = core.db.prepare(
        `INSERT INTO video_runs (video_id, channel_id, pipeline_json, pipeline_label, topic, minutes, budget_mode, gate_mode, status, demo, spent_credits, created_at, finished_at)
         VALUES (?, ?, '{}', 'p', 't', 1, 'usage_max', 'step', 'succeeded', ?, ?, ?, ?)`
      )
      ins.run(vid, cid, 0, 320, `${today}T09:00:00.000Z`, `${today}T09:30:00.000Z`)
      ins.run(vid, cid, 1, 777, `${today}T09:00:00.000Z`, `${today}T09:30:00.000Z`)
      const o = await core.api['money.overview']()
      expect(o.rows.find((r) => r.channelId === cid && r.month === month)).toMatchObject({ engineCents: 320, costCents: 320 })
    } finally {
      core.close()
    }
  })

  it('uses the injected clock for the months', () => {
    const core = memoryCore()
    try {
      const api = moneyApi(core.context, () => new Date('2026-03-15T12:00:00Z'))
      expect(api['money.overview']()).toMatchObject({ month: '2026-03', months: ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'] })
    } finally {
      core.close()
    }
  })
})

describe('money example rows', () => {
  it('seeds three months of revenues, four deals and two offers, counts them only for the example channels, and clears them', async () => {
    const core = memoryCore()
    try {
      const mine = channel(core, 'Ma chaîne')
      await core.api['example.load']()
      const revenues = await core.api['money.revenues.list']()
      expect(revenues.length).toBeGreaterThanOrEqual(12)
      expect(revenues.every((r) => r.example && r.source === 'example')).toBe(true)
      expect(new Set(revenues.map((r) => r.channelName))).toEqual(new Set(['Les Grandes Énigmes', 'Top Savoirs']))
      expect(revenues.every((r) => r.date <= today)).toBe(true)
      const deals = await core.api['money.sponsors.list']()
      expect(deals).toHaveLength(4)
      expect(new Set(deals.map((d) => d.stage)).size).toBe(4)
      expect(await core.api['money.offers.list']()).toHaveLength(2)

      const o = await core.api['money.overview']()
      const exampleIds = o.channels.filter((c) => c.example).map((c) => c.id)
      expect(exampleIds).toHaveLength(2)
      expect(o.rows.some((r) => r.channelId === mine && r.revenueCents > 0)).toBe(false)
      expect(o.rows.filter((r) => exampleIds.includes(r.channelId!)).some((r) => r.revenueCents > 0 && r.sources.revenue === 'example')).toBe(true)

      await core.api['example.delete']()
      expect(await core.api['money.revenues.list']()).toEqual([])
      expect(await core.api['money.sponsors.list']()).toEqual([])
      expect(await core.api['money.offers.list']()).toEqual([])
    } finally {
      core.close()
    }
  })
})
