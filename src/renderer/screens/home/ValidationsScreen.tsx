// Validations (section `validations`): the inbox of everything waiting for the owner. Real: workflow deliverables
// (`approvals.approve` / `approvals.requestRevision`) and production gates (`production.approve` / `requestChanges`).
import { Check, CornerUpLeft, ExternalLink } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import type { HomeInbox, InboxGate } from '../../../shared/api/home'
import type { PendingApproval } from '../../../shared/workflow'
import type { Route } from '../../../shared/sections'
import { ErrorLine, LoadingBlock } from '@/components/atelier/kit'
import { PageShell } from '@/components/atelier/page'
import { EmptyState } from '@/components/atelier/primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/lib/toast'
import { call, errText, useApi } from '@/state/client'
import type { ScreenProps } from '../registry'

export const INBOX_TABS = ['all', 'approvals', 'gates'] as const
export type InboxTab = (typeof INBOX_TABS)[number]

function NoteForm({ busy, onSubmit, onCancel }: { busy: boolean; onSubmit: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState('')
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(note)
      }}
    >
      <label className="text-[12px] font-medium text-fg-2" htmlFor="inbox-note">
        {t('inbox.note.label')}
      </label>
      <Textarea id="inbox-note" rows={3} value={note} placeholder={t('inbox.note.placeholder')} onChange={(e) => setNote(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('inbox.note.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {t('inbox.note.send')}
        </Button>
      </div>
    </form>
  )
}

function Card({ kind, title, meta, badges, body, actions, form }: { kind: 'approval' | 'gate'; title: string; meta: string; badges?: ReactNode; body?: ReactNode; actions: ReactNode; form?: ReactNode }) {
  return (
    <li data-testid="inbox-card" data-kind={kind} className="flex flex-col gap-3 rounded-card border border-line bg-surface-1 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{t(`inbox.kind.${kind}` as MessageKey)}</Badge>
        <h3 className="text-[15px] font-medium text-fg">{title}</h3>
        {badges}
      </div>
      <p className="text-[12.5px] text-fg-3">{meta}</p>
      {body}
      {form ?? <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </li>
  )
}

export function ApprovalCard({ item, busy, onApprove, onSendBack }: { item: PendingApproval; busy: boolean; onApprove: () => void; onSendBack: (note: string) => void }) {
  const [asking, setAsking] = useState(false)
  const v = item.version
  const label = t(`home.deliverable.${item.deliverable.type}` as MessageKey)
  return (
    <Card
      kind="approval"
      title={label}
      meta={item.video.title}
      badges={<Badge variant="default">{v ? t('inbox.version', { n: v.number }) : t('inbox.noVersion')}</Badge>}
      body={
        v?.content ? (
          <pre className="max-h-48 overflow-auto rounded-field border border-line bg-surface-2 p-3 font-sans text-[12.5px] whitespace-pre-wrap text-fg-2">{v.content.slice(0, 1200)}</pre>
        ) : undefined
      }
      actions={
        <>
          <Button variant="brand" size="sm" disabled={busy} onClick={onApprove}>
            <Check />
            {t('inbox.approve')}
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setAsking(true)}>
            <CornerUpLeft />
            {t('inbox.sendBack')}
          </Button>
        </>
      }
      form={asking ? <NoteForm busy={busy} onSubmit={onSendBack} onCancel={() => setAsking(false)} /> : undefined}
    />
  )
}

export function GateCard({ gate, busy, onApprove, onChanges, onOpen }: { gate: InboxGate; busy: boolean; onApprove: () => void; onChanges: (note: string) => void; onOpen: () => void }) {
  const [asking, setAsking] = useState(false)
  return (
    <Card
      kind="gate"
      title={gate.nodeLabel}
      meta={`${gate.videoTitle} · ${gate.channelName} · ${gate.pipelineLabel}`}
      badges={
        <>
          <Badge variant={gate.gateKind === 'owner' ? 'warn' : 'default'}>{t(gate.gateKind === 'owner' ? 'inbox.gate.owner' : 'inbox.gate.review')}</Badge>
          {gate.demo && <Badge variant="brand">{t('inbox.demo')}</Badge>}
        </>
      }
      body={<p className="text-[12.5px] text-fg-2">{gate.step ?? t('inbox.fallbackStep')}</p>}
      actions={
        <>
          <Button variant="brand" size="sm" disabled={busy} onClick={onApprove}>
            <Check />
            {t('inbox.approve')}
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setAsking(true)}>
            <CornerUpLeft />
            {t('inbox.sendBack')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpen}>
            <ExternalLink />
            {t('inbox.openRun')}
          </Button>
        </>
      }
      form={asking ? <NoteForm busy={busy} onSubmit={onChanges} onCancel={() => setAsking(false)} /> : undefined}
    />
  )
}

export interface InboxActions {
  busy: string | null
  onApprove: (a: PendingApproval) => void
  onSendBack: (a: PendingApproval, note: string) => void
  onGateApprove: (g: InboxGate) => void
  onGateChanges: (g: InboxGate, note: string) => void
  onOpenRun: () => void
}

export function InboxList({ inbox, tab, actions }: { inbox: HomeInbox; tab: InboxTab; actions: InboxActions }) {
  const approvals = tab === 'gates' ? [] : inbox.approvals
  const gates = tab === 'approvals' ? [] : inbox.gates
  if (approvals.length + gates.length === 0) return <EmptyState title={t('inbox.empty.title')} blurb={t('inbox.empty.blurb')} />
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="inbox-list">
      {approvals.map((a) => (
        <ApprovalCard
          key={`d${a.deliverable.id}`}
          item={a}
          busy={actions.busy === `d${a.deliverable.id}`}
          onApprove={() => actions.onApprove(a)}
          onSendBack={(note) => actions.onSendBack(a, note)}
        />
      ))}
      {gates.map((g) => (
        <GateCard
          key={`r${g.runId}:${g.nodeId}`}
          gate={g}
          busy={actions.busy === `r${g.runId}:${g.nodeId}`}
          onApprove={() => actions.onGateApprove(g)}
          onChanges={(note) => actions.onGateChanges(g, note)}
          onOpen={actions.onOpenRun}
        />
      ))}
    </ul>
  )
}

export function ValidationsScreen({ onRoute }: ScreenProps) {
  const { data, error, reload } = useApi('home.inbox', ['videos', 'production', 'agents'])
  const [tab, setTab] = useState<InboxTab>('all')
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (key: string, what: string, done: 'inbox.approved' | 'inbox.sentBack', action: () => Promise<unknown>): Promise<void> => {
    setBusy(key)
    try {
      await action()
      toast.success(t(done, { what }))
      reload()
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(null)
    }
  }
  const needNote = (note: string): boolean => {
    if (note.trim()) return false
    toast.error(t('inbox.note.required'))
    return true
  }
  const label = (a: PendingApproval): string => t(`home.deliverable.${a.deliverable.type}` as MessageKey)
  const open = (): void => onRoute({ section: 'production', page: 'encours' } satisfies Route)

  const actions: InboxActions = {
    busy,
    onApprove: (a) => void run(`d${a.deliverable.id}`, label(a), 'inbox.approved', () => call('approvals.approve', a.deliverable.id, undefined, a.version?.id)),
    onSendBack: (a, note) => {
      if (needNote(note)) return
      void run(`d${a.deliverable.id}`, label(a), 'inbox.sentBack', () => call('approvals.requestRevision', a.deliverable.id, note.trim(), a.version?.id))
    },
    onGateApprove: (g) => void run(`r${g.runId}:${g.nodeId}`, g.nodeLabel, 'inbox.approved', () => call('production.approve', g.runId, g.nodeId)),
    onGateChanges: (g, note) => {
      if (needNote(note)) return
      void run(`r${g.runId}:${g.nodeId}`, g.nodeLabel, 'inbox.sentBack', () => call('production.requestChanges', g.runId, g.nodeId, note.trim()))
    },
    onOpenRun: open
  }

  return (
    <PageShell section="validations" title={t('section.validations')} subtitle={t('inbox.subtitle')}>
      <div className="flex flex-col gap-5">
        <Tabs value={tab} onValueChange={(v) => setTab(v as InboxTab)}>
          <TabsList>
            {INBOX_TABS.map((k) => (
              <TabsTrigger key={k} value={k}>
                {t(`inbox.tab.${k}` as MessageKey)}
                {data && k === 'all' ? ` · ${data.total}` : ''}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {error && <ErrorLine message={`${t('inbox.loadError')} ${error}`} onRetry={reload} />}
        {!data && !error && <LoadingBlock rows={3} />}
        {data && <InboxList inbox={data} tab={tab} actions={actions} />}
      </div>
    </PageShell>
  )
}
