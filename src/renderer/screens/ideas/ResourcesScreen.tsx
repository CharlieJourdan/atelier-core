// Production › Ressources: what the engine can use. Real: the voices of this computer (production.voices) and the state of
// the resources folder shipped with Atelier (production.engineStatus). Demo through the registry: the platform voices
// (`voice-platform`, an Atelier Cloud function) and the user's own cloned voice (`voice-clone`).
import { AudioLines, FolderOpen, Mic } from 'lucide-react'
import { t } from '../../../shared/fr'
import type { EngineStatus, RunVoice, RunVoices } from '../../../shared/runs'
import { DemoBoundary } from '@/components/atelier/demo'
import { DataTable, ErrorLine, LoadingBlock, type Column } from '@/components/atelier/kit'
import { PageShell } from '@/components/atelier/page'
import { Panel, StatusDot } from '@/components/atelier/primitives'
import { Badge } from '@/components/ui/badge'
import { call, useLoader } from '@/state/client'
import type { ScreenProps } from '../registry'

const LANGUAGES: Record<string, string> = { fr: 'Français', en: 'Anglais', es: 'Espagnol', de: 'Allemand', it: 'Italien', pt: 'Portugais', nl: 'Néerlandais', ja: 'Japonais', zh: 'Chinois', ru: 'Russe' }

export function languageLabel(code: string): string {
  return LANGUAGES[code.toLowerCase()] ?? code.toUpperCase()
}

export function VoicesPanel({ data }: { data: RunVoices }) {
  const columns: Column<RunVoice>[] = [
    {
      key: 'name',
      header: t('resources.voices.name'),
      cell: (v) => (
        <span className="inline-flex items-center gap-2 text-fg">
          <AudioLines className="size-3.5 text-fg-3" aria-hidden />
          {v.name}
        </span>
      )
    },
    { key: 'language', header: t('resources.voices.language'), cell: (v) => languageLabel(v.language) },
    { key: 'kind', header: t('resources.voices.kind'), cell: (v) => (v.system ? <Badge variant="outline">{t('resources.voices.system')}</Badge> : <Badge variant="brand">{t('resources.voices.other')}</Badge>) }
  ]
  return (
    <div className="flex flex-col gap-3">
      <DataTable columns={columns} rows={data.voices} rowKey={(v) => v.id} empty={t('resources.voices.empty')} testId="voices-table" />
      {data.note && <p className="text-[12px] text-fg-3">{data.note}</p>}
      {!data.listed && <p className="text-[12px] text-warn">{t('resources.voices.notListed')}</p>}
    </div>
  )
}

export function BundledPanel({ status }: { status: EngineStatus }) {
  return (
    <div className="flex flex-col gap-3 text-[13px] text-fg-2">
      <p className="flex items-center gap-2" data-testid="resources-folder">
        <StatusDot tone={status.resourcesFound ? 'ok' : 'err'} />
        {t(status.resourcesFound ? 'resources.bundled.found' : 'resources.bundled.missing')}
      </p>
      <p className="flex items-center gap-2 text-[12px] text-fg-3">
        <FolderOpen className="size-3.5 shrink-0" aria-hidden />
        <code className="font-mono break-all">{status.resourcesDir}</code>
      </p>
      <p className="text-[12px] text-fg-3">{t('resources.bundled.note')}</p>
    </div>
  )
}

export function ResourcesScreen(_props: ScreenProps) {
  const voices = useLoader(() => call('production.voices'), 'resources-voices', [])
  const status = useLoader(() => call('production.engineStatus'), 'resources-engine', ['production'])
  return (
    <PageShell section="production" title={t('page.production.ressources')} subtitle={t('resources.subtitle')}>
      <div className="flex flex-col gap-6">
        <Panel title={t('resources.voices.title')}>
          <p className="mb-3 text-[12.5px] text-fg-3">{t('resources.voices.hint')}</p>
          {voices.error ? <ErrorLine message={voices.error} onRetry={voices.reload} /> : !voices.data ? <LoadingBlock rows={3} /> : <VoicesPanel data={voices.data} />}
        </Panel>
        <DemoBoundary feature="voice-platform">
          <Panel title={t('resources.platform.title')}>
            <p className="flex items-start gap-2 text-[13px] text-fg-2">
              <Mic className="mt-0.5 size-4 shrink-0 text-fg-3" aria-hidden />
              {t('resources.platform.blurb')}
            </p>
          </Panel>
        </DemoBoundary>
        <DemoBoundary feature="voice-clone">
          <Panel title={t('resources.clone.title')}>
            <p className="text-[13px] text-fg-2">{t('resources.clone.blurb')}</p>
          </Panel>
        </DemoBoundary>
        <Panel title={t('resources.bundled.title')}>
          {status.error ? <ErrorLine message={status.error} onRetry={status.reload} /> : !status.data ? <LoadingBlock rows={2} /> : <BundledPanel status={status.data} />}
        </Panel>
      </div>
    </PageShell>
  )
}
