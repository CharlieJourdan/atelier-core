// « Utilisateurs et CRM » on the real Atelier Cloud: every account with its plan, credits, spend over 30 days, machines,
// last activity and verified address; search and pages; a drawer with the account's detail; and the admin actions, each
// behind a confirmation (grant credits, verify the address, disable / enable, revoke the sessions). The Cloud checks the
// platform admin on every call and writes every action to the audit log. Pure views + a small container.
import { useCallback, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { CloudCallError } from '../cloud'
import { Button } from '../ui'
import {
  confirmText,
  credits,
  doneText,
  fetchDetail,
  fetchPage,
  newGrantKey,
  PAGE_SIZE,
  planLabel,
  ROLE_LABEL,
  runAction,
  sinceLabel,
  type CrmAccount,
  type CrmAction,
  type CrmDetail,
  type CrmPage,
  type CrmStatusFilter
} from './crm'
import { Chip2, Dialog, Drawer, FieldLabel, PageHeader, Panel, Status, Table, TextInput, td, th, useToast } from './kit'
import { dateLabel } from './releases'

const FILTERS: { id: CrmStatusFilter; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'active', label: 'Actifs' },
  { id: 'unverified', label: 'Adresse à vérifier' },
  { id: 'disabled', label: 'Désactivés' }
]

function AccountState({ a }: { a: CrmAccount }) {
  if (a.disabled) return <Status tone="err">Désactivé</Status>
  if (!a.emailVerified) return <Status tone="warn">Adresse à vérifier</Status>
  return <Status tone="ok">Actif</Status>
}

export interface UsersViewProps {
  page: CrmPage
  query: string
  status: CrmStatusFilter
  openId: string | null
  onQuery: (q: string) => void
  onStatus: (s: CrmStatusFilter) => void
  onOffset: (offset: number) => void
  onOpen: (id: string) => void
}

export function UsersView({ page, query, status, openId, onQuery, onStatus, onOffset, onOpen }: UsersViewProps) {
  const first = page.total === 0 ? 0 : page.offset + 1
  const last = Math.min(page.total, page.offset + page.accounts.length)
  return (
    <div data-testid="admin-live-users">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-[300px]">
          <Search size={15} strokeWidth={1.5} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
          <TextInput aria-label="Rechercher un compte" placeholder="Adresse, nom ou équipe" className="rounded-full pl-9" value={query} onChange={(e) => onQuery(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrer par état">
          {FILTERS.map((f) => (
            <Chip2 key={f.id} active={status === f.id} onClick={() => onStatus(f.id)}>
              {f.label}
            </Chip2>
          ))}
        </div>
      </div>
      <Panel flush className="overflow-hidden">
        <Table>
          <thead>
            <tr>
              <th className={th}>Compte</th>
              <th className={th}>Équipe et plan</th>
              <th className={`${th} text-right`}>Crédits</th>
              <th className={`${th} text-right`}>Dépensé 30 j</th>
              <th className={`${th} text-right`}>Machines</th>
              <th className={th}>Dernière activité</th>
              <th className={th}>État</th>
            </tr>
          </thead>
          <tbody>
            {page.accounts.map((a) => (
              <tr
                key={a.id}
                tabIndex={0}
                data-testid="crm-row"
                aria-label={`Ouvrir la fiche de ${a.name}`}
                onClick={() => onOpen(a.id)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') onOpen(a.id)
                }}
                className={`cursor-pointer transition-colors hover:bg-hover focus-visible:bg-hover ${openId === a.id ? 'bg-selected' : ''}`}
              >
                <td className={td}>
                  <span className="block font-medium text-fg">
                    {a.name}
                    {a.platformAdmin && <span className="ml-2 text-[11px] font-normal text-fg-3">admin plateforme</span>}
                  </span>
                  <span className="block text-[12px] text-fg-3">{a.email}</span>
                </td>
                <td className={td}>
                  <span className="block">
                    {a.team?.name ?? '—'}
                    {a.team?.test && (
                      <span className="ml-2 text-[11px] font-normal text-fg-3" data-testid="crm-test-team">
                        équipe de test
                      </span>
                    )}
                  </span>
                  <span className="block text-[12px] text-fg-3">{planLabel(a.team)}</span>
                </td>
                <td className={`${td} num text-right`}>{a.team ? credits(a.team.balance) : '—'}</td>
                <td className={`${td} num text-right`}>{a.team ? credits(a.team.spent30d) : '—'}</td>
                <td className={`${td} num text-right`}>{a.team ? a.team.machines : '—'}</td>
                <td className={td}>{sinceLabel(a.lastActiveAt)}</td>
                <td className={td}>
                  <AccountState a={a} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {page.accounts.length === 0 && <p className="m-0 px-5 py-8 text-[13px] text-fg-3">Aucun compte ne correspond à cette recherche.</p>}
      </Panel>
      <div className="mt-3 flex items-center justify-between gap-3 text-[13px] text-fg-3">
        <span className="num" data-testid="crm-range">
          {page.total === 0 ? '0 compte' : `${first}–${last} sur ${page.total}`}
        </span>
        <span className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page.offset === 0} onClick={() => onOffset(Math.max(0, page.offset - PAGE_SIZE))}>
            Précédents
          </Button>
          <Button variant="secondary" size="sm" disabled={page.offset + page.accounts.length >= page.total} onClick={() => onOffset(page.offset + PAGE_SIZE)}>
            Suivants
          </Button>
        </span>
      </div>
    </div>
  )
}

export interface AccountDrawerProps {
  detail: CrmDetail
  busy: boolean
  onClose: () => void
  /** Asks for an action (the container shows the confirmation). */
  onAsk: (a: CrmAction) => void
}

export function AccountDrawer({ detail, busy, onClose, onAsk }: AccountDrawerProps) {
  const a = detail.account
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const n = Number(amount)
  const valid = Number.isInteger(n) && n >= 1 && n <= 1_000_000
  return (
    <Drawer title={a.name} sub={a.email} onClose={onClose}>
      <div className="grid gap-6 p-5" data-testid="crm-detail">
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
          <div>
            <p className="m-0 text-fg-3">État</p>
            <p className="m-0 mt-0.5">
              <AccountState a={a} />
            </p>
          </div>
          <div>
            <p className="m-0 text-fg-3">Créé le</p>
            <p className="m-0 mt-0.5 text-fg-2">{dateLabel(a.createdAt)}</p>
          </div>
          <div>
            <p className="m-0 text-fg-3">Dernière activité</p>
            <p className="m-0 mt-0.5 text-fg-2">{sinceLabel(a.lastActiveAt)}</p>
          </div>
          <div>
            <p className="m-0 text-fg-3">Sessions ouvertes</p>
            <p className="num m-0 mt-0.5 text-fg-2">{a.activeSessions}</p>
          </div>
        </div>

        <div>
          <h3 className="m-0 mb-2 text-[13px] font-semibold">Équipes</h3>
          <ul className="hairline-list m-0 list-none border-y border-line p-0 text-[13px]">
            {detail.teams.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-fg">{t.name}</span>
                  <span className="block text-[12px] text-fg-3">
                    {ROLE_LABEL[t.role]} · {planLabel(t)} · {t.machines} machine(s)
                  </span>
                </span>
                <span className="num shrink-0 text-right text-fg-2">
                  {credits(t.balance)} cr.
                  <span className="block text-[12px] text-fg-3">{credits(t.spent30d)} dépensés en 30 j</span>
                </span>
              </li>
            ))}
            {detail.teams.length === 0 && <li className="py-2 text-fg-3">Aucune équipe.</li>}
          </ul>
        </div>

        <div>
          <h3 className="m-0 mb-2 text-[13px] font-semibold">Accorder des crédits</h3>
          <div className="grid gap-2">
            <FieldLabel htmlFor="crm-credits">Nombre de crédits (1 crédit = 0,01 €)</FieldLabel>
            <TextInput id="crm-credits" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} placeholder="500" />
            <TextInput aria-label="Note de l’opération" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Note (geste commercial, remboursement…)" />
            <Button size="sm" disabled={busy || !valid || !a.team} data-testid="crm-grant" onClick={() => onAsk({ kind: 'grant', credits: n, note: note.trim(), idempotencyKey: newGrantKey() })}>
              Accorder…
            </Button>
          </div>
        </div>

        <div>
          <h3 className="m-0 mb-2 text-[13px] font-semibold">Actions</h3>
          <div className="flex flex-wrap gap-2">
            {!a.emailVerified && (
              <Button variant="secondary" size="sm" disabled={busy} data-testid="crm-verify" onClick={() => onAsk({ kind: 'verify' })}>
                Vérifier l’adresse…
              </Button>
            )}
            <Button variant="secondary" size="sm" disabled={busy || a.activeSessions === 0} data-testid="crm-revoke" onClick={() => onAsk({ kind: 'revoke' })}>
              Révoquer les sessions…
            </Button>
            {a.disabled ? (
              <Button variant="secondary" size="sm" disabled={busy} data-testid="crm-enable" onClick={() => onAsk({ kind: 'enable' })}>
                Réactiver le compte…
              </Button>
            ) : (
              <Button variant="secondary" size="sm" disabled={busy} data-testid="crm-disable" onClick={() => onAsk({ kind: 'disable' })}>
                Désactiver le compte…
              </Button>
            )}
          </div>
        </div>

        <div>
          <h3 className="m-0 mb-2 text-[13px] font-semibold">Appareils</h3>
          <ul className="m-0 grid list-none gap-1.5 p-0 text-[13px]">
            {detail.devices.map((d) => (
              <li key={d.id} className="flex justify-between gap-3">
                <span className="truncate text-fg-2">{d.name}</span>
                <span className="shrink-0 text-[12px] text-fg-3">{d.revokedAt ? 'révoqué' : sinceLabel(d.lastSeenAt)}</span>
              </li>
            ))}
            {detail.devices.length === 0 && <li className="text-fg-3">Jamais connecté.</li>}
          </ul>
        </div>

        <div>
          <h3 className="m-0 mb-2 text-[13px] font-semibold">Portefeuille</h3>
          <ul className="m-0 grid list-none gap-1.5 p-0 text-[13px]">
            {detail.wallet.map((e) => (
              <li key={e.id} className="flex justify-between gap-3">
                <span className="truncate text-fg-2">
                  {e.kind}
                  {e.note ? ` · ${e.note}` : ''}
                </span>
                <span className={`num shrink-0 ${e.credits < 0 ? 'text-fg-3' : 'text-fg'}`}>{e.credits > 0 ? `+${credits(e.credits)}` : credits(e.credits)}</span>
              </li>
            ))}
            {detail.wallet.length === 0 && <li className="text-fg-3">Aucun mouvement.</li>}
          </ul>
        </div>

        <div>
          <h3 className="m-0 mb-2 text-[13px] font-semibold">Journal d’audit</h3>
          <ol className="m-0 list-none border-l border-line-2 p-0 pl-4 text-[13px]" data-testid="crm-audit">
            {detail.audit.map((e) => (
              <li key={e.id} className="relative pb-2 last:pb-0">
                <span aria-hidden="true" className="absolute -left-[20.5px] top-[7px] size-1.5 rounded-full bg-fg-4" />
                <span className="font-mono text-[12px] text-fg-2">{e.action}</span>
                <span className="block text-[12px] text-fg-3">
                  {dateLabel(e.at)} · par {e.actor === a.id ? 'la personne' : e.actor}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Drawer>
  )
}

const errText = (e: unknown): string => (e instanceof CloudCallError || e instanceof Error ? e.message : String(e))

export function LiveUsers() {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<CrmStatusFilter>('all')
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<CrmPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CrmDetail | null>(null)
  const [asking, setAsking] = useState<CrmAction | null>(null)
  const [busy, setBusy] = useState(false)

  // the search goes to the server a moment after the last key
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(query)
      setOffset(0)
    }, 250)
    return () => window.clearTimeout(t)
  }, [query])

  const loadPage = useCallback(() => {
    fetchPage(search, status, offset)
      .then((p) => {
        setPage(p)
        setError(null)
      })
      .catch((e: unknown) => setError(errText(e)))
  }, [search, status, offset])
  useEffect(loadPage, [loadPage])

  const loadDetail = useCallback(() => {
    if (!openId) return setDetail(null)
    fetchDetail(openId)
      .then(setDetail)
      .catch((e: unknown) => toast(`Fiche illisible : ${errText(e)}`))
  }, [openId, toast])
  useEffect(loadDetail, [loadDetail])

  const confirm = (a: CrmAction): void => {
    if (!detail) return
    const who = detail.account
    setAsking(null)
    setBusy(true)
    runAction(who.id, a)
      .then(() => toast(doneText(a, who)))
      .catch((e: unknown) => toast(`Refusé : ${errText(e)}`))
      .finally(() => {
        setBusy(false)
        loadPage()
        loadDetail()
      })
  }

  const ask = asking && detail ? confirmText(asking, detail.account) : null
  return (
    <>
      <PageHeader title="Utilisateurs et CRM" sub="Les comptes réels d’Atelier Cloud. Clique sur une ligne pour ouvrir la fiche : équipes, crédits, appareils, journal et actions." />
      {error && <p className="m-0 mb-4 text-[13px] text-fg-2">Atelier Cloud ne répond pas : {error}</p>}
      {page ? (
        <UsersView
          page={page}
          query={query}
          status={status}
          openId={openId}
          onQuery={setQuery}
          onStatus={(s) => {
            setStatus(s)
            setOffset(0)
          }}
          onOffset={setOffset}
          onOpen={setOpenId}
        />
      ) : (
        !error && <p className="m-0 text-[13px] text-fg-3">Chargement…</p>
      )}
      {detail && openId && <AccountDrawer detail={detail} busy={busy} onClose={() => setOpenId(null)} onAsk={setAsking} />}
      {asking && ask && (
        <Dialog
          title={ask.title}
          onClose={() => setAsking(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAsking(null)}>
                Annuler
              </Button>
              <Button data-testid="crm-confirm" disabled={busy} onClick={() => confirm(asking)}>
                {ask.ok}
              </Button>
            </>
          }
        >
          <p className="m-0 text-[14px] leading-[1.55] text-fg-2">{ask.body}</p>
        </Dialog>
      )}
    </>
  )
}
