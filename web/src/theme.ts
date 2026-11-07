import { useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'
const STORAGE_KEY = 'atelier.theme'

function current(): Theme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

function subscribe(cb: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => undefined
  const mo = new MutationObserver(cb)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => mo.disconnect()
}

/** Theme in use (the OS one until the visitor picks one with the toggle). */
export function useTheme(): { theme: Theme; toggle: () => void; set: (t: Theme) => void } {
  const theme = useSyncExternalStore(subscribe, current, () => 'dark' as Theme)
  const set = (t: Theme): void => {
    document.documentElement.setAttribute('data-theme', t)
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {
      // storage blocked: the choice only lasts for this visit
    }
  }
  return { theme, set, toggle: () => set(theme === 'dark' ? 'light' : 'dark') }
}
