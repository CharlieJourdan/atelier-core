import { describe, expect, it } from 'vitest'
import { checkMotion, MotionSpec, type MotionSpecInput } from '../../src/engine/formats/motion'
import { POV_KINDS, PovShot } from '../../src/engine/formats/pov'
import { checkEditPlan } from '../../src/engine/formats/editplan'
import type { Word } from '../../src/engine/formats/timing'
import { motionHtml } from '../../src/engine/motion'
import { revealsOf } from '../../src/engine/edit/grammar'
import { PovDirectorParams, fakeDrafts, povPlan, sentencesOf, splitLong, timeDrafts, timeParts } from '../../src/engine/nodes/director-pov'
import { povSystem } from '../../src/engine/nodes/director-pov-prompt'
import { POV_ICONS } from '../../src/engine/motion/pov-icons'
import { baseForReferences } from '../../src/engine/technologies/style-propose'
import { basePipeline } from '../../src/engine/technologies/bases'

const ctx = { width: 1920, height: 1080, durationS: 4, fontCss: '' }

/** One shot of every kind, as the director writes them for the reference passage (research note style-monde-pov-2026-11 (old repository) § 4). */
const SHOTS: Record<(typeof POV_KINDS)[number], unknown> = {
  scene: { kind: 'scene', set: 'showroom', sign: 'PRESTIGE AUTO', cast: [{ x: 0.4 }, { x: 0.6, pose: 'type', color: 'purple', hair: 'curly' }], props: [{ kind: 'sportscar', x: 0.2, label: 'Lamborghini', atS: 1 }], tag: { text: '100 personnes', atS: 0.5 }, camera: 'left', rain: 'bills' },
  face: { kind: 'face', moods: [{ expression: 'shock' }, { expression: 'worried', atS: 0.8 }], over: 'room' },
  title: { kind: 'title', kicker: 'Un trillion', lines: ['En 24 heures'] },
  number: { kind: 'number', mode: 'stack', steps: [{ value: 1000000, atS: 0.2 }, { value: 1000000000, atS: 1.2 }, { value: 1000000000000, atS: 2.2 }], unit: '$' },
  list: { kind: 'list', items: [{ text: 'Toutes les voitures', atS: 0.3 }, { text: 'Le bâtiment', atS: 1.3 }], over: 'showroom' },
  ring: { kind: 'ring', countdownS: 86400, caption: 'Tu as 24 heures', note: 'Chaque centime' },
  icons: { kind: 'icons', items: [{ icon: 'rocket', label: 'Espace' }, { icon: 'ship', label: 'Océans' }] },
  grid: { kind: 'grid', icon: 'store', total: 30, title: '1 concession = 12 M$' },
  compare: { kind: 'compare', label: 'Billets de 100 $', ref: 'Everest', times: 163 },
  chart: { kind: 'chart', trend: 'up-late', tone: 'red' },
  phone: { kind: 'phone', app: 'Ma banque', lines: [{ text: '1 $', tone: 'big' }], crackAtS: 3 },
  browser: { kind: 'browser', title: 'Virement', status: { text: 'Transaction refusée', tone: 'refused', atS: 1 } },
  paper: { kind: 'paper', title: 'Mission', stamp: { text: 'Top 100', atS: 1 } },
  dial: { kind: 'dial', look: 'gauges', warning: 'Check engine' },
  hand: { kind: 'hand', hold: 'ticket', title: 'EuroMillions', lines: [{ text: '250 M€', tone: 'big', atS: 0.6 }], over: 'room' }
}

const spec = (shot: unknown): MotionSpecInput => ({ template: 'pov', props: { shot } }) as MotionSpecInput

describe('the POV card (formats/pov.ts)', () => {
  it('draws every kind as an opaque page with the runtime, the same page every time, nothing from the network', () => {
    for (const k of POV_KINDS) {
      expect(MotionSpec.safeParse(spec(SHOTS[k])).success, k).toBe(true)
      expect(checkMotion(spec(SHOTS[k]), 4), k).toEqual([])
      const html = motionHtml(spec(SHOTS[k]), ctx)
      expect(html, k).toContain('class="pov"')
      expect(html, k).toContain('atelierRenderAt')
      expect(html, k).not.toMatch(/https?:\/\//)
      expect(motionHtml(spec(SHOTS[k]), ctx)).toBe(html)
    }
  })

  it('refuses what it cannot draw and says which part comes too late', () => {
    expect(PovShot.safeParse({ kind: 'scene', set: 'moon' }).success).toBe(false)
    expect(PovShot.safeParse({ kind: 'number', steps: [{ atS: 1 }] }).success).toBe(false)
    expect(checkMotion(spec({ kind: 'list', items: [{ text: 'a', atS: 3.9 }] }), 4)[0]).toMatch(/item 1 \(3\.9 s\) comes too late/)
    expect(checkMotion(spec(SHOTS.face), 0.5)[0]).toMatch(/shorter than the 0\.8 s/)
  })

  it('writes the texts escaped, a stack strikes the old values, a countdown ticks once a second', () => {
    const html = motionHtml(spec({ kind: 'paper', title: 'A <b>&</b>' }), ctx)
    expect(html).toContain('A &lt;b&gt;&amp;&lt;/b&gt;')
    const stack = motionHtml(spec(SHOTS.number), ctx)
    expect(stack.match(/data-anim="grow"/g)).toHaveLength(2)
    const ring = motionHtml(spec(SHOTS.ring), ctx)
    expect(ring).toContain('24:00:00')
    expect(ring).toContain('23:59:57')
  })

  it('the icons the director may name are all drawable', () => {
    expect(Object.keys(POV_ICONS).length).toBeGreaterThan(90)
    for (const n of ['rocket', 'ship', 'hospital', 'school', 'store', 'house']) expect(POV_ICONS[n], n).toBeTruthy()
  })

  it('puts its sound effects on its graphic events, not on its cut', () => {
    const r = (shot: unknown): string[] => revealsOf('pov', { shot }).map((x) => `${x.slot}@${x.atS}`)
    expect(r(SHOTS.number)).toEqual(['word@0.2', 'word@1.2', 'word@2.2'])
    expect(r(SHOTS.paper)).toEqual(['punch@1'])
    expect(r({ kind: 'scene', set: 'room' })).toEqual([])
  })
})

/** A narration of `n` sentences of `k` words, one word every 0.28 s (≈ 215 words a minute). */
function narration(texts: string[]): Word[] {
  const out: Word[] = []
  let t = 0
  texts.forEach((s, si) => {
    for (const w of s.split(' ')) {
      out.push({ w, start: t, end: t + 0.24, sentence: si, paragraph: 0 })
      t += 0.28
    }
  })
  return out
}

describe('the POV director (director.pov@1)', () => {
  const texts = [
    'Bravo, ton compte vient de recevoir mille milliards de dollars.',
    'Pas un million, pas même un milliard, mais bien 1000 milliards.',
    'Tu as vingt-quatre heures pour tout dépenser jusqu’au dernier centime.',
    'Huit heures du matin, ta vieille voiture tousse devant chez toi.',
    'Tu traverses la ville jusqu’au plus beau garage de luxe du coin.'
  ]
  const words = narration(texts)
  const D = (words.at(-1) as Word).end + 0.3
  const p = PovDirectorParams.parse({})

  it('cuts the sentences, times the parts on their words', () => {
    const s = sentencesOf(words)
    expect(s).toHaveLength(5)
    expect(s[1]?.first).toBe(10)
    const timed = timeParts({ kind: 'number', steps: [{ value: 1, on: 'pas même' }], crackOn: 'milliard,' }, words, 10, 19, words[10]?.start as number) as { steps: { atS: number }[]; crackAtS: number }
    expect(timed.steps[0]?.atS).toBeCloseTo(0.84, 2)
    expect(timed.crackAtS).toBeCloseTo(1.68, 2)
  })

  it('makes a sound plan from the sentences alone (fake), every shot a pov card on the base track', () => {
    const diag: string[] = []
    const shots = splitLong(timeDrafts(fakeDrafts(sentencesOf(words)), sentencesOf(words), words, D, p, diag), D, p)
    const plan = povPlan(shots, D, p, 'seed', diag)
    expect(checkEditPlan(plan, { items: [], totals: { credits: 0, items: 0, byKind: {} }, budget: null }, plan.frames)).toEqual([])
    expect(plan.shots.every((s) => s.track === 'base' && (s.graphic as { template: string }).template === 'pov')).toBe(true)
    expect(plan.shots.some((s) => (s.graphic as { props: { shot: { kind: string } } }).props.shot.kind === 'number')).toBe(true)
  })

  it('drops a shot shorter than the minimum, turns a shot that does not draw into a scene, splits a long still by a reaction', () => {
    const s = sentencesOf(words)
    const diag: string[] = []
    const timed = timeDrafts(
      [
        { sentence: 1, on: 'Bravo,', shot: { kind: 'scene', set: 'room' } },
        { sentence: 1, on: 'ton', shot: { kind: 'face', moods: [{ expression: 'smile' }] } },
        { sentence: 2, on: 'Pas', shot: { kind: 'nope' } },
        { sentence: 3, on: 'Tu', shot: { kind: 'scene', set: 'street' } }
      ],
      s,
      words,
      D,
      p,
      diag
    )
    expect(timed).toHaveLength(3)
    expect((timed[1]?.shot as PovShot).kind).toBe('scene')
    expect(diag.some((d) => /trop court/.test(d))).toBe(true)
    expect(diag.some((d) => /non dessinable/.test(d))).toBe(true)
    const split = splitLong(timed, D, p)
    expect(split.length).toBeGreaterThan(3)
    expect(split.some((t) => (t.shot as PovShot).kind === 'face')).toBe(true)
  })

  it('tells the model the measured rhythm and the whole vocabulary', () => {
    const sys = povSystem({ shotS: 2.7, hookShotS: 2.4, hookS: 25, faceEveryS: 16, shares: p.shares })
    expect(sys).toContain('One shot every 2.7 s')
    for (const k of POV_KINDS) expect(sys).toContain(`"kind":"${k}"`)
  })
})

describe('the base « Histoire POV (animation 2D) » (pov@1)', () => {
  it('is what « Créer une pipeline » picks for illustrated references without a presenter', () => {
    // what the eyes measured live on the channel (profile of two videos): no presenter, the cartoon hero « acting » in half the pictures
    const ref = { presenterShare: 0, presenterActs: 0.5, lookFamily: 'illustrated' as const, kinds: { motion: 1 }, wordsPerMinute: 135, minutes: 12 }
    expect(baseForReferences([ref, ref, { ...ref, lookFamily: 'photoreal' as const }])).toEqual({ baseId: 'pov@1', reason: 'animation' })
    // the same cards without the drawn look stay a documentary's
    expect(baseForReferences([{ ...ref, presenterActs: 0, lookFamily: 'archive' as const }]).baseId).toBe('documentary@2')
    // a real presenter acting the scenes in a photographic look is still the avatar's
    expect(baseForReferences([{ ...ref, lookFamily: 'photoreal' as const }]).baseId).toBe('avatar@1')
  })

  it('draws every frame: no pictures brick, the POV director, the measured voice pace and music bed', () => {
    const b = basePipeline('pov@1')
    expect(b).toBeDefined()
    const techs = b?.doc.bricks.map((x) => x.tech) ?? []
    expect(techs).toContain('director.pov@1')
    expect(techs.some((t) => t.startsWith('visuals.') || t.startsWith('clip.'))).toBe(false)
    expect(b?.doc.bricks.find((x) => x.tech === 'voice.tts@1')?.settings).toMatchObject({ wpm: 215 })
    expect(b?.doc.bricks.find((x) => x.tech === 'sound.music@1')?.settings).toMatchObject({ bedDb: -15, liftDb: 0 })
  })
})
