// Réglages › À propos: version, the app's updates (UpdateBlock), licences of the vendored components (VENDOR.md) and the clean-room note.
import type { ReactNode } from 'react'
import type { AppInfo } from '../../../../shared/api'
import { t } from '../../../../shared/fr'
import { WorkbenchMark } from '@/components/atelier/primitives'
import { useApi } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { Block, Loaded, PrefsPage } from './common'
import { UpdateBlock } from './UpdateBlock'

const LICENCES = ['prefs.apropos.lic.elevenlabs', 'prefs.apropos.lic.shadcn', 'prefs.apropos.lic.inter', 'prefs.apropos.lic.music'] as const

/** `updates`: the « Mises à jour » block (the page passes it; the body alone renders without the main process). */
export function AboutBody({ info, updates }: { info: AppInfo; updates?: ReactNode }) {
  return (
    <>
      <div className="flex items-center gap-4 rounded-card border border-line bg-surface-1 p-5">
        <WorkbenchMark size={48} />
        <div>
          <p className="font-serif text-[30px] leading-none text-fg">{info.name}</p>
          <p className="mt-1 text-[12.5px] text-fg-3">{t('prefs.apropos.version', { version: info.version })}</p>
          <p className="mt-2 text-[13px] text-fg-2">{t('prefs.apropos.tagline')}</p>
        </div>
      </div>
      {updates}
      <Block title={t('prefs.apropos.licences')}>
        <p className="text-[13px] text-fg-2">{t('prefs.apropos.licences.body')}</p>
        <ul className="mt-3 list-disc pl-5 text-[12.5px] text-fg-2">
          {LICENCES.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-fg-3">{t('prefs.apropos.vendor')}</p>
      </Block>
      <Block title={t('prefs.apropos.cleanroom')}>
        <p className="text-[13px] text-fg-2">{t('prefs.apropos.cleanroom.body')}</p>
        <p className="mt-3 text-[12px] text-fg-3">{t('prefs.apropos.youtube')}</p>
      </Block>
    </>
  )
}

export function AboutPage(_props: ScreenProps) {
  const info = useApi('app.info', [])
  return (
    <PrefsPage page="apropos">
      <Loaded data={info.data} error={info.error} onRetry={info.reload}>
        {(i) => <AboutBody info={i} updates={<UpdateBlock />} />}
      </Loaded>
    </PrefsPage>
  )
}
