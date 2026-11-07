// Fictive accounts: everything lives in this browser's localStorage, nothing is sent anywhere.
import { useSyncExternalStore } from 'react'

export interface SiteUser {
  name: string
  email: string
  plan?: string
  billing?: 'monthly' | 'yearly'
  /** Set once the simulated checkout is confirmed. */
  subscribedAt?: number
  /** Set once the team computer has been "provisioned". */
  provisioned?: boolean
}

const USER_KEY = 'atelier.site.user'
const ADMIN_KEY = 'atelier.site.admin'
const listeners = new Set<() => void>()
// Fallback when localStorage is blocked: the session then only lasts until reload.
const memory: Record<string, string | null> = {}

function raw(key: string): string | null {
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
    if (v !== null) return v
  } catch {
    // blocked storage: fall through to memory
  }
  return memory[key] ?? null
}

function write(key: string, value: string | null): void {
  memory[key] = value
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // blocked storage: memory holds it
  }
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function parseUser(s: string | null): SiteUser | null {
  if (!s) return null
  try {
    const u = JSON.parse(s) as SiteUser
    return typeof u?.email === 'string' ? u : null
  } catch {
    return null
  }
}

export function getUser(): SiteUser | null {
  return parseUser(raw(USER_KEY))
}

// useSyncExternalStore needs a stable snapshot: re-parse only when the stored string changes.
let cacheRaw: string | null | undefined
let cacheUser: SiteUser | null = null
function userSnapshot(): SiteUser | null {
  const s = raw(USER_KEY)
  if (s !== cacheRaw) {
    cacheRaw = s
    cacheUser = parseUser(s)
  }
  return cacheUser
}

export function useUser(): SiteUser | null {
  return useSyncExternalStore(subscribe, userSnapshot, userSnapshot)
}

export function saveUser(user: SiteUser): void {
  write(USER_KEY, JSON.stringify(user))
}

export function updateUser(patch: Partial<SiteUser>): void {
  const u = getUser()
  if (u) saveUser({ ...u, ...patch })
}

export function signOut(): void {
  write(USER_KEY, null)
}

const adminSnapshot = (): boolean => raw(ADMIN_KEY) === '1'

export function useAdmin(): boolean {
  return useSyncExternalStore(subscribe, adminSnapshot, adminSnapshot)
}

export function setAdmin(on: boolean): void {
  write(ADMIN_KEY, on ? '1' : null)
}

// The plan picked on the pricing page, kept until the account exists and the welcome flow starts.
const PENDING_KEY = 'atelier.site.pending'

export interface PendingPlan {
  plan: string
  billing: 'monthly' | 'yearly'
}

export function getPendingPlan(): PendingPlan | null {
  const s = raw(PENDING_KEY)
  if (!s) return null
  try {
    const p = JSON.parse(s) as PendingPlan
    return typeof p?.plan === 'string' ? p : null
  } catch {
    return null
  }
}

export function setPendingPlan(p: PendingPlan | null): void {
  write(PENDING_KEY, p ? JSON.stringify(p) : null)
}
