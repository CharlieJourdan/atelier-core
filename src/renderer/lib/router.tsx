// Router of the shell: the current route lives in React state (no URL: this is a desktop window). `navigate` takes
// a section (opening its first page when it has some) or a full route. The web demo (dist-demo/) mirrors it in the URL
// hash (#/section/page) so a screen can be linked to, reloaded, and reached with the browser's back button.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { defaultPage, HOME_ROUTE, isSectionId, pagesOf, type Route, type SectionId } from '../../shared/sections'
import { isDemoWeb } from './demo'

interface RouterValue {
  route: Route
  navigate: (to: SectionId | Route) => void
}

const RouterContext = createContext<RouterValue>({ route: HOME_ROUTE, navigate: () => undefined })

/** Normalises a destination: unknown pages fall back to the section's first page. */
export function resolveRoute(to: SectionId | Route): Route {
  const route: Route = typeof to === 'string' ? { section: to } : to
  const pages = pagesOf(route.section)
  if (pages.length === 0) return { section: route.section }
  const page = route.page && pages.includes(route.page) ? route.page : defaultPage(route.section)
  return {
    section: route.section,
    ...(page ? { page } : {})
  }
}

/** Pure: `#/production/creer` → its route; anything else → null. */
export function routeFromHash(hash: string): Route | null {
  const [section, page] = hash.replace(/^#\/?/, '').split('/')
  if (!isSectionId(section)) return null
  return resolveRoute(page ? { section, page } : { section })
}

export function hashOf(route: Route): string {
  return `#/${route.section}${route.page ? `/${route.page}` : ''}`
}

/** Web demo only: the route follows the hash (back button, links) and writes it back on each navigation. */
function useHashSync(route: Route, setRoute: (r: Route) => void): void {
  const on = isDemoWeb()
  useEffect(() => {
    if (!on) return
    const onHash = (): void => {
      const r = routeFromHash(window.location.hash)
      if (r) setRoute(r)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [on, setRoute])
  useEffect(() => {
    if (on && window.location.hash !== hashOf(route)) window.location.hash = hashOf(route)
  }, [on, route])
}

export function RouterProvider({ children, initial = HOME_ROUTE }: { children: ReactNode; initial?: Route }) {
  const [route, setRoute] = useState<Route>(() => (isDemoWeb() && routeFromHash(window.location.hash)) || resolveRoute(initial))
  const navigate = useCallback((to: SectionId | Route) => setRoute(resolveRoute(to)), [])
  useHashSync(route, setRoute)
  const value = useMemo(() => ({ route, navigate }), [route, navigate])
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRoute(): RouterValue {
  return useContext(RouterContext)
}
