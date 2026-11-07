// IPC handlers, module "team" (lot Z1). One domain per file.
import type { ApiHandlers } from '../../shared/api'
import type { TEAM_METHODS } from '../../shared/api/team'
import { adminOverview } from '../team/admin'
import { ClaudeStore } from '../team/claude'
import { MembersStore } from '../team/members'
import type { ApiContext } from './context'

type TeamMethodKey = (typeof TEAM_METHODS)[number]

export function teamApi(ctx: ApiContext): Pick<ApiHandlers, TeamMethodKey> {
  const members = new MembersStore(ctx.db)
  const claude = new ClaudeStore(ctx.db, ctx.secrets, ctx.routes)
  const done = <T>(value: T): T => {
    ctx.notify('team')
    return value
  }
  return {
    'team.members': () => members.list(),
    'team.invite': (input) => done(members.invite(input)),
    'team.updateMember': (id, patch) => done(members.update(id, patch)),
    'team.removeMember': (id) => {
      members.remove(id)
      done(undefined)
    },
    'team.devices': () => members.devices(),
    'team.revokeDevice': (id) => {
      members.revokeDevice(id)
      done(undefined)
    },
    'claude.profiles': () => claude.list(),
    'claude.saveProfile': (input) => done(claude.save(input)),
    'claude.removeProfile': (id) => {
      claude.remove(id)
      done(undefined)
    },
    'claude.setLimit': (id, until) => done(claude.setLimit(id, until)),
    'claude.routing': () => claude.routing(),
    'claude.setRouting': (role, profileId) => {
      claude.setRouting(role, profileId)
      done(undefined)
    },
    'admin.overview': () => adminOverview(members, ctx.credits)
  }
}
