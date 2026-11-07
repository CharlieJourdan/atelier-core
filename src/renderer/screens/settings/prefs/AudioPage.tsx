// Réglages › Audio: the voices the engine can use on this computer (`production.voices`), and the platform voices,
// which are demo until Atelier Cloud offers them.
import { Volume2 } from 'lucide-react'
import { t } from '../../../../shared/fr'
import type { RunVoices } from '../../../../shared/runs'
import { DemoBoundary } from '@/components/atelier/demo'
import { EmptyState } from '@/components/atelier/primitives'
import { Badge } from '@/components/ui/badge'
import { useApi } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { Block, Loaded, PrefsPage } from './common'

/** Shown even while the voices load: the DEMO label must be in the first render. */
export function PlatformVoices() {
  return (
    <DemoBoundary feature="voice-platform">
      <Block title={t('prefs.audio.platform')}>
        <p className="text-[13px] text-fg-2">{t('prefs.audio.platform.body')}</p>
      </Block>
    </DemoBoundary>
  )
}

export function AudioBody({ voices }: { voices: RunVoices }) {
  const list = voices.voices
  return (
    <>
      <Block title={t('prefs.audio.system')} action={<Badge>{list.length === 1 ? t('prefs.audio.system.count.one') : t('prefs.audio.system.count', { n: list.length })}</Badge>}>
        {!voices.listed && <p className="mb-3 text-[12px] text-warn">{t('prefs.audio.system.fallback')}</p>}
        {list.length === 0 ? (
          <EmptyState title={t('prefs.audio.system.empty')} className="py-6" />
        ) : (
          <ul className="grid gap-x-6 sm:grid-cols-2">
            {list.map((v) => (
              <li key={v.id} data-testid="voice-line" className="flex items-center gap-3 border-b border-line py-2.5">
                <Volume2 className="size-4 shrink-0 text-fg-3" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-fg">{v.name}</p>
                  <p className="text-[11.5px] text-fg-3">{t('prefs.audio.language', { lang: v.language.toUpperCase() })}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {voices.note && <p className="mt-3 text-[12px] text-fg-3">{voices.note}</p>}
        <p className="mt-2 text-[12px] text-fg-3">{t('prefs.audio.choose')}</p>
      </Block>
    </>
  )
}

export function AudioPage(_props: ScreenProps) {
  const voices = useApi('production.voices', ['production'])
  return (
    <PrefsPage page="audio">
      <Loaded data={voices.data} error={voices.error} onRetry={voices.reload}>
        {(v) => <AudioBody voices={v} />}
      </Loaded>
      <PlatformVoices />
    </PrefsPage>
  )
}
