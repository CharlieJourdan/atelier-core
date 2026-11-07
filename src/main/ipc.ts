// Electron-free half of the `atelier:call` bus: validates the request and wraps the outcome in an envelope
// (errors thrown across ipcMain.handle lose their message otherwise).
import type { ApiHandlers, ApiMethod, CallEnvelope } from '../shared/api'
import { friendlyMessage, technicalDetail } from '../shared/friendly-error'
import { dispatch, isApiMethod } from './api'

export async function handleCall(api: ApiHandlers, method: unknown, args: unknown): Promise<CallEnvelope<unknown>> {
  if (!isApiMethod(api, method)) {
    return { ok: false, error: { code: 'UNKNOWN_METHOD', message: `Unknown method: ${String(method)}` } }
  }
  if (!Array.isArray(args)) {
    return { ok: false, error: { code: 'BAD_ARGS', message: `Arguments for ${method} must be an array` } }
  }
  try {
    const value = await dispatch(api, method as ApiMethod, args as never)
    return { ok: true, value }
  } catch (err) {
    const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : 'ERROR'
    const raw = err instanceof Error ? err.message : String(err)
    const message = friendlyMessage(raw, code)
    // The technical detail goes to the log (scrubbed) and to `detail`, never on the screen.
    if (message !== raw) console.error(`Atelier: ${String(method)} failed (${code}): ${technicalDetail(raw)}`)
    return { ok: false, error: { code, message, ...(message !== raw ? { detail: technicalDetail(raw) } : {}) } }
  }
}
