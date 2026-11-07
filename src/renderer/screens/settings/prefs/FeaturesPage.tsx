// Réglages › Fonctions: the features registry as the app resolves it right now (real / demo / needs credits), with why
// and what unlocks each one.
import type { FeatureState, FeatureStatus } from '../../../../shared/features'
import { t, type MessageKey } from '../../../../shared/fr'
import { StatusDot, type Tone } from '@/components/atelier/primitives'
import { Badge } from '@/components/ui/badge'
import { useFeatures } from '@/lib/features'
import type { ScreenProps } from '../../registry'
import { Block, PrefsPage } from './common'

const TONE: Record<FeatureStatus, Tone> = { real: 'ok', demo: 'warn', 'needs-credits': 'info' }

function FeatureLine({ f }: { f: FeatureState }) {
  return (
    <li data-testid="feature-line" data-feature={f.id} data-status={f.status} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[13px] font-medium text-fg">
          <StatusDot tone={TONE[f.status]} />
          {f.label}
        </p>
        <Badge variant={f.status === 'real' ? 'ok' : f.status === 'demo' ? 'warn' : 'default'}>{t(`prefs.fonctions.status.${f.status}` as MessageKey)}</Badge>
      </div>
      {f.status !== 'real' && (
        <dl className="ml-4 flex flex-col gap-0.5 text-[12px] text-fg-3">
          {f.reason && (
            <div>
              <dt className="inline text-fg-2">{t('prefs.fonctions.reason')} : </dt>
              <dd className="inline">{f.reason}</dd>
            </div>
          )}
          {f.unlockedBy && (
            <div>
              <dt className="inline text-fg-2">{t('prefs.fonctions.unlock')} : </dt>
              <dd className="inline">{f.unlockedBy}</dd>
            </div>
          )}
        </dl>
      )}
    </li>
  )
}

export function FeaturesBody({ features }: { features: readonly FeatureState[] }) {
  const real = features.filter((f) => f.status === 'real')
  const other = features.filter((f) => f.status !== 'real')
  const count = (s: FeatureStatus): number => features.filter((f) => f.status === s).length
  return (
    <>
      <p className="text-[13px] text-fg-2" data-testid="features-summary">
        {t('prefs.fonctions.summary', { real: count('real'), demo: count('demo'), credits: count('needs-credits') })}
      </p>
      {other.length > 0 && (
        <Block title={t('prefs.fonctions.section.other')}>
          <ul className="flex flex-col divide-y divide-line">
            {other.map((f) => (
              <FeatureLine key={f.id} f={f} />
            ))}
          </ul>
        </Block>
      )}
      {real.length > 0 && (
        <Block title={t('prefs.fonctions.section.real')}>
          <ul className="flex flex-col divide-y divide-line">
            {real.map((f) => (
              <FeatureLine key={f.id} f={f} />
            ))}
          </ul>
        </Block>
      )}
    </>
  )
}

export function FeaturesPage(_props: ScreenProps) {
  const features = useFeatures()
  return (
    <PrefsPage page="fonctions">
      <FeaturesBody features={features} />
    </PrefsPage>
  )
}
