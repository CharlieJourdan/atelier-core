// The web app's Atelier Cloud session, for « Se connecter via Atelier Cloud » (docs/BRAIN-HEADLESS.md §7). The web app is
// served by the website under /app/ (same origin), so it reuses the session the site keeps after sign-in
// (localStorage `atelier.site.cloud`, written by web/src/cloud.ts) and the Cloud address the build was given
// (VITE_ATELIER_CLOUD). No session or no address: no Cloud mode. The access token refreshes itself once on a 401.
import type { BrainCloudMachine } from '../../shared/api'
import type { FetchLike } from '../../shared/brain-client'

export const SITE_TOKENS_KEY = 'atelier.site.cloud'

export interface WebCloudSession {
  baseUrl: string
  token(): Promise<string>
  /** The Cloud refused the access token: the next token() refreshes it. */
  expire(): void
  machines(): Promise<BrainCloudMachine[]>
}

interface Tokens {
  accessToken: string
  refreshToken: string
}

export function cloudBaseFromEnv(): string | null {
  const v = (import.meta.env?.VITE_ATELIER_CLOUD as string | undefined)?.replace(/\/+$/, '')
  return v || null
}

export function webCloudSession(o: { storage: Pick<Storage, 'getItem' | 'setItem'>; baseUrl: string | null; fetchImpl?: FetchLike }): WebCloudSession | null {
  const base = o.baseUrl
  if (!base) return null
  const fetchImpl = o.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init))
  const read = (): Tokens | null => {
    try {
      const v = JSON.parse(o.storage.getItem(SITE_TOKENS_KEY) ?? 'null') as Partial<Tokens> | null
      return v && typeof v.accessToken === 'string' && typeof v.refreshToken === 'string' ? { accessToken: v.accessToken, refreshToken: v.refreshToken } : null
    } catch {
      return null
    }
  }
  if (!read()) return null
  let stale = false
  let refreshing: Promise<string> | null = null
  const refresh = async (): Promise<string> => {
    const tokens = read()
    if (!tokens) throw new Error('signed out')
    const res = await fetchImpl(`${base}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken })
    })
    if (!res.ok) throw new Error(`refresh ${res.status}`)
    const fresh = (await res.json()) as Tokens
    try {
      o.storage.setItem(SITE_TOKENS_KEY, JSON.stringify({ accessToken: fresh.accessToken, refreshToken: fresh.refreshToken }))
    } catch {
      // blocked storage: this page keeps working until reloaded
    }
    stale = false
    return fresh.accessToken
  }
  const token = async (): Promise<string> => {
    if (!stale) {
      const tokens = read()
      if (!tokens) throw new Error('signed out')
      return tokens.accessToken
    }
    refreshing ??= refresh().finally(() => {
      refreshing = null
    })
    return refreshing
  }
  return {
    baseUrl: base,
    token,
    expire: () => {
      stale = true
    },
    machines: async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetchImpl(`${base}/v1/team/machines`, { headers: { authorization: `Bearer ${await token()}` } })
        if (res.status === 401 && attempt === 0) {
          stale = true
          continue
        }
        if (!res.ok) throw new Error(`machines ${res.status}`)
        const body = (await res.json()) as { machines?: { id: string; status: string; online?: boolean; demo?: boolean }[] }
        return (body.machines ?? []).map((m) => ({ id: m.id, status: m.status, online: m.online === true, demo: m.demo === true }))
      }
      throw new Error('machines 401')
    }
  }
}
