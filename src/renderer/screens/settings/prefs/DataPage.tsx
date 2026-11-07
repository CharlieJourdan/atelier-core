// Réglages › Données: where the data lives (database file, schema) and the example workspace (load / delete).
import { Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import type { AppInfo } from '../../../../shared/api'
import type { ExampleStatus } from '../../../../shared/api/example'
import { t } from '../../../../shared/fr'
import { useConfirm } from '@/components/atelier/confirm'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { call, errText, useApi } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { Block, InfoList, InfoRow, Loaded, PrefsPage } from './common'

export function exampleSummary(s: ExampleStatus): string {
  if (s.loaded) return t('prefs.donnees.example.loaded')
  return s.deleted ? t('prefs.donnees.example.deleted') : t('prefs.donnees.example.notLoaded')
}

export function DataBody({
  info,
  example,
  onLoad,
  onDelete,
  busy = false
}: {
  info: AppInfo
  example: ExampleStatus
  onLoad: () => void
  onDelete: () => void
  busy?: boolean
}) {
  const n = example.channelIds.length
  return (
    <>
      <Block title={t('prefs.donnees.where')}>
        <InfoList>
          <InfoRow label={t('prefs.donnees.dbPath')} mono>
            {info.dbPath}
          </InfoRow>
          <InfoRow label={t('prefs.donnees.schema')}>{info.schemaVersion}</InfoRow>
        </InfoList>
        <p className="mt-3 text-[12px] text-fg-3">{t('prefs.donnees.local')}</p>
      </Block>
      <Block title={t('prefs.donnees.example')}>
        <p className="text-[13px] text-fg-2" data-testid="example-summary">
          {exampleSummary(example)}
        </p>
        {example.loaded && n > 0 && <p className="mt-1 text-[12px] text-fg-3">{n === 1 ? t('prefs.donnees.example.channels.one') : t('prefs.donnees.example.channels', { n })}</p>}
        <div className="mt-4">
          {example.loaded ? (
            <Button variant="destructive" disabled={busy} onClick={onDelete}>
              <Trash2 /> {t('prefs.donnees.example.delete')}
            </Button>
          ) : (
            <Button variant="brand" disabled={busy} onClick={onLoad}>
              <Upload /> {t('prefs.donnees.example.load')}
            </Button>
          )}
        </div>
      </Block>
    </>
  )
}

export function DataPage(_props: ScreenProps) {
  const confirm = useConfirm()
  const info = useApi('app.info', [])
  const example = useApi('example.status', ['example'])
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<unknown>, done: string): Promise<void> => {
    setBusy(true)
    try {
      await action()
      toast.success(done)
      example.reload()
    } catch (err) {
      toast.error(t('prefs.saveError'), errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <PrefsPage page="donnees">
      <Loaded data={info.data && example.data ? { info: info.data, example: example.data } : null} error={info.error ?? example.error}>
        {(d) => (
          <DataBody
            info={d.info}
            example={d.example}
            busy={busy}
            onLoad={() => void run(() => call('example.load'), t('prefs.donnees.example.done.load'))}
            onDelete={() =>
              void confirm({
                title: t('prefs.donnees.example.confirm.title'),
                description: t('prefs.donnees.example.confirm.body'),
                confirmLabel: t('prefs.donnees.example.delete'),
                danger: true
              }).then((ok) => (ok ? run(() => call('example.delete'), t('prefs.donnees.example.done.delete')) : undefined))
            }
          />
        )}
      </Loaded>
    </PrefsPage>
  )
}
