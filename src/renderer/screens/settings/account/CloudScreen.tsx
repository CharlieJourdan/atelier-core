// Réglages › Atelier Cloud: the Cloud account page. All the logic (sign-in, wallet, catalog, spend) lives in lot P5's CloudPanel.
import { t } from '../../../../shared/fr'
import { CloudPanel } from '@/components/cloud/CloudPanel'
import type { ScreenProps } from '../../registry'
import { SettingsPage } from './common'

export function CloudScreen(_props: ScreenProps) {
  return (
    <SettingsPage page="cloud" subtitle={t('team.cloud.subtitle')}>
      <p className="text-[13px] text-fg-3">{t('team.cloud.intro')}</p>
      <CloudPanel />
    </SettingsPage>
  )
}
