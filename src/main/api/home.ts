// IPC handlers, module "home" (lot Z1): Accueil, Validations, Ordinateurs. One domain per file.
import type { ApiHandlers } from '../../shared/api'
import type { HomeContract } from '../../shared/api/home'
import { BrowsersStore, MachinesStore } from '../home/computers'
import { readInbox, readOverview } from '../home/overview'
import type { ApiContext } from './context'

export function homeApi(ctx: ApiContext): Pick<ApiHandlers, keyof HomeContract> {
  const browsers = new BrowsersStore(ctx.db, (role) => ctx.agents.find(role)?.name ?? null)
  const machines = new MachinesStore(ctx.db)
  const changed = <T>(value: T): T => {
    ctx.notify('computers')
    return value
  }
  return {
    'home.overview': () => readOverview(ctx),
    'home.inbox': () => readInbox(ctx),
    'browsers.list': () => browsers.list(),
    'browsers.open': (input) => changed(browsers.open(input)),
    'browsers.close': (id) => changed(browsers.close(id)),
    'browsers.remove': (id) => changed(browsers.remove(id)),
    'machines.list': () => machines.list(),
    'machines.add': (input) => changed(machines.add(input)),
    'machines.rename': (id, name) => changed(machines.rename(id, name)),
    'machines.remove': (id) => changed(machines.remove(id)),
    'machines.test': async (id) => changed(await machines.test(id))
  }
}
