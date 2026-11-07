// Claude connections of the team (lot Z1): several profiles (Claude Code subscription or Anthropic API key) and the
// routing role → profile. API keys go through the encrypted secrets store; the renderer only learns « set / not set ».
// The model tier of a role stays in the `routes` table (llm.*). Hand-off lot 14/15: the runner picks the profile of the
// role and flips « limite atteinte » itself when the CLI reports it; here the limit is set by hand.
import type { ClaudeProfile, ClaudeProfileInput, ClaudeRoutingRow, ClaudeStatus } from '../../shared/api/team'
import { ROLES } from '../../shared/roles'
import type { RoutesStore } from '../llm/routes'
import { transaction, type Db } from '../db'
import { SecretsUnavailableError, type SecretsStore } from '../secrets'
import { requireId, requireText } from './members'

interface ProfileDb {
  id: number
  name: string
  kind: 'cli' | 'api'
  limited_until: string | null
  is_default: number
  example: number
}

export const profileKeyName = (id: number): string => `claude.profile.${id}.key`

export class ClaudeStore {
  constructor(
    private readonly db: Db,
    private readonly secrets: SecretsStore,
    private readonly routes: RoutesStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  private toProfile(r: ProfileDb): ClaudeProfile {
    const keySet = r.kind === 'api' ? this.secrets.has(profileKeyName(r.id)) : null
    const limited = r.limited_until !== null && Date.parse(r.limited_until) > this.now().getTime()
    const status: ClaudeStatus = limited ? 'limited' : r.kind === 'api' && !keySet ? 'unset' : 'ready'
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      status,
      limitedUntil: limited ? r.limited_until : null,
      keySet,
      isDefault: r.is_default === 1,
      example: r.example === 1
    }
  }

  /** The user's own Claude Code is always there as the default profile until another is chosen. */
  private ensureDefault(): void {
    const real = this.db.prepare('SELECT 1 FROM claude_profiles WHERE example = 0').get()
    if (!real) this.db.prepare("INSERT INTO claude_profiles (name, kind, is_default) VALUES ('Mon Claude Code', 'cli', 1)").run()
    if (!this.db.prepare('SELECT 1 FROM claude_profiles WHERE is_default = 1').get()) {
      this.db.prepare('UPDATE claude_profiles SET is_default = 1 WHERE id = (SELECT MIN(id) FROM claude_profiles)').run()
    }
  }

  list(): ClaudeProfile[] {
    this.ensureDefault()
    const rows = this.db.prepare('SELECT * FROM claude_profiles ORDER BY is_default DESC, id').all() as unknown as ProfileDb[]
    return rows.map((r) => this.toProfile(r))
  }

  private get(id: number): ProfileDb {
    const r = this.db.prepare('SELECT * FROM claude_profiles WHERE id = ?').get(id) as ProfileDb | undefined
    if (!r) throw new Error('Profil Claude introuvable.')
    return r
  }

  save(input: ClaudeProfileInput): ClaudeProfile {
    if (!input || typeof input !== 'object') throw new Error('Profil invalide.')
    const name = requireText(input.name, 'Nom du profil', 60)
    if (input.kind !== 'cli' && input.kind !== 'api') throw new Error('Type de profil : abonnement Claude Code ou clé API.')
    if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.trim() === '')) throw new Error('Clé API : valeur vide.')
    if (input.apiKey !== undefined && input.kind !== 'api') throw new Error('Une clé API ne va qu’avec un profil de type clé API.')
    this.ensureDefault()
    const id = transaction(this.db, () => {
      let pid: number
      if (input.id !== undefined) {
        pid = requireId(input.id, 'Profil Claude')
        const cur = this.get(pid)
        if (cur.kind !== input.kind) throw new Error('Le type d’un profil ne se change pas : créez-en un autre.')
        this.db.prepare('UPDATE claude_profiles SET name = ? WHERE id = ?').run(name, pid)
      } else {
        pid = Number(this.db.prepare('INSERT INTO claude_profiles (name, kind) VALUES (?, ?)').run(name, input.kind).lastInsertRowid)
      }
      if (input.isDefault === true) {
        this.db.prepare('UPDATE claude_profiles SET is_default = 0').run()
        this.db.prepare('UPDATE claude_profiles SET is_default = 1 WHERE id = ?').run(pid)
      }
      return pid
    })
    if (input.apiKey !== undefined) {
      try {
        this.secrets.set(profileKeyName(id), input.apiKey.trim())
      } catch (e) {
        if (e instanceof SecretsUnavailableError) throw new Error('Le chiffrement du système n’est pas disponible : la clé ne peut pas être stockée.', { cause: e })
        throw e
      }
    }
    return this.toProfile(this.get(id))
  }

  remove(id: number): void {
    requireId(id, 'Profil Claude')
    const cur = this.get(id)
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM claude_profiles').get() as { n: number }).n
    if (count <= 1) throw new Error('Il faut garder au moins un profil Claude.')
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM claude_profiles WHERE id = ?').run(id)
      this.secrets.clear(profileKeyName(id))
      if (cur.is_default === 1) this.db.prepare('UPDATE claude_profiles SET is_default = 1 WHERE id = (SELECT MIN(id) FROM claude_profiles)').run()
    })
  }

  setLimit(id: number, until: string | null): ClaudeProfile {
    requireId(id, 'Profil Claude')
    this.get(id)
    if (until !== null) {
      const ms = typeof until === 'string' ? Date.parse(until) : NaN
      if (!Number.isFinite(ms)) throw new Error('Heure de reprise invalide.')
      if (ms <= this.now().getTime()) throw new Error('L’heure de reprise doit être dans le futur.')
      if (ms - this.now().getTime() > 8 * 86_400_000) throw new Error('L’heure de reprise ne peut pas dépasser huit jours.')
    }
    this.db.prepare('UPDATE claude_profiles SET limited_until = ? WHERE id = ?').run(until === null ? null : new Date(until).toISOString(), id)
    return this.toProfile(this.get(id))
  }

  routing(): ClaudeRoutingRow[] {
    const chosen = new Map((this.db.prepare('SELECT role, profile_id FROM claude_routing').all() as unknown as { role: string; profile_id: number }[]).map((r) => [r.role, r.profile_id]))
    const tiers = new Map(this.routes.list().map((r) => [r.role, r.tier]))
    return ROLES.map((d) => ({ role: d.role, name: d.name, tier: tiers.get(d.role) ?? d.defaultTier, profileId: chosen.get(d.role) ?? null }))
  }

  setRouting(role: string, profileId: number | null): void {
    if (typeof role !== 'string' || !ROLES.some((d) => d.role === role)) throw new Error('Rôle inconnu.')
    if (profileId === null) {
      this.db.prepare('DELETE FROM claude_routing WHERE role = ?').run(role)
      return
    }
    requireId(profileId, 'Profil Claude')
    this.get(profileId)
    this.db
      .prepare('INSERT INTO claude_routing (role, profile_id) VALUES (?, ?) ON CONFLICT(role) DO UPDATE SET profile_id = excluded.profile_id')
      .run(role, profileId)
  }
}
