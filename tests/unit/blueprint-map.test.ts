// The published blueprint onto the app: agents → the runtime's roles and tiers, free-text routines → cron, pipelines → drawing
// steps (with the founder's `kind` or a flagged guess), and the contract's new optional `kind` (the console's v3 data stays valid).
import { describe, expect, it } from 'vitest'
import { guessKind, KIND_LABEL, kindWarnings, NODE_KINDS, PUBLISHED_V3, validateBlueprint, type Blueprint as ConsoleBlueprint } from '../../web/src/admin/blueprint'
import { mapAgents, mapPipelines, parseRoutine, ROLE_TABLE, runtimeRoleOf, TIER_TABLE, type BlueprintDoc } from '../../src/main/blueprint/map'
import { CHANNEL_TEAM, PRINCIPAL_TEAM, type SeedNode } from '../../src/main/orchestra/roles'
import { guessDrawingKind } from '../../src/shared/blueprint'
import { Blueprint, BLUEPRINT_NODE_KINDS } from '../../src/shared/cloud-api'
import { DRAWING_KINDS } from '../../src/shared/pipeline-drawing'

const v3 = Blueprint.parse(PUBLISHED_V3) as BlueprintDoc

const flat = (nodes: readonly SeedNode[]): string[] => nodes.flatMap((n) => [n.role, ...flat(n.children ?? [])])

describe('contract: the optional step kind', () => {
  it('the console’s existing v3 data is still valid for the console and for the Cloud', () => {
    expect(validateBlueprint(PUBLISHED_V3)).toEqual([])
    expect(Blueprint.safeParse(PUBLISHED_V3).success).toBe(true)
  })

  it('a kind is kept by the Cloud’s schema (not stripped) and an unknown one is refused', () => {
    const withKind = structuredClone(PUBLISHED_V3) as ConsoleBlueprint
    withKind.pipelines[0]!.nodes[0]!.kind = 'idea'
    expect(Blueprint.parse(withKind).pipelines[0]!.nodes[0]!.kind).toBe('idea')
    expect(validateBlueprint(withKind)).toEqual([])
    const bad = structuredClone(withKind) as unknown as { pipelines: { nodes: { kind: string }[] }[] }
    bad.pipelines[0]!.nodes[0]!.kind = 'teleport'
    expect(Blueprint.safeParse(bad).success).toBe(false)
    expect(validateBlueprint(bad).map((i) => i.path)).toEqual(['pipelines[0].nodes[0].kind'])
  })

  it('the Cloud’s kinds, the console’s kinds and the drawing’s kinds are the same list', () => {
    expect([...BLUEPRINT_NODE_KINDS]).toEqual([...DRAWING_KINDS])
    expect([...NODE_KINDS]).toEqual([...DRAWING_KINDS])
    expect(Object.keys(KIND_LABEL).sort()).toEqual([...DRAWING_KINDS].sort())
  })

  it('the console’s label heuristic and the app’s give the same kind for every label of v3 and for odd ones', () => {
    const labels = [...PUBLISHED_V3.pipelines.flatMap((p) => p.nodes.map((n) => n.label)), 'Sous-titres', 'Carte d’intro', 'Gameplay Minecraft', 'Machin', 'Compte à rebours', 'Traduction EN']
    for (const l of labels) expect(guessKind(l), l).toEqual(guessDrawingKind(l))
  })

  it('the console warns for each step without a kind, naming what the app will deduce', () => {
    const warnings = kindWarnings(PUBLISHED_V3)
    expect(warnings).toHaveLength(PUBLISHED_V3.pipelines.reduce((n, p) => n + p.nodes.length, 0))
    expect(warnings[0]).toMatchObject({ path: 'pipelines[0].nodes[0].kind' })
    expect(warnings[0]!.message).toContain('Sujet')
    const explicit = structuredClone(PUBLISHED_V3)
    for (const p of explicit.pipelines) for (const n of p.nodes) n.kind = guessKind(n.label).kind
    expect(kindWarnings(explicit)).toEqual([])
    const unknown = structuredClone(explicit)
    delete unknown.pipelines[0]!.nodes[0]!.kind
    unknown.pipelines[0]!.nodes[0]!.label = 'Zorglub'
    expect(kindWarnings(unknown)[0]!.message).toContain('générique')
  })
})

describe('agents: blueprint → runtime roles', () => {
  it('the explicit table feeds roles the runtime really seeds', () => {
    const seeded = new Set(['principal', 'channel_lead', ...flat(PRINCIPAL_TEAM), ...flat(CHANNEL_TEAM)])
    for (const [id, role] of Object.entries(ROLE_TABLE)) expect(seeded.has(role), `${id} → ${role}`).toBe(true)
    expect(ROLE_TABLE).toMatchObject({
      atlas: 'principal',
      'chef-chaine': 'channel_lead',
      sujets: 'researcher',
      scenariste: 'scriptwriter',
      realisateur: 'director',
      monteur: 'video_producer',
      miniatures: 'packaging',
      analyse: 'competitor_analyst',
      qualite: 'qc_eye'
    })
  })

  it('tiers: fast → Haiku, balanced → Sonnet, deep → Opus (the runtime’s fast / balanced / best)', () => {
    expect(TIER_TABLE).toEqual({ fast: 'fast', balanced: 'balanced', deep: 'best' })
  })

  it('maps the console’s nine agents; a runtime role id also matches directly; the others are templates to recruit', () => {
    const m = mapAgents(v3)
    expect(m.agents.map((a) => `${a.id}→${a.runtimeRole}`)).toEqual([
      'atlas→principal',
      'chef-chaine→channel_lead',
      'sujets→researcher',
      'scenariste→scriptwriter',
      'realisateur→director',
      'monteur→video_producer',
      'miniatures→packaging',
      'analyse→competitor_analyst',
      'qualite→qc_eye'
    ])
    expect(m.recruitable).toEqual([])
    expect(m.defaults.get('principal')).toMatchObject({ blueprintId: 'atlas', tier: 'best' })
    expect(m.defaults.get('researcher')).toMatchObject({ tier: 'fast' })
    expect(m.defaults.get('scriptwriter')).toMatchObject({ tier: 'balanced' })

    expect(runtimeRoleOf('publisher')).toBe('publisher')
    expect(runtimeRoleOf('sponsor-manager')).toBe('sponsor_manager')
    const extra = Blueprint.parse({
      ...PUBLISHED_V3,
      agents: [...PUBLISHED_V3.agents, { id: 'community', role: 'Community manager', tier: 'fast', routines: [], instructions: 'Tu réponds aux commentaires.' }, { id: 'sujets-2', role: 'Autre', tier: 'fast', routines: [], instructions: 'x' }, { id: 'publisher', role: 'Publication', tier: 'fast', routines: [], instructions: 'Tu prépares.' }]
    }) as BlueprintDoc
    const m2 = mapAgents(extra)
    expect(m2.recruitable.map((a) => a.id)).toEqual(['community', 'sujets-2'])
    expect(m2.recruitable.every((a) => a.runtimeRole === null)).toBe(true)
    expect(m2.defaults.get('publisher')).toMatchObject({ blueprintId: 'publisher' })
  })

  it('two blueprint agents on one role: the first feeds it, the second is a template', () => {
    const dup = Blueprint.parse({ ...PUBLISHED_V3, agents: [PUBLISHED_V3.agents[2], { ...PUBLISHED_V3.agents[2]!, id: 'researcher' }] }) as BlueprintDoc
    const m = mapAgents(dup)
    expect(m.defaults.get('researcher')?.blueprintId).toBe('sujets')
    expect(m.recruitable.map((a) => a.id)).toEqual(['researcher'])
  })
})

describe('routines: French sentences → cron', () => {
  it('a time alone is every day; a weekday alone is 09:00; « chaque jour » is 08:00', () => {
    expect(parseRoutine('Point du matin à 8 h', 'principal')).toEqual({ name: 'Point du matin à 8 h', cron: '0 8 * * *', kind: 'digest' })
    expect(parseRoutine('Résumé de la semaine le dimanche', 'principal')).toMatchObject({ cron: '0 9 * * 0' })
    expect(parseRoutine('Chercher 10 sujets chaque lundi', 'researcher')).toEqual({ name: 'Chercher 10 sujets chaque lundi', cron: '0 9 * * 1', kind: 'research' })
    expect(parseRoutine('Regarder les nouvelles vidéos des concurrents chaque jour', 'competitor_analyst')).toMatchObject({ cron: '0 8 * * *', kind: 'competitor_scan' })
    expect(parseRoutine('Rapport à 7h30 le mardi et le jeudi', 'channel_lead')).toMatchObject({ cron: '30 7 * * 2,4' })
  })

  it('a sentence with no time of its own is not scheduled and a nonsense hour is refused', () => {
    expect(parseRoutine('Vérifier le style avant chaque publication', 'channel_lead')).toBeNull()
    expect(parseRoutine('Écrire le script après validation du sujet', 'scriptwriter')).toBeNull()
    expect(parseRoutine('Point à 27 h', 'principal')).toBeNull()
  })

  it('scheduled routines become routines; the others are rules appended to the instructions', () => {
    const m = mapAgents(v3)
    const atlas = m.defaults.get('principal')!
    expect(atlas.routines.map((r) => r.cron)).toEqual(['0 8 * * *', '0 9 * * 0'])
    expect(atlas.instructions).toBe(v3.agents[0]!.instructions)
    const lead = m.defaults.get('channel_lead')!
    expect(lead.routines.map((r) => r.cron)).toEqual(['0 9 * * 1'])
    expect(lead.instructions).toContain('Routines :\n- Vérifier le style avant chaque publication')
    expect(m.defaults.get('scriptwriter')!.routines).toEqual([])
    expect(m.defaults.get('scriptwriter')!.instructions).toContain('- Écrire le script après validation du sujet')
  })

  it('an empty instruction falls back to the built-in text of the role', () => {
    const empty = Blueprint.parse({ ...PUBLISHED_V3, agents: [{ ...PUBLISHED_V3.agents[2], instructions: '' }] }) as BlueprintDoc
    expect(mapAgents(empty).defaults.get('researcher')!.instructions.length).toBeGreaterThan(20)
  })
})

describe('pipelines: blueprint → drawing steps', () => {
  it('the founder’s kind wins and is marked; otherwise the label decides and is marked as guessed', () => {
    const bp = structuredClone(v3)
    bp.pipelines[0]!.nodes[0]!.kind = 'human-input' // « Sujet » drawn as something the user provides
    const [doc] = mapPipelines(bp)
    expect(doc!.steps[0]).toMatchObject({ id: 'sujet', kind: 'human-input', kindSource: 'blueprint' })
    expect(doc!.steps[1]).toMatchObject({ id: 'script', kind: 'script', kindSource: 'guessed' })
  })

  it('maps the runner, the validation gate, the provider and the credits; unmatched labels become a generic code step', () => {
    const views = mapPipelines(v3)
    expect(views.map((p) => p.id)).toEqual(['documentaire-narre', 'reddit-gameplay', 'top-10'])
    const docu = views[0]!
    expect(docu.credits).toBe(40 + 180 + 140 + 60 + 25)
    expect(docu.steps.map((s) => s.kind)).toEqual(['idea', 'script', 'director', 'stock', 'image-gen', 'voice', 'edit', 'thumbnail', 'qc'])
    expect(docu.steps[0]).toMatchObject({ runner: 'agent', gate: true, provider: 'Claude Code' })
    expect(docu.steps[3]).toMatchObject({ runner: 'api', gate: false, credits: 40 })
    expect(docu.steps[6]).toMatchObject({ runner: 'code', gate: false })
    expect(views[1]!.steps.map((s) => s.kind)).toContain('captions')
    const odd = structuredClone(v3)
    odd.pipelines[0]!.nodes[0]!.label = 'Zorglub'
    expect(mapPipelines(odd)[0]!.steps[0]).toMatchObject({ kind: 'code', kindSource: 'guessed' })
  })

  it('every kind it produces is one the drawing accepts', () => {
    for (const p of mapPipelines(v3)) for (const s of p.steps) expect(DRAWING_KINDS).toContain(s.kind)
  })
})
