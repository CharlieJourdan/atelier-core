import { useCallback, useEffect, useState } from 'react'
import { CloudCallError, cloudEnabled, cloudMe, cloudResendVerification, type CloudMe } from '../cloud'
import { useLang, type TFn } from '../i18n'
import { Button } from '../ui'

export type ResendState = 'idle' | 'busy' | 'sent' | 'limit' | 'already' | 'error'

const NOTE: Partial<Record<ResendState, string>> = {
  sent: 'verify.banner.sent',
  limit: 'verify.banner.limit',
  already: 'verify.banner.already',
  error: 'auth.err.network'
}

/** The « Vérifie ton adresse » banner, as pure markup (the connected one below feeds it). */
export function VerifyBannerView({ email, state, onResend, t }: { email: string; state: ResendState; onResend: () => void; t: TFn }) {
  const note = NOTE[state]
  return (
    <section className="fill-card mb-8 p-5" aria-labelledby="verify-banner-title" data-testid="verify-banner">
      <h2 id="verify-banner-title" className="m-0 flex items-center gap-2 text-[15px] font-semibold tracking-[-0.014em]">
        <span className="size-1.5 rounded-full bg-warn" aria-hidden="true" />
        {t('verify.banner.title')}
      </h2>
      <p className="m-0 mt-2 text-[14px] leading-[1.6] text-fg-3">{t('verify.banner.body', { email })}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={onResend} disabled={state === 'busy'} data-testid="verify-resend">
          {t('verify.banner.resend')}
        </Button>
        {note && (
          <span role="status" className="text-[13px] text-fg-2" data-testid="verify-note">
            {t(note)}
          </span>
        )}
      </div>
    </section>
  )
}

/** The signed-in account's address status, read from Atelier Cloud (nothing without the Cloud); re-read when the tab regains
 *  focus, so confirming the address in another tab clears the banner. */
export function useEmailStatus(): { me: CloudMe | null; refresh: () => void } {
  const [me, setMe] = useState<CloudMe | null>(null)
  const on = cloudEnabled()
  const refresh = useCallback(() => {
    if (!on) return
    cloudMe()
      .then(setMe)
      .catch(() => undefined)
  }, [on])
  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])
  return { me, refresh }
}

/** Shown while the address is unconfirmed: says where the link went and resends it. */
export function VerifyBanner({ email, onChange }: { email: string; onChange: () => void }) {
  const { t } = useLang()
  const [state, setState] = useState<ResendState>('idle')
  const resend = (): void => {
    setState('busy')
    cloudResendVerification()
      .then((r) => {
        setState(r.alreadyVerified ? 'already' : 'sent')
        if (r.alreadyVerified) onChange()
      })
      .catch((err: unknown) => setState(err instanceof CloudCallError && err.status === 429 ? 'limit' : 'error'))
  }
  return <VerifyBannerView email={email} state={state} onResend={resend} t={t} />
}
