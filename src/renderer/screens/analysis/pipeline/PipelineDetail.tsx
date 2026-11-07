// One pipeline of the library: the node graph with its inspector, cost, versions and the diff between two versions, and
// the actions (rename, export, set as default for a channel, delete).
import { useMemo, useState } from 'react'
import { t } from '../../../../shared/fr'
import type { LibraryPipelineDetail, LibraryPipelineRow } from '../../../../shared/analysis'
import type { GaugeMode } from '../../../../shared/gauge'
import { useConfirm } from '@/components/atelier/confirm'
import { ErrorLine, ExampleBadge, Field, LoadingBlock, fmtDate } from '@/components/atelier/kit'
import { EmptyState, Panel } from '@/components/atelier/primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/lib/toast'
import { call, errText, useApi, useLoader } from '@/state/client'
import { CostBlock, DiffView, downloadText, useChannelList } from '../shared/common'
import { parsePipelineDoc } from '../shared/graph-layout'
import { PipelineGraph } from '../shared/PipelineGraph'
import { RenameDialog } from './Dialogs'
import { NodeInspector } from './NodeInspector'

export function PipelineDetail({ id, onDeleted }: { id: number; onDeleted: () => void }) {
  const loaded = useLoader(() => call('pipelines.get', id), `pipeline-${id}`, ['pipelines', 'example'])
  if (loaded.error) return <ErrorLine message={loaded.error} onRetry={loaded.reload} />
  if (!loaded.data) return <LoadingBlock rows={5} />
  return <DetailBody detail={loaded.data} onDeleted={onDeleted} />
}

export function DetailBody({ detail, onDeleted }: { detail: LibraryPipelineDetail; onDeleted: () => void }) {
  const confirm = useConfirm()
  const [renaming, setRenaming] = useState<LibraryPipelineRow | null>(null)
  const [nodeId, setNodeId] = useState<string | null>(null)
  const [mode, setMode] = useState<GaugeMode>('usage_max')
  const doc = useMemo(() => parsePipelineDoc(detail.json), [detail.json])
  const catalog = useApi('pipelines.catalog')
  const cost = useLoader(() => call('pipelines.estimate', detail.json), `estimate-${detail.id}-${detail.latestVersion}`, [])

  const remove = async () => {
    const ok = await confirm({ title: t('pipelines.delete.title', { name: detail.name }), description: t('pipelines.delete.blurb'), confirmLabel: t('pipelines.delete.confirm'), danger: true })
    if (!ok) return
    try {
      await call('pipelines.delete', detail.id)
      onDeleted()
    } catch (err) {
      toast.error(errText(err))
    }
  }
  const exportJson = async () => {
    try {
      const file = await call('pipelines.export', detail.id)
      downloadText(file.fileName, file.json)
      toast.success(t('pipelines.export.done', { file: file.fileName }))
    } catch (err) {
      toast.error(errText(err))
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="pipeline-detail">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-serif text-[30px] leading-none">{detail.name}</h2>
            {detail.example && <ExampleBadge />}
            <Badge variant="outline">{t(`analysis.origin.${detail.origin}`)}</Badge>
            {detail.isDefault && <Badge variant="brand">{t('pipelines.default.badge', { channel: detail.channelName ?? '' })}</Badge>}
            <span className="micro-label">{t('analysis.common.version', { n: detail.latestVersion })}</span>
          </div>
          {detail.description && <p className="mt-1.5 max-w-2xl text-[13px] text-fg-3">{detail.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setRenaming(detail)}>
            {t('pipelines.rename.button')}
          </Button>
          <Button variant="outline" size="sm" data-testid="pipeline-export" onClick={() => void exportJson()}>
            {t('pipelines.export.button')}
          </Button>
          <Button variant="outline" size="sm" data-testid="pipeline-delete" onClick={() => void remove()}>
            {t('pipelines.delete.button')}
          </Button>
        </div>
      </header>

      <SetDefault detail={detail} />

      <Tabs defaultValue="graph" className="flex flex-col gap-4">
        <TabsList className="self-start">
          <TabsTrigger value="graph">{t('pipelines.tab.graph')}</TabsTrigger>
          <TabsTrigger value="versions">{t('pipelines.tab.versions', { n: detail.versions.length })}</TabsTrigger>
        </TabsList>
        <TabsContent value="graph">
          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-w-0 flex-col gap-4">
              <PipelineGraph json={detail.json} selected={nodeId} onSelect={setNodeId} />
              {doc && doc.minutes && (
                <p className="text-[12px] text-fg-3">
                  {t('pipelines.format', { d: doc.minutes.default, min: doc.minutes.min, max: doc.minutes.max })}
                </p>
              )}
              <Panel title={t('analysis.cost.title')}>
                {cost.error ? <ErrorLine message={cost.error} /> : cost.data ? <CostBlock minutes={cost.data.minutes} modes={cost.data.modes} /> : <LoadingBlock rows={1} />}
              </Panel>
            </div>
            {doc && <NodeInspector doc={doc} nodeId={nodeId} catalog={catalog.data ?? []} cost={cost.data} mode={mode} onMode={setMode} />}
          </div>
        </TabsContent>
        <TabsContent value="versions">
          <Versions detail={detail} />
        </TabsContent>
      </Tabs>
      <RenameDialog row={renaming} onClose={() => setRenaming(null)} />
    </div>
  )
}

function SetDefault({ detail }: { detail: LibraryPipelineDetail }) {
  const { channels } = useChannelList()
  const [picked, setPicked] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const channelId = picked !== '' ? Number(picked) : (detail.channelId ?? channels[0]?.id ?? null)
  if (channels.length === 0) return null
  const apply = async () => {
    if (channelId === null) return
    setBusy(true)
    try {
      await call('pipelines.setDefault', detail.id, channelId)
      toast.success(t('pipelines.default.done'))
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title={t('pipelines.default.title')} data-testid="pipeline-set-default">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('pipelines.default.channel')} htmlFor="default-channel">
          <Select id="default-channel" value={channelId ?? ''} onChange={(e) => setPicked(e.target.value)}>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="secondary" disabled={busy || channelId === null} data-testid="set-default" onClick={() => void apply()}>
          {t('pipelines.default.button')}
        </Button>
      </div>
    </Panel>
  )
}

function Versions({ detail }: { detail: LibraryPipelineDetail }) {
  const versions = detail.versions
  const [pickFrom, setFrom] = useState<number | null>(null)
  const [pickTo, setTo] = useState<number | null>(null)
  const has = (n: number | null): n is number => n !== null && versions.some((v) => v.number === n)
  const to = has(pickTo) ? pickTo : (versions[0]?.number ?? 0)
  const from = has(pickFrom) ? pickFrom : (versions[1]?.number ?? versions[0]?.number ?? 0)
  const diff = useLoader(() => (from > 0 && to > 0 && versions.length > 1 ? call('pipelines.diff', detail.id, from, to) : Promise.resolve([])), `pdiff-${detail.id}-${from}-${to}`, [])
  if (versions.length === 0) return <EmptyState title={t('pipelines.versions.empty')} blurb="" />
  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-2" data-testid="pipeline-versions">
        {versions.map((v) => (
          <li key={v.number} className="flex items-center gap-3 rounded-field border border-line bg-surface-1 px-3 py-2 text-[13px]">
            <span className="w-10 font-mono text-fg-2">{t('analysis.common.version', { n: v.number })}</span>
            <span className="min-w-0 flex-1 truncate text-fg">{v.note || t('styles.versions.noNote')}</span>
            <span className="text-[11.5px] text-fg-3">{fmtDate(v.createdAt, true)}</span>
          </li>
        ))}
      </ol>
      {versions.length > 1 && (
        <Panel title={t('styles.diff.title')}>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <Field label={t('styles.diff.from')} htmlFor="pdiff-from">
              <Select id="pdiff-from" value={from} onChange={(e) => setFrom(Number(e.target.value))}>
                {versions.map((v) => (
                  <option key={v.number} value={v.number}>
                    {t('analysis.common.version', { n: v.number })}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('styles.diff.to')} htmlFor="pdiff-to">
              <Select id="pdiff-to" value={to} onChange={(e) => setTo(Number(e.target.value))}>
                {versions.map((v) => (
                  <option key={v.number} value={v.number}>
                    {t('analysis.common.version', { n: v.number })}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {diff.error ? <ErrorLine message={diff.error} /> : diff.data ? <DiffView lines={diff.data} /> : <LoadingBlock rows={2} />}
        </Panel>
      )}
    </div>
  )
}
