// The owner's own YouTube channels, read-only through his Google account: see service.ts for the entry point.
export { GoogleService, type GoogleServiceOptions } from './service'
export { GoogleError, type FetchLike as GoogleFetch } from './oauth'
