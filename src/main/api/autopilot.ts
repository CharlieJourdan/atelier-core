// IPC handlers, module "autopilot": the team's switch and red stop (orchestra/power.ts), the live « Activité »
// (orchestra/activity.ts), each channel's standing goals with its approval level (orchestra/goals.ts), Charlie's
// « toujours valider » rules (orchestra/allow.ts) and the daily / weekly report (orchestra/reports.ts).
import type { ApiHandlers } from '../../shared/api'
import type { AUTOPILOT_METHODS } from '../../shared/api/autopilot'
import { activity } from '../orchestra/activity'
import { allowAlways } from '../orchestra/allow'
import { closeGoalsItem } from '../orchestra/goals-flow'
import { PLANNER_LAST_RUN } from '../orchestra/planner'
import { teamReport } from '../orchestra/reports'
import type { ApiContext } from './context'

type Methods = (typeof AUTOPILOT_METHODS)[number]

function channelId(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error('Une chaîne : son identifiant.')
  return v
}

export function autopilotApi(ctx: ApiContext): Pick<ApiHandlers, Methods> {
  const o = ctx.orchestra
  const changed = <T>(value: T): T => {
    ctx.notify('orchestra')
    return value
  }
  const known = (id: number): number => {
    ctx.workflow.channels.get(id)
    return id
  }
  return {
    'autopilot.power': () => o.power.view(),
    'autopilot.setPower': (input) => changed(o.power.set(input)),
    'autopilot.stop': () => changed(o.power.stop()),
    'autopilot.activity': () => activity(o.parts, o.supervisor, o.power.view()),
    'autopilot.goals': (id) => o.parts.goals.get(channelId(id)),
    'autopilot.saveGoals': (id, input) => {
      const goals = o.parts.goals.save(known(channelId(id)), input)
      closeGoalsItem(o.parts, goals)
      // the planner looks at the new goals at its next tick, not at its next hourly pass (production-equipe)
      o.parts.settings.set(PLANNER_LAST_RUN, null)
      return changed(goals)
    },
    'autopilot.proposeGoals': (id) => changed(o.parts.goals.propose(known(channelId(id)), 'create', true).goals),
    'autopilot.allowAlways': (inboxId, input) => {
      if (typeof inboxId !== 'number' || !Number.isInteger(inboxId)) throw new Error('Une question : son identifiant.')
      return changed(allowAlways(o, inboxId, input ?? {}))
    },
    'autopilot.rules': (id) => o.parts.allow.list(id === undefined || id === null ? undefined : channelId(id)),
    'autopilot.revokeRule': (id) => {
      if (typeof id !== 'number' || !Number.isInteger(id)) throw new Error('Une règle : son identifiant.')
      return changed(o.parts.allow.revoke(id))
    },
    'autopilot.report': (kind) => {
      if (kind !== 'daily' && kind !== 'weekly') throw new Error('Un rapport : « daily » ou « weekly ».')
      return teamReport(o.parts, kind, o.planner.utc)
    }
  }
}
