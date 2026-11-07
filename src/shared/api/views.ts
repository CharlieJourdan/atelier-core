// IPC contract, module "views": Read-only aggregates behind the Board and Dashboard views.
import type { BoardColumn, DashboardData } from '../views'

export interface ViewsContract {
  'board.columns': { args: [channelId?: number]; result: BoardColumn[] }

  'dashboard.overview': { args: [month?: string]; result: DashboardData }
}

export const VIEWS_METHODS = [
  'board.columns',
  'dashboard.overview'
] as const satisfies readonly (keyof ViewsContract)[]
