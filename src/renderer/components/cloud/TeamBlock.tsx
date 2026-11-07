// Réglages › Compte › « Équipe » (the beta): the people of the Atelier Cloud team, the pending invitations, and inviting a
// person by e-mail (owner or admin; the Cloud e-mails a single-use link, which the app never sees). `TeamBlockView` is pure
// (unit-rendered); `TeamBlock` loads `cloud.team` and refreshes on the 'cloud' topic.
import { MailPlus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { CloudTeam } from '../../../shared/api'
import { t } from '../../../shared/fr'
import { Panel } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useApi } from '@/state/client'

const day = (iso: string): string => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(new Date(iso))

export interface TeamBlockViewProps {
  team: CloudTeam | null
  /** The signed-in person's address (marked « toi »). */
  me: string | null
  busy: boolean
  onInvite: (email: string, role: 'admin' | 'member') => Promise<boolean>
  onRevoke: (id: string) => void
}

export function TeamBlockView(p: TeamBlockViewProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    void p.onInvite(email.trim(), role).then((ok) => ok && setEmail(''))
  }
  return (
    <Panel title={t('beta.team.title')} data-testid="team-block" className="max-w-2xl">
      <p className="mb-4 text-[13px] text-fg-3">{t('beta.team.blurb')}</p>
      {!p.team ? (
        <p className="text-[13px] text-fg-3" data-testid="team-signed-out">
          {t('beta.team.signedOut')}
        </p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-line" data-testid="team-members">
            {p.team.members.map((m) => (
              <li key={m.accountId} data-testid="team-member" className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-fg">
                    {m.name}
                    {p.me && m.email.toLowerCase() === p.me.toLowerCase() ? <span className="ml-1.5 text-fg-4">({t('beta.team.you')})</span> : null}
                  </span>
                  <span className="block truncate text-[12px] text-fg-3">{m.email}</span>
                </span>
                <span className="shrink-0 text-[12px] text-fg-3">{t(`cloud.role.${m.role}`)}</span>
              </li>
            ))}
          </ul>
          {p.team.invites.length > 0 && (
            <div className="mt-4" data-testid="team-invites">
              <p className="micro-label mb-1.5">{t('beta.team.pending')}</p>
              <ul className="flex flex-col divide-y divide-line">
                {p.team.invites.map((i) => (
                  <li key={i.id} data-testid="team-invite" className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate text-[13px] text-fg-2">
                      {i.email} · {t(`cloud.role.${i.role}`)} · <span className="text-fg-4">{t('beta.team.until', { date: day(i.expiresAt) })}</span>
                    </span>
                    {p.team?.canInvite && (
                      <Button variant="ghost" size="sm" data-testid="team-revoke" disabled={p.busy} onClick={() => p.onRevoke(i.id)}>
                        <X aria-hidden />
                        {t('beta.team.revoke')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.team.canInvite ? (
            <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-2" data-testid="team-invite-form">
              <label className="flex min-w-56 flex-1 flex-col gap-1 text-[12px] text-fg-3">
                {t('beta.team.email')}
                <Input type="email" data-testid="team-invite-email" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} placeholder="nom@exemple.fr" />
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-fg-3">
                {t('beta.team.role')}
                <Select data-testid="team-invite-role" value={role} onChange={(e) => setRole(e.target.value === 'admin' ? 'admin' : 'member')}>
                  <option value="member">{t('cloud.role.member')}</option>
                  <option value="admin">{t('cloud.role.admin')}</option>
                </Select>
              </label>
              <Button type="submit" data-testid="team-invite-send" disabled={p.busy || email.trim() === ''}>
                <MailPlus aria-hidden />
                {t('beta.team.invite')}
              </Button>
            </form>
          ) : (
            <p className="mt-4 text-[12px] text-fg-4">{t('beta.team.memberOnly')}</p>
          )}
        </>
      )}
    </Panel>
  )
}

export function TeamBlock() {
  const team = useApi('cloud.team', ['cloud'])
  const status = useApi('cloud.status', ['cloud'])
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, done: string): Promise<boolean> => {
    setBusy(true)
    try {
      await fn()
      toast.success(done)
      return true
    } catch (e) {
      toast.error(errText(e))
      return false
    } finally {
      setBusy(false)
      team.reload()
    }
  }
  return (
    <TeamBlockView
      team={team.data}
      me={status.data?.account?.email ?? null}
      busy={busy}
      onInvite={(email, role) => run(() => call('cloud.invite', email, role), t('beta.team.invited', { email }))}
      onRevoke={(id) => void run(() => call('cloud.revokeInvite', id), t('beta.team.revoked'))}
    />
  )
}
