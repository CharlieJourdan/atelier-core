// Réglages › Claude et modèles: the team's Claude connections (several profiles), the routing role → profile and the
// connection test of the default profile. Real: tables `claude_profiles` / `claude_routing`, keys in the encrypted
// secrets store (only « enregistrée / pas de clé » reaches this screen). The model tier of each role stays in
// `routes` (Réglages › Moteur); « limite atteinte » is marked by hand until the runner detects it (lot 14/15).
import { PlugZap, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { ClaudeKind, ClaudeProfile, ClaudeRoutingRow } from '../../../../shared/api/team'
import { useConfirm } from '@/components/atelier/confirm'
import { DataTable, ErrorLine, ExampleBadge, Field, LoadingBlock, type Column } from '@/components/atelier/kit'
import { Panel, StatusDot, type Tone } from '@/components/atelier/primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Select } from '@/components/ui/input'
import { ClaudeWeekPanel } from '@/components/atelier/ClaudeUsage'
import { CliAccountsPanel } from '@/components/orchestra/CliAccountsPanel'
import { DirectorBackendPanel } from '@/components/orchestra/DirectorBackendPanel'
import { RealEnginePanel } from '@/components/orchestra/RealEnginePanel'
import { toast } from '@/lib/toast'
import { call, errText, useLoader } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { SettingsPage, fmtTime } from './common'

const TONE: Record<ClaudeProfile['status'], Tone> = { ready: 'ok', limited: 'warn', unset: 'off' }

export function profileStatusText(p: Pick<ClaudeProfile, 'status' | 'limitedUntil'>): string {
  if (p.status === 'limited' && p.limitedUntil) return t('team.claude.statusLimited', { time: fmtTime(p.limitedUntil) })
  return t(`team.claude.status${p.status[0]!.toUpperCase()}${p.status.slice(1)}` as MessageKey)
}

export const kindLabel = (k: ClaudeKind): string => t(k === 'cli' ? 'team.claude.kindCli' : 'team.claude.kindApi')

export interface ProfileActions {
  onEdit: (p: ClaudeProfile) => void
  onRemove: (p: ClaudeProfile) => void
  onDefault: (p: ClaudeProfile) => void
  onLimit: (p: ClaudeProfile, hours: number | null) => void
  onTest: (p: ClaudeProfile) => void
}

export function ProfileCard({ p, actions, testing }: { p: ClaudeProfile; actions: ProfileActions; testing: boolean }) {
  return (
    <li data-testid="claude-profile" data-status={p.status} className="flex flex-col gap-3 rounded-card border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] text-fg">{p.name}</span>
        {p.isDefault && <Badge variant="brand">{t('team.claude.default')}</Badge>}
        {p.example && <ExampleBadge />}
        <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-fg-2" data-testid="profile-status">
          <StatusDot tone={TONE[p.status]} />
          {profileStatusText(p)}
        </span>
      </div>
      <div className="text-[12px] text-fg-3">
        {kindLabel(p.kind)}
        {p.keySet !== null && ` · ${p.keySet ? t('team.claude.keySet') : t('team.claude.keyUnset')}`}
      </div>
      <div className="flex flex-wrap gap-2">
        {p.kind === 'cli' && (
          <Button size="sm" variant="secondary" disabled={testing} onClick={() => actions.onTest(p)}>
            <PlugZap aria-hidden /> {t('team.claude.test')}
          </Button>
        )}
        {!p.isDefault && (
          <Button size="sm" variant="outline" onClick={() => actions.onDefault(p)}>
            {t('team.claude.makeDefault')}
          </Button>
        )}
        {p.status === 'limited' ? (
          <Button size="sm" variant="outline" onClick={() => actions.onLimit(p, null)}>
            {t('team.claude.clearLimit')}
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => actions.onLimit(p, 1)}>
              {t('team.claude.markLimited')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => actions.onLimit(p, 5)}>
              {t('team.claude.markLimited5')}
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => actions.onEdit(p)}>
          {t('team.claude.edit')}
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={`${t('team.claude.remove')} ${p.name}`} onClick={() => actions.onRemove(p)}>
          <Trash2 aria-hidden />
        </Button>
      </div>
    </li>
  )
}

export function ProfileForm({ profile, onDone, onCancel }: { profile: ClaudeProfile | null; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(profile?.name ?? '')
  const [kind, setKind] = useState<ClaudeKind>(profile?.kind ?? 'cli')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    setBusy(true)
    call('claude.saveProfile', {
      ...(profile ? { id: profile.id } : {}),
      name,
      kind,
      ...(kind === 'api' && apiKey.trim() !== '' ? { apiKey } : {})
    })
      .then(() => {
        setApiKey('')
        onDone()
      }, (err: unknown) => setError(errText(err)))
      .finally(() => setBusy(false))
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="profile-form">
      <Field label={t('team.claude.name')} htmlFor="cp-name">
        <Input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label={t('team.claude.kind')} htmlFor="cp-kind">
        <Select id="cp-kind" value={kind} disabled={profile !== null} onChange={(e) => setKind(e.target.value as ClaudeKind)}>
          <option value="cli">{t('team.claude.kindCli')}</option>
          <option value="api">{t('team.claude.kindApi')}</option>
        </Select>
      </Field>
      {kind === 'api' && (
        <Field label={t('team.claude.apiKey')} htmlFor="cp-key" hint={profile?.keySet ? t('team.claude.apiKeyKeep') : undefined}>
          <Input id="cp-key" type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-ant-…" />
        </Field>
      )}
      {error && <ErrorLine message={error} />}
      <DialogFooter className="justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('team.team.cancel')}
        </Button>
        <Button type="submit" disabled={busy}>
          {t('team.team.save')}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function RoutingTable({ rows, profiles, onChange }: { rows: readonly ClaudeRoutingRow[]; profiles: readonly ClaudeProfile[]; onChange: (role: string, profileId: number | null) => void }) {
  const columns: Column<ClaudeRoutingRow>[] = [
    { key: 'role', header: t('team.claude.colRole'), cell: (r) => <span className="text-fg">{r.name}</span> },
    { key: 'tier', header: t('team.claude.colTier'), cell: (r) => t(`team.claude.tier${r.tier[0]!.toUpperCase()}${r.tier.slice(1)}` as MessageKey) },
    {
      key: 'profile',
      header: t('team.claude.colProfile'),
      cell: (r) => (
        <Select aria-label={`${t('team.claude.colProfile')} ${r.name}`} className="w-64" value={r.profileId ?? ''} onChange={(e) => onChange(r.role, e.target.value === '' ? null : Number(e.target.value))}>
          <option value="">{t('team.claude.useDefault')}</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      )
    }
  ]
  return <DataTable testId="routing-table" columns={columns} rows={rows} rowKey={(r) => r.role} />
}

export function ClaudeScreen(_props: ScreenProps) {
  const profiles = useLoader(() => call('claude.profiles'), 'claude-profiles', ['team', 'example'])
  const confirm = useConfirm()
  const [editing, setEditing] = useState<ClaudeProfile | 'new' | null>(null)
  const [testing, setTesting] = useState(false)

  const fail = (e: unknown): void => {
    toast.error(errText(e))
  }
  const actions: ProfileActions = {
    onEdit: (p) => setEditing(p),
    onRemove: (p) => {
      void confirm({ title: t('team.claude.removeTitle', { name: p.name }), description: t('team.claude.removeBody'), danger: true, confirmLabel: t('team.claude.remove') }).then((ok) => {
        if (ok) call('claude.removeProfile', p.id).then(() => toast.success(t('team.claude.removed')), fail)
      })
    },
    onDefault: (p) => {
      call('claude.saveProfile', { id: p.id, name: p.name, kind: p.kind, isDefault: true }).then(() => toast.success(t('team.claude.saved')), fail)
    },
    onLimit: (p, hours) => {
      const until = hours === null ? null : new Date(Date.now() + hours * 3_600_000).toISOString()
      call('claude.setLimit', p.id, until).then(() => toast.success(t(hours === null ? 'team.claude.limitCleared' : 'team.claude.limitSet')), fail)
    },
    onTest: () => {
      setTesting(true)
      call('providers.test', 'claude-code')
        .then((r) => {
          if (r.ok) toast.success(t('team.claude.testOk', { ms: r.latencyMs }))
          else toast.error(t('team.claude.testFail', { message: r.message }))
        }, fail)
        .finally(() => setTesting(false))
    }
  }

  // The accounts above and the director's switch are how the team connects to Claude now; the old profiles and the 25-role
  // routing table no longer decide anything (QA D2). Profiles stay visible only for someone who still has an API-key one.
  const showProfiles = (profiles.data ?? []).some((p) => p.kind === 'api')
  return (
    <SettingsPage
      page="claude"
      subtitle={t('team.claude.subtitle')}
      actions={
        showProfiles ? (
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> {t('team.claude.add')}
          </Button>
        ) : undefined
      }
    >
      <RealEnginePanel />
      <CliAccountsPanel />
      <ClaudeWeekPanel />
      <DirectorBackendPanel />
      {showProfiles && (
      <Panel title={t('team.claude.profiles')}>
        <p className="mb-3 text-[12px] text-fg-3">{t('team.claude.limitNote')}</p>
        {profiles.error ? (
          <ErrorLine message={profiles.error} onRetry={profiles.reload} />
        ) : !profiles.data ? (
          <LoadingBlock rows={2} />
        ) : profiles.data.length === 0 ? (
          <p className="text-[13px] text-fg-3">{t('team.claude.empty')}</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {profiles.data.map((p) => (
              <ProfileCard key={p.id} p={p} actions={actions} testing={testing} />
            ))}
          </ul>
        )}
      </Panel>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing === 'new' || editing === null ? t('team.claude.add') : t('team.claude.edit')}</DialogTitle>
            <DialogDescription>{t('team.claude.subtitle')}</DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <ProfileForm
              key={editing === 'new' ? 'new' : editing.id}
              profile={editing === 'new' ? null : editing}
              onCancel={() => setEditing(null)}
              onDone={() => {
                setEditing(null)
                toast.success(t('team.claude.saved'))
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </SettingsPage>
  )
}
