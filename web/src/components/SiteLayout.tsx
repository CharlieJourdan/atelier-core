import { useEffect, useState, type ReactNode } from 'react'
import { Menu, Moon, Sun, X } from 'lucide-react'
import { useUser } from '../auth'
import { cloudEnabled } from '../cloud'
import { useLang } from '../i18n'
import { Link, useRouter } from '../router'
import { useTheme } from '../theme'
import { Container, LinkButton, Mark, buttonClass, cx } from '../ui'

export function LangToggle() {
  const { lang, setLang, t } = useLang()
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
      aria-label={t('common.lang')}
      title={t('common.lang')}
      className="inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-[13px] font-medium text-fg-2 transition-colors hover:bg-hover hover:text-fg"
    >
      {lang === 'fr' ? 'EN' : 'FR'}
    </button>
  )
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const { t } = useLang()
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t('common.theme')}
      title={t('common.theme')}
      className="inline-flex size-8 items-center justify-center rounded-full text-fg-2 transition-colors hover:bg-hover hover:text-fg"
    >
      {theme === 'dark' ? <Sun size={16} strokeWidth={1.5} /> : <Moon size={16} strokeWidth={1.5} />}
    </button>
  )
}

function Wordmark() {
  return (
    <Link to="/" className="flex items-center gap-2.5 text-[16px] font-semibold tracking-[-0.02em] text-fg">
      <Mark size={24} />
      Atelier
    </Link>
  )
}

export function Nav() {
  const { t } = useLang()
  const user = useUser()
  const { path } = useRouter()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const linkClass = (active: boolean): string =>
    cx('rounded-full px-3 py-1.5 text-[14px] transition-colors hover:text-fg', active ? 'text-fg' : 'text-fg-2')

  const links = (
    <>
      <Link to="/#produit" className={linkClass(false)} onClick={() => setOpen(false)}>
        {t('nav.product')}
      </Link>
      <Link to="/tarifs" className={linkClass(path === '/tarifs')} onClick={() => setOpen(false)}>
        {t('nav.pricing')}
      </Link>
      <a href="/app/" className={linkClass(false)}>
        {t('nav.demo')}
      </a>
      {user && cloudEnabled() && (
        <Link to="/mes-videos" className={linkClass(path === '/mes-videos')} onClick={() => setOpen(false)}>
          {t('nav.videos')}
        </Link>
      )}
    </>
  )

  return (
    <header className={cx('sticky top-0 z-40 bg-bg', scrolled || open ? 'border-b border-line' : 'border-b border-transparent')}>
      <Container className="flex h-14 items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Wordmark />
          <nav className="hidden items-center md:flex" aria-label="Principal">
            {links}
          </nav>
        </div>
        <div className="flex items-center gap-1">
          <span className="hidden items-center gap-1 sm:flex">
            <LangToggle />
            <ThemeToggle />
          </span>
          <Link to={user ? '/bienvenue' : '/connexion'} className={buttonClass('ghost', 'md', 'hidden sm:inline-flex')}>
            {user ? t('nav.account') : t('nav.login')}
          </Link>
          <LinkButton to="/inscription" className="ml-1">
            {t('nav.try')}
          </LinkButton>
          <button
            type="button"
            className="ml-1 inline-flex size-8 items-center justify-center rounded-full text-fg-2 hover:bg-hover md:hidden"
            aria-label={open ? t('common.closeMenu') : t('common.openMenu')}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={18} strokeWidth={1.5} /> : <Menu size={18} strokeWidth={1.5} />}
          </button>
        </div>
      </Container>
      {open && (
        <Container className="flex flex-col gap-1 pb-4 md:hidden">
          <nav className="flex flex-col items-start" aria-label="Mobile">
            {links}
            <Link to={user ? '/bienvenue' : '/connexion'} className={linkClass(false)} onClick={() => setOpen(false)}>
              {user ? t('nav.account') : t('nav.login')}
            </Link>
          </nav>
          <div className="mt-1 flex items-center gap-1 sm:hidden">
            <LangToggle />
            <ThemeToggle />
          </div>
        </Container>
      )}
    </header>
  )
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="m-0 mb-3 text-[13px] font-medium text-fg">{title}</h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px] text-fg-3">{children}</ul>
    </div>
  )
}

const fLink = 'transition-colors hover:text-fg'

export function Footer() {
  const { t } = useLang()
  return (
    <footer className="mt-32 border-t border-line">
      <Container className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="max-w-[300px]">
          <Wordmark />
          <p className="m-0 mt-4 text-[13px] text-fg-3">{t('footer.disclaimer')}</p>
        </div>
        <FooterColumn title={t('footer.product')}>
          <li>
            <Link to="/#equipe" className={fLink}>
              {t('footer.p1')}
            </Link>
          </li>
          <li>
            <Link to="/#planning" className={fLink}>
              {t('footer.p2')}
            </Link>
          </li>
          <li>
            <Link to="/#pipelines" className={fLink}>
              {t('footer.p3')}
            </Link>
          </li>
          <li>
            <Link to="/#yeux" className={fLink}>
              {t('footer.p4')}
            </Link>
          </li>
        </FooterColumn>
        <FooterColumn title={t('footer.resources')}>
          <li>
            <Link to="/tarifs" className={fLink}>
              {t('footer.r1')}
            </Link>
          </li>
          <li>
            <a href="/app/" className={fLink}>
              {t('footer.r2')}
            </a>
          </li>
          <li>
            <Link to="/#faq" className={fLink}>
              {t('footer.r3')}
            </Link>
          </li>
        </FooterColumn>
        <FooterColumn title={t('footer.account')}>
          <li>
            <Link to="/connexion" className={fLink}>
              {t('footer.a1')}
            </Link>
          </li>
          <li>
            <Link to="/inscription" className={fLink}>
              {t('footer.a2')}
            </Link>
          </li>
          <li>
            <Link to="/bienvenue" className={fLink}>
              {t('footer.a3')}
            </Link>
          </li>
        </FooterColumn>
      </Container>
      <Container className="border-t border-line py-5">
        <p className="m-0 text-[12px] text-fg-3">
          © 2026 Atelier. {t('footer.legal')}
        </p>
      </Container>
    </footer>
  )
}

export function SiteLayout({ children }: { children: ReactNode }) {
  const { t } = useLang()
  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-ink-fg"
      >
        {t('common.skip')}
      </a>
      <Nav />
      <main id="main">{children}</main>
      <Footer />
    </div>
  )
}
