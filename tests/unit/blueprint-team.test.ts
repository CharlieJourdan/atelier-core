// The published blueprint on the team: NEW agents are seeded from it (instructions, tier, routines), EXISTING agents keep their
// own settings until the user applies a version, and an agent edited by hand is only replaced when the user picks it. Through
// the real core and the real `atelier:call` dispatcher; the Cloud connection is faked by the cache the service reads.
import { describe, expect, it } from 'vitest'
import { CACHE_KEY } from '../../src/main/blueprint/service'
import { handleCall } from '../../src/main/ipc'
import { ACCESS_SECRET, REFRESH_SECRET } from '../../src/main/cloud/session'
import { roleInfo } from '../../src/main/orchestra/roles'
import type { BlueprintApplyResult, BlueprintPlan } from '../../src/shared/blueprint'
import { Blueprint } from '../../src/shared/cloud-api'
import { PUBLISHED_V3 } from '../../web/src/admin/blueprint'
import { agentBySlug, rig, type Rig } from './orchestra-helpers'

type Json = Parameters<Rig['core']['context']['settings']['set']>[1]

/** The app is connected to a Cloud (tokens present) whose current blueprint is `version`. */
function publish(r: Rig, version: number, edit: (bp: ReturnType<typeof structuredClone<typeof PUBLISHED_V3>>) => void = () => undefined): void {
  const { settings, secrets } = r.core.context
  secrets.set(ACCESS_SECRET, 'a')
  secrets.set(REFRESH_SECRET, 'b')
  const doc = structuredClone(PUBLISHED_V3)
  doc.version = version
  edit(doc)
  const parsed = Blueprint.parse(doc)
  settings.set(CACHE_KEY, { baseUrl: r.core.cloud.session.baseUrl(), version, publishedAt: '2026-10-23T10:00:00.000Z', fetchedAt: '2026-10-26T08:00:00.000Z', blueprint: parsed } as unknown as Json)
}

const call = async <T>(r: Rig, m: string, ...args: unknown[]): Promise<T> => {
  const res = await handleCall(r.core.api, m, args)
  // the screen gets the French `message`; the precise reason travels in `detail` (brain route, headless server, brain-run)
  if (!res.ok) throw new Error(res.error.detail ?? res.error.message)
  return res.value as T
}
const plan = (r: Rig): Promise<BlueprintPlan> => call(r, 'cloud.blueprintPlan')
const routineNames = (r: Rig, slug: string): string[] => r.core.orchestra.parts.routines.list(agentBySlug(r, slug).id).map((x) => x.name)

describe('seeding from the published blueprint', () => {
  it('without a blueprint the seed is exactly the built-in team', () => {
    const r = rig()
    const principal = agentBySlug(r, 'principal')
    expect(principal.instructions).toBe(roleInfo('principal').instructions)
    expect(principal.policy).toEqual({})
    expect(routineNames(r, 'principal')).toEqual(['Digest quotidien'])
    expect(routineNames(r, `lead-${r.channels[0]}`)).toEqual(['Idées du lundi'])
  })

  it('not connected (a cache left by a previous connection is ignored): the built-in team', () => {
    const r = rig({ seed: false })
    publish(r, 3)
    r.core.context.secrets.clear(ACCESS_SECRET)
    r.core.orchestra.seed()
    expect(agentBySlug(r, 'principal').instructions).toBe(roleInfo('principal').instructions)
  })

  it('new agents get the blueprint’s instructions, model tier and routines; roles it does not cover keep the built-in text', () => {
    const r = rig({ seed: false })
    publish(r, 3)
    r.core.orchestra.seed()
    const ch = r.channels[0]!
    const principal = agentBySlug(r, 'principal')
    expect(principal.instructions).toContain(PUBLISHED_V3.agents[0]!.instructions)
    expect(principal.policy).toEqual({ tier: 'best' }) // deep → the runtime's best tier (Opus through the tier map)
    expect(agentBySlug(r, `researcher-${ch}`).policy).toEqual({ tier: 'fast' })
    expect(agentBySlug(r, `scriptwriter-${ch}`).policy).toEqual({ tier: 'balanced' })
    expect(agentBySlug(r, `packaging-${ch}`).instructions).toContain(PUBLISHED_V3.agents[6]!.instructions)
    expect(agentBySlug(r, `qc-eye-${ch}`).policy).toEqual({ tier: 'fast' })
    // not in the blueprint: untouched
    expect(agentBySlug(r, `production-supervisor-${ch}`).instructions).toBe(roleInfo('production_supervisor').instructions)
    expect(agentBySlug(r, `production-supervisor-${ch}`).policy).toEqual({})
    expect(agentBySlug(r, 'pipeline-architect').policy).toEqual({})
    // scheduled routines come from the blueprint and replace the built-in ones of those roles
    expect(routineNames(r, 'principal')).toEqual(['Point du matin à 8 h', 'Résumé de la semaine le dimanche'])
    expect(routineNames(r, `lead-${ch}`)).toEqual(['Planifier la semaine le lundi'])
    expect(routineNames(r, `researcher-${ch}`)).toEqual(['Chercher 10 sujets chaque lundi'])
    expect(routineNames(r, `competitor-analyst-${ch}`)).toEqual(['Regarder les nouvelles vidéos des concurrents chaque jour'])
    // a routine with no time stays a rule in the instructions
    expect(agentBySlug(r, `lead-${ch}`).instructions).toContain('- Vérifier le style avant chaque publication')
    const cron = r.core.orchestra.parts.routines.list(principal.id).map((x) => x.cron)
    expect(cron).toEqual(['0 8 * * *', '0 9 * * 0'])
    // what the seed wrote counts as « applied »: nothing to apply
    return plan(r).then((p) => expect(p).toMatchObject({ version: 3, changes: [], appliedVersion: 3 }))
  })

  it('a channel added later gets its team from the blueprint too', async () => {
    const r = rig({ seed: false })
    publish(r, 3)
    r.core.orchestra.seed()
    const id = Number(r.core.db.prepare("INSERT INTO channels (name, niche, standards) VALUES ('Science', 'science', '')").run().lastInsertRowid)
    r.core.orchestra.seed()
    expect(agentBySlug(r, `researcher-${id}`).policy).toEqual({ tier: 'fast' })
    expect(routineNames(r, `researcher-${id}`)).toEqual(['Chercher 10 sujets chaque lundi'])
    expect((await plan(r)).changes).toEqual([])
  })
})

describe('« Appliquer la version N »', () => {
  /** A team seeded before any blueprint existed, then a published version 3. */
  function oldTeam(): Rig {
    const r = rig()
    publish(r, 3)
    return r
  }

  it('existing agents are not touched by a new seed or a new version; the plan lists what would change, per agent', async () => {
    const r = oldTeam()
    const before = r.core.orchestra.agents().map((a) => [a.slug, a.instructions, a.policy])
    r.core.orchestra.seed()
    expect(r.core.orchestra.agents().map((a) => [a.slug, a.instructions, a.policy])).toEqual(before)
    const p = await plan(r)
    expect(p.version).toBe(3)
    expect(p.appliedVersion).toBeNull()
    expect(p.changes).toHaveLength(17) // principal + 2 × (lead, researcher, scriptwriter, director, editor, packaging, analyst, qc)
    const researcher = p.changes.find((c) => c.slug === `researcher-${r.channels[0]}`)!
    expect(researcher).toMatchObject({ blueprintId: 'sujets', handEdited: false, tier: { from: null, to: 'fast' } })
    expect(researcher.instructions?.to).toContain(PUBLISHED_V3.agents[2]!.instructions)
    expect(researcher.instructions?.from).toBe(roleInfo('researcher').instructions)
    expect(researcher.routines).toEqual(['Chercher 10 sujets chaque lundi'])
    expect(p.changes.some((c) => c.slug.startsWith('production-supervisor'))).toBe(false)
  })

  it('applies only the agents the user picked and brings them to the version, routines included', async () => {
    const r = oldTeam()
    const ch = r.channels[0]!
    const researcher = agentBySlug(r, `researcher-${ch}`)
    const other = agentBySlug(r, `researcher-${r.channels[1]}`)
    const result = await call<BlueprintApplyResult>(r, 'cloud.blueprintApply', 3, [researcher.id])
    expect(result).toEqual({ version: 3, applied: 1, skipped: 0 })
    const after = r.core.orchestra.parts.tree.get(researcher.id)
    expect(after.instructions).toContain(PUBLISHED_V3.agents[2]!.instructions)
    expect(after.policy).toEqual({ tier: 'fast' })
    expect(routineNames(r, researcher.slug)).toContain('Chercher 10 sujets chaque lundi')
    // the other researcher is as it was
    expect(r.core.orchestra.parts.tree.get(other.id).instructions).toBe(roleInfo('researcher').instructions)
    const p = await plan(r)
    expect(p.changes.some((c) => c.agentId === researcher.id)).toBe(false)
    expect(p.changes.some((c) => c.agentId === other.id)).toBe(true)
    expect(p.appliedVersion).toBe(3)
    // applying again, or an agent that is not in the plan, changes nothing
    expect(await call<BlueprintApplyResult>(r, 'cloud.blueprintApply', 3, [researcher.id])).toEqual({ version: 3, applied: 0, skipped: 1 })
  })

  it('an agent edited by hand is flagged and never replaced unless the user picks it', async () => {
    const r = oldTeam()
    const ch = r.channels[0]!
    const mine = agentBySlug(r, `scriptwriter-${ch}`)
    const tuned = agentBySlug(r, `director-${ch}`)
    r.core.orchestra.updateAgent(mine.id, { instructions: 'Mon style à moi : phrases courtes.' })
    r.core.orchestra.updateAgent(tuned.id, { policy: { tier: 'fast' } }) // a model chosen by hand counts too
    const p = await plan(r)
    expect(p.changes.find((c) => c.agentId === mine.id)).toMatchObject({ handEdited: true })
    expect(p.changes.find((c) => c.agentId === tuned.id)).toMatchObject({ handEdited: true })
    expect(p.changes.filter((c) => c.handEdited)).toHaveLength(2)

    // « apply to everyone not edited by hand »: the screen sends exactly those ids
    const ids = p.changes.filter((c) => !c.handEdited).map((c) => c.agentId)
    const result = await call<BlueprintApplyResult>(r, 'cloud.blueprintApply', 3, ids)
    expect(result.applied).toBe(15)
    expect(r.core.orchestra.parts.tree.get(mine.id).instructions).toBe('Mon style à moi : phrases courtes.')
    expect(r.core.orchestra.parts.tree.get(tuned.id).policy).toEqual({ tier: 'fast' })
    const rest = await plan(r)
    expect(rest.changes.map((c) => c.agentId).sort()).toEqual([mine.id, tuned.id].sort())

    // the user explicitly picks the edited one
    await call(r, 'cloud.blueprintApply', 3, [mine.id])
    expect(r.core.orchestra.parts.tree.get(mine.id).instructions).toContain(PUBLISHED_V3.agents[3]!.instructions)
    expect((await plan(r)).changes.map((c) => c.agentId)).toEqual([tuned.id])
  })

  it('a later version shows only what changed since the last apply, without calling the untouched agents « edited by hand »', async () => {
    const r = oldTeam()
    const all = (await plan(r)).changes.map((c) => c.agentId)
    await call(r, 'cloud.blueprintApply', 3, all)
    expect((await plan(r)).changes).toEqual([])
    publish(r, 4, (bp) => {
      bp.agents.find((a) => a.id === 'qualite')!.tier = 'balanced'
      bp.agents.find((a) => a.id === 'monteur')!.instructions = 'Tu montes vite et propre.'
    })
    const p = await plan(r)
    expect(p.version).toBe(4)
    expect(p.changes.every((c) => !c.handEdited)).toBe(true)
    expect(p.changes.map((c) => c.blueprintId).sort()).toEqual(['monteur', 'monteur', 'qualite', 'qualite'])
    expect(p.changes.find((c) => c.blueprintId === 'qualite')).toMatchObject({ tier: { from: 'fast', to: 'balanced' } })
    expect(p.changes.find((c) => c.blueprintId === 'qualite')?.instructions).toBeUndefined()
  })

  it('agents created by hand are never part of the plan', async () => {
    const r = oldTeam()
    const principal = agentBySlug(r, 'principal')
    const mine = r.core.orchestra.createAgent({ name: 'Mon recherchiste', role: 'researcher', parentId: principal.id })
    const p = await plan(r)
    expect(p.changes.some((c) => c.agentId === mine.id)).toBe(false)
    const result = await call<BlueprintApplyResult>(r, 'cloud.blueprintApply', 3, [mine.id])
    expect(result.applied).toBe(0)
  })

  it('refuses a version that is no longer the published one, bad ids, and a team with no blueprint', async () => {
    const r = oldTeam()
    await expect(call(r, 'cloud.blueprintApply', 2, [1])).rejects.toThrow(/version changed/)
    await expect(call(r, 'cloud.blueprintApply', 3, 'all')).rejects.toThrow(/list of agent ids/)
    r.core.context.secrets.clear(REFRESH_SECRET)
    expect(await plan(r)).toEqual({ version: null, changes: [], appliedVersion: null })
    await expect(call(r, 'cloud.blueprintApply', 3, [1])).rejects.toThrow()
  })
})
