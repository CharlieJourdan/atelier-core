import { useSyncExternalStore } from 'react'
import { fr } from './content-fr'
import { en } from './content-en'

export type Lang = 'fr' | 'en'
export type Key = keyof typeof fr

const DICT: Record<Lang, Record<string, string>> = { fr, en }
const STORAGE_KEY = 'atelier.lang'

let lang: Lang = 'fr'
const listeners = new Set<() => void>()

function readStored(): Lang | null {
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    return v === 'en' || v === 'fr' ? v : null
  } catch {
    return null
  }
}

// French by default; an explicit choice (the toggle) is remembered.
const stored = readStored()
if (stored) lang = stored

export function getLang(): Lang {
  return lang
}

export function setLang(next: Lang): void {
  if (next === lang) return
  lang = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // storage blocked: the choice only lasts for this visit
  }
  if (typeof document !== 'undefined') document.documentElement.setAttribute('lang', next)
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export type TFn = (key: string, vars?: Record<string, string | number>) => string

export function translate(l: Lang, key: string, vars?: Record<string, string | number>): string {
  const raw = DICT[l][key] ?? fr[key as Key] ?? key
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
}

/** Current language and `t()`; components re-render when the visitor flips the FR / EN toggle. */
export function useLang(): { lang: Lang; setLang: (l: Lang) => void; t: TFn } {
  const current = useSyncExternalStore(subscribe, getLang, getLang)
  return { lang: current, setLang, t: (key, vars) => translate(current, key, vars) }
}

export function fmtEuro(n: number, l: Lang, opts: { decimals?: boolean } = {}): string {
  const decimals = opts.decimals ?? !Number.isInteger(n)
  return new Intl.NumberFormat(l === 'fr' ? 'fr-FR' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0
  }).format(n)
}

export function fmtNum(n: number, l: Lang): string {
  return new Intl.NumberFormat(l === 'fr' ? 'fr-FR' : 'en-GB').format(n)
}
