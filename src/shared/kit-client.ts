// Asking Atelier Cloud for a video's publication kit from a page that has the person's Cloud token but no main process
// (the web app). Plain `fetch`, no DOM: Node tests use this exact module. The desktop app does the same through its
// Cloud session (src/main/cloud/kits.ts).
import type { CloudKitState } from './api'
import { KitWithLinks, VideoRef } from './cloud-kit'

export interface KitEndpoint {
  /** The Cloud's address, no trailing slash. */
  baseUrl: string
  token: () => Promise<string>
  /** The Cloud refused the access token (the next `token()` refreshes it). */
  expire?: () => void
  fetchImpl?: typeof fetch
}

/**
 * The kit of a video, or why there is none to show. A refused token is refreshed once. `ref`: the video's platform
 * reference from its brain (`cloud.kitRef`); a kit sent before the references carried a database id is read by the bare id.
 */
export async function fetchKitState(ep: KitEndpoint, videoId: number, ref?: string): Promise<CloudKitState> {
  if (ref !== undefined && VideoRef.safeParse(ref).success && ref !== String(videoId)) {
    const state = await fetchOne(ep, ref)
    if (state.status !== 'none') return state
  }
  return fetchOne(ep, String(videoId))
}

async function fetchOne(ep: KitEndpoint, ref: string): Promise<CloudKitState> {
  const doFetch = ep.fetchImpl ?? fetch
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response
    try {
      res = await doFetch(`${ep.baseUrl}/v1/team/videos/${encodeURIComponent(ref)}/kit`, { headers: { authorization: `Bearer ${await ep.token()}` } })
    } catch {
      return { status: 'unreachable' }
    }
    if (res.status === 401 && attempt === 0) {
      ep.expire?.()
      continue
    }
    if (res.status === 401) return { status: 'not-connected' }
    if (res.status === 404) return { status: 'none' }
    if (!res.ok) return { status: 'unreachable' }
    const parsed = KitWithLinks.safeParse(await res.json().catch(() => null))
    return parsed.success ? { status: 'ok', kit: parsed.data } : { status: 'unreachable' }
  }
  return { status: 'not-connected' }
}
