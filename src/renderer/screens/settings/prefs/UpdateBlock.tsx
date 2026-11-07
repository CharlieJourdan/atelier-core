// Réglages › À propos › Mises à jour: the installed version, the channel (bêta / stable), « Rechercher des mises à jour »,
// the download progress and « Redémarrer pour installer ». The status comes from the main process (src/main/updater);
// the page refreshes on the 'update' change topic. Pure body + a small container, so the body renders in tests.
import { useState } from 'react'
import type { UpdateChannel, UpdateStatus } from '../../../../shared/api'
import { getLocale, t, type MessageKey } from '../../../../shared/fr'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { call, errText, useApi } from '@/state/client'
import { Block, InfoList, InfoRow, Loaded } from './common'

const CHANNELS: readonly UpdateChannel[] = ['beta', 'stable']

const whenText = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(getLocale() === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

export interface UpdateBodyProps {
  status: UpdateStatus
  busy: boolean
  onCheck: () => void
  onInstall: () => void
  onChannel: (channel: UpdateChannel) => void
}

/** The line that says where the update stands. */
export function updateLine(s: UpdateStatus): string {
  switch (s.phase) {
    case 'unsupported':
      return t(`update.unsupported.${s.unsupported ?? 'dev'}` as MessageKey)
    case 'checking':
      return t('update.checking')
    case 'downloading':
      return t('update.downloading', { version: s.available ?? '', percent: s.percent ?? 0 })
    case 'ready':
      return t('update.ready', { version: s.available ?? '' })
    case 'error':
      return t('update.error', { reason: s.error ?? '' })
    default:
      return s.checkedAt ? t('update.upToDate') : t('update.never')
  }
}

export function UpdateBody({ status: s, busy, onCheck, onInstall, onChannel }: UpdateBodyProps) {
  const supported = s.phase !== 'unsupported'
  const running = s.phase === 'checking' || s.phase === 'downloading'
  return (
    <div className="flex flex-col gap-4" data-testid="update-block" data-phase={s.phase}>
      <InfoList>
        <InfoRow label={t('update.current')}>{s.current}</InfoRow>
        <InfoRow label={t('update.channel')}>
          <span className="inline-flex gap-1.5" role="group" aria-label={t('update.channel')}>
            {CHANNELS.map((c) => (
              <Button
                key={c}
                size="sm"
                variant={s.channel === c ? 'default' : 'secondary'}
                aria-pressed={s.channel === c}
                disabled={busy || running || !supported}
                data-testid={`update-channel-${c}`}
                onClick={() => (s.channel === c ? undefined : onChannel(c))}
              >
                {t(`update.channel.${c}` as MessageKey)}
              </Button>
            ))}
          </span>
        </InfoRow>
      </InfoList>
      <p className="text-[12px] text-fg-3">{t('update.channel.hint')}</p>

      <div className="rounded-card border border-line bg-surface-2 p-3.5" data-testid="update-status">
        <p className="text-[13px] text-fg" role="status">
          {updateLine(s)}
        </p>
        {s.phase === 'downloading' && (
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={s.percent ?? 0}
            data-testid="update-progress"
          >
            <div className="h-full rounded-full bg-brand" style={{ width: `${s.percent ?? 0}%` }} />
          </div>
        )}
        {supported && s.checkedAt && s.phase !== 'checking' && <p className="mt-1.5 text-[12px] text-fg-3">{t('update.lastCheck', { when: whenText(s.checkedAt) })}</p>}
        {s.phase === 'ready' && <p className="mt-1.5 text-[12px] text-fg-3">{t('update.installLater')}</p>}
        {s.available && s.notes && (
          <div className="mt-3" data-testid="update-notes">
            <p className="text-[12px] font-medium text-fg-2">{t('update.notes', { version: s.available })}</p>
            <p className="mt-1 text-[12.5px] whitespace-pre-line text-fg-2">{s.notes}</p>
          </div>
        )}
      </div>

      {supported && (
        <div className="flex flex-wrap items-center gap-2">
          {s.phase === 'ready' ? (
            <Button size="sm" disabled={busy} data-testid="update-install" onClick={onInstall}>
              {t('update.install')}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" disabled={busy || running} data-testid="update-check" onClick={onCheck}>
              {s.phase === 'checking' ? t('update.checking') : t('update.check')}
            </Button>
          )}
        </div>
      )}

      {supported && <p className="text-[12px] text-fg-3">{t('update.schedule')}</p>}
      {s.platform === 'win' && <p className="text-[12px] text-fg-3">{t('update.help.win')}</p>}
      {s.platform === 'mac' && <p className="text-[12px] text-fg-3">{t('update.help.mac')}</p>}
    </div>
  )
}

export function UpdateBlock() {
  const status = useApi('app.update.status', ['update'])
  const [busy, setBusy] = useState(false)
  const run = (fn: () => Promise<unknown>): void => {
    setBusy(true)
    fn()
      .catch((err: unknown) => toast.error(t('update.title'), errText(err)))
      .finally(() => {
        setBusy(false)
        status.reload()
      })
  }
  return (
    <Block title={t('update.title')}>
      <Loaded data={status.data} error={status.error} onRetry={status.reload}>
        {(s) => (
          <UpdateBody
            status={s}
            busy={busy}
            onCheck={() => run(() => call('app.update.check'))}
            onInstall={() => run(() => call('app.update.install'))}
            onChannel={(c) => run(() => call('app.update.setChannel', c))}
          />
        )}
      </Loaded>
    </Block>
  )
}
