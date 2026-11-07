import { useState, type FormEvent, type ReactNode } from 'react'
import { Activity, KeyRound, Layers, LayoutDashboard, Rocket, Server, Users as UsersIcon, Wallet } from 'lucide-react'
import { setAdmin, useAdmin } from '../auth'
import { CloudCallError, cloudAdminLogin, cloudEnabled, cloudSignOut } from '../cloud'
import { Field } from '../components/AuthShell'
import { ThemeToggle } from '../components/SiteLayout'
import { Link, useRouter } from '../router'
import { Button, Mark, cx } from '../ui'
import { Blueprints } from './Blueprints'
import { Costs } from './Costs'
import { LiveCosts } from './LiveCosts'
import { LiveMachines, LiveOverview, MockBanner } from './Live'
import { LiveUsers } from './LiveUsers'
import { Machines } from './Machines'
import { Overview } from './Overview'
import { Production } from './Production'
import { Providers } from './Providers'
import { Users } from './Users'
import { Versions } from './Versions'
import { ToastProvider } from './kit'

export const ADMIN_PAGES = [
  { path: '/admin', label: 'Vue d’ensemble', icon: LayoutDashboard },
  { path: '/admin/utilisateurs', label: 'Utilisateurs et CRM', icon: UsersIcon },
  { path: '/admin/machines', label: 'Machines', icon: Server },
  { path: '/admin/production', label: 'Production en direct', icon: Activity },
  { path: '/admin/couts', label: 'Coûts et rentabilité', icon: Wallet },
  { path: '/admin/blueprints', label: 'Blueprints', icon: Layers },
  { path: '/admin/fournisseurs', label: 'Fournisseurs', icon: KeyRound },
  { path: '/admin/versions', label: 'Versions', icon: Rocket }
] as const

function AdminLogin() {
  const real = cloudEnabled()
  const [email, setEmail] = useState(real ? '' : 'fondateur@atelier.test')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (password.length === 0) {
      setError(real ? 'Entre ton mot de passe.' : 'Entre un mot de passe (n’importe lequel en démonstration).')
      return
    }
    if (!real) return setAdmin(true)
    setBusy(true)
    cloudAdminLogin(email.trim(), password)
      .then((ok) => {
        if (ok) setAdmin(true)
        else setError('Ce compte n’est pas administrateur de la plateforme.')
      })
      .catch((err: unknown) => setError(err instanceof CloudCallError && err.status === 401 ? 'E-mail ou mot de passe incorrect.' : err instanceof CloudCallError && err.status === 429 ? 'Trop d’essais : réessaie dans 15 minutes.' : 'Atelier Cloud ne répond pas.'))
      .finally(() => setBusy(false))
  }
  return (
    <div className="flex min-h-screen items-start justify-center px-5 pt-[14vh]">
      <div className="w-full max-w-[380px]">
        <Link to="/" className="mb-8 flex items-center gap-2.5 text-[16px] font-semibold tracking-[-0.02em] text-fg">
          <Mark size={24} />
          Atelier
        </Link>
        <h1 className="m-0 text-[24px] font-semibold tracking-[-0.022em]">Console fondateur</h1>
        <p className="m-0 mt-2 text-[14px] text-fg-3">Accès réservé à l’équipe d’Atelier.</p>
        <form onSubmit={submit} noValidate className="mt-7 flex flex-col gap-4">
          <Field id="admin-email" type="email" label="Adresse e-mail" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field id="admin-password" type="password" label="Mot de passe" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
          <Button type="submit" size="lg" className="mt-1 w-full" disabled={busy}>
            Entrer
          </Button>
        </form>
        <p className="m-0 mt-6 rounded-[12px] bg-surface-2 px-4 py-3 text-[12px] leading-[1.5] text-fg-3">
          {real
            ? 'Connexion réelle sur Atelier Cloud : seuls les comptes administrateurs de la plateforme entrent, et le serveur vérifie chaque requête.'
            : 'Démonstration : cette connexion est fictive et n’importe quel mot de passe est accepté. La vraie protection se fait côté serveur, jamais dans le navigateur.'}
        </p>
      </div>
    </div>
  )
}

function Shell({ children }: { children: ReactNode }) {
  const { path } = useRouter()
  return (
    <ToastProvider>
      <div className="min-h-screen lg:grid lg:grid-cols-[236px_1fr]">
        <aside aria-label="Navigation de la console" className="border-b border-line bg-sidebar lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
          <div className="flex h-14 items-center justify-between gap-2 px-4">
            <Link to="/admin" className="flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.02em] text-fg">
              <Mark size={22} />
              Atelier
              <span className="text-[12px] font-normal text-fg-3">Console</span>
            </Link>
            <span className="lg:hidden">
              <ThemeToggle />
            </span>
          </div>
          <nav aria-label="Console" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-0">
            {ADMIN_PAGES.map((p) => {
              const active = path === p.path
              const Icon = p.icon
              return (
                <Link
                  key={p.path}
                  to={p.path}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex h-9 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-[8px] px-2.5 text-[13px] transition-colors',
                    active ? 'bg-selected font-medium text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg'
                  )}
                >
                  <Icon size={16} strokeWidth={1.5} className="shrink-0" />
                  {p.label}
                </Link>
              )
            })}
          </nav>
          <div className="hidden px-3 pb-4 lg:absolute lg:inset-x-0 lg:bottom-0 lg:block">
            <div className="flex items-center justify-between border-t border-line px-1 pt-3">
              <div className="flex flex-col gap-0.5 text-[12px]">
                <Link to="/" className="text-fg-3 hover:text-fg">
                  Retour au site
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    if (cloudEnabled()) cloudSignOut()
                    setAdmin(false)
                  }}
                  className="text-left text-fg-3 hover:text-fg"
                >
                  Quitter la console
                </button>
              </div>
              <ThemeToggle />
            </div>
          </div>
        </aside>
        <main id="main" className="min-w-0 px-5 py-8 sm:px-8">
          <div className="mx-auto max-w-[1240px]">{children}</div>
        </main>
      </div>
    </ToastProvider>
  )
}

export function AdminPage({ path }: { path: string }) {
  if (cloudEnabled()) {
    if (path === '/admin') return <LiveOverview />
    if (path === '/admin/utilisateurs') return <LiveUsers />
    if (path === '/admin/machines') return <LiveMachines />
    if (path === '/admin/couts') return <LiveCosts />
    if (path === '/admin/blueprints') return <Blueprints />
    if (path === '/admin/versions') return <Versions />
    return (
      <>
        <MockBanner />
        <MockPage path={path} />
      </>
    )
  }
  return <MockPage path={path} />
}

function MockPage({ path }: { path: string }) {
  switch (path) {
    case '/admin/utilisateurs':
      return <Users />
    case '/admin/machines':
      return <Machines />
    case '/admin/production':
      return <Production />
    case '/admin/couts':
      return <Costs />
    case '/admin/blueprints':
      return <Blueprints />
    case '/admin/fournisseurs':
      return <Providers />
    case '/admin/versions':
      return <Versions />
    default:
      return <Overview />
  }
}

/** Founder console: fake login first, then the eight pages. The admin flag lives in localStorage, as a real session never would. */
export function Admin() {
  const signedIn = useAdmin()
  const { path } = useRouter()
  if (!signedIn) return <AdminLogin />
  return (
    <Shell>
      <AdminPage path={path} />
    </Shell>
  )
}
