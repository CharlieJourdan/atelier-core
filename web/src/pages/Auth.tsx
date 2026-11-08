import { useState, type FormEvent } from 'react'
import { saveUser } from '../auth'
import { CloudCallError, cloudEnabled, cloudLogin, cloudSignup } from '../cloud'
import { AuthShell, Field } from '../components/AuthShell'
import { DEMO, DEMO_ACCOUNT } from '../demo/mode'
import { getLang, useLang } from '../i18n'
import { Link, useRouter } from '../router'
import { Button } from '../ui'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Login or signup. Fictive (a localStorage entry) unless the site is built for Atelier Cloud (cloud.ts): then the
 *  account is real, on the Cloud. */
export function Auth({ mode }: { mode: 'login' | 'signup' }) {
  const { t } = useLang()
  const { navigate } = useRouter()
  const signup = mode === 'signup'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const real = cloudEnabled()
  const minPassword = real ? 10 : 8

  const finish = (user: { name: string; email: string }): void => {
    setBusy(true)
    saveUser({ ...user })
    navigate('/bienvenue')
  }

  // the demo build: straight in as the fictional founder account, nothing to type
  const skip = (): void => {
    setBusy(true)
    cloudLogin(DEMO_ACCOUNT.email, 'demo')
      .then((who) => finish({ name: who.name, email: DEMO_ACCOUNT.email }))
      .catch(() => setBusy(false))
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const next: typeof errors = {}
    if (signup && name.trim().length < 2) next.name = t('auth.errName')
    if (!EMAIL.test(email.trim())) next.email = t('auth.errEmail')
    if (password.length < minPassword) next.password = t(real ? 'auth.errPassword10' : 'auth.errPassword')
    setErrors(next)
    setFailure(null)
    if (Object.keys(next).length > 0) return
    const trimmed = email.trim()
    if (!real) {
      finish({ name: signup ? name.trim() : (trimmed.split('@')[0] ?? 'toi'), email: trimmed })
      return
    }
    setBusy(true)
    const done = signup ? cloudSignup(name.trim(), trimmed, password, getLang()).then(() => ({ name: name.trim() })) : cloudLogin(trimmed, password)
    done
      .then((who) => finish({ name: who.name, email: trimmed }))
      .catch((err: unknown) => {
        setBusy(false)
        const status = err instanceof CloudCallError ? err.status : 0
        setFailure(t(status === 409 ? 'auth.err.exists' : status === 401 ? 'auth.err.bad' : status === 429 ? 'auth.err.locked' : 'auth.err.network'))
      })
  }

  return (
    <AuthShell>
      <h1 className="m-0 text-[28px] font-medium leading-[1.15] tracking-[-0.03em]">{t(signup ? 'auth.signup.title' : 'auth.login.title')}</h1>
      <p className="m-0 mt-2 text-[14px] text-fg-3">{t(signup ? 'auth.signup.sub' : 'auth.login.sub')}</p>

      {!real && (
        <>
          <Button variant="secondary" size="lg" className="mt-8 w-full" disabled={busy} onClick={() => finish({ name: 'Alex', email: 'alex.demo@example.com' })}>
            {t('auth.google')}
          </Button>

          <div className="my-6 flex items-center gap-3 text-[12px] text-fg-3" role="separator">
            <span className="h-px flex-1 bg-line-2" />
            {t('auth.or')}
            <span className="h-px flex-1 bg-line-2" />
          </div>
        </>
      )}
      {DEMO && (
        <>
          <Button variant="secondary" size="lg" className="mt-8 w-full" disabled={busy} onClick={skip} data-testid="auth-demo-skip">
            {t('demo.skip')}
          </Button>
          <div className="my-6 flex items-center gap-3 text-[12px] text-fg-3" role="separator">
            <span className="h-px flex-1 bg-line-2" />
            {t('auth.or')}
            <span className="h-px flex-1 bg-line-2" />
          </div>
        </>
      )}
      {real && !DEMO && <div className="mt-8" />}

      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {signup && <Field id="name" label={t('auth.name')} autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />}
        <Field
          id="email"
          type="email"
          label={t('auth.email')}
          autoComplete="email"
          placeholder="toi@exemple.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <Field
          id="password"
          type="password"
          label={t('auth.password')}
          autoComplete={signup ? 'new-password' : 'current-password'}
          hint={signup ? t(real ? 'auth.passwordHint10' : 'auth.passwordHint') : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        {!signup && (
          <p className="m-0 -mt-2 text-right text-[13px]">
            <Link to="/mot-de-passe-oublie" className="text-fg-3 underline decoration-line-3 underline-offset-4 hover:text-fg hover:decoration-fg">
              {t('auth.forgot')}
            </Link>
          </p>
        )}
        {failure && (
          <p role="alert" data-testid="auth-failure" className="m-0 rounded-[12px] bg-surface-2 px-4 py-3 text-[13px] text-fg-2">
            {failure}
          </p>
        )}
        <Button type="submit" size="lg" className="mt-2 w-full" disabled={busy}>
          {t(signup ? 'auth.submitSignup' : 'auth.submitLogin')}
        </Button>
      </form>

      <p className="m-0 mt-6 text-center text-[13px] text-fg-3">
        {t(signup ? 'auth.haveAccount' : 'auth.noAccount')}{' '}
        <Link to={signup ? '/connexion' : '/inscription'} className="text-fg underline decoration-line-3 underline-offset-4 hover:decoration-fg">
          {t(signup ? 'auth.toLogin' : 'auth.toSignup')}
        </Link>
      </p>
      <p className="m-0 mt-8 rounded-[12px] bg-surface-2 px-4 py-3 text-[12px] leading-[1.5] text-fg-3">{t(DEMO ? 'demo.note' : real ? 'auth.cloudNote' : 'auth.demoNote')}</p>
    </AuthShell>
  )
}
