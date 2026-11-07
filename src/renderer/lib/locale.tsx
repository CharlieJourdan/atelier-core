// UI language (French / English). `t()` reads a module-level locale; switching re-mounts the tree under the provider so
// every text is looked up again.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { getLocale, setLocale as setGlobalLocale, type Locale } from '../../shared/fr'

interface LocaleValue {
  locale: Locale
  setLocale: (l: Locale) => void
}

const LocaleContext = createContext<LocaleValue>({ locale: 'fr', setLocale: () => undefined })

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setState] = useState<Locale>(getLocale())
  const setLocale = useCallback((l: Locale) => {
    setGlobalLocale(l)
    if (typeof document !== 'undefined') document.documentElement.lang = l
    setState(l)
  }, [])
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale])
  return (
    <LocaleContext.Provider value={value}>
      <LocaleRoot key={locale}>{children}</LocaleRoot>
    </LocaleContext.Provider>
  )
}

function LocaleRoot({ children }: { children: ReactNode }) {
  return <>{children}</>
}

export function useLocale(): LocaleValue {
  return useContext(LocaleContext)
}
