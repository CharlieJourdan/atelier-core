// Réglages › Ordinateur d'équipe: link the app to the headless brain on the team computer (docs/BRAIN-HEADLESS.md).
// Address + token → `brain.connect` checks them against the brain before keeping them: in the desktop app the main
// process stores the token encrypted (this page only sees « set / not set »); in the web app it stays in this tab's
// sessionStorage, with a warning. Once connected every screen talks to the team computer; the page reloads to refetch.
// When the person is signed in to Atelier Cloud and the team has a computer there, « Se connecter via Atelier Cloud »
// links through the Cloud's relay instead: no tunnel, no token to copy (docs/BRAIN-HEADLESS.md §7).
import { useState } from 'react'
import type { BrainStatus } from '../../../../shared/api'
import { t } from '../../../../shared/fr'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useApi } from '@/state/client'
import { Block, InfoList, InfoRow, Loaded, PrefsPage } from './common'

/** True in the web app (stub or remote bridge): the token lives in the tab, not in an encrypted store. */
function inBrowser(): boolean {
  if (typeof window === 'undefined') return false
  const a = (window as unknown as { atelier?: { web?: boolean; remote?: boolean } }).atelier
  return a?.web === true || a?.remote === true
}

function ConnectForm({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState('http://127.0.0.1:8790')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const connect = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = await call('brain.connect', { url, token })
      // The field is emptied at once: the page never keeps the token.
      setToken('')
      toast.success(t('prefs.ordinateur.ok', { name: next.name ?? next.url ?? '' }))
      onDone()
    } catch (err) {
      toast.error(t('prefs.saveError'), errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-3" data-testid="brain-connect-form">
      <label className="flex flex-col gap-1 text-[12.5px] text-fg-3">
        {t('prefs.ordinateur.url')}
        <Input value={url} spellCheck={false} placeholder={t('prefs.ordinateur.url.placeholder')} data-testid="brain-url" onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-[12.5px] text-fg-3">
        {t('prefs.ordinateur.token')}
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          placeholder={t('prefs.ordinateur.token.placeholder')}
          data-testid="brain-token"
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && token.trim() && url.trim() && !busy) void connect()
          }}
        />
      </label>
      <div>
        <Button size="sm" disabled={busy || !token.trim() || !url.trim()} data-testid="brain-connect" onClick={() => void connect()}>
          {busy ? t('prefs.ordinateur.connecting') : t('prefs.ordinateur.connect')}
        </Button>
      </div>
    </div>
  )
}

function CloudOffer({ cloud, onDone }: { cloud: NonNullable<BrainStatus['cloud']>; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const online = cloud.machines.some((m) => m.online)
  const connect = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = await call('brain.connect', { via: 'cloud' })
      toast.success(t('prefs.ordinateur.ok', { name: next.name ?? '' }))
      onDone()
    } catch (err) {
      toast.error(t('prefs.saveError'), errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-3" data-testid="brain-cloud-offer" data-online={online}>
      <p className="text-[13px] font-medium text-fg">{t('prefs.ordinateur.cloud.title')}</p>
      {cloud.machines.length === 0 ? (
        <p className="text-[12.5px] text-fg-3">{cloud.error ?? (cloud.checked ? t('prefs.ordinateur.cloud.none') : t('prefs.ordinateur.connecting'))}</p>
      ) : (
        <>
          <p className="text-[12.5px] text-fg-3">{t('prefs.ordinateur.cloud.how')}</p>
          <div className="flex flex-wrap gap-2">
            {cloud.machines.map((m) => (
              <Badge key={m.id} variant={m.online ? 'ok' : 'warn'}>
                {t('prefs.ordinateur.cloud.machine', { id: m.id, state: t(m.online ? 'prefs.ordinateur.cloud.online' : 'prefs.ordinateur.cloud.offline') })}
              </Badge>
            ))}
          </div>
          <div>
            <Button size="sm" disabled={busy || !online} data-testid="brain-cloud-connect" onClick={() => void connect()}>
              {busy ? t('prefs.ordinateur.connecting') : t('prefs.ordinateur.cloud.connect')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function Connected({ status, onDone }: { status: BrainStatus; onDone: () => void }) {
  const disconnect = async (): Promise<void> => {
    try {
      await call('brain.disconnect')
      toast.success(t('prefs.ordinateur.off'))
      onDone()
    } catch (err) {
      toast.error(t('prefs.saveError'), errText(err))
    }
  }
  return (
    <div className="flex flex-col gap-3" data-testid="brain-connected">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="ok">{t('prefs.ordinateur.connected', { name: status.name ?? '' })}</Badge>
        <Badge variant={status.live ? 'ok' : 'warn'} data-testid="brain-live" data-live={status.live}>
          {status.live ? t('prefs.ordinateur.live') : t('prefs.ordinateur.notLive')}
        </Badge>
      </div>
      <InfoList>
        <InfoRow label={t('prefs.ordinateur.via')}>{t(status.via === 'cloud' ? 'prefs.ordinateur.via.cloud' : 'prefs.ordinateur.via.direct')}</InfoRow>
        <InfoRow label={t('prefs.ordinateur.url')} mono>
          {status.url}
        </InfoRow>
        {status.via === 'cloud' ? (
          <InfoRow label={t('prefs.ordinateur.token')}>{t('prefs.ordinateur.cloud.session')}</InfoRow>
        ) : (
          <InfoRow label={t('prefs.ordinateur.token')}>{status.tokenSet ? t('prefs.ordinateur.token.set') : t('prefs.ordinateur.token.notSet')}</InfoRow>
        )}
      </InfoList>
      {status.error && <p className="text-[12.5px] text-err">{status.error}</p>}
      <div>
        <Button size="sm" variant="ghost" data-testid="brain-disconnect" onClick={() => void disconnect()}>
          {t('prefs.ordinateur.disconnect')}
        </Button>
      </div>
    </div>
  )
}

export function BrainPage() {
  const status = useApi('brain.status', ['brain'])
  // Every screen must refetch from the other brain: a reload is the simplest way (the web app reloads by itself).
  const reloadApp = (): void => {
    status.reload()
    if (!inBrowser()) setTimeout(() => window.location.reload(), 600)
  }
  return (
    <PrefsPage page="ordinateur">
      <Block title={t('prefs.ordinateur.title')}>
        <div className="flex flex-col gap-4">
          <p className="text-[12.5px] text-fg-3">{t('prefs.ordinateur.how')}</p>
          <p className="text-[12.5px] text-fg-3" data-testid="brain-storage-note">
            {inBrowser() ? t('prefs.ordinateur.session') : t('prefs.ordinateur.secret')}
          </p>
          <Loaded data={status.data} error={status.error} onRetry={status.reload}>
            {(s) =>
              s.mode === 'remote' ? (
                <Connected status={s} onDone={reloadApp} />
              ) : (
                <>
                  <p className="text-[13px] text-fg-2">{t('prefs.ordinateur.local')}</p>
                  {s.cloud ? (
                    <CloudOffer cloud={s.cloud} onDone={reloadApp} />
                  ) : (
                    <p className="text-[12.5px] text-fg-3" data-testid="brain-cloud-signed-out">
                      {t('prefs.ordinateur.cloud.signedOut')}
                    </p>
                  )}
                  <p className="text-[13px] font-medium text-fg">{t('prefs.ordinateur.direct.title')}</p>
                  <ConnectForm onDone={reloadApp} />
                </>
              )
            }
          </Loaded>
        </div>
      </Block>
    </PrefsPage>
  )
}
