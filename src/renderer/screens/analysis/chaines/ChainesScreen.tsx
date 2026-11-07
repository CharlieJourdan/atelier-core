// Production › Chaînes et styles (PLAN-V2-PRODUCTION §3, §5): the channels, the style of the selected one (a form over
// the `atelier.style/1` sheet, saved as numbered versions with a note), the diff between two versions, and the default
// pipeline of the channel. All real: styles live in SQLite, the example channels carry the EXEMPLE chip.
import { useMemo, useState } from 'react'
import { t } from '../../../../shared/fr'
import type { ChannelStyleDetail, StyleSheet } from '../../../../shared/analysis'
import { PageShell } from '@/components/atelier/page'
import { EmptyState, Panel } from '@/components/atelier/primitives'
import { ErrorLine, ExampleBadge, Field, LoadingBlock, fmtDate } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { call, errText, useApi, useLoader } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { DiffView, useChannelList } from '../shared/common'
import { blankStyle } from './default-style'
import { StyleForm } from './StyleForm'

export function ChainesScreen(_props: ScreenProps) {
  const { channels, exampleIds, loading, error } = useChannelList()
  const [picked, setPicked] = useState<number | null>(null)
  const channelId = picked ?? channels[0]?.id ?? null
  const channel = channels.find((c) => c.id === channelId) ?? null

  return (
    <PageShell section="production" title={t('page.production.chaines')} subtitle={t('styles.subtitle')}>
      {error ? (
        <ErrorLine message={error} />
      ) : loading ? (
        <LoadingBlock rows={4} />
      ) : channels.length === 0 ? (
        <EmptyState title={t('styles.empty.title')} blurb={t('styles.empty.blurb')} />
      ) : (
        <div className="grid min-h-0 grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label={t('styles.channels')} className="flex flex-col gap-1.5" data-testid="style-channels">
            <p className="micro-label mb-1">{t('styles.channels')}</p>
            {channels.map((c) => (
              <button
                key={c.id}
                type="button"
                data-testid={`style-channel-${c.id}`}
                aria-current={c.id === channelId}
                onClick={() => setPicked(c.id)}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-field border px-3 py-2.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/60',
                  c.id === channelId ? 'border-brand/60 bg-brand-soft text-fg' : 'border-line bg-surface-1 text-fg-2 hover:bg-surface-2'
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.name}</span>
                  {c.niche && <span className="block truncate text-[11.5px] text-fg-3">{c.niche}</span>}
                </span>
                {exampleIds.has(c.id) && <ExampleBadge />}
              </button>
            ))}
          </nav>
          {channel && <ChannelStyle key={channel.id} channelId={channel.id} name={channel.name} niche={channel.niche} example={exampleIds.has(channel.id)} />}
        </div>
      )}
    </PageShell>
  )
}

function ChannelStyle({ channelId, name, niche, example }: { channelId: number; name: string; niche: string; example: boolean }) {
  const detail = useLoader(() => call('styles.get', channelId), `style-${channelId}`, ['channels', 'pipelines', 'example'])
  const pipelines = useApi('pipelines.list', ['pipelines', 'example'])
  if (detail.error) return <ErrorLine message={detail.error} onRetry={detail.reload} />
  if (!detail.data) return <LoadingBlock rows={5} />
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-serif text-[28px] leading-none">{name}</h2>
        {example && <ExampleBadge />}
        {detail.data.currentVersion !== null && <span className="micro-label">{t('analysis.common.version', { n: detail.data.currentVersion })}</span>}
      </div>
      <DefaultPipeline channelId={channelId} detail={detail.data} pipelines={pipelines.data ?? []} />
      <Tabs defaultValue="style" className="flex flex-col gap-4">
        <TabsList className="self-start">
          <TabsTrigger value="style">{t('styles.tab.style')}</TabsTrigger>
          <TabsTrigger value="versions">{t('styles.tab.versions', { n: detail.data.versions.length })}</TabsTrigger>
        </TabsList>
        <TabsContent value="style">
          <StyleEditor key={detail.data.currentVersion ?? 0} channelId={channelId} detail={detail.data} name={name} niche={niche} onSaved={detail.reload} />
        </TabsContent>
        <TabsContent value="versions">
          <VersionsPanel channelId={channelId} detail={detail.data} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function DefaultPipeline({ channelId, detail, pipelines }: { channelId: number; detail: ChannelStyleDetail; pipelines: { id: number; name: string; channelId: number | null }[] }) {
  const [busy, setBusy] = useState(false)
  const choose = async (id: number) => {
    setBusy(true)
    try {
      await call('pipelines.setDefault', id, channelId)
      toast.success(t('styles.default.done'))
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title={t('styles.default.title')} data-testid="style-default-pipeline">
      {pipelines.length === 0 ? (
        <p className="text-[13px] text-fg-3">{t('styles.default.none')}</p>
      ) : (
        <Field label={t('styles.default.label')} htmlFor="style-default" hint={t('styles.default.hint')}>
          <Select
            id="style-default"
            value={detail.defaultPipelineId ?? ''}
            disabled={busy}
            onChange={(e) => {
              const id = Number(e.target.value)
              if (Number.isInteger(id) && id > 0) void choose(id)
            }}
          >
            {detail.defaultPipelineId === null && (
              <option value="" disabled>
                {t('styles.default.placeholder')}
              </option>
            )}
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </Panel>
  )
}

function StyleEditor({ channelId, detail, name, niche, onSaved }: { channelId: number; detail: ChannelStyleDetail; name: string; niche: string; onSaved: () => void }) {
  const current = detail.current
  const base = useMemo(() => current ?? blankStyle(name, niche), [current, name, niche])
  const [draft, setDraft] = useState<StyleSheet>(base)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const dirty = detail.current === null || JSON.stringify(draft) !== JSON.stringify(detail.current)

  const save = async () => {
    if (!note.trim()) {
      toast.error(t('styles.save.noteNeeded'))
      return
    }
    setBusy(true)
    try {
      const res = await call('styles.save', channelId, draft, note.trim())
      toast.success(t('styles.save.done', { n: res.currentVersion ?? 0 }))
      setNote('')
      onSaved()
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-4">
      {detail.current === null && <p className="rounded-field border border-dashed border-line-2 px-3 py-2 text-[13px] text-fg-3">{t('styles.noStyle')}</p>}
      <StyleForm sheet={draft} onChange={setDraft} disabled={busy} />
      <div className="sticky bottom-0 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface-1 p-3">
        <Field label={t('styles.save.note')} htmlFor="style-note" className="min-w-64 flex-1">
          <Input id="style-note" value={note} placeholder={t('styles.save.notePlaceholder')} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button variant="ghost" disabled={busy || !dirty} onClick={() => setDraft(base)}>
          {t('styles.save.reset')}
        </Button>
        <Button variant="brand" data-testid="style-save" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? t('analysis.common.saving') : t('styles.save.button')}
        </Button>
      </div>
    </div>
  )
}

function VersionsPanel({ channelId, detail }: { channelId: number; detail: ChannelStyleDetail }) {
  const versions = detail.versions
  const [pickFrom, setFrom] = useState<number | null>(null)
  const [pickTo, setTo] = useState<number | null>(null)
  const has = (n: number | null): n is number => n !== null && versions.some((v) => v.version === n)
  const to = has(pickTo) ? pickTo : (versions[0]?.version ?? 0)
  const from = has(pickFrom) ? pickFrom : (versions[1]?.version ?? versions[0]?.version ?? 0)
  const diff = useLoader(() => (from > 0 && to > 0 ? call('styles.diff', channelId, from, to) : Promise.resolve([])), `sdiff-${channelId}-${from}-${to}`, [])
  if (versions.length === 0) return <EmptyState title={t('styles.versions.empty.title')} blurb={t('styles.versions.empty.blurb')} />
  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-2" data-testid="style-versions">
        {versions.map((v) => (
          <li key={v.version} className="flex items-center gap-3 rounded-field border border-line bg-surface-1 px-3 py-2 text-[13px]">
            <span className="w-10 font-mono text-fg-2">{t('analysis.common.version', { n: v.version })}</span>
            <span className="min-w-0 flex-1 truncate text-fg">{v.note || t('styles.versions.noNote')}</span>
            {v.example && <ExampleBadge />}
            <span className="text-[11.5px] text-fg-3">{fmtDate(v.createdAt, true)}</span>
          </li>
        ))}
      </ol>
      {versions.length > 1 && (
        <Panel title={t('styles.diff.title')}>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <Field label={t('styles.diff.from')} htmlFor="sdiff-from">
              <Select id="sdiff-from" value={from} onChange={(e) => setFrom(Number(e.target.value))}>
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {t('analysis.common.version', { n: v.version })}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('styles.diff.to')} htmlFor="sdiff-to">
              <Select id="sdiff-to" value={to} onChange={(e) => setTo(Number(e.target.value))}>
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {t('analysis.common.version', { n: v.version })}
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
