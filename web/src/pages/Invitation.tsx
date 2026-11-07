import { useEffect, useRef, useState, type FormEvent } from 'react'
import { saveUser } from '../auth'
import { CloudCallError, cloudEnabled, cloudInviteAccept, cloudInvitePreview, cloudInviteSignup, cloudLogin, type InvitePreview } from '../cloud'
import { AuthShell, Field } from '../components/AuthShell'
import { useLang } from '../i18n'
import { Button } from '../ui'

const MIN_PASSWORD = 10

/** The `?token=` of the address bar (the invitation e-mail links to /invitation with it). */
const tokenFromUrl = (): string => (typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('token') ?? ''))

const title = 'm-0 text-[28px] font-medium leading-[1.15] tracking-[-0.03em]'
const sub = 'm-0 mt-2 text-[14px] leading-[1.6] text-fg-3'
const notice = 'm-0 mt-6 rounded-[12px] bg-surface-2 px-4 py-3 text-[13px] leading-[1.5] text-fg-2'

export type InviteState = { kind: 'loading' } | { kind: 'ready'; invite: InvitePreview } | { kind: 'done'; team: string } | { kind: 'invalid' } | { kind: 'network' } | { kind: 'demo' }

/**
 * /invitation?token=… : who invites to which team; a person without an account creates it (name, password: the address is
 * the invitation's), a person with one signs in, then the link is accepted. `token` and `initial` let tests render a state.
 */
export function Invitation({ token, initial }: { token?: string; initial?: InviteState }) {
  const { t, lang } = useLang()
  const [state, setState] = useState<InviteState>(initial ?? { kind: 'loading' })
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ name?: string; password?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const started = useRef(false)
  const value = token ?? tokenFromUrl()

  useEffect(() => {
    if (started.current || initial) return
    started.current = true
    if (!cloudEnabled()) return setState({ kind: 'demo' })
    if (!value) return setState({ kind: 'invalid' })
    cloudInvitePreview(value)
      .then((invite) => setState({ kind: 'ready', invite }))
      .catch((err: unknown) => setState(err instanceof CloudCallError && err.status > 0 ? { kind: 'invalid' } : { kind: 'network' }))
  }, [value, initial])

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (state.kind !== 'ready') return
    const invite = state.invite
    const next: typeof errors = {}
    if (!invite.hasAccount && name.trim().length < 2) next.name = t('auth.errName')
    if (password.length < (invite.hasAccount ? 1 : MIN_PASSWORD)) next.password = t('auth.errPassword10')
    setErrors(next)
    setFailure(null)
    if (Object.keys(next).length > 0) return
    setBusy(true)
    const done = invite.hasAccount
      ? cloudLogin(invite.email, password).then((who) => cloudInviteAccept(value).then(() => who.name))
      : cloudInviteSignup(value, name.trim(), password, lang).then(() => name.trim())
    done
      .then((who) => {
        saveUser({ name: who, email: invite.email })
        setState({ kind: 'done', team: invite.teamName })
      })
      .catch((err: unknown) => {
        setBusy(false)
        const status = err instanceof CloudCallError ? err.status : 0
        if (status === 410) return setState({ kind: 'invalid' })
        setFailure(
          t(status === 401 ? 'auth.err.bad' : status === 403 ? 'invite.err.other' : status === 409 ? 'invite.err.exists' : status === 429 ? 'auth.err.locked' : 'auth.err.network')
        )
      })
  }

  if (state.kind === 'ready') {
    const invite = state.invite
    return (
      <AuthShell>
        <h1 className={title}>{t('invite.title')}</h1>
        <p className={sub} data-testid="invite-lead">
          {t('invite.lead', { who: invite.invitedBy || 'Atelier', team: invite.teamName, role: t(`invite.role.${invite.role}`) })}
        </p>
        <p className={sub}>{t(invite.hasAccount ? 'invite.login.sub' : 'invite.signup.sub')}</p>
        <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-4" data-testid="invite-form" data-mode={invite.hasAccount ? 'login' : 'signup'}>
          {!invite.hasAccount && (
            <Field id="name" label={t('auth.name')} autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
          )}
          <Field id="email" type="email" label={t('auth.email')} autoComplete="email" value={invite.email} readOnly />
          <Field
            id="password"
            type="password"
            label={t('auth.password')}
            autoComplete={invite.hasAccount ? 'current-password' : 'new-password'}
            hint={invite.hasAccount ? undefined : t('auth.passwordHint10')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />
          {failure && (
            <p role="alert" data-testid="invite-failure" className="m-0 rounded-[12px] bg-surface-2 px-4 py-3 text-[13px] text-fg-2">
              {failure}
            </p>
          )}
          <Button type="submit" size="lg" className="mt-2 w-full" disabled={busy}>
            {t(invite.hasAccount ? 'invite.submitLogin' : 'invite.submitSignup')}
          </Button>
        </form>
      </AuthShell>
    )
  }

  const heading = state.kind === 'done' ? 'invite.done.title' : state.kind === 'invalid' ? 'invite.err.title' : 'invite.title'
  const body =
    state.kind === 'done'
      ? t('invite.done.body', { team: state.team })
      : state.kind === 'invalid'
        ? t('invite.err.link')
        : state.kind === 'network'
          ? t('verify.err.network')
          : state.kind === 'demo'
            ? t('invite.demo')
            : t('invite.loading')
  return (
    <AuthShell>
      <h1 className={title}>{t(heading)}</h1>
      <p className={state.kind === 'done' ? notice : sub} role={state.kind === 'loading' ? 'status' : undefined} data-testid="invite-state" data-state={state.kind}>
        {body}
      </p>
    </AuthShell>
  )
}
