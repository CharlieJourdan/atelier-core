import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import { DEMO, DEMO_APP_HREF } from './demo/mode'

interface RouterValue {
  path: string
  navigate: (to: string, opts?: { replace?: boolean }) => void
}

const RouterContext = createContext<RouterValue>({ path: '/', navigate: () => undefined })

export function normalizePath(p: string): string {
  const clean = p.split('#')[0]?.split('?')[0] ?? '/'
  const trimmed = clean.length > 1 ? clean.replace(/\/+$/, '') : clean
  return trimmed || '/'
}

/** Paths that belong to the app web demo, not to this router (a plain link, full page load). */
export function isAppPath(to: string): boolean {
  return to === '/app' || to.startsWith('/app/')
}

/**
 * The demo build is a static folder served under any sub-path: it routes on the URL hash (`#/tarifs`) instead of the
 * History API, and its links to the app open the demo app built next to it.
 */
const HASH_ROUTING = DEMO

/** The route part of the address bar: the path (History) or what follows `#` (hash routing), query included. */
function locationRoute(): string {
  if (!HASH_ROUTING) return window.location.pathname + window.location.search
  const h = window.location.hash
  return h.startsWith('#/') ? h.slice(1) : '/'
}

/** The `href` of an internal link. */
export function hrefFor(to: string): string {
  if (isAppPath(to)) return DEMO ? DEMO_APP_HREF : to
  return HASH_ROUTING ? `#${to}` : to
}

/** A query parameter of the current address (`?token=` of the e-mail links), hash routing included. */
export function queryParam(name: string): string | null {
  if (typeof window === 'undefined') return null
  const route = locationRoute()
  const q = route.includes('?') ? route.slice(route.indexOf('?') + 1).split('#')[0] : ''
  return new URLSearchParams(q).get(name)
}

function scrollToHash(hash: string): void {
  if (typeof window === 'undefined') return
  requestAnimationFrame(() => {
    const el = hash ? document.getElementById(hash) : null
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else window.scrollTo(0, 0)
  })
}

/** History-based router of our own: `initialPath` lets tests render a route without a window. */
export function Router({ children, initialPath }: { children: ReactNode; initialPath?: string }) {
  const [path, setPath] = useState(() => initialPath ?? (typeof window === 'undefined' ? '/' : normalizePath(locationRoute())))

  useEffect(() => {
    const onPop = (): void => {
      // hash routing: an in-page anchor (`#main`) is not a route, the page stays
      if (HASH_ROUTING && !window.location.hash.startsWith('#/') && window.location.hash !== '') return
      setPath(normalizePath(locationRoute()))
    }
    window.addEventListener('popstate', onPop)
    if (HASH_ROUTING) window.addEventListener('hashchange', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('hashchange', onPop)
    }
  }, [])

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (isAppPath(to)) {
      window.location.assign(hrefFor(to))
      return
    }
    const [pathPart = '/', hash = ''] = to.split('#')
    const next = normalizePath(pathPart || '/')
    if (typeof window !== 'undefined') {
      const url = (HASH_ROUTING ? `#${next}` : next) + (hash ? `#${hash}` : '')
      if (opts?.replace) window.history.replaceState(null, '', url)
      else window.history.pushState(null, '', url)
    }
    setPath(next)
    scrollToHash(hash)
  }, [])

  const value = useMemo(() => ({ path, navigate }), [path, navigate])
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRouter(): RouterValue {
  return useContext(RouterContext)
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string }

/** Internal link: client-side navigation, but ctrl/cmd-click, new tabs and /app/ keep the browser's behaviour. */
export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const { navigate } = useRouter()
  const handle = (e: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if (isAppPath(to) || rest.target === '_blank') return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a href={hrefFor(to)} onClick={handle} {...rest}>
      {children}
    </a>
  )
}
