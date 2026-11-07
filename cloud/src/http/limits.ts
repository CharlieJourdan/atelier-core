// The Cloud's per-account request limits (issue #105, decision 0088). They stop a runaway client, not a busy team: ten productions
// of one team at once (the vps-rendu scale test) must fit, so the numbers are sized for it and proven by the N=10 run (decision 0088).
/** Requests of one account a minute, every route together (the job polls of N productions, the uploads, the quotes). */
export const DEFAULT_REQUESTS_PER_MINUTE = 1200
/** Media searches of one account a minute (each fans out to a dozen free APIs; the answers are cached). */
export const DEFAULT_MEDIA_SEARCHES_PER_MINUTE = 120
