// An unreachable Atelier Cloud stops the clone (decision 0113): a paid run, a free demo or a judge call that fails because the
// network or the Cloud is down is NOT a style failure and NOT a reason to improve the definition. The clone stops with one clear
// reason, nothing lost, and the proof resumes (`clone.resume` / `reverse.prove`) when the Cloud is back.
export const CLOUD_DOWN_WHY = 'Atelier Cloud unreachable — the proof waits; resume when it is back'

export class CloudUnreachable extends Error {
  constructor(readonly detail: string) { super(CLOUD_DOWN_WHY); this.name = 'CloudUnreachable' }
}

const NETWORK = /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|UND_ERR_(CONNECT|SOCKET|HEADERS_TIMEOUT)|fetch failed|injoignable|unreachable|network error|socket hang up|Atelier Cloud n[’']est pas connect|Atelier Cloud is not connected/i

/** True for an error that says the Cloud or the network could not be reached (message, code, or the cause's). Pure. */
export function isCloudUnreachable(e: unknown, depth = 0): boolean {
  if (e instanceof CloudUnreachable) return true
  if (!e || typeof e !== 'object' || depth > 3) return typeof e === 'string' && NETWORK.test(e)
  const x = e as { message?: unknown; code?: unknown; cause?: unknown; errors?: unknown }
  if (typeof x.message === 'string' && NETWORK.test(x.message)) return true
  if (typeof x.code === 'string' && NETWORK.test(x.code)) return true
  if (isCloudUnreachable(x.cause, depth + 1)) return true
  return Array.isArray(x.errors) && x.errors.some((c) => isCloudUnreachable(c, depth + 1))
}

/** Runs `f`; a Cloud/network error comes out as `CloudUnreachable` (the original text kept in `detail`). */
export async function stopIfCloudDown<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f()
  } catch (e) {
    if (e instanceof CloudUnreachable || !isCloudUnreachable(e)) throw e
    throw new CloudUnreachable(e instanceof Error ? e.message : String(e))
  }
}
