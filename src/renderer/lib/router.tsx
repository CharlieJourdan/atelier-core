// Router of the shell: the current route lives in React state (no URL: this is a desktop window). `navigate` takes
// a section (opening its first page when it has some) or a full route.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { defaultPage, HOME_ROUTE, pagesOf, type Route, type SectionId } from '../../shared/sections'

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

export function RouterProvider({ children, initial = HOME_ROUTE }: { children: ReactNode; initial?: Route }) {
  const [route, setRoute] = useState<Route>(resolveRoute(initial))
  const navigate = useCallback((to: SectionId | Route) => setRoute(resolveRoute(to)), [])
  const value = useMemo(() => ({ route, navigate }), [route, navigate])
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRoute(): RouterValue {
  return useContext(RouterContext)
}
