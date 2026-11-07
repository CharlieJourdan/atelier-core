// Lot Z1, team area: members and devices, Claude profiles and routing, the admin overview, the example seed and the IPC contract.
import { afterEach, describe, expect, it } from 'vitest'
import { TEAM_METHODS } from '../../src/shared/api'
import type { ChangeTopic } from '../../src/shared/api'
import { next1430 } from '../../src/main/example/team'
import { memoryCore, testCipher } from './helpers'

const cores: ReturnType<typeof memoryCore>[] = []
function core(extra: Parameters<typeof memoryCore>[0] = {}) {
  const c = memoryCore(extra)
  cores.push(c)
  return c
}
afterEach(() => {
  for (const c of cores.splice(0)) c.close()
})

describe('team API contract', () => {
  it('lists its IPC methods (one comment per method)', () => {
    expect([...TEAM_METHODS]).toEqual([
      'team.members', // members of the team (the local owner is created on first use)
      'team.invite', // stores an invitation locally, no e-mail
      'team.updateMember', // role and monthly credits cap
      'team.removeMember', // removes a member (never the owner)
      'team.devices', // devices, this one flagged and refreshed
      'team.revokeDevice', // revokes another device
      'claude.profiles', // Claude connections (CLI subscription or API key)
      'claude.saveProfile', // creates or edits a profile; the key goes to the secrets store
      'claude.removeProfile', // deletes a profile and its key
      'claude.setLimit', // manual « limite atteinte » or clear
      'claude.routing', // role → profile table with the model tier of each role
      'claude.setRouting', // attaches a role to a profile
      'admin.overview' // owner only: local price grid and credits granted
    ])
  })

  it('has a handler for every method', () => {
    const c = core()
    for (const m of TEAM_METHODS) expect(typeof c.api[m], m).toBe('function')
  })

  it('notifies the team topic after every write', async () => {
    const topics: ChangeTopic[] = []
    const c = core({ notify: (t) => topics.push(t) })
    await c.api['team.invite']({ name: 'Zoé', email: 'zoe@exemple.fr', role: 'member' })
    const p = await c.api['claude.saveProfile']({ name: 'Autre', kind: 'cli' })
    await c.api['claude.setRouting']('scriptwriter', p.id)
    expect(topics.filter((t) => t === 'team')).toHaveLength(3)
  })
})

describe('members and devices', () => {
  it('creates the local owner on first use and lists it first', async () => {
    const c = core()
    const list = await c.api['team.members']()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ role: 'owner', status: 'active', self: true, email: null, example: false })
  })

  it('invites, updates the role and cap, and removes a member', async () => {
    const c = core()
    const m = await c.api['team.invite']({ name: '  Zoé Petit ', email: 'Zoe@Exemple.fr', role: 'member', monthlyCap: 500 })
    expect(m).toMatchObject({ name: 'Zoé Petit', email: 'zoe@exemple.fr', role: 'member', status: 'invited', monthlyCap: 500, self: false })
    const up = await c.api['team.updateMember'](m.id, { role: 'admin', monthlyCap: null })
    expect(up).toMatchObject({ role: 'admin', monthlyCap: null })
    expect((await c.api['team.members']()).map((x) => x.name)).toEqual(['Vous', 'Zoé Petit'])
    await c.api['team.removeMember'](m.id)
    expect(await c.api['team.members']()).toHaveLength(1)
  })

  it('refuses bad input with French messages', async () => {
    const c = core()
    const ok = { name: 'Zoé', email: 'zoe@exemple.fr', role: 'member' as const }
    await c.api['team.invite'](ok)
    expect(() => c.api['team.invite'](ok)).toThrow('déjà dans l’équipe')
    expect(() => c.api['team.invite']({ ...ok, email: 'pas-une-adresse' })).toThrow('format invalide')
    expect(() => c.api['team.invite']({ ...ok, email: 'a@b.fr', name: '  ' })).toThrow('obligatoire')
    expect(() => c.api['team.invite']({ ...ok, email: 'a@b.fr', role: 'owner' as never })).toThrow('Rôle')
    expect(() => c.api['team.invite']({ ...ok, email: 'a@b.fr', monthlyCap: -3 })).toThrow('Plafond mensuel')
    expect(() => c.api['team.invite']({ ...ok, email: 'a@b.fr', monthlyCap: 1.5 })).toThrow('Plafond mensuel')
    expect(() => c.api['team.invite'](null as never)).toThrow('Invitation invalide')
    expect(() => c.api['team.updateMember'](999, { monthlyCap: 1 })).toThrow('Membre introuvable')
    expect(() => c.api['team.updateMember']('x' as never, {})).toThrow('identifiant invalide')
    expect(() => c.api['team.removeMember'](999)).toThrow('Membre introuvable')
  })

  it('protects the owner', async () => {
    const c = core()
    const owner = (await c.api['team.members']())[0]!
    expect(() => c.api['team.removeMember'](owner.id)).toThrow('propriétaire')
    expect(() => c.api['team.updateMember'](owner.id, { role: 'member' })).toThrow('propriétaire')
    expect((await c.api['team.updateMember'](owner.id, { monthlyCap: 100 })).monthlyCap).toBe(100)
  })

  it('lists this device first, flagged, and revokes another one but never this one', async () => {
    const c = core()
    const [me] = await c.api['team.devices']()
    expect(me).toMatchObject({ current: true, example: false })
    expect(['macOS', 'Windows', 'Linux']).toContain(me!.os)
    expect(await c.api['team.devices']()).toHaveLength(1)
    expect(() => c.api['team.revokeDevice'](me!.id)).toThrow('révoqué')
    c.db.prepare("INSERT INTO team_devices (name, os, is_current) VALUES ('Autre', 'macOS', 0)").run()
    const all = await c.api['team.devices']()
    expect(all.map((d) => d.current)).toEqual([true, false])
    await c.api['team.revokeDevice'](all[1]!.id)
    expect(await c.api['team.devices']()).toHaveLength(1)
    expect(() => c.api['team.revokeDevice'](all[1]!.id)).toThrow('Appareil introuvable')
  })
})

describe('Claude profiles and routing', () => {
  it('creates the default CLI profile on first use', async () => {
    const c = core()
    expect(await c.api['claude.profiles']()).toEqual([
      { id: 1, name: 'Mon Claude Code', kind: 'cli', status: 'ready', limitedUntil: null, keySet: null, isDefault: true, example: false }
    ])
  })

  it('stores an API key as a secret and only says set / not set', async () => {
    const c = core()
    await c.api['claude.profiles']()
    const none = await c.api['claude.saveProfile']({ name: 'Clé équipe', kind: 'api' })
    expect(none).toMatchObject({ status: 'unset', keySet: false })
    const withKey = await c.api['claude.saveProfile']({ id: none.id, name: 'Clé équipe', kind: 'api', apiKey: 'sk-ant-secret-123' })
    expect(withKey).toMatchObject({ status: 'ready', keySet: true })
    expect(JSON.stringify(await c.api['claude.profiles']())).not.toContain('sk-ant-secret-123')
    expect(c.context.secrets.get(`claude.profile.${none.id}.key`)).toBe('sk-ant-secret-123')
    // Editing without a key keeps the stored one.
    expect((await c.api['claude.saveProfile']({ id: none.id, name: 'Renommée', kind: 'api' })).keySet).toBe(true)
    await c.api['claude.removeProfile'](none.id)
    expect(c.context.secrets.has(`claude.profile.${none.id}.key`)).toBe(false)
  })

  it('refuses bad profiles', async () => {
    const c = core()
    await c.api['claude.profiles']()
    expect(() => c.api['claude.saveProfile']({ name: '', kind: 'cli' })).toThrow('obligatoire')
    expect(() => c.api['claude.saveProfile']({ name: 'X', kind: 'foo' as never })).toThrow('Type de profil')
    expect(() => c.api['claude.saveProfile']({ name: 'X', kind: 'cli', apiKey: 'k' })).toThrow('clé API ne va qu’avec')
    expect(() => c.api['claude.saveProfile']({ name: 'X', kind: 'api', apiKey: '  ' })).toThrow('valeur vide')
    expect(() => c.api['claude.saveProfile']({ id: 1, name: 'X', kind: 'api' })).toThrow('ne se change pas')
    expect(() => c.api['claude.saveProfile']({ id: 77, name: 'X', kind: 'cli' })).toThrow('introuvable')
    expect(() => c.api['claude.removeProfile'](1)).toThrow('au moins un profil')
  })

  it('refuses a key when OS encryption is unavailable, without storing anything', async () => {
    const c = core({ cipher: testCipher(false) })
    await c.api['claude.profiles']()
    expect(() => c.api['claude.saveProfile']({ name: 'API', kind: 'api', apiKey: 'sk-1' })).toThrow('chiffrement')
  })

  it('moves the default and promotes another when the default is removed', async () => {
    const c = core()
    await c.api['claude.profiles']()
    const b = await c.api['claude.saveProfile']({ name: 'B', kind: 'cli', isDefault: true })
    expect(b.isDefault).toBe(true)
    expect((await c.api['claude.profiles']()).map((p) => [p.name, p.isDefault])).toEqual([['B', true], ['Mon Claude Code', false]])
    await c.api['claude.removeProfile'](b.id)
    expect((await c.api['claude.profiles']())[0]).toMatchObject({ name: 'Mon Claude Code', isDefault: true })
  })

  it('marks a profile limited by hand, then clears it; a past limit counts as ready', async () => {
    const c = core()
    // A limit that has passed counts as ready: rewrite the stored time to the past.
    const [p] = await c.api['claude.profiles']()
    const until = new Date(Date.now() + 3_600_000).toISOString()
    const limited = await c.api['claude.setLimit'](p!.id, until)
    expect(limited).toMatchObject({ status: 'limited', limitedUntil: until })
    c.db.prepare('UPDATE claude_profiles SET limited_until = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), p!.id)
    expect((await c.api['claude.profiles']())[0]).toMatchObject({ status: 'ready', limitedUntil: null })
    await c.api['claude.setLimit'](p!.id, until)
    expect((await c.api['claude.setLimit'](p!.id, null)).status).toBe('ready')
    expect(() => c.api['claude.setLimit'](p!.id, 'demain')).toThrow('invalide')
    expect(() => c.api['claude.setLimit'](p!.id, new Date(Date.now() - 5000).toISOString())).toThrow('dans le futur')
    expect(() => c.api['claude.setLimit'](p!.id, new Date(Date.now() + 30 * 86_400_000).toISOString())).toThrow('huit jours')
    expect(() => c.api['claude.setLimit'](99, until)).toThrow('introuvable')
  })

  it('routes roles to profiles next to the tier of the routes table', async () => {
    const c = core()
    const [def] = await c.api['claude.profiles']()
    const other = await c.api['claude.saveProfile']({ name: 'Autre', kind: 'cli' })
    const rows = await c.api['claude.routing']()
    const writer = rows.find((r) => r.role === 'scriptwriter')!
    expect(writer).toMatchObject({ name: 'Scénariste', tier: 'best', profileId: null })
    await c.api['claude.setRouting']('scriptwriter', other.id)
    expect((await c.api['claude.routing']()).find((r) => r.role === 'scriptwriter')!.profileId).toBe(other.id)
    await c.api['routes.set']('scriptwriter', { tier: 'fast' })
    expect((await c.api['claude.routing']()).find((r) => r.role === 'scriptwriter')!.tier).toBe('fast')
    await c.api['claude.setRouting']('scriptwriter', null)
    expect((await c.api['claude.routing']()).find((r) => r.role === 'scriptwriter')!.profileId).toBeNull()
    expect(() => c.api['claude.setRouting']('inconnu', def!.id)).toThrow('Rôle inconnu')
    expect(() => c.api['claude.setRouting']('qc', 42)).toThrow('introuvable')
    // Deleting a profile sends its roles back to the default.
    await c.api['claude.setRouting']('qc', other.id)
    await c.api['claude.removeProfile'](other.id)
    expect((await c.api['claude.routing']()).find((r) => r.role === 'qc')!.profileId).toBeNull()
  })
})

describe('admin overview', () => {
  it('shows the local price grid with credits per unit, and what was granted', async () => {
    const c = core()
    c.context.credits.grant({ amount: 100, idempotencyKey: 'a' })
    await c.api['credits.simulatePurchase']((await c.api['credits.packs']())[0]!.id, 'purchase-key-1')
    const o = await c.api['admin.overview']()
    expect(o.prices.version).toBe(1)
    expect(o.prices.lines.map((l) => l.unit)).toEqual(['chars', 'images', 'video_s', 'avatar_s', 'gpu_s', 'searches', 'watch_min'])
    for (const l of o.prices.lines) expect(l.creditsPerUnit).toBeGreaterThan(0)
    expect(o.granted.local).toBe(100)
    expect(o.granted.simulated).toBeGreaterThan(0)
    expect(o.balance.total).toBe(o.granted.local + o.granted.simulated)
  })

  it('is refused to anyone but the owner', async () => {
    const c = core()
    await c.api['team.members']()
    c.db.prepare("UPDATE team_members SET role = 'member' WHERE is_self = 1").run()
    expect(() => c.api['admin.overview']()).toThrow('réservée au propriétaire')
  })
})

describe('team example rows', () => {
  it('seeds 2 members, 1 extra device and 2 Claude profiles (one limited until 14:30), then clears them', async () => {
    const c = core()
    await c.api['example.load']()
    const members = await c.api['team.members']()
    expect(members.filter((m) => m.example).map((m) => [m.role, m.status])).toEqual([['admin', 'active'], ['member', 'invited']])
    const devices = await c.api['team.devices']()
    expect(devices.filter((d) => d.example)).toHaveLength(1)
    const profiles = await c.api['claude.profiles']()
    const ex = profiles.filter((p) => p.example)
    expect(ex).toHaveLength(2)
    const limited = ex.find((p) => p.status === 'limited')!
    const at = new Date(limited.limitedUntil!)
    expect([at.getHours(), at.getMinutes()]).toEqual([14, 30])
    expect(ex.find((p) => p.status === 'unset')).toBeDefined()
    // The real default exists and is not an example.
    expect(profiles.find((p) => p.isDefault)!.example).toBe(false)

    await c.api['example.delete']()
    expect((await c.api['team.members']()).map((m) => m.example)).toEqual([false])
    expect((await c.api['team.devices']()).filter((d) => d.example)).toHaveLength(0)
    expect((await c.api['claude.profiles']()).filter((p) => p.example)).toHaveLength(0)
  })

  it('next1430 is always in the future', () => {
    const morning = next1430(new Date(2026, 9, 20, 9, 0))
    expect([morning.getDate(), morning.getHours(), morning.getMinutes()]).toEqual([20, 14, 30])
    const evening = next1430(new Date(2026, 9, 20, 18, 0))
    expect(evening.getDate()).toBe(21)
  })
})
