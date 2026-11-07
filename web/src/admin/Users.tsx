import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { PLANS, monthlyPrice } from '../plans'
import { Button } from '../ui'
import { HBar } from './charts'
import { USERS, agoLabel, economics, eur, num, pct, userPlan, type AdminUser, type UserStatus } from './data'
import { Chip2, Drawer, FieldLabel, PageHeader, Panel, SelectInput, Status, Table, TextArea, TextInput, td, th, useToast } from './kit'

const STATUS_LABEL: Record<UserStatus, string> = { trial: 'Essai', active: 'Actif', 'churn-risk': 'À risque' }
const STATUS_TONE = { trial: 'info', active: 'ok', 'churn-risk': 'warn' } as const

function StatusCell({ status }: { status: UserStatus }) {
  return <Status tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Status>
}

function ContactDrawer({ user, onClose, onStatus }: { user: AdminUser; onClose: () => void; onStatus: (s: UserStatus) => void }) {
  const toast = useToast()
  const plan = userPlan(user)
  const e = economics(user)
  const [notes, setNotes] = useState(user.notes)
  const [draft, setDraft] = useState('')
  const lines: [string, number][] = [
    ['Abonnement', e.revenue - e.topups],
    ['Recharges de crédits', e.topups],
    ['Machine d’équipe', -e.vm],
    ['Crédits (coût fournisseur)', -e.credits],
    ['Stockage', -e.storage],
    ['Infrastructure et support', -e.overhead],
    ['Frais Stripe', -e.fees]
  ]
  return (
    <Drawer title={user.name} sub={user.email} onClose={onClose}>
      <div className="grid gap-6 p-5">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-[13px]">
          <div>
            <p className="m-0 text-fg-3">Plan</p>
            <p className="m-0 mt-0.5 font-medium text-fg">
              {plan.name} · {user.billing === 'yearly' ? 'annuel' : 'mensuel'}
            </p>
          </div>
          <div>
            <FieldLabel htmlFor="status">Statut</FieldLabel>
            <SelectInput id="status" value={user.status} onChange={(ev) => onStatus(ev.target.value as UserStatus)}>
              {(Object.keys(STATUS_LABEL) as UserStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </SelectInput>
          </div>
          <div>
            <p className="m-0 text-fg-3">Chaînes</p>
            <p className="m-0 mt-0.5 text-fg-2">{user.channels.join(', ')}</p>
          </div>
          <div>
            <p className="m-0 text-fg-3">Dernière activité</p>
            <p className="m-0 mt-0.5 text-fg-2">{agoLabel(user.lastActiveMin)}</p>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
            <span className="text-fg-3">Crédits utilisés</span>
            <span className="num text-fg">
              {num(user.creditsUsed)} / {num(plan.credits)}
            </span>
          </div>
          <HBar value={user.creditsUsed} max={Math.max(plan.credits, user.creditsUsed)} tone={user.creditsUsed > plan.credits ? 'warn' : 'ink'} />
        </div>

        <div>
          <h3 className="m-0 mb-2 text-[13px] font-semibold">Rentabilité du mois</h3>
          <ul className="hairline-list m-0 list-none border-y border-line p-0 text-[13px]">
            {lines.map(([label, v]) => (
              <li key={label} className="flex justify-between py-2">
                <span className="text-fg-3">{label}</span>
                <span className={`num ${v < 0 ? 'text-fg-2' : 'text-fg'}`}>{eur(v)}</span>
              </li>
            ))}
            <li className="flex justify-between py-2 font-medium">
              <span>Marge</span>
              <span className={`num ${e.margin < 0 ? 'text-err' : 'text-fg'}`}>
                {eur(e.margin)} {e.revenue > 0 && <span className="font-normal text-fg-3">({pct(e.marginPct)})</span>}
              </span>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="m-0 mb-2 text-[13px] font-semibold">Notes</h3>
          {notes.length === 0 && <p className="m-0 mb-2 text-[13px] text-fg-3">Aucune note pour l’instant.</p>}
          <ul className="m-0 mb-3 flex list-none flex-col gap-2 p-0">
            {notes.map((n) => (
              <li key={n.text} className="rounded-[10px] bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
                {n.text}
                <span className="mt-1 block text-[12px] text-fg-3">{n.at}</span>
              </li>
            ))}
          </ul>
          <TextArea aria-label="Nouvelle note" placeholder="Ajouter une note" value={draft} onChange={(ev) => setDraft(ev.target.value)} className="min-h-[64px]" />
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            disabled={draft.trim().length === 0}
            onClick={() => {
              setNotes((s) => [{ at: 'à l’instant', text: draft.trim() }, ...s])
              setDraft('')
              toast('Note enregistrée (démo, non conservée)')
            }}
          >
            Enregistrer la note
          </Button>
        </div>

        <div>
          <h3 className="m-0 mb-2 text-[13px] font-semibold">Historique</h3>
          <ol className="m-0 list-none border-l border-line-2 p-0 pl-4 text-[13px]">
            {user.timeline.map((ev, i) => (
              <li key={`${ev.text}-${i}`} className="relative pb-3 last:pb-0">
                <span aria-hidden="true" className="absolute -left-[20.5px] top-[7px] size-1.5 rounded-full bg-fg-4" />
                <span className="text-fg-2">{ev.text}</span>
                <span className="block text-[12px] text-fg-3">{ev.at}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Drawer>
  )
}

export function Users() {
  const [users, setUsers] = useState<AdminUser[]>(USERS)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<UserStatus | 'all'>('all')
  const [plan, setPlan] = useState('all')
  const [openId, setOpenId] = useState<string | null>(null)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return users
      .filter((u) => (status === 'all' || u.status === status) && (plan === 'all' || u.plan === plan))
      .filter((u) => q === '' || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .map((u) => ({ u, e: economics(u) }))
  }, [users, query, status, plan])

  const open = users.find((u) => u.id === openId) ?? null
  const counts = (s: UserStatus): number => users.filter((u) => u.status === s).length

  return (
    <>
      <PageHeader title="Utilisateurs et CRM" sub={`${users.length} comptes. Clique sur une ligne pour ouvrir la fiche : plan, rentabilité, notes et historique.`} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-[280px]">
          <Search size={15} strokeWidth={1.5} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
          <TextInput aria-label="Rechercher un utilisateur" placeholder="Rechercher un nom ou une adresse" className="rounded-full pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrer par statut">
          <Chip2 active={status === 'all'} onClick={() => setStatus('all')}>
            Tous {users.length}
          </Chip2>
          {(Object.keys(STATUS_LABEL) as UserStatus[]).map((s) => (
            <Chip2 key={s} active={status === s} onClick={() => setStatus(s)}>
              {STATUS_LABEL[s]} {counts(s)}
            </Chip2>
          ))}
        </div>
        <SelectInput aria-label="Filtrer par plan" value={plan} onChange={(e) => setPlan(e.target.value)} className="w-[150px] rounded-full">
          <option value="all">Tous les plans</option>
          {PLANS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectInput>
      </div>
      <Panel flush className="overflow-hidden">
        <Table>
          <thead>
            <tr>
              <th className={th}>Utilisateur</th>
              <th className={th}>Plan</th>
              <th className={`${th} text-right`}>MRR</th>
              <th className={`${th} text-right`}>Chaînes</th>
              <th className={`${th} text-right`}>Vidéos / mois</th>
              <th className={th}>Crédits</th>
              <th className={`${th} text-right`}>Marge</th>
              <th className={th}>Statut</th>
              <th className={th}>Dernière activité</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ u, e }) => {
              const p = userPlan(u)
              return (
                <tr
                  key={u.id}
                  tabIndex={0}
                  aria-label={`Ouvrir la fiche de ${u.name}`}
                  onClick={() => setOpenId(u.id)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') setOpenId(u.id)
                  }}
                  className={`cursor-pointer transition-colors hover:bg-hover focus-visible:bg-hover ${openId === u.id ? 'bg-selected' : ''}`}
                >
                  <td className={td}>
                    <span className="block font-medium text-fg">{u.name}</span>
                    <span className="block text-[12px] text-fg-3">{u.email}</span>
                  </td>
                  <td className={td}>{p.name}</td>
                  <td className={`${td} num text-right`}>{u.status === 'trial' ? '–' : eur(monthlyPrice(p, u.billing))}</td>
                  <td className={`${td} num text-right`}>{u.channelCount}</td>
                  <td className={`${td} num text-right`}>{u.videosMonth}</td>
                  <td className={td}>
                    <span className="num mb-1 block text-[12px]">
                      {num(u.creditsUsed)} / {num(p.credits)}
                    </span>
                    <HBar value={u.creditsUsed} max={Math.max(p.credits, u.creditsUsed)} tone={u.creditsUsed > p.credits ? 'warn' : 'ink'} className="w-[96px]" />
                  </td>
                  <td className={`${td} num text-right ${e.margin < 0 ? 'text-err' : ''}`}>{eur(e.margin)}</td>
                  <td className={td}>
                    <StatusCell status={u.status} />
                  </td>
                  <td className={td}>{agoLabel(u.lastActiveMin)}</td>
                </tr>
              )
            })}
          </tbody>
        </Table>
        {rows.length === 0 && <p className="m-0 px-5 py-8 text-[13px] text-fg-3">Aucun utilisateur ne correspond à ces filtres.</p>}
      </Panel>
      {open && <ContactDrawer user={open} onClose={() => setOpenId(null)} onStatus={(s) => setUsers((all) => all.map((u) => (u.id === open.id ? { ...u, status: s } : u)))} />}
    </>
  )
}
