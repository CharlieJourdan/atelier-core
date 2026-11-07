// IPC contract, module "google": the owner's own YouTube channels read through his Google account (src/main/google).
// Read-only: the three scopes are YouTube Analytics (views, watch time, subscribers), its monetary twin (estimated revenue)
// and the YouTube Data API read scope (which channels the account owns). No write scope is ever asked for.
// The client secret and the refresh token are secrets: stored encrypted, never returned (the renderer sees « set / not set »).
// Every method added here must also be listed in GOOGLE_METHODS (tests/unit/google-api.test.ts checks them).

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
  'https://www.googleapis.com/auth/youtube.readonly'
] as const

export type GoogleErrorCode =
  | 'noClient'
  | 'notConnected'
  | 'client'
  | 'state'
  | 'denied'
  | 'scopes'
  | 'noRefresh'
  | 'timeout'
  | 'cancelled'
  | 'reconnect'
  | 'quota'
  | 'forbidden'
  | 'network'
  | 'answer'

export interface GoogleChannelLink {
  youtubeChannelId: string
  title: string
  /** `@handle` of the channel, when it has one. */
  handle: string | null
  /** The Atelier channel whose YouTube id (or handle) is this channel's; null when none matches. */
  atelierChannelId: number | null
  atelierChannelName: string | null
  /** Google gave estimated revenue for it (the channel is monetised and the monetary scope was granted). */
  revenueAvailable: boolean
}

export interface GoogleStatus {
  /** A client id is known (pasted in Réglages or from ATELIER_GOOGLE_CLIENT_ID). */
  clientIdSet: boolean
  /** The OAuth client id (not a secret: it appears in every sign-in address). */
  clientId: string | null
  /** A client secret is stored (its value is never sent to the renderer). */
  clientSecretSet: boolean
  /** Where the client comes from: the app settings first, else the environment. */
  clientSource: 'settings' | 'env' | null
  /** A refresh token is stored: the account is connected. */
  connected: boolean
  /** Google refused the stored token (revoked, expired, password changed): connect again. */
  needsReconnect: boolean
  /** The browser sign-in is waiting for the person. */
  connecting: boolean
  /** The scopes Google granted at the last connection. */
  scopes: string[]
  lastRefreshAt: string | null
  lastError: { code: GoogleErrorCode; message: string } | null
  /** The YouTube channels of the account and the Atelier channel each one feeds. */
  channels: GoogleChannelLink[]
}

export interface GoogleClientInput {
  clientId: string
  /** The desktop client's secret (Google treats it as non-confidential); empty or absent keeps the stored one. */
  clientSecret?: string
}

/** One YouTube channel's figures, from the cache (refreshed daily and on demand). Money in euros. */
export interface GoogleChannelStat {
  youtubeChannelId: string
  title: string
  handle: string | null
  atelierChannelId: number | null
  /** Current subscribers (null when the channel hides the count). */
  subscribers: number | null
  /** The last 28 days of Analytics data. */
  views28d: number
  watchMinutes28d: number
  subscribersNet28d: number
  revenue28dEur: number | null
  /** Views of the 28 days before (for the trend). */
  viewsPrev28d: number
  /** Views change, last 28 days against the 28 before, in %; null without the earlier period. */
  trendPct: number | null
  /** This calendar month so far (`YYYY-MM`). */
  month: string
  monthViews: number
  monthWatchMinutes: number
  monthRevenueEur: number | null
  fetchedAt: string
}

export interface GoogleChannelStats {
  connected: boolean
  needsReconnect: boolean
  lastRefreshAt: string | null
  channels: GoogleChannelStat[]
}

export interface GoogleContract {
  'google.status': { args: []; result: GoogleStatus }
  /** Saves the OAuth client pasted in Réglages (the secret encrypted). */
  'google.setClient': { args: [input: GoogleClientInput]; result: GoogleStatus }
  /** Forgets the pasted client (the environment's, if any, is used again). */
  'google.clearClient': { args: []; result: GoogleStatus }
  /** Opens Google's sign-in in the browser and waits for its answer on a loopback address, then reads the figures. */
  'google.connect': { args: []; result: GoogleStatus }
  /** Revokes the token at Google (best effort), forgets it and the cached figures. */
  'google.disconnect': { args: []; result: GoogleStatus }
  /** Reads the channels and their figures now. */
  'google.refresh': { args: []; result: GoogleStatus }
  /** The cached figures of every channel of the account. */
  'google.channelStats': { args: []; result: GoogleChannelStats }
}

export const GOOGLE_METHODS = [
  'google.status',
  'google.setClient',
  'google.clearClient',
  'google.connect',
  'google.disconnect',
  'google.refresh',
  'google.channelStats'
] as const satisfies readonly (keyof GoogleContract)[]
