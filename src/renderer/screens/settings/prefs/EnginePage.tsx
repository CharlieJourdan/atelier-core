// Réglages › Moteur: what the production engine finds on this computer (`production.engineStatus`).
import { RefreshCw } from 'lucide-react'
import { t } from '../../../../shared/fr'
import type { EngineStatus } from '../../../../shared/runs'
import { StatTile, StatusDot } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { useApi } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { Block, InfoList, InfoRow, Loaded, PrefsPage } from './common'

function Found({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <StatusDot tone={ok ? 'ok' : 'warn'} />
      {ok ? yes : no}
    </span>
  )
}

export function EngineBody({ status, onCloud }: { status: EngineStatus; onCloud?: () => void }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label={t('prefs.moteur.ffmpeg')}
          value={status.ffmpeg.found ? t('prefs.moteur.found') : t('prefs.moteur.missing')}
          hint={status.ffmpeg.version ? t('prefs.moteur.version', { version: status.ffmpeg.version }) : undefined}
        />
        <StatTile label={t('prefs.moteur.voice')} value={status.systemVoice ? t('prefs.moteur.voice.yes') : t('prefs.moteur.voice.no')} />
        <StatTile label={t('prefs.moteur.active')} value={status.activeRuns} hint={status.activeRuns === 0 ? t('prefs.moteur.active.none') : undefined} />
      </div>
      {!status.ffmpeg.found && (
        <p className="rounded-field border border-warn/30 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">{t('prefs.moteur.missing.hint')}</p>
      )}
      <Block title={t('prefs.moteur.ffmpeg')}>
        <InfoList>
          <InfoRow label={t('prefs.moteur.ffmpeg')} mono>
            <Found ok={status.ffmpeg.found} yes={status.ffmpeg.path ?? t('prefs.moteur.found')} no={t('prefs.moteur.missing')} />
          </InfoRow>
          <InfoRow label={t('prefs.moteur.ffprobe')} mono>
            <Found ok={status.ffprobe.found} yes={status.ffprobe.path ?? t('prefs.moteur.found')} no={t('prefs.moteur.missing')} />
          </InfoRow>
          <InfoRow label={t('prefs.moteur.platform')}>{status.platform}</InfoRow>
        </InfoList>
      </Block>
      <Block title={t('prefs.moteur.folders')}>
        <InfoList>
          <InfoRow label={t('prefs.moteur.dataDir')} mono>
            {status.dataDir}
          </InfoRow>
          <InfoRow label={t('prefs.moteur.productionDir')} mono>
            {status.productionDir}
          </InfoRow>
          <InfoRow label={t('prefs.moteur.resourcesDir')} mono>
            {status.resourcesDir}
          </InfoRow>
          <InfoRow label={t('prefs.moteur.resourcesFound')}>
            <Found ok={status.resourcesFound} yes={t('prefs.yes')} no={t('prefs.no')} />
          </InfoRow>
        </InfoList>
      </Block>
      <Block title={t('prefs.moteur.cloud')}>
        <p className="text-[13px] text-fg-2">{status.cloudConnected ? t('prefs.moteur.cloud.on') : t('prefs.moteur.cloud.off')}</p>
        {status.note && <p className="mt-2 text-[12px] text-fg-3">{status.note}</p>}
        {onCloud && (
          <Button variant="link" size="sm" className="mt-2 h-auto px-0" onClick={onCloud}>
            {t('prefs.moteur.cloud.link')}
          </Button>
        )}
      </Block>
    </>
  )
}

export function EnginePage({ onRoute }: ScreenProps) {
  const status = useApi('production.engineStatus', ['production'])
  return (
    <PrefsPage
      page="moteur"
      actions={
        <Button variant="secondary" size="sm" onClick={status.reload}>
          <RefreshCw /> {t('prefs.refresh')}
        </Button>
      }
    >
      <Loaded data={status.data} error={status.error} onRetry={status.reload}>
        {(s) => <EngineBody status={s} onCloud={() => onRoute({ section: 'reglages', page: 'cloud' })} />}
      </Loaded>
    </PrefsPage>
  )
}
