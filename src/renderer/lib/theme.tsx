// Dark / light theme: a `data-theme` attribute on <html> (tokens.css does the rest), remembered in localStorage.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Theme = 'dark' | 'light'
export const THEME_KEY = 'atelier.theme'

export function parseTheme(v: unknown): Theme {
  return v === 'light' ? 'light' : 'dark'
}

export function readStoredTheme(): Theme {
  try {
    return parseTheme(globalThis.localStorage?.getItem(THEME_KEY))
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme
  // The native window (background, caption buttons) follows. No bridge (unit renders, plain browser): nothing to do.
  try {
    const bridge = (globalThis as { atelier?: { call?: (method: string, ...args: unknown[]) => Promise<unknown> } }).atelier
    void bridge?.call?.('app.setTheme', theme)?.catch(() => undefined)
  } catch {
    /* the window keeps its previous colours */
  }
}

interface ThemeValue {
  theme: Theme
  setTheme: (t: Theme) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeValue>({ theme: 'dark', setTheme: () => undefined, toggle: () => undefined })

export function ThemeProvider({ children, initial }: { children: ReactNode; initial?: Theme }) {
  const [theme, setThemeState] = useState<Theme>(initial ?? readStoredTheme())
  useEffect(() => applyTheme(theme), [theme])
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      globalThis.localStorage?.setItem(THEME_KEY, next)
    } catch {
      /* private mode: the theme just is not remembered */
    }
  }, [])
  const toggle = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme])
  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext)
}
