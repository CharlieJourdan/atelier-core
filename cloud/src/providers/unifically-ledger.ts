// `npm run cloud -- providers unifically-ledger [--since 2026-11-01T00:00:00Z]` (chantier vrais-tests): what unifically really
// charged, for the founder's reconciliation with `jobs.cost_usd`. Two free reads (docs.unifically.com, read 2026-11-01):
// GET /v1/account → data { balance_usd, … } and GET /v1/tasks?page=N&page_size=100&created_after=UNIX → data [{ task_id, model,
// status, cost, created_at }], pagination { has_next }. Only the balance and the tasks' model, status and cost are kept: never the
// account's email or the tasks' inputs.
import { z } from 'zod'
import { readJson, type HttpOptions } from './http.ts'
import { UNIFICALLY_BASE, unificallyCall } from './unifically-common.ts'

const Account = z.object({ data: z.object({ balance_usd: z.number() }).passthrough() }).passthrough()
const Tasks = z
  .object({
    data: z.array(z.object({ task_id: z.string(), model: z.string().nullish(), status: z.string(), cost: z.number().nullish(), created_at: z.number() }).passthrough()),
    pagination: z.object({ has_next: z.boolean() }).passthrough().optional()
  })
  .passthrough()

export interface LedgerModel {
  model: string
  tasks: number
  failed: number
  costUsd: number
}

export interface UnificallyLedger {
  balanceUsd: number
  since: number
  totalUsd: number
  models: LedgerModel[]
}

/** The balance and what each model cost since `since` (UNIX seconds), at most `maxPages` pages of 100 tasks. */
export async function unificallyLedger(secret: string, since: number, signal: AbortSignal, o: HttpOptions & { baseUrl?: string } = {}, maxPages = 20): Promise<UnificallyLedger> {
  const base = (o.baseUrl ?? UNIFICALLY_BASE).replace(/\/+$/, '')
  const label = 'unifically ledger'
  const get = async (path: string): Promise<unknown> =>
    readJson(await unificallyCall({ label, url: `${base}${path}`, secret, signal, init: { method: 'GET', headers: { authorization: `Bearer ${secret}`, accept: 'application/json' } } }, o), label, signal)
  const account = Account.safeParse(await get('/v1/account'))
  if (!account.success) throw new Error(`${label}: unexpected account answer`)
  const byModel = new Map<string, LedgerModel>()
  for (let page = 1; page <= maxPages; page++) {
    const t = Tasks.safeParse(await get(`/v1/tasks?page=${page}&page_size=100&created_after=${Math.floor(since)}`))
    if (!t.success) throw new Error(`${label}: unexpected tasks answer`)
    for (const task of t.data.data) {
      const model = task.model ?? '(unknown)'
      const row = byModel.get(model) ?? { model, tasks: 0, failed: 0, costUsd: 0 }
      row.tasks++
      if (task.status === 'failed') row.failed++
      row.costUsd += task.cost ?? 0
      byModel.set(model, row)
    }
    if (!t.data.pagination?.has_next) break
  }
  const models = [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd)
  return { balanceUsd: account.data.data.balance_usd, since, totalUsd: models.reduce((s, m) => s + m.costUsd, 0), models }
}
