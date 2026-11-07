// IPC handlers, module "runs" (lot Z1): our engine's runs (`ctx.productionRuns`) and the credits wallet
// (`ctx.credits`). Every argument is validated here or in the service (French errors); writes notify their topic.
import { randomUUID } from 'node:crypto'
import type { ApiHandlers, RunsContract } from '../../shared/api'
import type { ApiContext } from './context'

export function runsApi(ctx: ApiContext): Pick<ApiHandlers, keyof RunsContract> {
  const runs = ctx.productionRuns
  const credits = ctx.credits
  return {
    'production.quote': (input) => runs.quote(input),
    'production.start': (input) => runs.start(input),
    'production.list': (filter) => runs.list(filter),
    'production.get': (runId) => runs.get(runId),
    'production.approve': (runId, nodeId) => runs.approve(runId, nodeId),
    'production.requestChanges': (runId, nodeId, note) => runs.requestChanges(runId, nodeId, note),
    'production.cancel': (runId) => runs.cancel(runId),
    'production.retry': (runId) => runs.retry(runId),
    'production.redo': (runId) => runs.redo(runId),
    'production.resume': (runId) => runs.resume(runId),
    'production.output': (runId, nodeId) => runs.output(runId, nodeId),
    'production.file': (runId, ref) => runs.file(runId, ref),
    'production.library': (filter) => runs.library(filter),
    'production.voices': () => runs.voices(),
    'production.engineStatus': () => runs.engineStatus(),
    'production.revealPackage': (runId) => runs.revealPackage(runId),
    'credits.balance': () => credits.balance(),
    'credits.entries': (limit) => {
      if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 500)) {
        throw new Error('Nombre de lignes invalide (1 à 500).')
      }
      return credits.entries(limit)
    },
    'credits.packs': () => credits.packs(),
    'credits.simulatePurchase': (packId, key) => {
      if (typeof packId !== 'string' || packId.length > 50) throw new Error('Pack de crédits inconnu.')
      if (key !== undefined && (typeof key !== 'string' || !/^[\w-]{8,100}$/.test(key))) throw new Error('Clé d’achat invalide.')
      const entry = credits.simulatePurchase(packId, `purchase-${key ?? randomUUID()}`)
      ctx.notify('credits')
      return { simulated: true, entry, balance: credits.balance() }
    }
  }
}
