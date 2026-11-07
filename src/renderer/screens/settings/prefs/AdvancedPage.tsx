// Réglages › Avancé: the « Mode présentation » (the demo workspace, to show the app), off by default. It is a main-process
// setting (`app.presentation`): the data mode follows it everywhere (proto/live/BetaSync.tsx) and a banner says it is on.
import { useState } from 'react'
import { t } from '../../../../shared/fr'
import { Switch } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { PRESENTATION_KEY } from '@/proto/live/BetaSync'
import { useProto } from '@/proto/store'
import { call, errText } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { Block, PrefsPage, SettingRow } from './common'

export function AdvancedPage(_props: ScreenProps) {
  const { mode } = useProto()
  const [busy, setBusy] = useState(false)
  const on = mode === 'demo'
  const set = (v: boolean): void => {
    setBusy(true)
    call('settings.set', PRESENTATION_KEY, v)
      .then(() => toast.success(v ? t('beta.presentation.on') : t('beta.presentation.off')))
      .catch((e: unknown) => toast.error(t('prefs.saveError'), errText(e)))
      .finally(() => setBusy(false))
  }
  return (
    <PrefsPage page="avance">
      <Block title={t('beta.presentation.title')}>
        <SettingRow label={t('beta.presentation.title')} hint={t('beta.presentation.hint')}>
          <Switch checked={on} disabled={busy} aria-label={t('beta.presentation.title')} data-testid="presentation-switch" onCheckedChange={set} />
        </SettingRow>
      </Block>
    </PrefsPage>
  )
}
