// `brain-run order` (equipe-3-chaines): Charlie's order as he would give it — his message (each script under its channel's
// name, a [PUB] marker where the promo goes) written to Atlas in the app's chat — then the orders it made followed to the
// end under ONE dollar cap for the whole order (every run of every ordered video, fixes included; past it, every run still
// going is cancelled). `--direct` places the order without Atlas (same code path the tool calls). Prints one JSON report.
//
//   node scripts/brain-run.mjs order --data <dir> --message-file <file> --max-usd X [--demo] [--direct --each-usd Y] [--wait-min 240]
// (--max-usd caps the WHOLE order; with Atlas the per-video cap is the one his message says, Atlas passes it to videos_order)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const say = (line) => void process.stderr.write(`[brain-run] ${line}\n`)

/** Where the order stands (pure): every order told → done; spend over the cap → stop; else keep waiting. */
export function judgeOrder(orders, spentUsd, maxUsd) {
  if (spentUsd > maxUsd) return { stop: 'overSpend', reason: `dépense ${spentUsd.toFixed(3)} $ au-dessus du plafond ${maxUsd} $ : arrêt` }
  if (orders.length > 0 && orders.every((o) => o.notifiedAt !== null)) return { stop: orders.every((o) => o.status === 'ready') ? 'ok' : 'runFailed', reason: orders.map((o) => `#${o.id} ${o.status}`).join(', ') }
  return { stop: null }
}

export async function orderCommand(brain, o, deps) {
  const { EXIT, creditsToUsd, readText, clock = Date.now } = deps
  if (!o.messageFile) throw new deps.UsageError('order : --message-file <fichier du message de Charlie> est obligatoire')
  if (o.maxUsd === null) throw new deps.UsageError('order : --max-usd (plafond de TOUTE la commande) est obligatoire')
  const message = readText(o.messageFile)
  const real = !o.demo
  const usdToEur = await brain.rate()
  const before = new Set((await brain.call('orders.list')).map((x) => x.id))
  const started = clock()
  let mine
  if (o.direct) {
    if (real && o.eachUsd === null) throw new deps.UsageError('order --direct : --each-usd (le plus qu’UNE vidéo peut coûter) est obligatoire')
    if (real && o.eachUsd > o.maxUsd) throw new deps.UsageError('order : --each-usd ne peut pas dépasser --max-usd')
    mine = await brain.call('orders.place', [{ message, real, ...(real ? { maxUsd: o.eachUsd } : {}) }], 600_000)
  } else {
    const atlas = (await brain.call('orchestra.agents')).find((a) => a.role === 'principal')
    if (!atlas) throw new Error('pas d’Atlas dans cette équipe (orchestra.seed d’abord)')
    await brain.call('orchestra.say', [{ agentId: atlas.id, text: message }])
    say(`message envoyé à ${atlas.name} : il commande les vidéos`)
    for (;;) {
      mine = (await brain.call('orders.list')).filter((x) => !before.has(x.id))
      if (mine.length > 0) break
      if (clock() - started > 20 * 60_000) {
        const events = await brain.call('orchestra.events', [undefined, 30]).catch(() => [])
        return { code: EXIT.stalled, report: { reason: 'Atlas n’a passé aucune commande en 20 min', events: events.slice(-15) } }
      }
      await sleep(o.pollS * 1000)
    }
  }
  const batch = mine[0]?.batch
  const runs = new Set()
  let last = ''
  for (;;) {
    const orders = (await brain.call('orders.list', [batch])).filter((x) => !before.has(x.id))
    for (const x of orders) for (const id of [...(x.runs ?? []), ...(x.runId ? [x.runId] : [])]) runs.add(id)
    let credits = 0
    for (const id of runs) credits += (await brain.call('production.get', [id]).catch(() => ({ spentCredits: 0 }))).spentCredits
    const spentUsd = creditsToUsd(credits, usdToEur)
    const line = orders.map((x) => `#${x.id} ${x.channelName}: ${x.status}${x.runId ? ` (run ${x.runId})` : ''}`).join(' · ') + ` · ${spentUsd.toFixed(3)} $`
    if (line !== last) {
      say(line)
      last = line
    }
    const v = judgeOrder(orders, spentUsd, o.maxUsd)
    const out = async () => ({
      batch,
      reason: v.reason,
      spent: { credits, usd: Math.round(spentUsd * 1000) / 1000 },
      runs: [...runs],
      orders,
      inbox: (await brain.call('orchestra.inbox', [true]).catch(() => [])).filter((i) => /^Vidéo (prête|non livrée)/u.test(i.title)).map((i) => ({ title: i.title, body: i.body }))
    })
    if (v.stop === 'overSpend') {
      for (const id of runs) await brain.call('production.cancel', [id]).catch(() => undefined)
      return { code: EXIT.overSpend, report: await out() }
    }
    if (v.stop) return { code: v.stop === 'ok' ? EXIT.ok : EXIT.runFailed, report: await out() }
    if (clock() - started > o.waitMin * 60_000) return { code: EXIT.stalled, report: { ...(await out()), reason: `pas fini après ${o.waitMin} min (ça continue dans le cerveau)` } }
    await sleep(o.pollS * 1000)
  }
}
