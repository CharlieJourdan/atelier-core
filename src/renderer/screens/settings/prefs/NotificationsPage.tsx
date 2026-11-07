// Réglages › Notifications: what notifies the user today (fixed rules, nothing to configure) and what waits for their OK.
import { Bell, Inbox, MonitorSmartphone } from 'lucide-react'
import { t } from '../../../../shared/fr'
import { StatTile } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { useApi } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { Block, Loaded, PrefsPage } from './common'

const RULES = [
  { icon: Bell, title: 'prefs.notifications.rule.desktop', body: 'prefs.notifications.rule.desktop.body' },
  { icon: Inbox, title: 'prefs.notifications.rule.inapp', body: 'prefs.notifications.rule.inapp.body' },
  { icon: MonitorSmartphone, title: 'prefs.notifications.rule.tray', body: 'prefs.notifications.rule.tray.body' }
] as const

export function NotificationsBody({ pending, onOpen }: { pending: number; onOpen?: () => void }) {
  return (
    <>
      <StatTile
        label={t('prefs.notifications.pending')}
        value={pending}
        hint={pending === 0 ? t('prefs.notifications.pending.none') : pending === 1 ? t('prefs.notifications.pending.one') : t('prefs.notifications.pending.n', { n: pending })}
      />
      {onOpen && (
        <div>
          <Button variant="secondary" size="sm" onClick={onOpen}>
            {t('prefs.notifications.pending.open')}
          </Button>
        </div>
      )}
      <Block title={t('prefs.notifications.rules')}>
        <ul className="flex flex-col divide-y divide-line">
          {RULES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <Icon className="mt-0.5 size-4 shrink-0 text-fg-3" aria-hidden />
              <div>
                <p className="text-[13px] font-medium text-fg">{t(title)}</p>
                <p className="mt-0.5 text-[12.5px] text-fg-3">{t(body)}</p>
              </div>
            </li>
          ))}
        </ul>
      </Block>
    </>
  )
}

export function NotificationsPage({ onRoute }: ScreenProps) {
  const pending = useApi('approvals.pending', ['videos'])
  return (
    <PrefsPage page="notifications">
      <Loaded data={pending.data} error={pending.error} onRetry={pending.reload}>
        {(list) => <NotificationsBody pending={list.length} onOpen={() => onRoute({ section: 'validations' })} />}
      </Loaded>
    </PrefsPage>
  )
}
