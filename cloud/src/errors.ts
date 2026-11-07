// One error type for every refusal the Cloud answers; the HTTP layer maps `code` to a status.
import type { CloudErrorCode } from '../../src/shared/cloud-api.ts'

export class CloudError extends Error {
  readonly code: CloudErrorCode
  /** A busy refusal (429): the seconds to wait before trying again, sent as `Retry-After` (production-17). */
  readonly retryAfterS: number | undefined
  constructor(code: CloudErrorCode, message: string, retryAfterS?: number) {
    super(message)
    this.name = 'CloudError'
    this.code = code
    this.retryAfterS = retryAfterS
  }
}

export const HTTP_STATUS: Record<CloudErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  token_expired: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  gone: 410,
  insufficient_credits: 402,
  cap_exceeded: 402,
  rate_limited: 429,
  authorization_pending: 428,
  machine_offline: 503,
  timeout: 504,
  too_large: 413,
  internal: 500
}
