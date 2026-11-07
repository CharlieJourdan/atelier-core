// Where a renderer call is answered: by this app's own core, or — once Réglages › Ordinateur d'équipe is connected — by
// the headless brain on the team computer. A few methods always stay here: the link itself and the native window.
import type { ApiHandlers, CallEnvelope } from '../../shared/api'
import { handleCall } from '../ipc'
import type { BrainLink } from './link'

/**
 * Answered by this app even when a team computer is connected. `cloud.kit` and `cloud.kitDownload` too: the kit is read
 * from Atelier Cloud with the person's own session, which the team computer does not hold (`cloud.kitRef`, the video's
 * reference on the platform, is asked of the team computer that holds the video; `cloud.kitPublish` goes to the
 * computer that holds the package). The account, plan, credits and team block (`cloud.profile`, `cloud.team`, inviting) are
 * the person's too. The `google.*` methods too: the Google
 * sign-in opens this machine's browser on a loopback port of this machine, and the owner's Google token stays on his own
 * computer (the screens match the figures to the channels by their YouTube id, whichever brain holds the channels).
 */
export const LOCAL_WHEN_REMOTE: ReadonlySet<string> = new Set([
  'brain.status',
  'brain.connect',
  'brain.disconnect',
  'app.setTheme',
  'cloud.kit',
  'cloud.kitDownload',
  'cloud.reopenLogin',
  'cloud.profile',
  'cloud.team',
  'cloud.invite',
  'cloud.revokeInvite',
  'google.status',
  'google.setClient',
  'google.clearClient',
  'google.connect',
  'google.disconnect',
  'google.refresh',
  'google.channelStats'
])

export function routeCall(api: ApiHandlers, link: BrainLink | null, method: unknown, args: unknown): Promise<CallEnvelope<unknown>> {
  if (link?.active() && typeof method === 'string' && !LOCAL_WHEN_REMOTE.has(method)) return link.call(method, args)
  return handleCall(api, method, args)
}
