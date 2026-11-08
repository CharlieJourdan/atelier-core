import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CloudCallError, cloudEnabled, cloudForgotPassword, cloudResetPassword, cloudVerifyEmail } from '../cloud'
import { AuthShell, Field } from '../components/AuthShell'
import { DEMO, DEMO_TOKEN } from '../demo/mode'
import { useLang } from '../i18n'
import { Link, queryParam } from '../router'
import { Button, LinkButton } from '../ui'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 10

/** The `?token=` of the address bar (the e-mails link to /verifier and /nouveau-mot-de-passe with it). */
const tokenFromUrl = (): string => queryParam('token') ?? (DEMO ? DEMO_TOKEN : '')

const title = 'm-0 text-[28px] font-medium leading-[1.15] tracking-[-0.03em]'
const sub = 'm-0 mt-2 text-[14px] leading-[1.6] text-fg-3'
const notice = 'm-0 mt-6 rounded-[12px] bg-surface-2 px-4 py-3 text-[13px] leading-[1.5] text-fg-2'

type VerifyState = 'working' | 'ok' | 'invalid' | 'network' | 'demo'

/** /verifier?token=… : spends the single-use link of the verification e-mail. `token` and `initial` let tests render a state. */
export function VerifyEmail({ token, initial }: { token?: string; initial?: VerifyState }) {
  const { t } = useLang()
  const [state, setState] = useState<VerifyState>(initial ?? 'working')
  const started = useRef(false)
  useEffect(() => {
    // the link works once: React's double effect in development must not spend it twice
    if (started.current || initial) return
    started.current = true
    const value = token ?? tokenFromUrl()
    if (!cloudEnabled()) return setState('demo')
    if (!value) return setState('invalid')
    cloudVerifyEmail(value)
      .then(() => setState('ok'))
      .catch((err: unknown) => setState(err instanceof CloudCallError && err.status > 0 ? 'invalid' : 'network'))
  }, [token, initial])
  return (
    <AuthShell>
      <h1 className={title}>{t(state === 'ok' ? 'verify.ok.title' : state === 'invalid' ? 'verify.err.title' : 'verify.title')}</h1>
      <p className={sub} role={state === 'working' ? 'status' : undefined} data-testid="verify-state" data-state={state}>
        {t(
          state === 'ok'
            ? 'verify.ok.body'
            : state === 'invalid'
              ? 'verify.err.body'
              : state === 'network'
                ? 'verify.err.network'
                : state === 'demo'
                  ? 'verify.demo'
                  : 'verify.working'
        )}
      </p>
      {state === 'ok' && (
        <LinkButton to="/bienvenue" size="lg" className="mt-8 w-full">
          {t('verify.continue')}
        </LinkButton>
      )}
      {(state === 'invalid' || state === 'network') && (
        <LinkButton to="/connexion" variant="secondary" size="lg" className="mt-8 w-full">
          {t('verify.login')}
        </LinkButton>
      )}
    </AuthShell>
  )
}

/** « Mot de passe oublié » : the same confirmation whether or not an account uses the address. */
export function ForgotPassword({ initialSent = false }: { initialSent?: boolean }) {
  const { t, lang } = useLang()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(initialSent)
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const value = email.trim()
    if (!EMAIL.test(value)) return setError(t('auth.errEmail'))
    setError(null)
    if (!cloudEnabled()) return setSent(true)
    setBusy(true)
    cloudForgotPassword(value, lang)
      .then(() => setSent(true))
      .catch((err: unknown) => setError(t(err instanceof CloudCallError && err.status === 429 ? 'forgot.err.limit' : 'auth.err.network')))
      .finally(() => setBusy(false))
  }
  return (
    <AuthShell>
      <h1 className={title}>{t('forgot.title')}</h1>
      {sent ? (
        <>
          <p className={sub} role="status" data-testid="forgot-sent">
            {t('forgot.sent')}
          </p>
          {!cloudEnabled() && <p className={notice}>{t('forgot.demo')}</p>}
        </>
      ) : (
        <>
          <p className={sub}>{t('forgot.sub')}</p>
          <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-4">
            <Field id="email" type="email" label={t('auth.email')} autoComplete="email" placeholder="toi@exemple.com" value={email} onChange={(e) => setEmail(e.target.value)} error={error ?? undefined} />
            <Button type="submit" size="lg" className="mt-2 w-full" disabled={busy}>
              {t('forgot.submit')}
            </Button>
          </form>
        </>
      )}
      <p className="m-0 mt-6 text-center text-[13px] text-fg-3">
        <Link to="/connexion" className="text-fg underline decoration-line-3 underline-offset-4 hover:decoration-fg">
          {t('forgot.back')}
        </Link>
      </p>
    </AuthShell>
  )
}

type ResetState = 'form' | 'done' | 'invalid'

/** /nouveau-mot-de-passe?token=… : the new password for the single-use link; every device is signed out by the Cloud. */
export function ResetPassword({ token, initial }: { token?: string; initial?: ResetState }) {
  const { t } = useLang()
  const value = token ?? tokenFromUrl()
  const [state, setState] = useState<ResetState>(initial ?? (cloudEnabled() && !value ? 'invalid' : 'form'))
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [errors, setErrors] = useState<{ password?: string; again?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const next: typeof errors = {}
    if (password.length < MIN_PASSWORD) next.password = t('auth.errPassword10')
    else if (again !== password) next.again = t('reset.errMatch')
    setErrors(next)
    setFailure(null)
    if (Object.keys(next).length > 0) return
    if (!cloudEnabled()) return setState('done')
    setBusy(true)
    cloudResetPassword(value, password)
      .then(() => setState('done'))
      .catch((err: unknown) => {
        const status = err instanceof CloudCallError ? err.status : 0
        if (status === 410) setState('invalid')
        else setFailure(t(status === 429 ? 'auth.err.locked' : 'auth.err.network'))
      })
      .finally(() => setBusy(false))
  }
  if (state === 'done') {
    return (
      <AuthShell>
        <h1 className={title}>{t('reset.done.title')}</h1>
        <p className={sub} role="status" data-testid="reset-done">
          {t('reset.done.body')}
        </p>
        <LinkButton to="/connexion" size="lg" className="mt-8 w-full">
          {t('verify.login')}
        </LinkButton>
        {!cloudEnabled() && <p className={notice}>{t('reset.demo')}</p>}
      </AuthShell>
    )
  }
  if (state === 'invalid') {
    return (
      <AuthShell>
        <h1 className={title}>{t('verify.err.title')}</h1>
        <p className={sub} role="alert" data-testid="reset-invalid">
          {t('reset.err.link')}
        </p>
        <LinkButton to="/mot-de-passe-oublie" size="lg" className="mt-8 w-full">
          {t('reset.again')}
        </LinkButton>
      </AuthShell>
    )
  }
  return (
    <AuthShell>
      <h1 className={title}>{t('reset.title')}</h1>
      <p className={sub}>{t('reset.sub')}</p>
      <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-4">
        <Field id="password" type="password" label={t('auth.password')} autoComplete="new-password" hint={t('auth.passwordHint10')} value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        <Field id="password2" type="password" label={t('reset.confirm')} autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} error={errors.again} />
        {failure && (
          <p role="alert" className="m-0 rounded-[12px] bg-surface-2 px-4 py-3 text-[13px] text-fg-2">
            {failure}
          </p>
        )}
        <Button type="submit" size="lg" className="mt-2 w-full" disabled={busy}>
          {t('reset.submit')}
        </Button>
      </form>
    </AuthShell>
  )
}
