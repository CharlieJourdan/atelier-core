// Usage-limit and rate-limit detection from what a CLI or the API says when it refuses (the error text of a
// ProviderError: a Claude Code error result, a Codex `turn.failed`, the stderr tail, an HTTP 429). Formats seen or
// documented: "Claude AI usage limit reached|<epoch seconds>", "You've hit your limit · resets 3pm (Europe/Paris)",
// "5-hour limit reached ∙ resets 2am", Codex "You've hit your usage limit … try again in 2 hours 5 minutes" or
// "try again at 3:05 PM", "429 Too Many Requests", "rate_limit_error", "Retry-After: 30". VERIFY new wordings against
// real refusals: an unrecognised refusal is an ordinary failure (retried with backoff), never a crash.
export interface LimitHit {
  kind: 'usage' | 'rate'
  /** When the account may be tried again (ms since epoch). */
  until: number
  note: string
}

const USAGE_RE = /usage limit|hit your (?:usage )?limit|limit reached|quota (?:exceeded|reached)|insufficient_quota|out of (?:credits|messages)|reached your (?:usage|message) limit|credit balance is too low/i
const RATE_RE = /\b429\b|rate[ _-]?limit|too many requests|\boverloaded\b|\b529\b/i
/** Without a reset time: a usage limit is tried again in an hour, a rate limit in a minute. */
export const DEFAULT_USAGE_COOLDOWN_MS = 60 * 60_000
export const DEFAULT_RATE_COOLDOWN_MS = 60_000
const MAX_COOLDOWN_MS = 8 * 86_400_000

export function detectLimit(message: string, now: number): LimitHit | null {
  if (typeof message !== 'string' || !message) return null
  const epoch = /limit reached\|(\d{9,13})/i.exec(message)
  if (epoch) {
    const n = Number(epoch[1])
    return hit('usage', n < 1e12 ? n * 1000 : n, now, message)
  }
  const usage = USAGE_RE.test(message)
  const rate = !usage && RATE_RE.test(message)
  if (!usage && !rate) return null
  const until = resetTime(message, now)
  return hit(usage ? 'usage' : 'rate', until ?? now + (usage ? DEFAULT_USAGE_COOLDOWN_MS : DEFAULT_RATE_COOLDOWN_MS), now, message)
}

// A login that no longer works: Claude Code "Failed to authenticate: OAuth session expired and could not be refreshed",
// "Not logged in · Please run /login", "Invalid API key", an HTTP 401; Codex "not logged in" / "please log in"; a CLI
// that is not installed. The account must be reconnected by its owner: retrying it is useless.
const AUTH_RE =
  /failed to authenticate|oauth (?:session|token)[^.]{0,40}(?:expired|revoked|invalid)|not logged in|please run \/login|\/login required|invalid (?:x-)?api[ _-]?key|authentication_error|\b401\b[^.]{0,20}unauthori[sz]ed|unauthori[sz]ed[^.]{0,20}\b401\b|token (?:has )?(?:expired|been revoked)|please (?:log|sign) ?in|cli not found on path/i

/** Why an account's login is dead (a short note), or null when the refusal is something else. */
export function detectAuthFailure(message: string): string | null {
  if (typeof message !== 'string' || !AUTH_RE.test(message)) return null
  return message.replace(/\s+/g, ' ').trim().slice(0, 200)
}

function hit(kind: LimitHit['kind'], until: number, now: number, message: string): LimitHit {
  const bounded = Math.min(Math.max(until, now + 1000), now + MAX_COOLDOWN_MS)
  return { kind, until: bounded, note: message.replace(/\s+/g, ' ').trim().slice(0, 200) }
}

/** The reset time a message names: an ISO time, "in 2 hours 5 minutes", "retry after 30 s", or a clock time. */
export function resetTime(message: string, now: number): number | null {
  const isoMatch = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))\b/.exec(message)
  if (isoMatch) {
    const t = Date.parse(isoMatch[1] as string)
    if (Number.isFinite(t)) return t
  }
  const retryAfter = /retry[- ]after:?\s*(\d+)\s*(?:s|sec|seconds)?\b/i.exec(message)
  if (retryAfter) return now + Number(retryAfter[1]) * 1000
  const rel = /\bin\s+((?:\d+\s*(?:days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b[\s,and]*)+)/i.exec(message)
  if (rel) {
    let ms = 0
    for (const part of (rel[1] as string).matchAll(/(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi)) {
      const n = Number(part[1])
      const unit = (part[2] as string).toLowerCase()
      if (unit.startsWith('d')) ms += n * 86_400_000
      else if (unit.startsWith('h')) ms += n * 3_600_000
      else if (unit.startsWith('m')) ms += n * 60_000
      else ms += n * 1000
    }
    if (ms > 0) return now + ms
  }
  const clock = /(?:resets?|try again|available)(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(message)
  if (clock) {
    let hour = Number(clock[1])
    const minute = clock[2] ? Number(clock[2]) : 0
    const ampm = clock[3]?.toLowerCase()
    if (ampm === 'pm' && hour < 12) hour += 12
    if (ampm === 'am' && hour === 12) hour = 0
    if (hour > 23 || minute > 59) return null
    // The CLI prints the user's local time; the next occurrence of it.
    const d = new Date(now)
    d.setHours(hour, minute, 0, 0)
    if (d.getTime() <= now) d.setDate(d.getDate() + 1)
    return d.getTime()
  }
  return null
}
