// IPC handlers, module "google": the owner's YouTube channels read through Google (src/main/google). One domain per file.
// The client secret and the refresh token go in through `setClient` / the browser sign-in and are never returned.
import type { ApiHandlers } from '../../shared/api'
import type { GOOGLE_METHODS } from '../../shared/api/google'
import type { ApiContext } from './context'

type GoogleMethodKey = (typeof GOOGLE_METHODS)[number]

export function googleApi(ctx: ApiContext): Pick<ApiHandlers, GoogleMethodKey> {
  const g = ctx.google
  return {
    'google.status': () => g.status(),
    'google.setClient': (input) => g.setClient(input),
    'google.clearClient': () => g.clearClient(),
    'google.connect': () => g.connect(),
    'google.disconnect': () => g.disconnect(),
    'google.refresh': () => g.refresh(),
    'google.channelStats': () => g.channelStats()
  }
}
