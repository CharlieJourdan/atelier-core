import type { InputHTMLAttributes, ReactNode } from 'react'
import { useLang } from '../i18n'
import { Link } from '../router'
import { Mark } from '../ui'
import { LangToggle, ThemeToggle } from './SiteLayout'

/** Quiet page frame for account pages: wordmark, toggles, one centred column (centring is fine for onboarding flows). */
export function AuthShell({ children, width = 400 }: { children: ReactNode; width?: number }) {
  const { t } = useLang()
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between px-5 sm:px-8">
        <Link to="/" className="flex items-center gap-2.5 text-[16px] font-semibold tracking-[-0.02em] text-fg">
          <Mark size={24} />
          Atelier
        </Link>
        <div className="flex items-center gap-1">
          <LangToggle />
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-5 pb-16 pt-10 sm:pt-16">
        <div className="w-full" style={{ maxWidth: width }}>
          {children}
        </div>
      </main>
      <footer className="px-5 pb-6 text-center text-[12px] text-fg-3">{t('footer.disclaimer')}</footer>
    </div>
  )
}

export function Field({
  id,
  label,
  hint,
  error,
  ...rest
}: { id: string; label: string; hint?: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-fg">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        className={
          'h-10 w-full rounded-[12px] border bg-surface-1 px-3.5 text-[14px] text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-3 hover:border-line-3 focus-visible:border-ink/55 focus-visible:ring-4 focus-visible:ring-ink/10 ' +
          (error ? 'border-err/60' : 'border-line-2')
        }
        {...rest}
      />
      {error ? (
        <p id={`${id}-err`} className="m-0 mt-1.5 flex items-center gap-1.5 text-[12px] text-err">
          <span aria-hidden="true" className="inline-grid size-3.5 place-items-center rounded-full border border-current text-[9px] font-semibold leading-none">
            !
          </span>
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="m-0 mt-1.5 text-[12px] text-fg-3">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
