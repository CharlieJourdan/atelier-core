// avatar-qualite (Charlie 01/11, the first real 60 s hook from the app: « les 3 derniers plans c'est quasiment les mêmes »):
// on that hook's own script, words and the director's recorded answer (tests/fixtures/hook-2026-11), the new plan shows no
// subject twice within 20 s, the recurring wall corner's fixed description heads at most one picture per 20 s, every picture
// has its own directive, and the scene pass is told how many pictures each sentence gets. The run's old plan, kept in the
// fixture, had the same directive on two shots in a row. Also the node's fake on the same hook, and the measure itself.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Directive } from '../../src/engine/formats/directives'
import type { EditPlan, GenList } from '../../src/engine/formats/editplan'
import { directorPlan } from '../../src/engine/nodes/director-plan'
import type { DirectorParams } from '../../src/engine/nodes/director-cuts'
import { REPEAT_WINDOW_S, repeatProblems, sameScene, sceneSimilarity } from '../../src/engine/nodes/director-variety'
import type { ClaudeService } from '../../src/engine/services'
import { avatarBase, compileRecipe, fromBase, technologyRegistry } from '../../src/engine/technologies'
import { art, makeCtx } from './engine-node-helpers'

interface Before {
  id: string
  startS: number
  endS: number
  kind: string
  subject: string
  scene: string | null
}
const HOOK = JSON.parse(readFileSync(path.join(__dirname, '..', 'fixtures', 'hook-2026-11', 'hook-60s.json'), 'utf8')) as {
  words: { value: unknown; meta: Record<string, unknown> }
  beats: unknown
  outline: unknown
  sceneAnswer: { directives: unknown[]; recurring: { name: string; description: string }[] }
  sceneAnswerNew: { answer: unknown }
  before: Before[]
  illustrationPass: { roles: unknown; scene: unknown; topUp?: unknown }
  part4Pass: { roles: unknown; scene: unknown; topUp?: unknown }
}

/** The talk / show sort of a recorded pass that had none: an empty answer (the rule on the words decides). */
const isRoles = (system: string): boolean => system.startsWith('You sort the sentences')
const WALL = HOOK.sceneAnswer.recurring[0]?.description as string

/** The director's params of `avatar@1` as compiled (the real run's). */
function avatarParams(): DirectorParams {
  const r = compileRecipe(fromBase(avatarBase), technologyRegistry())
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  return directorPlan.params.parse(r.pipeline.nodes.find((n) => n.id === 'director')?.params) as DirectorParams
}

/**
 * The LLM replays the answer the director gave on the real run (01/11); asked to top up a sentence, it answers what a director
 * would there (sentence 14, « On va faire ça en quatre temps » : the four things laid out).
 */
const TOP_UP_SCENES = [
  'Overhead shot of a sack of lime, a bucket, a wide brush and a sponge laid out in a row on a wooden floor',
  'Close-up of a thermometer on a bedroom shelf',
  'Wide shot of a north-facing house wall in winter',
  'Close-up of a hand opening a window latch',
  'Close-up of condensation drops running down a cold window pane',
  'Close-up of a wet towel drying on a radiator',
  'Wide shot of a bedroom with a wardrobe against the outer wall',
  'Close-up of a scraper lifting flaky old paint'
]

function replay(): { svc: ClaudeService; prompts: string[] } {
  const prompts: string[] = []
  const topUp = (prompt: string): string => {
    const asked = [...prompt.matchAll(/^(\d+) · (\d+) · (.+)$/gm)]
    const directives = asked.flatMap((m) =>
      Array.from({ length: Number(m[2]) }, (_, k) => ({
        sentence: Number(m[1]),
        anchor: (m[3] as string).split(' ').slice(k, k + 2).join(' '),
        kind: 'imageAi',
        subject: `plan ${m[1]}-${k + 1}`,
        prompt: TOP_UP_SCENES[(Number(m[1]) * 3 + k) % TOP_UP_SCENES.length] as string,
        why: 'les quatre temps annoncés'
      }))
    )
    return JSON.stringify({ directives, recurring: [] })
  }
  return {
    prompts,
    svc: {
      ask: (req) => {
        prompts.push(req.prompt)
        if (isRoles(req.system)) return Promise.resolve({ text: JSON.stringify({ roles: [] }) })
        return Promise.resolve({ text: req.prompt.includes('need more pictures') ? topUp(req.prompt) : JSON.stringify(HOOK.sceneAnswer) })
      }
    }
  }
}

const inputs = () => ({
  beats: art('json.beats', { value: HOOK.beats as never }),
  words: art('json.words', { value: HOOK.words.value as never, meta: HOOK.words.meta as never }),
  outline: art('json.outline', { value: HOOK.outline as never })
})

interface Row {
  id: string
  startS: number
  kind: string
  subject: string
  scene: string
  /** The item and the one whose clip it shares (two shots of one action are allowed to show it twice). */
  item?: string
  sameAs?: string
}
function rows(plan: EditPlan, list: GenList): Row[] {
  return plan.shots
    .filter((s) => s.track === 'base' && s.kind !== 'avatar')
    .sort((a, b) => a.startFrame - b.startFrame)
    .map((s) => {
      const it = list.items.find((i) => i.id === s.genItem)
      return { id: s.id, startS: s.startFrame / plan.fps, kind: s.kind, subject: it?.context.subject ?? '', scene: it?.shot?.scene ?? it?.prompt ?? '', ...(it ? { item: it.id } : {}), ...(it?.sameAs ? { sameAs: it.sameAs } : {}) }
    })
}

/** Pairs of pictures within 20 s that show the same thing (same subject, or alike scenes written by the scene pass). */
function repeats(r: readonly { startS: number; subject: string; scene: string | null; item?: string; sameAs?: string }[]): string[] {
  const out: string[] = []
  for (let i = 0; i < r.length; i++)
    for (let j = i + 1; j < r.length; j++) {
      const a = r[i] as (typeof r)[number]
      const b = r[j] as (typeof r)[number]
      if (b.startS - a.startS >= REPEAT_WINDOW_S) break
      // the two shots of one clip are one continuing action
      if ((b.sameAs !== undefined && b.sameAs === a.item) || (a.sameAs !== undefined && a.sameAs === b.item)) continue
      if (a.subject === b.subject || sameScene(a.scene ?? '', b.scene ?? '')) out.push(`${a.startS.toFixed(1)} / ${b.startS.toFixed(1)} « ${a.subject} »`)
    }
  return out
}

describe('avatar-qualite: the reference hook never shows a subject twice within 20 s', () => {
  it('the run of 01/11 did (its plan, kept in the fixture): one directive on two shots, the wall corner on 5 of 10 pictures', () => {
    const before = HOOK.before.filter((s) => s.kind !== 'avatar')
    expect(before.length).toBe(10)
    expect(repeats(before).length).toBeGreaterThan(0)
    expect(before.filter((s) => s.scene?.startsWith(WALL)).length).toBe(5)
  })

  it('with the same LLM answer, the new plan repeats no subject; each sentence’s picture count reaches the scene pass', async () => {
    const llm = replay()
    const out = await directorPlan.run(makeCtx({ claude: llm.svc }), inputs(), avatarParams())
    const plan = out.plan?.value as unknown as EditPlan
    const list = out.genlist?.value as unknown as GenList
    const after = rows(plan, list)
    // the scene pass was asked for the pictures per sentence
    expect(llm.prompts.find((x) => x.includes('Picture budget'))).toMatch(/Pictures per sentence: .*pictures: \d/)
    // a sentence left short gets new directives from the director (one more call); a shot still without one shows the SAME
    // subject as a directive, from another angle, never a new unrelated subject
    expect(llm.prompts.filter((x) => x.includes('need more pictures')).length).toBeLessThanOrEqual(1)
    const directives = out.directives?.value as unknown as Directive[]
    const subjects = new Set(directives.map((d) => d.subject))
    for (const s of after.filter((x) => x.subject.includes(' — '))) expect(subjects.has(s.subject.split(' — ')[0] as string), s.subject).toBe(true)
    // no subject twice within 20 s, by the test's own measure and by the director's check
    expect(repeats(after)).toEqual([])
    expect(repeatProblems(plan, list)).toEqual([])
    // the wall corner's fixed description heads at most one picture per 20 s
    const walls = after.filter((s) => s.scene.startsWith(WALL))
    for (let i = 1; i < walls.length; i++) expect((walls[i] as Row).startS - (walls[i - 1] as Row).startS).toBeGreaterThanOrEqual(REPEAT_WINDOW_S)
    // every directive of the answer serves at most one picture
    for (const d of directives) {
      const body = (d.prompt ?? '').replace(`${WALL}; `, '')
      expect(after.filter((s) => s.scene.endsWith(body)).length, d.subject).toBeLessThanOrEqual(1)
    }
    // the hook is still the real run's mix: ≥ 8 pictures, none over 8 s
    expect(after.length).toBeGreaterThanOrEqual(8)
    for (const s of plan.shots) if (s.track === 'base' && s.kind !== 'avatar') expect(s.endFrame - s.startFrame).toBeLessThanOrEqual(8 * plan.fps)
    console.log(['| t | kind | subject | scene |', '|---|---|---|---|', ...after.map((s) => `| ${s.startS.toFixed(1)} | ${s.kind} | ${s.subject} | ${s.scene.slice(0, 110)} |`)].join('\n'))
  })

  it('a real director pass with the variety rules (Opus, recorded 01/11): every picture its own directive, no repeat', async () => {
    const prompts: string[] = []
    const svc: ClaudeService = {
      ask: (req) => (prompts.push(req.prompt), Promise.resolve({ text: JSON.stringify(isRoles(req.system) ? { roles: [] } : HOOK.sceneAnswerNew.answer) }))
    }
    const out = await directorPlan.run(makeCtx({ claude: svc }), inputs(), avatarParams())
    const plan = out.plan?.value as unknown as EditPlan
    const list = out.genlist?.value as unknown as GenList
    const after = rows(plan, list)
    expect(prompts.filter((x) => x.includes('Picture budget')).length).toBe(1)
    expect(repeats(after)).toEqual([])
    expect(repeatProblems(plan, list)).toEqual([])
    // recorded before the pictures were counted per sentence (avatar-qualite part 2), this answer is short in places: a shot left
    // without a fresh directive shows the SAME subject as the one on screen, from another angle, never a new unrelated one
    const subjects = new Set((HOOK.sceneAnswerNew.answer as { directives: { subject: string }[] }).directives.map((d) => d.subject))
    // (since part 5 the opening's last clause, « vous avez décalé l'armoire », is a picture; this answer has no directive for it
    // and no picture is on screen before it: its angle is on its own words; a real pass gets the time and writes one)
    const opening = after[0]
    expect(opening?.startS).toBeLessThan(3.5)
    for (const s of after.filter((x) => x.subject.includes(' — ') && x !== opening)) expect(subjects.has(s.subject.split(' — ')[0] as string), s.subject).toBe(true)
    expect(new Set(after.map((s) => s.subject)).size).toBe(after.length)
  })

  it('a real pass (recorded 01/11 night, part 4): presenter runs as the references’, every picture cut on the word that names it', async () => {
    const rec = HOOK.part4Pass
    const svc: ClaudeService = {
      ask: (req) =>
        Promise.resolve({ text: JSON.stringify(isRoles(req.system) ? rec.roles : req.prompt.includes('need more pictures') ? (rec.topUp ?? { directives: [], recurring: [] }) : rec.scene) })
    }
    const out = await directorPlan.run(makeCtx({ claude: svc }), inputs(), avatarParams())
    const plan = out.plan?.value as unknown as EditPlan
    const list = out.genlist?.value as unknown as GenList
    const words = HOOK.words.value as { w: string; start: number; end: number }[]
    const at = (w: string): number => (words.find((x) => x.w.toLowerCase().startsWith(w)) as { start: number }).start
    const shotAt = (t: number) => plan.shots.find((s) => s.track === 'base' && s.startFrame / plan.fps <= t + 1e-6 && s.endFrame / plan.fps > t + 1e-6)
    const sceneAt = (t: number): string => list.items.find((i) => i.id === shotAt(t)?.genItem)?.shot?.scene ?? ''
    // talk sentences are the presenter's (the reference does the same), never a picture of the idea
    expect(shotAt(at('deuxième'))?.kind).toBe('avatar')
    expect(shotAt(at('sauf'))?.kind).toBe('avatar')
    // the presenter as the references: never more than 8.5 s in a row (they hold 3 to 8.6 s, always between pictures)
    const base = plan.shots.filter((x) => x.track === 'base').sort((x, y) => x.startFrame - y.startFrame)
    let run = 0
    for (const sh of base) {
      run = sh.kind === 'avatar' ? run + (sh.endFrame - sh.startFrame) / plan.fps : 0
      expect(run, sh.id).toBeLessThanOrEqual(8.5 + 1e-6)
    }
    // the picture lands on the word that names it, at most 0.15 s before it (« un spray », « repeint »), not on « avec », « même »
    for (const w of ['spray', 'repeint']) {
      const t = at(w)
      const sh = shotAt(t) as { startFrame: number }
      expect(t - sh.startFrame / plan.fps, w).toBeGreaterThanOrEqual(0)
      expect(t - sh.startFrame / plan.fps, w).toBeLessThanOrEqual(0.15)
    }
    // what is named is shown on its words: the spray, the mould behind the wardrobe, the roller, the sack of lime
    expect(sceneAt(at('spray'))).toMatch(/spray/i)
    // (never before it is named, record 0059: the mould comes on « moisissure », not on « côté nord »)
    expect(sceneAt(at('moisissure'))).toMatch(/mou?ld/i)
    expect(sceneAt(at('repeint') + 0.6)).toMatch(/roller|paint/i)
    expect(sceneAt(at('sac'))).toMatch(/lime/i)
    // a picture with a directive starts on its words: the word at its cut begins within 0.15 s
    for (const sh of plan.shots.filter((x) => x.track === 'base' && x.kind !== 'avatar' && x.role === 'scene')) {
      const k = words.findIndex((w) => w.start >= sh.startFrame / plan.fps - 1e-6)
      expect((words[k] as { start: number }).start - sh.startFrame / plan.fps, sh.id).toBeLessThanOrEqual(0.15)
    }
    expect(repeats(rows(plan, list))).toEqual([])
  })

  it('the node’s fake on the same hook shows no subject twice within 20 s either', async () => {
    const out = await directorPlan.fake(makeCtx({}), inputs(), avatarParams())
    const plan = out.plan?.value as unknown as EditPlan
    const list = out.genlist?.value as unknown as GenList
    expect(repeats(rows(plan, list))).toEqual([])
  })

  it('the measure: the same scene twice is alike, two different gestures are not, framing words do not count', () => {
    const a = 'Slow pan along a clean matte white limewashed wall corner, no stains, soft raking light'
    expect(sceneSimilarity(a, a)).toBe(1)
    expect(sceneSimilarity('close shot of a wardrobe slid away from the wall', 'wide shot of a wardrobe slid away from the wall')).toBe(1)
    expect(sceneSimilarity(a, 'Close shot of weathered mason’s hands holding a trowel of white lime putty')).toBeLessThan(0.2)
  })
})
