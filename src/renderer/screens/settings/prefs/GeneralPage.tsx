// Réglages › Général: the app's identity, the language, and how the agents work (settings keys the main process reads).
import type { AppInfo, JsonValue } from '../../../../shared/api'
import { t } from '../../../../shared/fr'
import { CloudPanel } from '@/components/cloud/CloudPanel'
import { MemoryBlockPanel } from '@/components/orchestra/MemoryBlockPanel'
import { useApi } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { Block, boolOf, InfoList, InfoRow, Loaded, NumberSetting, numberOf, PrefsPage, ToggleSetting } from './common'

/** Keys and bounds read by the runner (agents.*) and the group engine (chat.*). */
export const GENERAL_KEYS = {
  runner: 'agents.runnerEnabled',
  maxParallel: 'agents.maxParallel',
  maxParallelPerChannel: 'agents.maxParallelPerChannel',
  maxTurns: 'agents.maxTurns',
  multiplier: 'agents.toolRunEstimateMultiplier',
  handoffs: 'chat.maxHandoffs',
  roundBudget: 'chat.roundBudgetUsd'
} as const

export function GeneralBody({ info, settings }: { info: AppInfo; settings: Readonly<Record<string, JsonValue>> }) {
  const k = GENERAL_KEYS
  return (
    <>
      <Block title={t('prefs.general.app')}>
        <InfoList>
          <InfoRow label={t('prefs.general.name')}>{info.name}</InfoRow>
          <InfoRow label={t('prefs.general.version')}>{info.version}</InfoRow>
          <InfoRow label={t('prefs.general.system')}>{info.platform}</InfoRow>
          <InfoRow label={t('prefs.general.schema')}>{info.schemaVersion}</InfoRow>
          <InfoRow label={t('prefs.general.language')}>{t('prefs.general.language.value')}</InfoRow>
        </InfoList>
        <p className="mt-3 text-[12px] text-fg-3">{t('prefs.general.language.hint')}</p>
      </Block>
      <Block title={t('prefs.general.agents')}>
        <ToggleSetting settingKey={k.runner} label={t('prefs.general.runner')} hint={t('prefs.general.runner.hint')} value={boolOf(settings, k.runner, true)} />
        <NumberSetting
          settingKey={k.maxParallel}
          label={t('prefs.general.maxParallel')}
          hint={t('prefs.general.maxParallel.hint')}
          value={numberOf(settings, k.maxParallel, 3, 1, 16)}
          min={1}
          max={16}
          unit={t('prefs.unit.tasks')}
        />
        <NumberSetting
          settingKey={k.maxParallelPerChannel}
          label={t('prefs.general.maxParallelPerChannel')}
          hint={t('prefs.general.maxParallelPerChannel.hint')}
          value={numberOf(settings, k.maxParallelPerChannel, 2, 1, 16)}
          min={1}
          max={16}
          unit={t('prefs.unit.tasks')}
        />
        <NumberSetting
          settingKey={k.maxTurns}
          label={t('prefs.general.maxTurns')}
          hint={t('prefs.general.maxTurns.hint')}
          value={numberOf(settings, k.maxTurns, 12, 1, 100)}
          min={1}
          max={100}
          unit={t('prefs.unit.steps')}
        />
        <NumberSetting
          settingKey={k.multiplier}
          label={t('prefs.general.multiplier')}
          hint={t('prefs.general.multiplier.hint')}
          value={numberOf(settings, k.multiplier, 4, 1, 50)}
          min={1}
          max={50}
        />
      </Block>
      <Block title={t('prefs.general.team')}>
        <NumberSetting
          settingKey={k.handoffs}
          label={t('prefs.general.handoffs')}
          hint={t('prefs.general.handoffs.hint')}
          value={numberOf(settings, k.handoffs, 3, 0, 10)}
          min={0}
          max={10}
          unit={t('prefs.unit.times')}
        />
        <NumberSetting
          settingKey={k.roundBudget}
          label={t('prefs.general.roundBudget')}
          hint={t('prefs.general.roundBudget.hint')}
          value={numberOf(settings, k.roundBudget, 2, 0, 1000, false)}
          min={0}
          max={1000}
          integer={false}
          unit={t('prefs.unit.usd')}
        />
      </Block>
    </>
  )
}

export function GeneralPage(_props: ScreenProps) {
  const info = useApi('app.info', [])
  const settings = useApi('settings.list', ['settings'])
  const error = info.error ?? settings.error
  return (
    <PrefsPage page="general">
      <CloudPanel />
      <MemoryBlockPanel scope="workspace" />
      <Loaded data={info.data && settings.data ? { info: info.data, settings: settings.data } : null} error={error}>
        {(d) => <GeneralBody info={d.info} settings={d.settings} />}
      </Loaded>
    </PrefsPage>
  )
}
