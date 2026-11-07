// Réglages › Chaînes › Google: the OAuth client Charlie pastes (id shown, secret masked and never shown again), the
// connection of his Google account in the browser (read-only scopes), « Actualiser maintenant », and which Atelier channel
// each YouTube channel of the account feeds (« Relier à » writes the channel's YouTube id). Everything is real: the main
// process holds the secret and the token (src/main/google); this page only sees « set / not set ». Pure body + container.
import { useState } from 'react'
import type { GoogleStatus } from '../../../../shared/api/google'
import { getLocale, t } from '../../../../shared/fr'
import type { ChannelRow } from '../../../../shared/workflow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useApi } from '@/state/client'
import { Block, Loaded } from './common'

const whenText = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(getLocale() === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

export type GoogleAction = 'save' | 'clear' | 'connect' | 'disconnect' | 'refresh' | 'link'

export interface GoogleBodyProps {
  status: GoogleStatus
  /** The Atelier channels a YouTube channel can be linked to. */
  channels: readonly Pick<ChannelRow, 'id' | 'name' | 'archived'>[]
  busy: GoogleAction | null
  onSaveClient: (clientId: string, clientSecret: string) => void
  onClearClient: () => void
  onConnect: () => void
  onDisconnect: () => void
  onRefresh: () => void
  onLink: (youtubeChannelId: string, channelId: number) => void
}

function ClientForm({ status: s, busy, onSaveClient, onClearClient }: Pick<GoogleBodyProps, 'status' | 'busy' | 'onSaveClient' | 'onClearClient'>) {
  const [clientId, setClientId] = useState(s.clientSource === 'settings' ? (s.clientId ?? '') : '')
  const [secret, setSecret] = useState('')
  const save = (): void => {
    onSaveClient(clientId.trim(), secret.trim())
    // the secret never stays in the page
    setSecret('')
  }
  return (
    <div className="flex flex-col gap-2.5" data-testid="google-client">
      <p className="text-[13px] font-medium text-fg">{t('prefs.google.client')}</p>
      <p className="text-[12.5px] text-fg-3">{t('prefs.google.client.help')}</p>
      <p className="text-[12.5px] text-fg-2" data-testid="google-client-source">
        {s.clientSource === 'env' ? t('prefs.google.source.env') : s.clientSource === 'settings' ? t('prefs.google.source.settings') : t('prefs.google.noClient')}
      </p>
      <Input
        value={clientId}
        spellCheck={false}
        autoComplete="off"
        aria-label={t('prefs.google.clientId.label')}
        placeholder={t('prefs.google.clientId.placeholder')}
        data-testid="google-client-id"
        onChange={(e) => setClientId(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Input
          type="password"
          value={secret}
          spellCheck={false}
          autoComplete="off"
          aria-label={t('prefs.google.secret.label')}
          placeholder={t('prefs.google.secret.placeholder')}
          data-testid="google-client-secret"
          onChange={(e) => setSecret(e.target.value)}
        />
        <Badge variant={s.clientSecretSet ? 'ok' : 'default'} data-testid="google-secret-state" data-set={s.clientSecretSet}>
          {s.clientSecretSet ? t('prefs.google.secret.set') : t('prefs.google.secret.notSet')}
        </Badge>
      </div>
      {s.clientSecretSet && <p className="text-[12px] text-fg-3">{t('prefs.google.secret.keep')}</p>}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy !== null || !clientId.trim()} data-testid="google-client-save" onClick={save}>
          {t('prefs.google.save')}
        </Button>
        {s.clientSource === 'settings' && (
          <Button size="sm" variant="ghost" disabled={busy !== null} data-testid="google-client-clear" onClick={onClearClient}>
            {t('prefs.google.clear')}
          </Button>
        )}
      </div>
    </div>
  )
}

export function GoogleBody(p: GoogleBodyProps) {
  const s = p.status
  const state = s.connecting ? 'connecting' : s.connected ? 'connected' : s.needsReconnect ? 'reconnect' : 'off'
  const linkable = p.channels.filter((c) => !c.archived)
  return (
    <div className="flex flex-col gap-5" data-testid="google-block" data-state={state}>
      <div className="flex flex-col gap-1.5">
        <p className="text-[13px] text-fg-2">{t('prefs.google.intro')}</p>
        <p className="text-[12px] text-fg-3">{t('prefs.google.readOnly')}</p>
      </div>
      <ClientForm status={s} busy={p.busy} onSaveClient={p.onSaveClient} onClearClient={p.onClearClient} />

      <div className="flex flex-col gap-2.5 border-t border-line pt-4" data-testid="google-account">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-medium text-fg">{t('prefs.google.account')}</p>
          <Badge variant={state === 'connected' ? 'ok' : state === 'reconnect' ? 'warn' : 'default'} data-testid="google-state">
            {state === 'connected'
              ? t('prefs.google.state.connected')
              : state === 'reconnect'
                ? t('prefs.google.state.reconnect')
                : state === 'connecting'
                  ? t('prefs.google.state.connecting')
                  : t('prefs.google.state.off')}
          </Badge>
        </div>
        {s.needsReconnect && <p className="text-[12.5px] text-warn">{t('prefs.google.reconnect.why')}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {!s.connected && (
            <Button size="sm" disabled={!s.clientIdSet || p.busy !== null} data-testid="google-connect" onClick={p.onConnect}>
              {s.needsReconnect ? t('prefs.google.reconnect') : t('prefs.google.connect')}
            </Button>
          )}
          {s.connected && (
            <Button size="sm" variant="secondary" disabled={p.busy !== null} data-testid="google-refresh" onClick={p.onRefresh}>
              {t('prefs.google.refresh')}
            </Button>
          )}
          {(s.connected || s.needsReconnect) && (
            <Button size="sm" variant="ghost" disabled={p.busy !== null} data-testid="google-disconnect" onClick={p.onDisconnect}>
              {t('prefs.google.disconnect')}
            </Button>
          )}
        </div>
        <p className="text-[12px] text-fg-3" data-testid="google-last">
          {s.lastRefreshAt ? t('prefs.google.lastRefresh', { when: whenText(s.lastRefreshAt) }) : t('prefs.google.never')} {s.connected ? t('prefs.google.daily') : ''}
        </p>
        {s.lastError && (
          <p className="text-[12.5px] text-err" data-testid="google-error" data-code={s.lastError.code}>
            {t('prefs.google.error', { reason: s.lastError.message })}
          </p>
        )}
      </div>

      {(s.connected || s.channels.length > 0) && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-[13px] font-medium text-fg">{t('prefs.google.channels')}</p>
          {s.channels.length === 0 && <p className="text-[12.5px] text-fg-3">{t('prefs.google.channels.none')}</p>}
          <ul className="flex flex-col" data-testid="google-channels">
            {s.channels.map((c) => (
              <li key={c.youtubeChannelId} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0" data-testid="google-channel" data-linked={c.atelierChannelId !== null}>
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-fg">
                    {c.title || c.youtubeChannelId} {c.handle && <span className="text-fg-3">{c.handle}</span>}
                  </p>
                  <p className="text-[12px] text-fg-3">
                    {c.atelierChannelName ? t('prefs.google.channel.mapped', { name: c.atelierChannelName }) : t('prefs.google.channel.unmapped')} ·{' '}
                    {c.revenueAvailable ? t('prefs.google.channel.revenue') : t('prefs.google.channel.noRevenue')}
                  </p>
                </div>
                {c.atelierChannelId === null && linkable.length > 0 && (
                  <Select
                    aria-label={t('prefs.google.channel.link')}
                    className="w-[200px]"
                    value=""
                    disabled={p.busy !== null}
                    data-testid="google-link"
                    onChange={(e) => {
                      const id = Number(e.target.value)
                      if (Number.isInteger(id) && id > 0) p.onLink(c.youtubeChannelId, id)
                    }}
                  >
                    <option value="">{t('prefs.google.channel.pick')}</option>
                    {linkable.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.name}
                      </option>
                    ))}
                  </Select>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function GoogleBlock({ channels }: { channels: GoogleBodyProps['channels'] }) {
  const status = useApi('google.status', ['google', 'channels'])
  const [busy, setBusy] = useState<GoogleAction | null>(null)
  const run = (action: GoogleAction, fn: () => Promise<unknown>, ok?: string): void => {
    setBusy(action)
    fn()
      .then(() => {
        if (ok) toast.success(ok)
      })
      .catch((err: unknown) => toast.error(t('prefs.google.title'), errText(err)))
      .finally(() => {
        setBusy(null)
        status.reload()
      })
  }
  return (
    <Block title={t('prefs.google.title')}>
      <Loaded data={status.data} error={status.error} onRetry={status.reload}>
        {(s) => (
          <GoogleBody
            status={s}
            channels={channels}
            busy={busy}
            onSaveClient={(clientId, clientSecret) => run('save', () => call('google.setClient', { clientId, ...(clientSecret ? { clientSecret } : {}) }), t('prefs.google.saved'))}
            onClearClient={() => run('clear', () => call('google.clearClient'), t('prefs.google.cleared'))}
            onConnect={() => run('connect', () => call('google.connect'), t('prefs.google.connected'))}
            onDisconnect={() => run('disconnect', () => call('google.disconnect'), t('prefs.google.disconnected'))}
            onRefresh={() => run('refresh', () => call('google.refresh'), t('prefs.google.refreshed'))}
            onLink={(youtubeChannelId, channelId) => run('link', () => call('channels.update', channelId, { youtubeChannelId }), t('prefs.google.channel.linked'))}
          />
        )}
      </Loaded>
    </Block>
  )
}
