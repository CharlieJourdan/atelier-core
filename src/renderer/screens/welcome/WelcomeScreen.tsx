// The welcome screen of the beta (full window, same design system as the onboarding): « Se connecter » / « Créer un compte »
// start the device login of Atelier Cloud (src/main/cloud/session.ts) and open its page in the browser; the code to check
// is shown here while the browser page waits. « Continuer sans compte (hors ligne) » keeps Atelier on this computer only.
// The Cloud's address (a build default) can be changed from here too, for beta testers pointed at another server.
import { ArrowRight, Globe, KeyRound, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { CloudLoginState } from '../../../shared/api'
import { t } from '../../../shared/fr'
import { Logo } from '@/components/atelier/logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IS_MAC } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { call, errText, useApi } from '@/state/client'
import { OFFLINE_KEY } from './gate'

type Mode = 'signin' | 'signup'

export interface WelcomeViewProps {
  login: CloudLoginState | null
  baseUrl: string
  busy: boolean
  error: string | null
  onConnect: (mode: Mode) => void
  onReopen: () => void
  onCancel: () => void
  onOffline: () => void
  onServer: (url: string) => Promise<boolean>
}

/** Pure view (rendered in unit tests). */
export function WelcomeView(p: WelcomeViewProps) {
  const pending = p.login !== null && typeof p.login === 'object' && 'pending' in p.login ? p.login : null
  const loginError = p.login !== null && typeof p.login === 'object' && 'error' in p.login ? p.login.message : null
  const error = p.error ?? loginError
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const saveServer = (e: FormEvent): void => {
    e.preventDefault()
    void p.onServer(draft.trim()).then((ok) => ok && setEditing(false))
  }
  return (
    <div data-testid="welcome" data-state={pending ? 'pending' : 'idle'} className="relative flex h-full min-h-0 flex-col bg-bg text-fg">
      <header className={cn('drag flex h-[var(--titlebar-h)] shrink-0 items-center gap-2 pl-5', IS_MAC ? 'pr-5' : 'pr-[140px]')}>
        <span className={cn('flex items-center gap-2', IS_MAC && 'pl-[60px]')}>
          <Logo size={20} />
          <span className="text-[13.5px] font-semibold tracking-[-0.014em]">{t('app.name')}</span>
        </span>
      </header>
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 pb-16">
        <div className="fade-in flex w-full max-w-[440px] flex-col items-center text-center">
          <Logo size={56} />
          <h1 className="mt-8 text-[32px] leading-[1.18] font-semibold tracking-[-0.03em]">{pending ? t('beta.welcome.pending.title') : t('beta.welcome.title')}</h1>
          <p className="mt-3 text-[15px] leading-[1.55] text-fg-3">{pending ? t('beta.welcome.pending.blurb') : t('beta.welcome.blurb')}</p>

          {pending ? (
            <div className="mt-8 flex w-full flex-col items-center gap-4">
              <div className="w-full rounded-[18px] border border-line bg-surface-1 px-6 py-5">
                <p className="micro-label">{t('beta.welcome.code')}</p>
                <p data-testid="welcome-code" className="mt-2 font-mono text-[30px] tracking-[0.18em] text-fg select-all">
                  {pending.userCode}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" data-testid="welcome-reopen" onClick={p.onReopen} disabled={p.busy}>
                  <Globe aria-hidden />
                  {t('beta.welcome.openAgain')}
                </Button>
                <Button variant="ghost" data-testid="welcome-cancel" onClick={p.onCancel} disabled={p.busy}>
                  {t('beta.welcome.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-8 flex w-full flex-col gap-2.5">
              <Button size="lg" data-testid="welcome-signin" onClick={() => p.onConnect('signin')} disabled={p.busy} className="w-full">
                <KeyRound aria-hidden />
                {t('beta.welcome.signIn')}
              </Button>
              <Button size="lg" variant="secondary" data-testid="welcome-signup" onClick={() => p.onConnect('signup')} disabled={p.busy} className="w-full">
                <UserPlus aria-hidden />
                {t('beta.welcome.signUp')}
              </Button>
              <div className="mt-5 flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  data-testid="welcome-offline"
                  onClick={p.onOffline}
                  disabled={p.busy}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13.5px] font-medium text-fg-2 outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {t('beta.welcome.offline')}
                  <ArrowRight className="size-3.5" aria-hidden />
                </button>
                <p className="max-w-[380px] text-[12.5px] leading-[1.5] text-fg-4">{t('beta.welcome.offline.hint')}</p>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" data-testid="welcome-error" className="mt-5 text-[13px] text-err">
              {t('beta.welcome.failed', { error })}
            </p>
          )}
        </div>
      </main>
      <footer className="flex shrink-0 flex-col items-center gap-2 px-6 pb-6 text-[12px] text-fg-4">
        {editing ? (
          <form onSubmit={saveServer} className="flex w-full max-w-[440px] flex-col gap-1.5">
            <div className="flex gap-2">
              <Input
                data-testid="welcome-server-input"
                type="url"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                placeholder="https://…"
                aria-label={t('beta.welcome.server.change')}
                className="h-8 text-[12.5px]"
              />
              <Button type="submit" size="sm" variant="secondary" data-testid="welcome-server-save" disabled={p.busy || draft.trim() === ''}>
                {t('beta.welcome.server.save')}
              </Button>
            </div>
            <p className="text-left">{t('beta.welcome.server.hint')}</p>
          </form>
        ) : (
          <p className="flex items-center gap-2">
            <span data-testid="welcome-server">{t('beta.welcome.server', { url: p.baseUrl })}</span>
            <button
              type="button"
              data-testid="welcome-server-change"
              onClick={() => {
                setDraft(p.baseUrl)
                setEditing(true)
              }}
              className="rounded underline-offset-2 outline-none hover:text-fg-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {t('beta.welcome.server.change')}
            </button>
          </p>
        )}
      </footer>
    </div>
  )
}

export function WelcomeScreen() {
  const status = useApi('cloud.status', ['cloud'])
  const login = useApi('cloud.loginState', ['cloud'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('signin')

  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      return true
    } catch (e) {
      setError(errText(e))
      return false
    } finally {
      setBusy(false)
      status.reload()
      login.reload()
    }
  }

  return (
    <WelcomeView
      login={login.data}
      baseUrl={status.data?.baseUrl ?? ''}
      busy={busy}
      error={error}
      onConnect={(m) => {
        setMode(m)
        void run(() => call('cloud.connect', m))
      }}
      onReopen={() => void run(() => call('cloud.reopenLogin', mode))}
      onCancel={() => void run(() => call('cloud.cancelLogin'))}
      onOffline={() => void run(() => call('settings.set', OFFLINE_KEY, true))}
      onServer={(url) => run(() => call('cloud.setBaseUrl', url))}
    />
  )
}
