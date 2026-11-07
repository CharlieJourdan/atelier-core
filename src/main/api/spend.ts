import { SPEND_GROUPS, type ApiHandlers } from '../../shared/api'
import type { ApiContext } from './context'

type SpendMethods = 'spend.overview' | 'spend.summary' | 'spend.entries' | 'spend.claudeUsage' | 'spend.setGlobalCap' | 'spend.setChannelCap'

const raised = (before: number | null, after: number | null): boolean => after === null || (before !== null && after > before)

export function spendApi(ctx: ApiContext): Pick<ApiHandlers, SpendMethods> {
  const { ledger } = ctx
  return {
    'spend.overview': (month) => ledger.overview(month),
    'spend.summary': (group, month) => {
      if (!SPEND_GROUPS.includes(group)) throw new Error(`Unknown grouping: ${String(group)}`)
      return ledger.summary(group, month)
    },
    'spend.entries': (month, limit) => ledger.entries(month, limit),
    'spend.claudeUsage': (scope) => ledger.claudeUsage(scope),
    // A raised or removed cap may let held tasks run: the runner tries them again (still too low: held again).
    'spend.setGlobalCap': (usd) => {
      const before = ledger.globalCap()
      ledger.setGlobalCap(usd)
      if (raised(before, usd)) ctx.runner.resumeHolds()
    },
    'spend.setChannelCap': (channelId, usd) => {
      const before = ledger.channelCap(channelId)
      ledger.setChannelCap(channelId, usd)
      if (raised(before, usd)) ctx.runner.resumeHolds()
    }
  }
}
