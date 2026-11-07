// The « Atelier Cloud » panel of Réglages (lot P5): connection state, device login (the code to type in the browser),
// sign-out, the Cloud's address, team and balance. Tokens never reach the renderer: main only says « connected ».
// `CloudPanelView` is pure (rendered in unit tests); `CloudPanel` loads the data and refreshes on the 'cloud' topic.
import { useState } from 'react'
import type { CloudAccount, CloudLoginState, CloudSpendSummary, CloudStatus } from '../../../shared/api'
import { t } from '../../../shared/fr'
import { Panel, StatusDot } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { call, errText, useApi, useLoader } from '@/state/client'

const credits = (n: number): string => new Intl.NumberFormat('fr-FR').format(n)
const eurosText = (n: number): string => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n)

export function balanceText(account: Pick<CloudAccount, 'wallet' | 'creditValueEur'>): string {
  const balance = account.wallet.balance
  return account.creditValueEur === null
    ? t('cloud.balance', { credits: credits(balance) })
    : t('cloud.balanceEur', { credits: credits(balance), eur: eurosText(balance * account.creditValueEur) })
}

export interface CloudPanelViewProps {
  status: CloudStatus | null
  login: CloudLoginState | null
  account: CloudAccount | null
  spend: CloudSpendSummary | null
  /** A French error to show (unreachable Cloud, refused address…). */
  error: string | null
  busy: boolean
  address: string
  onAddress: (value: string) => void
  onSaveAddress: () => void
  onConnect: () => void
  onCancel: () => void
  onDisconnect: () => void
}

export function CloudPanelView(p: CloudPanelViewProps) {
  const pending = p.login !== null && typeof p.login === 'object' && 'pending' in p.login ? p.login : null
  const loginError = p.login !== null && typeof p.login === 'object' && 'error' in p.login ? p.login.message : null
  const connected = p.status?.connected === true
  const who = p.status?.account ? `${p.status.account.name} (${p.status.account.email})` : null
  const stateLabel = pending
    ? t('cloud.state.pending')
    : connected
      ? who
        ? t('cloud.state.connected', { who })
        : t('cloud.state.connectedAnon')
      : t('cloud.state.idle')
  const error = p.error ?? loginError
  return (
    <Panel title={t('cloud.title')} data-testid="cloud-panel" className="max-w-2xl">
      <p className="mb-3 text-[13px] text-fg-3">{t('cloud.blurb')}</p>
      <div className="mb-3 flex items-center gap-2 text-sm" data-testid="cloud-state">
        <StatusDot tone={pending ? 'warn' : connected ? 'ok' : 'off'} pulse={pending !== null} />
        <span>{stateLabel}</span>
      </div>

      {pending && (
        <div className="mb-3 rounded-field border border-line bg-surface-2 p-3" data-testid="cloud-pending">
          <div className="micro-label">{t('cloud.code')}</div>
          <div className="my-1 font-mono text-2xl tracking-widest" data-testid="cloud-user-code">
            {pending.userCode}
          </div>
          <p className="text-xs text-fg-3">{t('cloud.browserOpened')}</p>
          <code className="block text-xs break-all text-fg-2 select-all">{pending.verificationUri}</code>
        </div>
      )}

      {connected && p.account && (
        <div className="mb-3 space-y-1 text-[13px]" data-testid="cloud-account">
          <div>
            {t('cloud.team', { team: p.account.teamName })} · {t(`cloud.role.${p.account.role}`)}
          </div>
          <div className="font-medium" data-testid="cloud-balance">
            {balanceText(p.account)}
          </div>
          <div className="text-xs text-fg-3">
            {t('cloud.available', { available: credits(p.account.wallet.available), held: credits(p.account.wallet.held) })}
          </div>
          {p.spend && p.spend.jobs > 0 && (
            <div className="text-xs text-fg-3">{t('cloud.spentMonth', { credits: credits(p.spend.spentCredits), jobs: p.spend.jobs })}</div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mb-3 text-[13px] text-err" data-testid="cloud-error">
          {error}
        </p>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {!connected && !pending && (
          <Button data-testid="cloud-connect" onClick={p.onConnect} disabled={p.busy}>
            {p.busy ? t('cloud.connecting') : t('cloud.connect')}
          </Button>
        )}
        {pending && (
          <Button variant="secondary" data-testid="cloud-cancel" onClick={p.onCancel} disabled={p.busy}>
            {t('cloud.cancel')}
          </Button>
        )}
        {connected && (
          <Button variant="outline" data-testid="cloud-disconnect" onClick={p.onDisconnect} disabled={p.busy}>
            {t('cloud.disconnect')}
          </Button>
        )}
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          p.onSaveAddress()
        }}
      >
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-fg-3">
          {t('cloud.address')}
          <input
            type="url"
            data-testid="cloud-address"
            value={p.address}
            onChange={(e) => p.onAddress(e.target.value)}
            className="h-8 w-full rounded-field border border-line bg-surface-1 px-2 text-[12.5px] text-fg outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          />
        </label>
        <Button type="submit" variant="secondary" size="sm" data-testid="cloud-address-save" disabled={p.busy || p.address.trim() === '' || p.address.trim() === p.status?.baseUrl}>
          {t('cloud.address.save')}
        </Button>
        <p className="w-full text-[11px] text-fg-4">{t('cloud.address.hint')}</p>
      </form>
    </Panel>
  )
}

export function CloudPanel() {
  const status = useApi('cloud.status', ['cloud'])
  const login = useApi('cloud.loginState', ['cloud'])
  const connected = status.data?.connected === true
  const account = useLoader(() => (connected ? call('cloud.account') : Promise.resolve(null)), String(connected), ['cloud', 'spend'])
  const spend = useLoader(() => call('cloud.spend'), 'spend', ['spend', 'cloud'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // what the person typed, until it is saved (null: the address in use)
  const [draft, setDraft] = useState<string | null>(null)
  const address = draft ?? status.data?.baseUrl ?? ''

  const run = async (fn: () => Promise<unknown>, done?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      if (done) toast.success(done)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
      status.reload()
      login.reload()
    }
  }

  return (
    <CloudPanelView
      status={status.data}
      login={login.data}
      account={account.data}
      spend={spend.data}
      error={error ?? account.error ?? status.error}
      busy={busy}
      address={address}
      onAddress={setDraft}
      onSaveAddress={() =>
        void run(async () => {
          await call('cloud.setBaseUrl', address.trim())
          setDraft(null)
        }, t('cloud.address.saved'))
      }
      onConnect={() => void run(() => call('cloud.connect'))}
      onCancel={() => void run(() => call('cloud.cancelLogin'))}
      onDisconnect={() => void run(() => call('cloud.disconnect'), t('cloud.disconnected'))}
    />
  )
}
