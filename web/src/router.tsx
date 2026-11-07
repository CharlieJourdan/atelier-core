import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react'

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
  const [path, setPath] = useState(() => initialPath ?? (typeof window === 'undefined' ? '/' : normalizePath(window.location.pathname)))

  useEffect(() => {
    const onPop = (): void => setPath(normalizePath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (isAppPath(to)) {
      window.location.assign(to)
      return
    }
    const [pathPart = '/', hash = ''] = to.split('#')
    const next = normalizePath(pathPart || '/')
    if (typeof window !== 'undefined') {
      const url = next + (hash ? `#${hash}` : '')
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
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  )
}
