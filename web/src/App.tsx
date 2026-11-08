import { lazy, Suspense, useEffect } from 'react'
import { SiteLayout } from './components/SiteLayout'
import { DEMO } from './demo/mode'
import { translate, useLang } from './i18n'
import { Auth } from './pages/Auth'
import { ForgotPassword, ResetPassword, VerifyEmail } from './pages/AccountMail'
import { Invitation } from './pages/Invitation'
import { Landing } from './pages/Landing'
import { MyVideos } from './pages/MyVideos'
import { Pricing } from './pages/Pricing'
import { Welcome } from './pages/Welcome'
import { Router, useRouter } from './router'
import { LinkButton } from './ui'

// The founder console is a separate chunk: visitors of the marketing site never download it.
const Admin = lazy(() => import('./admin/Admin').then((m) => ({ default: m.Admin })))

export function NotFound() {
  const { t } = useLang()
  return (
    <SiteLayout>
      <section className="mx-auto max-w-[1200px] px-5 py-32 sm:px-8">
        <h1 className="m-0 text-[36px] font-normal leading-[1.1] tracking-[-0.03em]">{t('notfound.title')}</h1>
        <LinkButton to="/" variant="secondary" className="mt-8">
          {t('notfound.back')}
        </LinkButton>
      </section>
    </SiteLayout>
  )
}

const TITLES: Record<string, string> = {
  '/': 'title.home',
  '/tarifs': 'title.pricing',
  '/connexion': 'title.login',
  '/inscription': 'title.signup',
  '/bienvenue': 'title.welcome',
  '/mes-videos': 'title.videos',
  '/verifier': 'title.verify',
  '/mot-de-passe-oublie': 'title.forgot',
  '/nouveau-mot-de-passe': 'title.reset',
  '/invitation': 'title.invite'
}

export function Routes() {
  const { path } = useRouter()
  const { lang } = useLang()
  const titleKey = TITLES[path] ?? (path === '/admin' || path.startsWith('/admin/') ? 'title.admin' : 'title.notfound')
  useEffect(() => {
    document.title = translate(lang, titleKey)
  }, [lang, titleKey])
  if (path === '/') return <Landing />
  if (path === '/tarifs') return <Pricing />
  if (path === '/connexion') return <Auth mode="login" />
  if (path === '/inscription') return <Auth mode="signup" />
  if (path === '/bienvenue') return <Welcome />
  if (path === '/mes-videos') return <MyVideos />
  if (path === '/verifier') return <VerifyEmail />
  if (path === '/mot-de-passe-oublie') return <ForgotPassword />
  if (path === '/nouveau-mot-de-passe') return <ResetPassword />
  if (path === '/invitation') return <Invitation />
  if (path === '/admin' || path.startsWith('/admin/')) {
    return (
      <Suspense fallback={<div className="min-h-screen" />}>
        <Admin />
      </Suspense>
    )
  }
  return <NotFound />
}

/** The demo build's thin top strip: every number and account on the pages is invented. */
export function DemoBanner() {
  const { t } = useLang()
  return (
    <p role="note" data-testid="demo-banner" className="m-0 bg-surface-2 px-4 py-1 text-center text-[12px] leading-[1.5] text-fg-2">
      {t('demo.banner')}
    </p>
  )
}

export function App({ initialPath }: { initialPath?: string }) {
  return (
    <Router initialPath={initialPath}>
      {DEMO && <DemoBanner />}
      <Routes />
    </Router>
  )
}
