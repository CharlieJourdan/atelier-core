// Production › Bibliothèque: the finished videos (succeeded runs), filtered by channel; a sheet with the player, the
// package files, the credits per node and the pipeline version, « Refaire pareil » and « Ouvrir le paquet ».
import { FolderOpen, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { LibraryItem } from '../../../../shared/runs'
import { DemoBadge } from '@/components/atelier/demo'
import { DataTable, ErrorLine, ExampleBadge, LoadingBlock, fmtCredits, fmtDate } from '@/components/atelier/kit'
import { PageShell } from '@/components/atelier/page'
import { EmptyState } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { FileList, VideoPlayer } from '../encours/Reviews'
import { focusRun, fmtDuration, useChannelList } from '../shared'

function Sheet({ item, onRoute, onClose }: { item: LibraryItem; onRoute: ScreenProps['onRoute']; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const redo = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await call('production.redo', item.runId)
      focusRun(r.id)
      toast.success(t('production.live.redone'))
      onClose()
      onRoute({ section: 'production', page: 'encours' })
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }
  const reveal = async (): Promise<void> => {
    try {
      await call('production.revealPackage', item.runId)
    } catch (err) {
      toast.error(errText(err))
    }
  }
  const spent = item.creditsByNode.filter((n) => n.credits > 0)
  return (
    <div className="flex flex-col gap-4" data-testid="library-sheet">
      {item.videoFileRef ? (
        <VideoPlayer runId={item.runId} file={{ ref: item.videoFileRef, name: item.title, size: 0, mime: 'video/mp4' }} />
      ) : (
        <p className="m-0 rounded-field border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-fg-3">{t('production.lib.noVideo')}</p>
      )}
      <dl className="m-0 grid grid-cols-2 gap-3 text-[12.5px] md:grid-cols-4">
        {[
          [t('production.lib.channel'), item.channelName],
          [t('production.lib.duration'), fmtDuration(item.durationS)],
          [t('production.lib.credits'), item.demo ? t('production.live.demoSpent') : fmtCredits(item.totalCredits)],
          [t('production.lib.pipeline'), t('production.lib.version', { name: item.pipelineLabel, version: item.pipelineVersion })]
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="micro-label">{k}</dt>
            <dd className="m-0 mt-0.5 text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="lib-nodes">
        <h3 id="lib-nodes" className="micro-label mb-1.5">
          {t('production.lib.byNode')}
        </h3>
        {spent.length === 0 ? (
          <p className="m-0 text-[12.5px] text-fg-3">{item.demo ? t('production.lib.demoNoCost') : t('production.lib.free')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] text-fg-2">
            {spent.map((n) => (
              <li key={n.nodeId} className="flex justify-between gap-3">
                <span>{n.label}</span>
                <span className="tabular-nums">{fmtCredits(n.credits)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {item.packageFiles.length > 0 && (
        <section aria-labelledby="lib-files">
          <h3 id="lib-files" className="micro-label mb-1.5">
            {t('production.lib.files')}
          </h3>
          <FileList files={item.packageFiles} />
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void redo()} disabled={busy} data-testid="lib-redo">
          <RotateCcw aria-hidden />
          {t('production.live.redo')}
        </Button>
        <Button variant="secondary" onClick={() => void reveal()} disabled={!item.packageDir} title={item.packageDir ? undefined : t('production.lib.noPackage')} data-testid="lib-reveal">
          <FolderOpen aria-hidden />
          {t('production.lib.open')}
        </Button>
      </div>
    </div>
  )
}

export function BibliothequeScreen({ onRoute }: ScreenProps) {
  const channels = useChannelList()
  const [channelId, setChannelId] = useState<number | null>(null)
  const lib = useLoader(() => call('production.library', channelId === null ? undefined : { channelId }), String(channelId), ['production', 'example'])
  const [open, setOpen] = useState<LibraryItem | null>(null)
  const rows = lib.data ?? []

  return (
    <PageShell
      section="production"
      title={t('page.production.bibliotheque')}
      subtitle={t('production.lib.subtitle')}
      actions={
        <Select aria-label={t('production.lib.filter')} value={channelId ?? ''} onChange={(e) => setChannelId(e.target.value === '' ? null : Number(e.target.value))} className="w-56">
          <option value="">{t('production.lib.allChannels')}</option>
          {(channels.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      }
    >
      {lib.error && <ErrorLine message={lib.error} onRetry={lib.reload} />}
      {!lib.data && !lib.error && <LoadingBlock rows={4} />}
      {lib.data && rows.length === 0 && <EmptyState title={t('production.lib.empty.title')} blurb={t('production.lib.empty.blurb')} />}
      {rows.length > 0 && (
        <DataTable
          testId="library-table"
          rows={rows}
          rowKey={(r) => r.runId}
          onRowClick={setOpen}
          columns={[
            {
              key: 'title',
              header: t('production.lib.video'),
              cell: (r) => (
                <button type="button" onClick={() => setOpen(r)} className="inline-flex items-center gap-2 text-left text-fg outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/60">
                  {r.title}
                  {r.example && <ExampleBadge />}
                  {r.demo && <DemoBadge />}
                </button>
              )
            },
            { key: 'channel', header: t('production.lib.channel'), cell: (r) => r.channelName },
            { key: 'duration', header: t('production.lib.duration'), align: 'right', cell: (r) => fmtDuration(r.durationS) },
            { key: 'credits', header: t('production.lib.credits'), align: 'right', cell: (r) => (r.demo ? '—' : fmtCredits(r.totalCredits)) },
            { key: 'mode', header: t('production.lib.mode'), cell: (r) => t(`runs.budget.${r.budgetMode}` as MessageKey) },
            { key: 'date', header: t('production.lib.date'), cell: (r) => (r.finishedAt ? fmtDate(r.finishedAt) : '—') }
          ]}
        />
      )}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[90vh] w-[min(760px,94vw)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{open?.title ?? ''}</DialogTitle>
            <DialogDescription>{open?.finishedAt ? t('production.lib.finished', { date: fmtDate(open.finishedAt, true) }) : ''}</DialogDescription>
          </DialogHeader>
          {open && <Sheet key={open.runId} item={open} onRoute={onRoute} onClose={() => setOpen(null)} />}
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
