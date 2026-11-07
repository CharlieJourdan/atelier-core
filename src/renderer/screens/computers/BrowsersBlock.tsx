// Ordinateurs › Navigateurs des agents. The sessions are real rows (open / close / remove); the live picture is a mock
// frame, labelled DÉMO through the features registry (`remote-desktop-control`), until a browser is really driven.
import { Globe, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import type { BrowserSession } from '../../../shared/api/home'
import { useConfirm } from '@/components/atelier/confirm'
import { DemoBadge, DemoBoundary } from '@/components/atelier/demo'
import { ErrorLine, ExampleBadge, Field, LoadingBlock, fmtDate } from '@/components/atelier/kit'
import { EmptyState, Panel, StatusDot } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useApi } from '@/state/client'

/** The mock live view: a browser window drawn in CSS, never a real capture. */
export function MockFrame({ session }: { session: BrowserSession }) {
  return (
    <div data-testid="browser-mock" aria-label={t('computers.browsers.mock')} role="img" className="relative overflow-hidden rounded-field border border-line-2 bg-surface-2">
      <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-1.5">
        <span className="size-2 rounded-full bg-fg-4" />
        <span className="size-2 rounded-full bg-fg-4" />
        <span className="size-2 rounded-full bg-fg-4" />
        <span className="ml-2 min-w-0 flex-1 truncate rounded-full bg-surface-1 px-2.5 py-0.5 font-mono text-[10.5px] text-fg-3">{session.startUrl}</span>
      </div>
      <div className="flex h-28 flex-col justify-center gap-2 px-4">
        <span className="h-2 w-2/3 rounded-full bg-line-2" />
        <span className="h-2 w-5/6 rounded-full bg-line" />
        <span className="h-2 w-1/2 rounded-full bg-line" />
      </div>
      <div className="absolute right-2 bottom-2">
        <DemoBadge title={t('computers.browsers.mock')} />
      </div>
    </div>
  )
}

export function SessionCard({ session, busy, onClose, onRemove }: { session: BrowserSession; busy: boolean; onClose: () => void; onRemove: () => void }) {
  const open = session.status === 'open'
  return (
    <li data-testid="browser-session" data-status={session.status} className="flex flex-col gap-3 rounded-card border border-line bg-surface-1 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Globe className="size-4 text-fg-3" aria-hidden />
        <h3 className="text-[14px] font-medium text-fg">{session.agentName}</h3>
        {session.example && <ExampleBadge />}
        <span className="ml-auto flex items-center gap-1.5 text-[12px] text-fg-3">
          <StatusDot tone={open ? 'ok' : 'off'} />
          {t(`computers.browsers.status.${session.status}` as MessageKey)}
        </span>
      </div>
      <p className="text-[12px] text-fg-3">{t('computers.browsers.since', { date: fmtDate(session.createdAt, true) })}</p>
      <MockFrame session={session} />
      <div className="flex justify-end">
        {open ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            <X />
            {t('computers.browsers.close')}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled={busy} onClick={onRemove}>
            {t('computers.browsers.remove')}
          </Button>
        )}
      </div>
    </li>
  )
}

export function SessionList({ sessions, busy, onClose, onRemove }: { sessions: readonly BrowserSession[]; busy: number | null; onClose: (s: BrowserSession) => void; onRemove: (s: BrowserSession) => void }) {
  if (sessions.length === 0) return <EmptyState className="py-8" title={t('computers.browsers.empty')} blurb={t('computers.browsers.emptyHint')} />
  return (
    <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
      {sessions.map((s) => (
        <SessionCard key={s.id} session={s} busy={busy === s.id} onClose={() => onClose(s)} onRemove={() => onRemove(s)} />
      ))}
    </ul>
  )
}

function OpenForm({ onDone }: { onDone: () => void }) {
  const agents = useApi('agents.list', ['agents'])
  const [role, setRole] = useState('researcher')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      const s = await call('browsers.open', { role, startUrl: url })
      toast.success(t('computers.browsers.opened', { agent: s.agentName }))
      setUrl('')
      onDone()
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="mb-4 grid grid-cols-1 items-end gap-3 rounded-card border border-line bg-surface-1 p-4 md:grid-cols-[14rem_1fr_auto]"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Field label={t('computers.browsers.role')} htmlFor="browser-role">
        <Select id="browser-role" value={role} onChange={(e) => setRole(e.target.value)}>
          {(agents.data ?? []).map((a) => (
            <option key={a.id} value={a.role}>
              {a.name}
            </option>
          ))}
          {agents.data?.length === 0 && <option value="">{t('computers.browsers.noAgents')}</option>}
        </Select>
      </Field>
      <Field label={t('computers.browsers.url')} htmlFor="browser-url">
        <Input id="browser-url" value={url} placeholder={t('computers.browsers.urlPlaceholder')} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <Button type="submit" disabled={busy || !url.trim()}>
        <Plus />
        {t('computers.browsers.create')}
      </Button>
    </form>
  )
}

export function BrowsersBlock() {
  const { data, error, reload } = useApi('browsers.list', ['computers', 'example'])
  const [busy, setBusy] = useState<number | null>(null)
  const confirm = useConfirm()

  const act = async (s: BrowserSession, action: () => Promise<unknown>, done: MessageKey): Promise<void> => {
    setBusy(s.id)
    try {
      await action()
      toast.success(t(done))
      reload()
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(null)
    }
  }
  const close = async (s: BrowserSession): Promise<void> => {
    if (!(await confirm({ title: t('computers.browsers.close'), description: s.startUrl, confirmLabel: t('computers.browsers.close'), danger: true }))) return
    await act(s, () => call('browsers.close', s.id), 'computers.browsers.closed')
  }

  return (
    <Panel title={t('computers.browsers')} data-testid="computers-browsers">
      <p className="mb-4 text-[12.5px] text-fg-3">{t('computers.browsers.blurb')}</p>
      <OpenForm onDone={reload} />
      {error && <ErrorLine message={`${t('computers.loadError')} ${error}`} onRetry={reload} />}
      {!data && !error && <LoadingBlock rows={2} />}
      {data && (
        <DemoBoundary feature="remote-desktop-control">
          <SessionList sessions={data} busy={busy} onClose={(s) => void close(s)} onRemove={(s) => void act(s, () => call('browsers.remove', s.id), 'computers.browsers.removed')} />
        </DemoBoundary>
      )}
    </Panel>
  )
}
