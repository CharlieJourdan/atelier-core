// Ordinateurs › PC distant (H1): the machines the owner declared. All real: add, rename, remove, and a connection test
// (a TCP connect to host:port from the main process, nothing else).
import { Check, Pencil, Plus, Trash2, Wifi } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { MACHINE_OSES, type Machine, type MachineOs, type MachineStatus } from '../../../shared/api/home'
import { useConfirm } from '@/components/atelier/confirm'
import { ErrorLine, ExampleBadge, Field, LoadingBlock, fmtDate } from '@/components/atelier/kit'
import { EmptyState, Panel, StatusDot, type Tone } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useApi } from '@/state/client'

const STATUS_TONE: Record<MachineStatus, Tone> = { unknown: 'off', reachable: 'ok', unreachable: 'err' }

export interface MachineActions {
  busy: number | null
  onTest: (m: Machine) => void
  onRename: (m: Machine, name: string) => void
  onRemove: (m: Machine) => void
}

export function MachineRow({ machine: m, actions }: { machine: Machine; actions: MachineActions }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(m.name)
  const busy = actions.busy === m.id
  return (
    <li data-testid="machine-row" data-status={m.status} className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface-1 px-4 py-3">
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              actions.onRename(m, name)
              setEditing(false)
            }}
          >
            <Input aria-label={t('computers.machines.name')} value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
            <Button type="submit" size="sm">
              <Check />
              {t('computers.machines.save')}
            </Button>
          </form>
        ) : (
          <p className="flex items-center gap-2 text-[14px] font-medium text-fg">
            <span className="truncate">{m.name}</span>
            {m.example && <ExampleBadge />}
          </p>
        )}
        <p className="mt-0.5 font-mono text-[12px] text-fg-3">
          {t(`computers.os.${m.os}` as MessageKey)} · {m.host}:{m.port}
        </p>
        <p className="mt-0.5 text-[12px] text-fg-3">
          {m.lastSeenAt ? t('computers.machines.lastSeen', { date: fmtDate(m.lastSeenAt, true) }) : t('computers.machines.neverSeen')}
          {m.status === 'unreachable' && m.lastError ? ` · ${m.lastError}` : ''}
        </p>
      </div>
      <span className="flex items-center gap-1.5 text-[12px] text-fg-2">
        <StatusDot tone={STATUS_TONE[m.status]} />
        {t(`computers.machines.status.${m.status}` as MessageKey)}
      </span>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => actions.onTest(m)}>
          <Wifi />
          {busy ? t('computers.machines.testing') : t('computers.machines.test')}
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={t('computers.machines.rename')} onClick={() => setEditing((v) => !v)}>
          <Pencil />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={t('computers.machines.remove')} onClick={() => actions.onRemove(m)}>
          <Trash2 />
        </Button>
      </div>
    </li>
  )
}

export function MachineList({ machines, actions }: { machines: readonly Machine[]; actions: MachineActions }) {
  if (machines.length === 0) return <EmptyState className="py-8" title={t('computers.machines.empty')} blurb={t('computers.machines.emptyHint')} />
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {machines.map((m) => (
        <MachineRow key={m.id} machine={m} actions={actions} />
      ))}
    </ul>
  )
}

function AddForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [os, setOs] = useState<MachineOs>('windows')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      const m = await call('machines.add', { name, os, host, port: Number(port) })
      toast.success(t('computers.machines.added', { name: m.name }))
      setName('')
      setHost('')
      onDone()
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="mb-4 grid grid-cols-2 items-end gap-3 rounded-card border border-line bg-surface-1 p-4 md:grid-cols-[1fr_9rem_1.4fr_6rem_auto]"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Field label={t('computers.machines.name')} htmlFor="machine-name">
        <Input id="machine-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('computers.machines.os')} htmlFor="machine-os">
        <Select id="machine-os" value={os} onChange={(e) => setOs(e.target.value as MachineOs)}>
          {MACHINE_OSES.map((o) => (
            <option key={o} value={o}>
              {t(`computers.os.${o}` as MessageKey)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('computers.machines.host')} htmlFor="machine-host">
        <Input id="machine-host" value={host} placeholder={t('computers.machines.hostPlaceholder')} onChange={(e) => setHost(e.target.value)} />
      </Field>
      <Field label={t('computers.machines.port')} htmlFor="machine-port">
        <Input id="machine-port" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} />
      </Field>
      <Button type="submit" disabled={busy || !name.trim() || !host.trim()}>
        <Plus />
        {t('computers.machines.create')}
      </Button>
    </form>
  )
}

export function MachinesBlock() {
  const { data, error, reload } = useApi('machines.list', ['computers', 'example'])
  const [busy, setBusy] = useState<number | null>(null)
  const confirm = useConfirm()

  const wrap = async (m: Machine, action: () => Promise<void>): Promise<void> => {
    setBusy(m.id)
    try {
      await action()
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setBusy(null)
    }
  }
  const actions: MachineActions = {
    busy,
    onTest: (m) =>
      void wrap(m, async () => {
        const r = await call('machines.test', m.id)
        if (r.ok) toast.success(r.message)
        else toast.error(r.message)
      }),
    onRename: (m, name) =>
      void wrap(m, async () => {
        await call('machines.rename', m.id, name)
        toast.success(t('computers.machines.renamed'))
      }),
    onRemove: (m) =>
      void wrap(m, async () => {
        const ok = await confirm({ title: t('computers.machines.removeTitle'), description: t('computers.machines.removeBody', { name: m.name }), confirmLabel: t('computers.machines.remove'), danger: true })
        if (!ok) return
        await call('machines.remove', m.id)
        toast.success(t('computers.machines.removed'))
      })
  }

  return (
    <Panel title={t('computers.machines')} data-testid="computers-machines">
      <p className="mb-4 text-[12.5px] text-fg-3">{t('computers.machines.blurb')}</p>
      <AddForm onDone={reload} />
      {error && <ErrorLine message={`${t('computers.loadError')} ${error}`} onRetry={reload} />}
      {!data && !error && <LoadingBlock rows={2} />}
      {data && <MachineList machines={data} actions={actions} />}
    </Panel>
  )
}
