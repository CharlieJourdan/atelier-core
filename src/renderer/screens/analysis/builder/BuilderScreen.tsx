// Production › Builder (bêta): a conversation with the Builder agent (a real model call through the user's Claude Code)
// that edits a pipeline draft. Every reply that carries a document is validated by the engine; the live preview, the
// cost per mode and the problems are those of the current draft. The draft is saved as a new pipeline or a new version.
import { Loader2, Send, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { t } from '../../../../shared/fr'
import type { BuilderDetail, BuilderMessage, BuilderSummary } from '../../../../shared/analysis'
import { lineDiff } from '../../../../shared/line-diff'
import { useConfirm } from '@/components/atelier/confirm'
import { ErrorLine, ExampleBadge, LoadingBlock, fmtDate } from '@/components/atelier/kit'
import { PageShell } from '@/components/atelier/page'
import { EmptyState, Panel } from '@/components/atelier/primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { call, errText, useApi, useLoader } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { CostBlock, DiffView, ProblemList } from '../shared/common'
import { PipelineGraph } from '../shared/PipelineGraph'
import { SavePanel } from './SavePanel'
import { StartDialog } from './StartDialog'

export function BuilderScreen({ onRoute }: ScreenProps) {
  const list = useApi('builder.list', ['pipelines', 'example'])
  const [selected, setSelected] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)
  const confirm = useConfirm()
  const rows = list.data ?? []
  const current = selected !== null && rows.some((r) => r.id === selected) ? selected : (rows[0]?.id ?? null)

  const remove = async (row: BuilderSummary) => {
    const ok = await confirm({ title: t('builder.delete.title', { name: row.title }), description: t('builder.delete.blurb'), confirmLabel: t('builder.delete.confirm'), danger: true })
    if (!ok) return
    try {
      await call('builder.delete', row.id)
      if (selected === row.id) setSelected(null)
    } catch (err) {
      toast.error(errText(err))
    }
  }

  return (
    <PageShell
      section="production"
      title={t('page.production.builder')}
      subtitle={t('builder.subtitle')}
      actions={
        <div className="flex items-center gap-3">
          <Badge variant="brand" data-testid="beta-badge">
            {t('builder.beta')}
          </Badge>
          <Button variant="brand" data-testid="builder-new" onClick={() => setStarting(true)}>
            {t('builder.new')}
          </Button>
        </div>
      }
    >
      <div className="grid min-h-0 grid-cols-1 gap-6 lg:grid-cols-[256px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-2" aria-label={t('builder.sessions')} data-testid="builder-sessions">
          <p className="micro-label mb-1">{t('builder.sessions')}</p>
          {list.error ? (
            <ErrorLine message={list.error} onRetry={list.reload} />
          ) : list.data === null ? (
            <LoadingBlock rows={3} />
          ) : rows.length === 0 ? (
            <p className="text-[12.5px] text-fg-3">{t('builder.sessions.empty')}</p>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="group relative">
                <button
                  type="button"
                  data-testid={`builder-row-${r.id}`}
                  aria-current={r.id === current}
                  onClick={() => setSelected(r.id)}
                  className={cn(
                    'flex w-full flex-col gap-1 rounded-field border px-3 py-2.5 pr-9 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/60',
                    r.id === current ? 'border-brand/60 bg-brand-soft' : 'border-line bg-surface-1 hover:bg-surface-2'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium text-fg">{r.title}</span>
                    {r.example && <ExampleBadge />}
                  </span>
                  <span className="flex items-center gap-2 text-[11.5px] text-fg-3">
                    <Badge variant={r.valid ? 'ok' : 'warn'}>{r.valid ? t('builder.valid') : t('builder.invalid')}</Badge>
                    {fmtDate(r.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={t('builder.delete.aria', { name: r.title })}
                  onClick={() => void remove(r)}
                  className="absolute top-2 right-2 rounded-chip p-1.5 text-fg-3 opacity-60 transition-opacity outline-none group-hover:opacity-100 hover:text-err focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-brand/60"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
            ))
          )}
        </aside>
        <div className="min-w-0">
          {current !== null ? (
            <Session key={current} id={current} onSaved={() => onRoute({ section: 'production', page: 'pipeline' })} />
          ) : list.data !== null ? (
            <EmptyState title={t('builder.empty.title')} blurb={t('builder.empty.blurb')} />
          ) : null}
        </div>
      </div>
      <StartDialog open={starting} onOpenChange={setStarting} onCreated={(d) => setSelected(d.id)} />
    </PageShell>
  )
}

function Session({ id, onSaved }: { id: number; onSaved: () => void }) {
  const loaded = useLoader(() => call('builder.get', id), `builder-${id}`, ['pipelines'])
  if (loaded.error) return <ErrorLine message={loaded.error} onRetry={loaded.reload} />
  if (!loaded.data) return <LoadingBlock rows={5} />
  return <SessionBody detail={loaded.data} reload={loaded.reload} onSaved={onSaved} />
}

function Bubble({ m }: { m: BuilderMessage }) {
  const mine = m.author === 'user'
  return (
    <li data-testid={`builder-message-${m.id}`} className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      <div className={cn('max-w-[88%] rounded-card px-3.5 py-2 text-[13px] leading-[1.5] whitespace-pre-wrap', mine ? 'bg-brand text-ink-fg' : 'border border-line bg-surface-2 text-fg')}>{m.body}</div>
      {m.outcome === 'valid' && <Badge variant="ok">{t('builder.outcome.valid')}</Badge>}
      {m.outcome === 'invalid' && <Badge variant="warn">{t('builder.outcome.invalid', { n: m.problems.length })}</Badge>}
    </li>
  )
}

export function SessionBody({ detail, reload, onSaved }: { detail: BuilderDetail; reload: () => void; onSaved: () => void }) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const diff = useMemo(() => (detail.previousDraftJson && detail.previousDraftJson !== detail.draftJson ? lineDiff(detail.previousDraftJson, detail.draftJson) : null), [detail.previousDraftJson, detail.draftJson])

  const send = async () => {
    const body = text.trim()
    if (!body || pending) return
    setPending(true)
    try {
      await call('builder.send', detail.id, body)
      setText('')
      reload()
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]" data-testid="builder-session">
      <Panel title={t('builder.chat.title')} className="flex min-h-96 flex-col">
        <ul className="mb-3 flex max-h-[28rem] flex-1 flex-col gap-3 overflow-auto pr-1" aria-live="polite" aria-label={t('builder.chat.title')}>
          {detail.messages.length === 0 && !pending && <li className="text-[12.5px] text-fg-3">{t('builder.chat.empty')}</li>}
          {detail.messages.map((m) => (
            <Bubble key={m.id} m={m} />
          ))}
          {pending && (
            <li data-testid="builder-pending" className="flex items-center gap-2 text-[12.5px] text-fg-3">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {t('builder.chat.pending')}
            </li>
          )}
        </ul>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <Textarea
            rows={2}
            value={text}
            disabled={pending}
            aria-label={t('builder.chat.placeholder')}
            placeholder={t('builder.chat.placeholder')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <Button type="submit" variant="brand" size="icon" disabled={pending || !text.trim()} aria-label={t('builder.chat.send')} data-testid="builder-send">
            {pending ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </form>
      </Panel>

      <div className="flex min-w-0 flex-col gap-5">
        <Panel
          title={t('builder.preview.title')}
          action={<Badge variant={detail.valid ? 'ok' : 'warn'}>{detail.valid ? t('builder.valid') : t('builder.invalid')}</Badge>}
          data-testid="builder-preview"
        >
          <PipelineGraph json={detail.draftJson} />
          {detail.problems.length > 0 && (
            <div className="mt-3">
              <ProblemList problems={detail.problems} />
            </div>
          )}
        </Panel>
        {detail.cost && (
          <Panel title={t('analysis.cost.title')}>
            <CostBlock minutes={detail.cost.minutes} modes={detail.cost.modes} />
          </Panel>
        )}
        {diff && (
          <Panel title={t('builder.diff.title')}>
            <DiffView lines={diff} />
          </Panel>
        )}
        <SavePanel detail={detail} onSaved={onSaved} />
      </div>
    </div>
  )
}
