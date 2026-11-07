// Saving a Builder draft: as a new pipeline (name, optional channel) or as a new version of an existing one.
import { useState } from 'react'
import { t } from '../../../../shared/fr'
import type { BuilderDetail } from '../../../../shared/analysis'
import { Field } from '@/components/atelier/kit'
import { Panel } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { call, errText, useApi } from '@/state/client'
import { useChannelList } from '../shared/common'

export function SavePanel({ detail, onSaved }: { detail: BuilderDetail; onSaved: () => void }) {
  const pipelines = useApi('pipelines.list', ['pipelines'])
  const { channels } = useChannelList()
  const rows = pipelines.data ?? []
  const [target, setTarget] = useState<'new' | 'version'>(detail.pipelineId !== null ? 'version' : 'new')
  const [name, setName] = useState('')
  const [channel, setChannel] = useState('')
  const [pipelineId, setPipelineId] = useState<string>(detail.pipelineId !== null ? String(detail.pipelineId) : '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const versionTarget = pipelineId !== '' ? Number(pipelineId) : (rows[0]?.id ?? null)
  const ready = detail.valid && (target === 'new' ? name.trim() !== '' : versionTarget !== null)

  const save = async () => {
    setBusy(true)
    try {
      const row = await call(
        'builder.save',
        detail.id,
        target === 'new' ? { target: 'new', name: name.trim(), channelId: channel === '' ? null : Number(channel) } : { target: 'version', pipelineId: versionTarget as number },
        note.trim()
      )
      toast.success(target === 'new' ? t('builder.save.doneNew', { name: row.name }) : t('builder.save.doneVersion', { name: row.name, n: row.latestVersion }))
      onSaved()
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={t('builder.save.title')} data-testid="builder-save">
      {!detail.valid && <p className="mb-3 text-[12.5px] text-warn">{t('builder.save.invalid')}</p>}
      <div role="radiogroup" aria-label={t('builder.save.title')} className="mb-3 inline-flex rounded-full border border-line-2 p-0.5">
        {(['new', 'version'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={target === k}
            onClick={() => setTarget(k)}
            className={cn('rounded-full px-3.5 py-1 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-brand/60', target === k ? 'bg-brand text-ink-fg' : 'text-fg-2 hover:text-fg')}
          >
            {t(`builder.save.target.${k}`)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {target === 'new' ? (
          <>
            <Field label={t('builder.save.name')} htmlFor="builder-name">
              <Input id="builder-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t('builder.save.channel')} htmlFor="builder-channel">
              <Select id="builder-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="">{t('pipelines.import.noChannel')}</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : (
          <Field label={t('builder.save.pipeline')} htmlFor="builder-pipeline">
            {rows.length === 0 ? (
              <p className="text-[12.5px] text-fg-3">{t('pipelines.mine.empty')}</p>
            ) : (
              <Select id="builder-pipeline" value={versionTarget ?? ''} onChange={(e) => setPipelineId(e.target.value)}>
                {rows.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label={t('builder.save.note')} htmlFor="builder-note" className="md:col-span-2">
          <Input id="builder-note" value={note} placeholder={t('builder.save.notePlaceholder')} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <Button variant="brand" className="mt-4" data-testid="builder-save-button" disabled={busy || !ready} onClick={() => void save()}>
        {busy ? t('analysis.common.saving') : t('builder.save.button')}
      </Button>
    </Panel>
  )
}
