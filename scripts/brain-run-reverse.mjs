// `brain-run reverse` (reverse-pipeline, docs/METHODE-REVERSE-PIPELINE.md): a channel or video link goes in, a
// reverse-engineered production pipeline comes out, through the brain's `reverse.*` methods. Every command that can spend is
// capped by --max-usd (refused above it, nothing started). Prints one JSON report.
//
//   node scripts/brain-run.mjs reverse start     --data <dir> --max-usd X --request-file <json>   (refused when the request's
//     testBudgetUsd is above X)
//   node scripts/brain-run.mjs reverse follow    --data <dir> <id> [--wait-min N]   (until done / stopped / failed)
//   node scripts/brain-run.mjs reverse result    --data <dir> <id> [--out <file>]
//   node scripts/brain-run.mjs reverse transform --data <dir> <id> --transform-file <json> --max-usd X
//   node scripts/brain-run.mjs reverse prove     --data <dir> <id> --budget Y --max-usd X
//   node scripts/brain-run.mjs reverse list      --data <dir>

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const say = (line) => void process.stderr.write(`[brain-run] ${line}\n`)

/** What a reverse status means for the runner (pure): done, a stop (with its exit code), or keep waiting. */
export function judgeReverse(status, EXIT) {
  if (status.state === 'done') return { stop: EXIT.ok, reason: 'fini' }
  if (status.state === 'stopped') return { stop: EXIT.gate, reason: `arrêté : ${status.stoppedBecause ?? 'sans raison donnée'}` }
  if (status.state === 'failed') return { stop: EXIT.runFailed, reason: `échec : ${status.stoppedBecause ?? 'sans raison donnée'}` }
  if (status.state === 'idle') return { stop: EXIT.runFailed, reason: 'ne travaille pas (prouve-le avec reverse prove)' }
  return { stop: null, reason: null }
}

/**
 * The reverse commands. `deps`: { EXIT, UsageError, readJson(file), writeJson(file, value), clock() }.
 */
export async function reverseCommand(brain, o, deps) {
  const { EXIT, UsageError } = deps
  const clock = deps.clock ?? Date.now
  const [sub, id] = o.rest
  const capped = () => {
    if (o.maxUsd === null || o.maxUsd === undefined) throw new UsageError(`reverse ${sub} : --max-usd est obligatoire`)
  }
  if (sub === 'start') {
    capped()
    if (!o.requestFile) throw new UsageError('reverse start : --request-file <demande JSON> est obligatoire')
    const request = deps.readJson(o.requestFile)
    const budget = request?.testBudgetUsd
    if (typeof budget !== 'number') throw new UsageError('reverse start : la demande doit dire testBudgetUsd')
    if (budget > o.maxUsd) return { code: EXIT.overQuote, report: { started: false, problems: [`le budget d’essai de la demande (${budget} $) dépasse le plafond ${o.maxUsd} $`] } }
    const r = await brain.call('reverse.start', [request])
    return { code: EXIT.ok, report: { started: true, id: r.id, budgetUsd: budget } }
  }
  if (sub === 'list') return { code: EXIT.ok, report: await brain.call('reverse.list') }
  if (!id) throw new UsageError(`reverse ${sub ?? ''} <id> : start | follow | result | transform | prove | list`)
  if (sub === 'result') {
    const pipeline = await brain.call('reverse.result', [id])
    if (o.out && pipeline) deps.writeJson(o.out, pipeline)
    return { code: pipeline ? EXIT.ok : EXIT.runFailed, report: o.out && pipeline ? { id, out: o.out, state: pipeline.state, summary: pipeline.summary } : { id, pipeline } }
  }
  if (sub === 'transform') {
    capped()
    if (!o.transformFile) throw new UsageError('reverse transform : --transform-file <transformation JSON> est obligatoire')
    const transform = deps.readJson(o.transformFile)
    const budget = transform?.testBudgetUsd ?? 0
    if (typeof budget !== 'number' || budget > o.maxUsd) return { code: EXIT.overQuote, report: { id, started: false, problems: [`le budget d’essai de la transformation (${budget} $) dépasse le plafond ${o.maxUsd} $`] } }
    const r = await brain.call('reverse.transform', [id, transform])
    return { code: EXIT.ok, report: { from: id, id: r.id, budgetUsd: budget } }
  }
  if (sub === 'prove') {
    capped()
    if (typeof o.budget !== 'number' || !(o.budget > 0)) throw new UsageError('reverse prove : --budget Y (dollars de plus pour la preuve) est obligatoire')
    if (o.budget > o.maxUsd) return { code: EXIT.overQuote, report: { id, started: false, problems: [`le budget de preuve (${o.budget} $) dépasse le plafond ${o.maxUsd} $`] } }
    return { code: EXIT.ok, report: await brain.call('reverse.prove', [id, o.budget]) }
  }
  if (sub === 'follow') {
    const started = clock()
    let last = ''
    for (;;) {
      const s = await brain.call('reverse.status', [id])
      const line = `${s.state} ${s.phase} · ${s.spentUsd} $ / ${s.budgetUsd} $`
      if (line !== last) { say(`reverse ${id} ${line}`); last = line }
      const v = judgeReverse(s, EXIT)
      if (v.stop !== null) return { code: v.stop, report: { ...s, reason: v.reason } }
      if (clock() - started > o.waitMin * 60_000) return { code: EXIT.stalled, report: { ...s, reason: `pas fini après ${o.waitMin} min (il continue dans le cerveau)` } }
      await sleep((o.pollS ?? 10) * 1000)
    }
  }
  throw new UsageError(`reverse ${sub ?? ''} : start | follow | result | transform | prove | list`)
}
