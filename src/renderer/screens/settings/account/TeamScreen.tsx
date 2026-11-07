// Réglages › Équipe: members (role, monthly cap, status), invitations stored locally (no e-mail is sent) and devices.
// All real: tables `team_members` and `team_devices`. Lot 14/15 moves the team to Atelier Cloud behind the same shapes.
import { Monitor, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { InviteInput, TeamDevice, TeamMember, TeamRole } from '../../../../shared/api/team'
import { useConfirm } from '@/components/atelier/confirm'
import { ErrorLine, ExampleBadge, Field, LoadingBlock } from '@/components/atelier/kit'
import { Panel } from '@/components/atelier/primitives'
import { TeamBlock } from '@/components/cloud/TeamBlock'
import { isDesktopApp } from '@/proto/live/desktop'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Select } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { SettingsPage, fmtAgo } from './common'

export const roleLabel = (r: TeamRole): string => t(`team.team.role${r[0]!.toUpperCase()}${r.slice(1)}` as MessageKey)

function capValue(cap: number | null): string {
  return cap === null ? '' : String(cap)
}

export function MemberRow({ m, onSave, onRemove }: { m: TeamMember; onSave: (id: number, role: TeamRole, cap: number | null) => void; onRemove: (m: TeamMember) => void }) {
  const [role, setRole] = useState<TeamRole>(m.role)
  const [cap, setCap] = useState(capValue(m.monthlyCap))
  const dirty = role !== m.role || cap !== capValue(m.monthlyCap)
  return (
    <tr data-testid="member-row" data-role={m.role} className="border-b border-line last:border-b-0">
      <td className="px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-fg">{m.name}</span>
          {m.self && <Badge variant="outline">{t('team.team.you')}</Badge>}
          {m.example && <ExampleBadge />}
        </div>
        <div className="text-[12px] text-fg-3">{m.email ?? t('team.team.noEmail')}</div>
      </td>
      <td className="px-3 py-3">
        {m.self ? (
          <span className="text-fg-2">{roleLabel('owner')}</span>
        ) : (
          <Select aria-label={t('team.team.role')} className="w-44" value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
            <option value="admin">{roleLabel('admin')}</option>
            <option value="member">{roleLabel('member')}</option>
          </Select>
        )}
      </td>
      <td className="px-3 py-3">
        <Input
          aria-label={t('team.team.cap')}
          className="w-36"
          type="number"
          min={0}
          step={1}
          placeholder={t('team.team.capNone')}
          value={cap}
          onChange={(e) => setCap(e.target.value)}
        />
      </td>
      <td className="px-3 py-3">
        <Badge variant={m.status === 'active' ? 'ok' : 'warn'}>{m.status === 'active' ? t('team.team.statusActive') : t('team.team.statusInvited')}</Badge>
      </td>
      <td className="px-3 py-3">
        <div className="flex justify-end gap-2">
          {dirty && (
            <Button size="sm" onClick={() => onSave(m.id, role, cap.trim() === '' ? null : Number(cap))}>
              {t('team.team.save')}
            </Button>
          )}
          {!m.self && (
            <Button size="icon-sm" variant="ghost" aria-label={`${t('team.team.remove')} ${m.name}`} onClick={() => onRemove(m)}>
              <Trash2 aria-hidden />
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}

export function MembersTable({ members, onSave, onRemove }: { members: readonly TeamMember[]; onSave: (id: number, role: TeamRole, cap: number | null) => void; onRemove: (m: TeamMember) => void }) {
  return (
    <div className="overflow-hidden rounded-card border border-line" data-testid="members-table">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line bg-surface-1">
            {[t('team.team.name'), t('team.team.role'), t('team.team.cap'), t('team.team.status'), ''].map((h, i) => (
              <th key={i} scope="col" className="micro-label px-3 py-2 text-left font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <MemberRow key={`${m.id}-${m.role}-${m.monthlyCap ?? 'x'}`} m={m} onSave={onSave} onRemove={onRemove} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DevicesList({ devices, onRevoke, now }: { devices: readonly TeamDevice[]; onRevoke: (d: TeamDevice) => void; now?: number }) {
  if (devices.length === 0) return <p className="text-[13px] text-fg-3">{t('team.team.devicesEmpty')}</p>
  return (
    <ul className="divide-y divide-line rounded-card border border-line" data-testid="devices-list">
      {devices.map((d) => (
        <li key={d.id} data-testid="device-row" className="flex items-center gap-3 px-4 py-3">
          <Monitor className="size-4 text-fg-3" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg">
              {d.name}
              {d.current && <Badge variant="brand">{t('team.team.deviceCurrent')}</Badge>}
              {d.example && <ExampleBadge />}
            </div>
            <div className="text-[12px] text-fg-3">
              {d.os} · {t('team.team.deviceSeen', { when: fmtAgo(d.lastSeenAt, now) })}
            </div>
          </div>
          {!d.current && (
            <Button size="sm" variant="outline" onClick={() => onRevoke(d)}>
              {t('team.team.deviceRevoke')}
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

export function InviteForm({ onDone, onCancel }: { onDone: (m: TeamMember) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'member' as InviteInput['role'], cap: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    setBusy(true)
    call('team.invite', { name: form.name, email: form.email, role: form.role, monthlyCap: form.cap.trim() === '' ? null : Number(form.cap) })
      .then(onDone, (err: unknown) => setError(errText(err)))
      .finally(() => setBusy(false))
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="invite-form">
      <Field label={t('team.team.name')} htmlFor="inv-name">
        <Input id="inv-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      </Field>
      <Field label={t('team.team.email')} htmlFor="inv-email">
        <Input id="inv-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('team.team.role')} htmlFor="inv-role">
          <Select id="inv-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as InviteInput['role'] })}>
            <option value="member">{roleLabel('member')}</option>
            <option value="admin">{roleLabel('admin')}</option>
          </Select>
        </Field>
        <Field label={t('team.team.cap')} htmlFor="inv-cap">
          <Input id="inv-cap" type="number" min={0} step={1} placeholder={t('team.team.capNone')} value={form.cap} onChange={(e) => setForm({ ...form, cap: e.target.value })} />
        </Field>
      </div>
      <p className="text-[12px] text-fg-3">{t('team.team.inviteNote')}</p>
      {error && <ErrorLine message={error} />}
      <DialogFooter className="justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('team.team.cancel')}
        </Button>
        <Button type="submit" disabled={busy}>
          {t('team.team.send')}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function TeamScreen(_props: ScreenProps) {
  const members = useLoader(() => call('team.members'), 'team-members', ['team', 'example'])
  const devices = useLoader(() => call('team.devices'), 'team-devices', ['team', 'example'])
  const confirm = useConfirm()
  const [inviting, setInviting] = useState(false)

  const save = (id: number, role: TeamRole, cap: number | null): void => {
    const patch = role === 'owner' ? { monthlyCap: cap } : { role, monthlyCap: cap }
    call('team.updateMember', id, patch).then(() => toast.success(t('team.team.updated')), (e: unknown) => toast.error(errText(e)))
  }
  const remove = async (m: TeamMember): Promise<void> => {
    if (!(await confirm({ title: t('team.team.removeTitle', { name: m.name }), description: t('team.team.removeBody'), danger: true, confirmLabel: t('team.team.remove') }))) return
    call('team.removeMember', m.id).then(() => toast.success(t('team.team.removed')), (e: unknown) => toast.error(errText(e)))
  }
  const revoke = async (d: TeamDevice): Promise<void> => {
    if (!(await confirm({ title: t('team.team.deviceRevokeTitle', { name: d.name }), description: t('team.team.deviceRevokeBody'), danger: true, confirmLabel: t('team.team.deviceRevoke') }))) return
    call('team.revokeDevice', d.id).then(() => toast.success(t('team.team.deviceRevoked')), (e: unknown) => toast.error(errText(e)))
  }

  return (
    <SettingsPage
      page="equipe"
      subtitle={t('team.team.subtitle')}
      actions={
        <Button onClick={() => setInviting(true)}>
          <UserPlus aria-hidden /> {t('team.team.invite')}
        </Button>
      }
    >
      {/* the beta: the real team is the Atelier Cloud one (invitations by e-mail); the local list below stays this computer's */}
      {isDesktopApp() && <TeamBlock />}
      <Panel title={t('team.team.members')}>
        {members.error ? (
          <ErrorLine message={members.error} onRetry={members.reload} />
        ) : members.data ? (
          <MembersTable members={members.data} onSave={save} onRemove={(m) => void remove(m)} />
        ) : (
          <LoadingBlock rows={3} />
        )}
      </Panel>
      <Panel title={t('team.team.devices')}>
        {devices.error ? (
          <ErrorLine message={devices.error} onRetry={devices.reload} />
        ) : devices.data ? (
          <DevicesList devices={devices.data} onRevoke={(d) => void revoke(d)} />
        ) : (
          <LoadingBlock rows={2} />
        )}
      </Panel>
      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('team.team.invite')}</DialogTitle>
            <DialogDescription>{t('team.team.inviteNote')}</DialogDescription>
          </DialogHeader>
          {inviting && (
            <InviteForm
              onCancel={() => setInviting(false)}
              onDone={(m) => {
                setInviting(false)
                toast.success(t('team.team.invited', { name: m.name }))
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </SettingsPage>
  )
}
