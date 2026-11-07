// Chantier B (moteur-definition): P3 feasibility from measured screen time and P4 Style Definitions at v1-level richness
// for the five acceptance channels, with the real bricks / presenters / voices services on fixture ports (no money).
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { atPath, sourcedFields, withAtPath, type Sourced } from '../../src/shared/clone'
import { faithfulAlternatives } from '../../src/main/production/clone/definition/alternatives'
import { deriveFields } from '../../src/main/production/clone/definition/derive'
import { channelUniverse, crossCheckElements } from '../../src/main/production/clone/definition/elements'
import { FINARY, JAPANESE, MARCEL, MONDE_POV, YARNHUB } from '../../src/main/production/clone/definition/fixtures/profiles'
import { runDefinition, type DefinitionRun } from '../../src/main/production/clone/definition/fixtures/run'
import { pickSameKind } from '../../src/main/production/clone/definition/people'
import { safeDescriptors } from '../../src/main/production/clone/definition/lookalike'
import { checkP3 } from '../../src/main/production/clone/p3-feasibility'
import { checkP4 } from '../../src/main/production/clone/p4-definition'

const PROOF_DIR = process.env['CLONE_DEFINITION_PROOF_DIR']
function proof(name: string, r: DefinitionRun): void {
  if (!PROOF_DIR) return
  const dir = path.join(PROOF_DIR, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'p3-feasibility.json'), JSON.stringify(r.feasibility, null, 2) + '\n')
  writeFileSync(path.join(dir, 'p4-style-definition.json'), JSON.stringify(r.definition, null, 2) + '\n')
  const fields = sourcedFields(r.definition)
  writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    verdict: r.feasibility.verdict, brickShare: r.feasibility.brickShare, reproducibleShare: r.feasibility.reproducibleShare,
    elements: r.feasibility.elements.map((e) => ({ id: e.id, share: e.screenShare.value, how: e.how, brick: e.brick, slot: e.slot?.kind ?? null })),
    fields: fields.length, measured: fields.filter((f) => f.field.source === 'measured').length, user: fields.filter((f) => f.field.source === 'user').length,
    defaults: fields.filter((f) => f.field.source === 'default').map((f) => f.path)
  }, null, 2) + '\n')
}

const ok = (r: DefinitionRun): void => {
  expect(checkP3(r.feasibility, r.analyses).problems).toEqual([])
  expect(checkP4(r.definition, r.synthesis, r.brief, [], r.analyses).problems).toEqual([])
}
const measuredCount = (r: DefinitionRun): number => sourcedFields(r.definition).filter((f) => f.field.source === 'measured').length

describe('P3 + P4 on the acceptance channels', () => {
  it('Finary → a real presenter slot filled by a look-alike placeholder + motion design in its own palette', async () => {
    const r = await runDefinition(FINARY)
    proof('finary', r)
    ok(r)
    expect(r.feasibility.verdict).toBe('reproducible-with-human-inputs')
    const presenter = r.feasibility.elements.find((e) => e.id === 'presenter')!
    expect(presenter.how).toBe('human-input')
    expect(presenter.slot?.kind).toBe('presenter-footage')
    expect(presenter.screenShare.value).toBeGreaterThan(0.5)
    expect(r.feasibility.elements.find((e) => e.id === 'motion-cards')).toMatchObject({ how: 'brick', brick: 'motion.render' })
    const d = r.definition
    expect(d.presenter.kind).toMatchObject({ value: 'real', source: 'measured' })
    expect(d.presenter.mode.value).toBe('look-alike-placeholder')
    expect(d.presenter.angleCount.value).toBe(3)
    expect(d.presenter.placeholder.value?.placeholder).toBe(true)
    expect(d.presenter.placeholder.value?.angles).toHaveLength(3)
    expect(d.presenter.placeholder.value?.type).toMatchObject({ gender: 'man', wardrobe: 'dark crew-neck sweater' })
    expect(r.pictures.portraits).toHaveLength(1)
    expect(r.pictures.angles).toBe(2)
    expect(d.motion.palette.value).toEqual(['#E4002B', '#111111', '#FFFFFF'])
    expect(d.motion.elements.value.map((e) => e.type).sort()).toEqual(['card', 'chart'])
    expect(d.voice.mode.value).toBe('same-kind')
    expect(String(d.voice.voiceRef.value)).not.toMatch(/^clone_/)
    expect(measuredCount(r)).toBeGreaterThanOrEqual(55)
  })

  it('Marcel (his own channel) → his own avatar and voice, his layouts full / half / inset per part', async () => {
    const r = await runDefinition(MARCEL, { intent: 'own-channel', ownChannel: true })
    proof('marcel', r)
    ok(r)
    expect(r.feasibility.verdict).toBe('reproducible')
    expect(r.feasibility.elements.find((e) => e.id === 'presenter')).toMatchObject({ how: 'brick', brick: 'avatar.speak' })
    const d = r.definition
    expect(d.presenter.mode.value).toBe('own')
    expect(d.presenter.presenterRef.value).toBe('own-presenter:marcel')
    expect(d.presenter.placeholder.value).toBeNull()
    expect(d.voice).toMatchObject({ mode: { value: 'user-clone' }, voiceRef: { value: 'clone_2716753' } })
    expect(r.pictures.portraits).toHaveLength(0) // never a look-alike of himself
    expect([...new Set(d.presenter.configurations.value.map((c) => c.layout))].sort()).toEqual(['full', 'half-left', 'inset'])
    const hook = d.presenter.layoutCurve.value.find((l) => l.part === 'hook')!
    expect(hook.shares.full).toBeGreaterThan(0.3)
    expect(hook.shares['half-left'] ?? 0).toBe(0)
    const end = d.presenter.layoutCurve.value.find((l) => l.part === 'end')!
    expect(end.shares.inset).toBeGreaterThan(0)
    expect(d.sound.music).toMatchObject({ value: false, source: 'measured' })
    expect(d.motion.palette.value).toEqual(['#11192B', '#223C61', '#E49D56'])
    // nothing measured the cost target and nobody said it: a default, said so (it was stored as the user's word)
    expect(d.cost.usdPerMinute).toMatchObject({ value: 0.6, source: 'default' })
    expect(d.cost.usdPerMinute.note).toMatch(/not measured on this channel/)
    expect(d.cost.usdPerMinute.note).not.toMatch(/Marcel|Charlie/)
  })

  it('The Japanese Method → French: a look-alike of the same type with his 4 angles, his presence throughout, a voice in French', async () => {
    const r = await runDefinition(JAPANESE, { intent: 'translate', language: 'fr', sourceLanguage: 'en' })
    proof('japanese-fr', r)
    ok(r)
    expect(r.feasibility.verdict).toBe('reproducible-with-human-inputs')
    const d = r.definition
    expect(d.presenter.mode.value).toBe('look-alike-placeholder')
    expect(d.presenter.angleCount.value).toBe(4)
    expect(new Set(d.presenter.configurations.value.map((c) => c.angle)).size).toBe(4)
    expect(d.presenter.placeholder.value?.angles).toHaveLength(4)
    expect(d.presenter.placeholder.value?.type).toMatchObject({ gender: 'man', wardrobe: 'red polo shirt' })
    expect(d.presenter.placeholder.value?.portraitPrompt).toMatch(/invented person/)
    expect(d.presenter.presenceByPart.value.find((x) => x.part === 'body')!.share).toBeGreaterThan(0.2)
    expect(d.voice.language).toMatchObject({ value: 'fr', source: 'user' })
    expect(d.voice.language.note).toMatch(/translated from en/)
    expect(d.editing.hookMeanShotS.source).toBe('measured')
  })

  it('Le Monde en POV → reproducible from bricks: drawn motion design, its palette, its cadence and SFX', async () => {
    const r = await runDefinition(MONDE_POV)
    proof('monde-pov', r)
    ok(r)
    expect(r.feasibility.verdict).toBe('reproducible')
    expect(r.feasibility.elements.find((e) => e.id === '3d')?.how).toBe('impossible')
    const d = r.definition
    expect(d.presenter.kind.value).toBe('none')
    expect(d.presenter.mode.value).toBe('none')
    expect(d.voice.kind).toMatchObject({ value: 'synthetic', source: 'measured' })
    expect(d.sound.sfx.value).toEqual([{ kind: 'pop', on: 'graphic event', perMinute: expect.any(Number) }])
    expect(d.sound.sfx.value[0]!.perMinute).toBeGreaterThan(10)
    expect(d.motion.coverageByPart.value.every((x) => x.share > 0.85)).toBe(true)
    expect(d.editing.hookMeanShotS.value).toBeLessThan(d.editing.meanShotS.value)
  })

  it('Yarnhub → « not reproducible » with alternatives faithful to Yarnhub (its subjects, outline and palette)', async () => {
    const r = await runDefinition(YARNHUB)
    proof('yarnhub', r)
    expect(checkP3(r.feasibility, r.analyses).problems).toEqual([])
    const f = r.feasibility
    expect(f.verdict).toBe('not-reproducible')
    expect(f.alert).toMatch(/3D rendered scenes \(9\d %\)/)
    expect(f.stillPossible.length).toBeGreaterThan(0)
    expect(f.alternatives.length).toBe(3)
    for (const a of f.alternatives) {
      expect(a.borrowsLookFrom).toBeNull()
      expect(a.replaces).toEqual(['3d'])
      expect(a.palette).toEqual(['#3B4A2F', '#C9B27C', '#8B1E1E'])
    }
    expect(f.universe?.topics).toContain('Wake Island')
    expect(f.alternatives[0]!.description).toMatch(/cold open in battle/)
    // An alternative that brings in another channel's colours is refused.
    const foreign = { ...f, alternatives: [{ ...f.alternatives[0]!, palette: ['#0B1F3A', '#F5B700'] }] }
    expect(checkP3(foreign, r.analyses).problems.join()).toMatch(/colours the channel never uses/)
  })
})

describe('no field silently falls back to a default when it was measured', () => {
  it('every field the analyses measure is measured in the definition, for every channel', async () => {
    for (const [p, over] of [[FINARY, {}], [MARCEL, { ownChannel: true, intent: 'own-channel' as const }], [JAPANESE, {}], [MONDE_POV, {}]] as const) {
      const r = await runDefinition(p, over)
      const measured = deriveFields(r.analyses)
      expect(measured.length).toBeGreaterThan(40)
      for (const m of measured) {
        const f = atPath(r.definition, m.field) as Sourced
        expect(f.source, `${p.id} ${m.field}`).toBe('measured')
        expect(f.evidence.length, `${p.id} ${m.field}`).toBeGreaterThan(0)
      }
      // Turn any one of them back to its default: P4's check refuses it by name.
      for (const m of measured) {
        const lazy = withAtPath(r.definition, m.field, { value: (atPath(r.definition, m.field) as Sourced).value, source: 'default', evidence: [] })
        expect(checkP4(lazy, r.synthesis, r.brief, [], r.analyses).problems.join(), `${p.id} ${m.field}`).toMatch(new RegExp(`${m.field.replace('.', '\\.')} is marked default although the analysis measured it`))
      }
    }
  })

  it('a measured value replaced by another one is refused unless an improvement round changed it', async () => {
    const r = await runDefinition(FINARY)
    const changed = withAtPath(r.definition, 'editing.hookMeanShotS', { ...r.definition.editing.hookMeanShotS, value: 9 })
    expect(checkP4(changed, r.synthesis, r.brief, [], r.analyses).problems.join()).toMatch(/editing.hookMeanShotS differs from the measured value/)
    expect(checkP4(changed, r.synthesis, r.brief, ['editing.hookMeanShotS'], r.analyses).ok).toBe(true)
  })
})

describe('P3 measures and checks', () => {
  it('screen shares are the pooled measured screen time, and a share that disagrees with the analyses is refused', async () => {
    const r = await runDefinition(FINARY)
    expect(r.feasibility.crossCheck).toEqual([])
    const total = r.feasibility.elements.reduce((s, e) => s + e.screenShare.value, 0)
    expect(total).toBeCloseTo(1, 2)
    const inflated = r.feasibility.elements.map((e) => (e.id === 'motion-cards' ? { ...e, screenShare: { ...e.screenShare, value: e.screenShare.value + 0.2 } } : e))
    expect(crossCheckElements(inflated, r.analyses).join()).toMatch(/motion: elements cover/)
  })

  it('a filmed presenter the user can supply is marked so (his own footage fills the slot)', async () => {
    const r = await runDefinition(FINARY, { humanInputs: { face: true, voice: false, footage: false } })
    expect(r.feasibility.elements.find((e) => e.id === 'presenter')?.slot?.userSupplies).toBe(true)
  })

  it('an element whose brick the engine lacks becomes impossible, with what is missing', async () => {
    const { measureElements } = await import('../../src/main/production/clone/definition/elements')
    const r = await runDefinition(MONDE_POV)
    const els = measureElements(r.analyses, r.brief, (node) => node !== 'motion.render')
    expect(els.find((e) => e.id === 'drawn')).toMatchObject({ how: 'impossible', missing: { technology: expect.stringMatching(/no motion.render brick/) } })
  })

  it('alternatives keep the channel universe and only replace what is impossible', async () => {
    const r = await runDefinition(YARNHUB)
    const u = channelUniverse(r.analyses)
    expect(faithfulAlternatives(r.feasibility.elements.filter((e) => e.how !== 'impossible'), u)).toEqual([])
    expect(u.structure[0]).toBe('cold open in battle')
  })
})

describe('presenters and voices', () => {
  it('a same-kind voice is never somebody\'s clone and speaks the target language', async () => {
    const { FIXTURE_VOICES } = await import('../../src/main/production/clone/definition/fixtures/run')
    const v = pickSameKind(FIXTURE_VOICES, ['male', 'young', 'energetic'], 'fr')
    expect(v.ref).toBe('elevenlabs_fixture_young')
    const none = pickSameKind([], ['female'], 'de')
    expect(none.ref).toMatch(/^elevenlabs_/)
    expect(none.description).toMatch(/default narrator/)
  })

  it('look-alike descriptors that point at a real person or a picture are refused', () => {
    expect(safeDescriptors({ gender: 'man', wardrobe: 'red polo' })).toBe(true)
    expect(safeDescriptors({ face: 'looks like the host of the channel' })).toBe(false)
    expect(safeDescriptors({ face: 'p2/v1/f000020.jpg' })).toBe(false)
  })

  it('a look-alike on his own channel, or his clone on a third party, is refused', async () => {
    const marcel = await runDefinition(MARCEL, { intent: 'own-channel', ownChannel: true })
    expect(checkP4(marcel.definition, marcel.synthesis, { ...marcel.brief, ownChannel: false }, [], marcel.analyses).problems.join()).toMatch(/never the third party/)
    const finary = await runDefinition(FINARY)
    const stolen = withAtPath(finary.definition, 'voice.voiceRef', { value: 'clone_2716753', source: 'user', evidence: [], note: 'x' })
    expect(checkP4(stolen, finary.synthesis, finary.brief, [], finary.analyses).problems.join()).toMatch(/a cloned voice may not speak for it/)
  })
})

describe('the checks hold in the orchestrator path too (no analyses passed to checkP4 / checkP3)', () => {
  it('a field measured on the analyses and turned back to default is refused from the saved measures alone', async () => {
    const r = await runDefinition(FINARY)
    expect(r.definition.analysisMeasures.length).toBeGreaterThan(30)
    expect(checkP4(r.definition, r.synthesis, r.brief).ok).toBe(true)
    const lazy = withAtPath(r.definition, 'editing.hookMeanShotS', { value: 2.5, source: 'default', evidence: [] })
    expect(checkP4(lazy, r.synthesis, r.brief).problems.join()).toMatch(/editing.hookMeanShotS is marked default although the analysis measured it/)
  })

  it('a look-alike mode without its placeholder spec is refused', async () => {
    const r = await runDefinition(JAPANESE)
    const bare = withAtPath(r.definition, 'presenter.placeholder', { value: null, source: 'default', evidence: [] })
    expect(checkP4(bare, r.synthesis, r.brief).problems.join()).toMatch(/look-alike placeholder without its spec/)
  })

  it('a saved universe with colours the channel never uses is refused', async () => {
    const r = await runDefinition(YARNHUB)
    const forged = { ...r.feasibility, universe: { ...r.feasibility.universe!, palette: ['#0B1F3A'] }, alternatives: r.feasibility.alternatives.map((a) => ({ ...a, palette: ['#0B1F3A'] })) }
    expect(checkP3(forged, r.analyses).problems.join()).toMatch(/universe lists colours its videos never use: #0B1F3A/)
  })
})
