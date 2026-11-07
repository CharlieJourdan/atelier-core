// moteur-briques — the measures the 2026-11-04 proofs lacked go from the analyses to the definition, the definition to brick settings,
// and P8 only touches what a brick reads.
import { describe, expect, it } from 'vitest'
import { atPath, withAtPath, type Round, type Sourced, type StyleDefinition, type VideoAnalysis } from '../../src/shared/clone'
import { readByBrick, curveChanges, fixPrompt, parseFixes } from '../../src/main/production/clone/compare/improver'
import { deriveFields } from '../../src/main/production/clone/definition/derive'
import { FINARY, MONDE_POV } from '../../src/main/production/clone/definition/fixtures/profiles'
import { runDefinition } from '../../src/main/production/clone/definition/fixtures/run'
import { BRICK_SETTINGS } from '../../src/main/production/clone/pipeline/settings'
import { generatedLookFrom, handShareFrom, mixSharesFrom, povDepthFrom, povTypeFrom } from '../../src/main/production/clone/pipeline/values'
import { fakeDrafts } from '../../src/engine/nodes/director-pov'
import { PovShot } from '../../src/engine/formats/pov'

const set = <T>(def: StyleDefinition, field: string, value: T): StyleDefinition => withAtPath(def, field, { value, source: 'measured', evidence: [{ video: 'v', atS: 1, frames: ['f.jpg'] }] } as Sourced)
const field = (out: ReturnType<typeof deriveFields>, f: string): unknown => out.find((x) => x.field === f)?.value

/** The Monde en POV analyses with what the new look columns and the letterbox pass measure. */
function povAnalyses(analyses: readonly VideoAnalysis[]): VideoAnalysis[] {
  return analyses.map((a) => ({
    ...a,
    framing: { letterbox: { aspect: 2.01, barShare: 0.056, frameShare: 0.95, frames: 400 } },
    shots: a.shots.map((s, i) => ({ ...s, pov: s.origin === 'drawn' && i % 3 === 0, depth: s.origin === 'drawn' ? (i % 5 === 0 ? 'flat' : 'deep') : 'flat' }))
  }))
}

describe('the new measures reach the definition', () => {
  it('letterbox, first-person share and depth of field are derived from the analyses with evidence', async () => {
    const r = await runDefinition(MONDE_POV)
    const out = deriveFields(povAnalyses(r.analyses))
    expect(field(out, 'editing.letterbox')).toEqual({ aspect: 2.01, barShare: 0.056 })
    expect(field(out, 'sourcing.povShare') as number).toBeGreaterThan(0.1)
    expect(field(out, 'sourcing.depthShare') as number).toBeGreaterThan(0.6)
    for (const f of ['editing.letterbox', 'sourcing.povShare', 'sourcing.depthShare']) expect(out.find((x) => x.field === f)?.evidence.length, f).toBeGreaterThan(0)
  })

  it('says nothing about them when the analyses did not read them (older analyses)', async () => {
    const r = await runDefinition(MONDE_POV)
    const out = deriveFields(r.analyses)
    for (const f of ['editing.letterbox', 'sourcing.povShare', 'sourcing.depthShare', 'sourcing.generatedLook']) expect(out.some((x) => x.field === f), f).toBe(false)
  })

  it('a full-frame corpus measures « no letterbox » (null), not nothing', async () => {
    const r = await runDefinition(FINARY)
    const out = deriveFields(r.analyses.map((a) => ({ ...a, framing: { letterbox: null } })))
    expect(out.find((x) => x.field === 'editing.letterbox')?.value).toBeNull()
  })

  it('the generated look comes from the video that generates the most', async () => {
    const r = await runDefinition(FINARY)
    const as = r.analyses.map((a, i) => ({
      ...a,
      generatedLook: i === 0 ? 'photoreal cinematic still, dusk, wet street, teal and amber' : 'flat',
      shots: a.shots.map((s, k) => (i === 0 && k % 4 === 0 ? { ...s, origin: 'generated' as const } : s))
    }))
    expect(field(deriveFields(as), 'sourcing.generatedLook')).toBe('photoreal cinematic still, dusk, wet street, teal and amber')
  })
})

describe('the definition drives the bricks', () => {
  it('depth, hand share, type and generated look become brick settings; nothing when not measured', async () => {
    const { definition: d0 } = await runDefinition(MONDE_POV)
    expect(povDepthFrom(d0)).toBeUndefined()
    expect(handShareFrom(d0)).toBeUndefined()
    let d = set(d0, 'sourcing.depthShare', 0.8)
    d = set(d, 'sourcing.povShare', 0.22)
    d = set(d, 'motion.fonts', ['rounded sans bold capitals underlined title'])
    expect(povDepthFrom(d)).toBe('deep')
    expect(handShareFrom(d)).toBe(0.22)
    expect(povTypeFrom(d)).toMatchObject({ face: 'geometric', upper: true, titleRule: true })
    const keys = BRICK_SETTINGS.map((r) => r.key)
    for (const k of ['director.pov.depth', 'director.pov.handShare', 'director.pov.type', 'visuals.fulfil.look', 'render.assemble.letterbox']) expect(keys).toContain(k)
  })

  it('generated pictures carry the measured look only where the reference generates', async () => {
    const { definition: d0 } = await runDefinition(FINARY)
    const d = set(d0, 'sourcing.generatedLook', 'photoreal cinematic still, dusk')
    expect(generatedLookFrom(set(d, 'sourcing.originShares', { presenter: 0.5, generated: 0.2, motion: 0.3 }))).toEqual({ style: 'clone-measured', suffix: 'photoreal cinematic still, dusk' })
    expect(generatedLookFrom(set(d, 'sourcing.originShares', { presenter: 0.5, found: 0.2, motion: 0.3 }))).toBeUndefined()
  })

  it('the presenter share is his measured time on screen, taken out of « filmed » first (Finary)', async () => {
    const { definition: d0 } = await runDefinition(FINARY)
    let d = set(d0, 'sourcing.originShares', { presenter: 0.3, filmed: 0.2, motion: 0.3, found: 0.2 })
    d = set(d, 'presenter.talkSecondsPerMinute', 30)
    const m = mixSharesFrom(d)
    expect(m.presenter).toBeCloseTo(0.5, 2)
    expect(m.stock).toBeCloseTo(0.2, 2)
    // never less than the shots labelled presenter
    expect(mixSharesFrom(set(d, 'presenter.talkSecondsPerMinute', 6)).presenter).toBeCloseTo(0.3, 2)
  })
})

describe('the drawn director uses first-person shots at the measured share', () => {
  const sentences = Array.from({ length: 12 }, (_, i) => ({ n: i + 1, first: i, last: i, start: i * 3, end: i * 3 + 2.5, text: `phrase numéro ${i} sans chiffre` }))
  it('none when the channel has none, about the measured share otherwise, and the free demo mixes the kinds', () => {
    expect(fakeDrafts(sentences).some((d) => d.shot.kind === 'hand')).toBe(false)
    const drafts = fakeDrafts(sentences, 0.25)
    const hands = drafts.filter((d) => d.shot.kind === 'hand')
    expect(hands.length).toBeGreaterThanOrEqual(2)
    expect(hands.length).toBeLessThanOrEqual(4)
    expect(drafts[0]!.shot.kind).toBe('scene')
    // moteur-pov-2 (independent judge, round 1): on a first-person channel the phone is held up (a hand shot), never a bare
    // phone card, and a lone clause is not chopped into a list: the kinds are places, faces, hands and flows
    expect(new Set(drafts.map((d) => d.shot.kind)).size).toBeGreaterThanOrEqual(4)
    // two places in a row are never the same set
    const sets = drafts.filter((d) => d.shot.kind === 'scene').map((d) => d.shot.set)
    sets.forEach((x, i) => i > 0 && expect(x).not.toBe(sets[i - 1]))
  })
  it('its places are furnished and peopled, some carry a corner tag, and a question becomes a title card (independent judge, 2026-11-05)', () => {
    const words = ['un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze']
    const said = Array.from({ length: 24 }, (_, i) => ({ n: i + 1, first: i, last: i, start: i * 3, end: i * 3 + 2.5, text: i === 5 ? 'Le ticket peut-il expirer ?' : `la phrase ${words[i % 12]} sans chiffre` }))
    const drafts = fakeDrafts(said)
    const shots = drafts.map((d) => PovShot.parse(d.shot))
    const scenes = shots.filter((x): x is Extract<PovShot, { kind: 'scene' }> => x.kind === 'scene')
    expect(scenes.every((x) => x.props.length >= 2)).toBe(true)
    expect(scenes.some((x) => x.cast.length >= 3)).toBe(true)
    expect(scenes.some((x) => x.tag !== undefined)).toBe(true)
    expect(shots.some((x) => x.kind === 'title' && x.lines.at(-1)!.endsWith('?'))).toBe(true)
  })
})

describe('the depth finish', () => {
  it('adds a warm bloom and dust drifting up over the whole shot, the same for the same shot', async () => {
    const { depthFinish } = await import('../../src/engine/motion/pov-hand')
    const a = depthFinish('shot-7', 5)
    expect(a).toMatch(/mix-blend-mode:screen/)
    expect(a.match(/data-move=/g)?.length).toBe(22)
    expect(a).toMatch(/data-dur="5\.00"/)
    expect(depthFinish('shot-7', 5)).toBe(a)
    expect(depthFinish('shot-8', 5)).not.toBe(a)
  })
})

describe('P8 only changes what a brick reads', () => {
  it('a curve gap on a field no brick reads is a brick defect, never a definition change', async () => {
    const { definition } = await runDefinition(MONDE_POV)
    expect(readByBrick('motion.densityByPart')).toBe(false)
    expect(readByBrick('editing.meanShotS')).toBe(true)
    const round = {
      n: 1,
      comparison: {
        curves: [{ name: 'motion-density', axis: 'motion', labels: ['hook', 'body'], reference: [9, 6], ours: [2, 1], distance: 0.7, note: 'cards per minute' }],
        verdict: { scores: [] },
        defects: [],
        blindKey: {}
      }
    } as unknown as Round
    const changes = curveChanges(round, definition, null, { factors: {} } as never)
    const dens = changes.filter((c) => c.fixes.some((f) => f.startsWith('motion-density')))
    expect(dens.length).toBeGreaterThan(0)
    for (const c of dens) expect(c.cause).toBe('brick')
  })

  it('the model pass is shown and may change only brick-read fields', async () => {
    const { definition } = await runDefinition(MONDE_POV)
    const round = { n: 1, comparison: { curves: [], verdict: { scores: [{ axis: 'captions', score: 40, defects: ['captions too big'] }] }, defects: [], blindKey: {} } } as unknown as Round
    const prompt = fixPrompt(round, definition, ['captions', 'illustration'])
    expect(prompt).not.toContain('captions.style =')
    expect(prompt).not.toContain('sourcing.kindShares =')
    const style = (atPath(definition, 'captions.style') as Sourced).value
    const answer = JSON.stringify({ changes: [{ target: 'captions.style', after: `${String(style)} smaller`, why: 'x', fixes: ['captions too big'] }] })
    expect(parseFixes(answer, definition)).toEqual([])
  })
})

describe('the chain of icons', () => {
  it('draws each item in a dark box with a gold outline and an arrow to the next', async () => {
    const { iconsShot } = await import('../../src/engine/motion/pov-ui')
    const { PovShot: Shot } = await import('../../src/engine/formats/pov')
    const { PALETTES } = await import('../../src/engine/motion/pov-kit')
    const s = Shot.parse({ kind: 'icons', chain: true, items: [{ icon: 'user', label: 'TOI' }, { icon: 'users', label: 'UNE PERSONNE' }, { icon: 'landmark', label: 'LA BANQUE' }] }) as Extract<PovShot, { kind: 'icons' }>
    const html = iconsShot(s, PALETTES.dusk, 'x')
    expect(html.match(/background:#1b1d26/g)?.length).toBe(3)
    // moteur-pov-2: the last arrow runs off the frame, as the reference's flow does (one arrow per item)
    expect(html.match(/border-left:16px solid/g)?.length).toBe(3)
    const plain = iconsShot({ ...s, chain: false }, PALETTES.dusk, 'x')
    expect(plain).not.toMatch(/#1b1d26/)
  })
})

describe('depth on a deep channel', () => {
  it('a wide scene stays sharp (only close-ups defocus the place), with the bloom and dust over it', async () => {
    const { povCard } = await import('../../src/engine/motion/pov-cards')
    const { PovCardProps } = await import('../../src/engine/formats/pov')
    const c = { width: 1920, height: 1080, durationS: 3, fontCss: '' }
    const scene = povCard(PovCardProps.parse({ depth: 'deep', shot: { kind: 'scene', set: 'room', cast: [{ color: 'hero' }] } }), c as never)
    expect(scene.body).not.toMatch(/class="plate"|deepback/)
    expect(scene.body).toMatch(/mix-blend-mode:screen/)
    const close = povCard(PovCardProps.parse({ depth: 'deep', shot: { kind: 'hand', hold: 'ticket', over: 'room' } }), c as never)
    expect(close.body).toMatch(/class="plate"/)
  })
})
