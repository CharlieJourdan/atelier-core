// equipe-3-chaines: Charlie's order goes from his scripts to a checked video he is told about, with no answer to wait for:
// launched within its cap, a real error fixed once before he hears of it, a failure relaunched once, every end said.
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db'
import { Inbox } from '../../src/main/orchestra/inbox'
import { errorsOfRefusal, notice, stepOf, VideoOrders, type BlockingError, type FinalReport, type OrderProduction } from '../../src/main/orchestra/orders'
import { EventLog } from '../../src/main/orchestra/util'

function setup(o: { quote?: number; reports?: FinalReport[]; budgetLeft?: number | null; spent?: number } = {}) {
  const db = openDatabase(':memory:')
  let t = Date.parse('2026-11-04T20:00:00Z')
  const now = () => (t += 1000)
  const events = new EventLog(db, now)
  const inbox = new Inbox(db, now, events)
  for (const n of ['marcel artisan', 'Klaus vom Kundendienst', 'Gaston le Compagnon']) db.prepare('INSERT INTO channels (name) VALUES (?)').run(n)
  const said: string[] = []
  const runs = new Map<number, { status: string; error: string | null; videoId: number; project: number }>()
  const remakeCaps: (number | null)[] = []
  const log: string[] = []
  let nextRun = 100
  let nextProject = 10
  const production: OrderProduction = {
    importRecipe: (c) => 50 + c,
    prepare: (p) => {
      log.push(`prepare ${p.channelId} ${p.recipeId} ${p.script.slice(0, 12)}`)
      return { videoId: 200 + nextProject, projectId: nextProject++ }
    },
    quoteUsd: async () => o.quote ?? 1.2,
    launch: async (project, real) => {
      const id = nextRun++
      runs.set(id, { status: 'running', error: null, videoId: 200 + project, project })
      log.push(`launch ${project} ${real ? 'real' : 'demo'} → ${id}`)
      return id
    },
    remake: async (runId, steps, maxUsd) => {
      remakeCaps.push(maxUsd)
      if (maxUsd !== null && maxUsd < 0.5) throw new Error('Le devis de la réparation dépasse ce qui reste du plafond')
      const id = nextRun++
      runs.set(id, { status: 'running', error: null, videoId: runs.get(runId)!.videoId, project: runs.get(runId)!.project })
      log.push(`remake ${runId} [${steps.join(',')}] → ${id}`)
      return id
    },
    run: (id) => {
      const r = runs.get(id)
      return r ? { status: r.status, error: r.error, videoId: r.videoId, waitingNodes: r.status === 'waiting' ? ['topic'] : [], spentUsd: o.spent ?? 0.9 } : null
    },
    approve: (id, node) => {
      log.push(`approve ${id} ${node}`)
      runs.get(id)!.status = 'running'
    }
  }
  const reports = [...(o.reports ?? [])]
  const checked: number[] = []
  const orders = new VideoOrders({
    db,
    now,
    events,
    inbox,
    production,
    finalPass: {
      check: async ({ runId }) => {
        checked.push(runId)
        return reports.shift() ?? clean()
      }
    },
    say: (c, text) => said.push(`${c}: ${text}`),
    budgetLeftUsd: () => o.budgetLeft ?? null
  })
  const finish = (runId: number, status: 'succeeded' | 'failed', error: string | null = null) => {
    const r = runs.get(runId)!
    r.status = status
    r.error = error
    orders.runFinished({ runId, videoId: r.videoId, channelId: 1, status, error, title: 't', demo: false })
  }
  return { db, orders, inbox, said, log, checked, finish, runs, remakeCaps }
}

const clean = (): FinalReport => ({ blocking: [], checked: true, review: ['plan 0:42 un peu long'], judge: { sameChannel: 'yes', score: 81, reason: 'même décor, même voix', defects: ['inset un peu trop tôt'] }, costUsd: 0.02, film: 'C:/x/video.mp4', durationS: 124 })
const broken = (kind: string): FinalReport => ({ ...clean(), blocking: [{ kind, atS: 63, what: `${kind} at 1:03`, step: stepOf(kind) }] })

const ITEMS = [
  { channelId: 1, channelName: 'marcel artisan', title: 'Purger', script: 'Votre radiateur est froid. [PUB] Premier geste.' },
  { channelId: 2, channelName: 'Klaus vom Kundendienst', title: null, script: 'Ihr Backofen heizt nicht mehr? [Werbung] Erstens.' },
  { channelId: 3, channelName: 'Gaston le Compagnon', title: null, script: 'Une porte qui frotte se répare. [PUB] D’abord les gonds.' }
]

describe('Charlie’s video orders', () => {
  it('three scripts → three videos launched on each channel’s import pipeline, the script word for word', async () => {
    const s = setup()
    const placed = await s.orders.place({ items: ITEMS, real: true, maxUsdEach: 2 })
    expect(placed.map((p) => p.status)).toEqual(['producing', 'producing', 'producing'])
    expect(s.log.filter((l) => l.startsWith('prepare'))).toEqual(['prepare 1 51 Votre radiat', 'prepare 2 52 Ihr Backofen', 'prepare 3 53 Une porte qu'])
    expect(placed[1]!.title).toBe('Ihr Backofen heizt nicht mehr?')
    expect(s.said[0]).toMatch(/^1: Je fabrique « Purger »/u)
  })

  it('a finished run is checked, then Charlie is told once: inbox, room, the report with the defects left', async () => {
    const s = setup()
    const [o] = await s.orders.place({ items: [ITEMS[0]!], real: true })
    s.finish(o!.runId!, 'succeeded')
    await s.orders.idle()
    const done = s.orders.get(o!.id)
    expect(done.status).toBe('ready')
    expect(done.notifiedAt).not.toBeNull()
    const item = s.inbox.list().find((i) => i.title.startsWith('Vidéo prête'))!
    expect(item.title).toBe('Vidéo prête · marcel artisan · Purger')
    expect(item.body).toMatch(/aucune erreur réelle/u)
    expect(item.body).toMatch(/même chaîne, 81\/100/u)
    expect(item.body).toMatch(/inset un peu trop tôt/u)
    // a second end event never tells him twice
    s.orders.runFinished({ runId: o!.runId!, videoId: 1, channelId: 1, status: 'succeeded', error: null, title: 't', demo: false })
    await s.orders.idle()
    expect(s.inbox.list().filter((i) => i.title.startsWith('Vidéo prête'))).toHaveLength(1)
  })

  it('a real error measured on the film: the step it comes from is made again BEFORE Charlie is told', async () => {
    const s = setup({ reports: [broken('audio_dropout')] })
    const [o] = await s.orders.place({ items: [ITEMS[0]!], real: true })
    s.finish(o!.runId!, 'succeeded')
    await s.orders.idle()
    expect(s.orders.get(o!.id).status).toBe('fixing')
    expect(s.inbox.list().filter((i) => i.title.startsWith('Vidéo'))).toHaveLength(0)
    expect(s.log.at(-1)).toBe(`remake ${o!.runId} [voice] → ${o!.runId! + 1}`)
    s.finish(o!.runId! + 1, 'succeeded')
    await s.orders.idle()
    const done = s.orders.get(o!.id)
    expect(done.status).toBe('ready')
    expect(done.fixes).toBe(1)
    expect(s.inbox.list()[0]!.body).toMatch(/réparée 1 fois/u)
  })

  it('a real error still there after the fix: not delivered as ready, the errors listed', async () => {
    const s = setup({ reports: [broken('duplicate'), broken('duplicate')] })
    const [o] = await s.orders.place({ items: [ITEMS[0]!], real: true })
    s.finish(o!.runId!, 'succeeded')
    await s.orders.idle()
    expect(s.log.at(-1)).toMatch(/\[pictures\]/u)
    s.finish(o!.runId! + 1, 'succeeded')
    await s.orders.idle()
    const done = s.orders.get(o!.id)
    expect(done.status).toBe('failed')
    expect(s.inbox.list()[0]!.title).toMatch(/^Vidéo non livrée/u)
    expect(s.inbox.list()[0]!.body).toMatch(/duplicate à 1:03/u)
  })

  it('a render refused for its real errors is remade on their steps; another failure is relaunched once, then said', async () => {
    const s = setup()
    const [a, b] = await s.orders.place({ items: ITEMS.slice(0, 2), real: true })
    s.finish(a!.runId!, 'failed', 'verify_failed: audio_dropout at 0:28; duplicate at 1:12')
    s.finish(b!.runId!, 'failed', 'Le moteur vidéo ne répond pas.')
    await s.orders.idle()
    expect(s.log).toContain(`remake ${a!.runId} [voice,pictures] → 102`)
    expect(s.log).toContain(`launch ${b!.projectId} real → 103`)
    s.finish(103, 'failed', 'Le moteur vidéo ne répond pas.')
    await s.orders.idle()
    expect(s.orders.get(b!.id).status).toBe('failed')
    expect(s.inbox.list().map((i) => i.title)).toContain('Vidéo non livrée · Klaus vom Kundendienst · Ihr Backofen heizt nicht mehr?')
  })

  it('a quote over its cap or over the channel’s budget left is refused and said, never launched', async () => {
    const capped = setup({ quote: 3 })
    const [o] = await capped.orders.place({ items: [ITEMS[0]!], real: true, maxUsdEach: 2 })
    expect(o!.status).toBe('failed')
    expect(o!.error).toMatch(/dépasse le plafond de 2\.00 \$/u)
    expect(capped.log.some((l) => l.startsWith('launch'))).toBe(false)
    expect(capped.inbox.list()[0]!.title).toMatch(/^Vidéo non livrée/u)
    const poor = setup({ quote: 1.2, budgetLeft: 0.5 })
    expect((await poor.orders.place({ items: [ITEMS[0]!], real: true }))[0]!.error).toMatch(/budget de la chaîne/u)
    // a demo spends nothing: the channel's budget does not stop it
    expect((await poor.orders.place({ items: [ITEMS[0]!], real: false }))[0]!.status).toBe('producing')
  })

  it('the fix is quoted against what is left of the video’s cap; a fix the cap cannot pay is never launched, and said', async () => {
    const ok = setup({ reports: [broken('audio_dropout')], spent: 0.9 })
    const [a] = await ok.orders.place({ items: [ITEMS[0]!], real: true, maxUsdEach: 2 })
    ok.finish(a!.runId!, 'succeeded')
    await ok.orders.idle()
    expect(ok.remakeCaps[0]).toBeCloseTo(1.1, 5)
    expect(ok.orders.get(a!.id).runs).toEqual([a!.runId, a!.runId! + 1])
    const poor = setup({ reports: [broken('audio_dropout')], spent: 1.8 })
    const [b] = await poor.orders.place({ items: [ITEMS[0]!], real: true, maxUsdEach: 2 })
    poor.finish(b!.runId!, 'succeeded')
    await poor.orders.idle()
    const done = poor.orders.get(b!.id)
    expect(done.status).toBe('failed')
    expect(done.error).toMatch(/^Réparation non lancée : Le devis de la réparation/u)
    expect(poor.inbox.list()[0]!.body).toMatch(/audio_dropout à 1:03/u)
  })

  it('a run left interrupted (the app stopped) or gone is relaunched once, never forgotten', async () => {
    const s = setup()
    const [o] = await s.orders.place({ items: [ITEMS[0]!], real: true })
    s.runs.get(o!.runId!)!.status = 'interrupted'
    s.orders.tick()
    await s.orders.idle()
    expect(s.log.at(-1)).toBe(`launch ${o!.projectId} real → ${o!.runId! + 1}`)
    s.runs.delete(o!.runId! + 1)
    s.orders.tick()
    await s.orders.idle()
    expect(s.orders.get(o!.id).status).toBe('failed')
    expect(s.orders.get(o!.id).error).toBe('La fabrication a disparu.')
  })

  it('no report from the render: never « aucune erreur réelle », the checks are said NOT read', () => {
    const lines = notice({ id: 1, batch: 'b', channelId: 1, channelName: 'L', title: 't', real: true, status: 'ready', videoId: 1, projectId: 1, runId: 1, runs: [1], fixes: 0, error: null, notifiedAt: null, createdAt: '', report: { ...clean(), checked: false } })
    expect(lines.join('\n')).toMatch(/NON relus/u)
    expect(lines.join('\n')).not.toMatch(/aucune erreur réelle/u)
  })

  it('after a restart the watchdog finds a run that ended unseen and a pass cut short', async () => {
    const s = setup()
    const [o] = await s.orders.place({ items: [ITEMS[0]!], real: true })
    s.runs.get(o!.runId!)!.status = 'succeeded'
    s.orders.tick()
    await s.orders.idle()
    expect(s.orders.get(o!.id).status).toBe('ready')
    s.db.prepare("UPDATE video_orders SET status = 'checking', notified_at = NULL WHERE id = ?").run(o!.id)
    s.orders.tick()
    await s.orders.idle()
    expect(s.checked).toHaveLength(2)
  })

  it('a run stopped at its pipeline’s checkpoints is passed by the order (Charlie ordered it): nothing waits for an answer', async () => {
    const s = setup()
    const [o] = await s.orders.place({ items: [ITEMS[0]!], real: true })
    s.runs.get(o!.runId!)!.status = 'waiting'
    s.orders.tick()
    expect(s.log.at(-1)).toBe(`approve ${o!.runId} topic`)
    expect(s.runs.get(o!.runId!)!.status).toBe('running')
  })

  it('reads the refusal of a render and points each error to its step', () => {
    const e: BlockingError[] = errorsOfRefusal('Le film a des erreurs réelles : word_cut at 2:03.5; music_loud (9 dB); frozen at 0:41')
    expect(e.map((x) => [x.kind, x.atS, x.step])).toEqual([['word_cut', 123.5, 'voice'], ['music_loud', null, 'render'], ['frozen', 41, 'pictures']])
    expect(notice({ ...{ id: 1, batch: 'b', channelId: 1, channelName: 'L', title: 't', real: true, status: 'ready', videoId: 1, projectId: 1, runId: 1, runs: [1], fixes: 0, error: null, notifiedAt: null, createdAt: '' }, report: { ...clean(), judge: null, judgeSkipped: 'pas de vidéo de référence' } })).toContain('Juge à l’aveugle : pas fait (pas de vidéo de référence).')
  })
})
