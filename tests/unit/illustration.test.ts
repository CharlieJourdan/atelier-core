// avatar-qualite part 2 (Charlie 01/11 on the second real hook: « il faut que ce soit coupé au moment même, ultra précis, de
// ce qui est dit »): the talk / show sort that puts the presenter on the talk sentences; the illustration check that scores each
// picture against the words under its shot, remakes one under the bar once and never pays the same remake twice; pictures in
// the LLM layer (Claude Code reads them with its Read tool on their folders only, the API gets image blocks); the reference's
// camera in the clips' default motion.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { GenItem } from '../../src/engine/formats/editplan'
import { EngineError } from '../../src/engine/errors'
import { DEFAULT_MOTION } from '../../src/engine/nodes/clip-make'
import { ILLUSTRATION_RULES } from '../../src/engine/nodes/director-grammars'
import { avatarBase, compileRecipe, fromBase, technologyRegistry } from '../../src/engine/technologies'
import { talkByWords } from '../../src/engine/nodes/director-talk'
import { ILLUSTRATION_BAR, illustrationPass } from '../../src/engine/nodes/visuals-illustration'
import type { ClaudeService } from '../../src/engine/services'
import { buildRequest } from '../../src/main/llm/anthropic'
import { agentArgs, withPictures } from '../../src/main/llm/claude-code'
import { makeCtx, tempDir, testServices } from './engine-node-helpers'

const tmp = tempDir('illustration')
afterAll(() => tmp.cleanup())

describe('talk or show: the presenter on the talk sentences (the reference does it)', () => {
  it('the rule on the words sorts the hook as Charlie’s reference shows it', () => {
    for (const t of ['Sauf que dans ce coin-là, ce n’est pas le mur qui est malade.', 'Le pour toujours, je vais vous dire honnêtement ce qu’il vaut.', 'On va faire ça en quatre temps.', 'Pourquoi c’est toujours...', 'Les erreurs qui le ratent.'])
      expect(talkByWords(t), t).toBe('talk')
    for (const t of ['Et derrière, dans l’angle du mur côté nord, la moisissure est revenue.', 'L’an dernier, vous l’aviez frotté avec un spray du supermarché.', 'Elle tient dans un sac de chaux, une brosse et quelques jours de patience.'])
      expect(talkByWords(t), t).toBe('show')
  })

  it('avatar@1’s grammar is its references’ (a preset it picks): literal, the angle by what is said, talk to the presenter', () => {
    const g = ILLUSTRATION_RULES['reference-literal'].join('\n')
    expect(g).toMatch(/95 %/)
    expect(g).toMatch(/first-person hands/)
    expect(g).toMatch(/belong to the presenter/)
    // the steady phone camera is avatar@1’s clip setting; the engine’s own default stays a generic gentle motion
    const r = compileRecipe(fromBase(avatarBase), technologyRegistry())
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
    expect((r.pipeline.nodes.find((n) => n.id === 'clips')?.params as { motion?: string }).motion).toMatch(/steady at eye level/)
    expect(DEFAULT_MOTION).not.toMatch(/steady at eye level/)
  })
})

const item = (id: string, said: string, scene: string): GenItem => ({
  id,
  kind: 'image.gen',
  prompt: scene,
  shot: { size: 'medium shot', scene },
  constraints: { durationS: 3, aspect: '16:9' },
  context: { beatText: said, subject: id, keyTerms: [], said },
  unitPrice: 0,
  units: 1,
  priority: 0,
  shotIds: [`s-${id}`]
})

describe('the illustration check', () => {
  const files = ['a.jpg', 'b.jpg', 'c.jpg'].map((n, i) => {
    const f = path.join(tmp.dir, n)
    writeFileSync(f, Buffer.from(`picture ${i}`))
    return f
  })
  const items = [
    item('item-1', 'la moisissure est revenue', 'extreme close-up of grey mould dots in a wall corner'),
    item('item-2', 'ce n’est pas le mur qui est malade', 'a hand resting flat on a healthy wall'),
    item('item-3', 'un sac de chaux, une brosse', 'an open sack of lime and a wide brush')
  ]
  /** The judge: picture 2 (the hand on a wall) is an idea, 3/10, with a better prompt; the rest 9/10; a remade picture 8/10. */
  const judge = (): { svc: ClaudeService; calls: { prompt: string; images: string[] }[] } => {
    const calls: { prompt: string; images: string[] }[] = []
    return {
      calls,
      svc: {
        ask: (req) => {
          calls.push({ prompt: req.prompt, images: req.images ?? [] })
          const shots = (req.images ?? []).map((_, k) => {
            const line = req.prompt.split('\n').find((l) => l.startsWith(`${k + 1} · `)) ?? ''
            const idea = line.includes('healthy wall')
            const remade = line.includes('mould spots in the corner behind')
            return { n: k + 1, score: idea ? 3 : remade ? 8 : 9, angle: 'object-close', shows: 'x', why: idea ? 'a picture of an idea' : 'shows the words', ...(idea ? { better: 'Steady phone photo of mould spots in the corner behind a wardrobe' } : {}) }
          })
          return Promise.resolve({ text: JSON.stringify({ shots }) })
        }
      }
    }
  }

  it('scores every picture against its words; one under the bar is remade once with the judge’s prompt, then scored again', async () => {
    const j = judge()
    const ctx = makeCtx(testServices(tmp.dir, { claude: j.svc }))
    const remade: { i: number; item: GenItem }[] = []
    const r = await illustrationPass(ctx, { items, files, skip: new Set(), parallel: 2, remake: async (i, it) => void remade.push({ i, item: it }) })
    expect(j.calls[0]?.images).toEqual(files)
    expect(j.calls[0]?.prompt).toContain('« ce n’est pas le mur qui est malade »')
    expect(remade.map((x) => x.i)).toEqual([1])
    expect(remade[0]?.item.shot?.scene).toBe('Steady phone photo of mould spots in the corner behind a wardrobe')
    expect(r.notes.get(1)).toMatchObject({ first: 3, score: 8 })
    expect(r.notes.get(0)?.score).toBe(9)
    expect(r.line).toMatch(/1 refaite/)
    expect(3).toBeLessThan(ILLUSTRATION_BAR)
  })

  it('a rerun reads the verdicts it already has: no call, no second remake of the same picture', async () => {
    const j = judge()
    const ctx = makeCtx(testServices(tmp.dir, { claude: j.svc }))
    let remakes = 0
    // the remade picture's bytes are the same file here, so its new scene is what makes its verdict new
    const r = await illustrationPass(ctx, { items, files, skip: new Set(), parallel: 2, remake: async () => void remakes++ })
    expect(j.calls.length).toBe(0) // the first verdicts and the remade picture's are both kept from the first run
    expect(remakes).toBe(1)
    expect(r.notes.get(1)?.score).toBe(8)
  })

  it('a hold or a shot without its words is never judged; a failed call leaves pictures unscored, the run goes on', async () => {
    const svc: ClaudeService = { ask: () => Promise.resolve({ text: 'no json' }) }
    const ctx = makeCtx(testServices(path.join(tmp.dir, 'other'), { claude: svc }))
    const r = await illustrationPass(ctx, { items: [items[0] as GenItem, { ...(items[1] as GenItem), context: { ...(items[1] as GenItem).context, said: undefined } }], files, skip: new Set(), parallel: 1, remake: async () => undefined })
    expect(r.notes.size).toBe(0)
    expect(r.line).toBe('illustration : non vérifiée')
  })

  it('a remake that scores lower puts the first picture back (run 7: 7 then 5, and the 5 was kept)', async () => {
    const svc: ClaudeService = {
      ask: (req) => {
        const shots = (req.images ?? []).map((_, k) => {
          const line = req.prompt.split('\n').find((l) => l.startsWith(`${k + 1} · `)) ?? ''
          const idea = line.includes('healthy wall')
          const remade = line.includes('a better corner')
          return { n: k + 1, score: idea ? 7 : remade ? 5 : 9, angle: 'object-close', shows: 'x', why: idea ? 'close' : 'ok', ...(idea ? { better: 'Steady phone photo of a better corner' } : {}) }
        })
        return Promise.resolve({ text: JSON.stringify({ shots }) })
      }
    }
    const ctx = makeCtx(testServices(path.join(tmp.dir, 'worse'), { claude: svc }))
    const restored: number[] = []
    const r = await illustrationPass(ctx, { items, files, skip: new Set(), parallel: 1, remake: async () => undefined, restore: async (i) => void restored.push(i) })
    expect(restored).toEqual([1])
    expect(r.remade.has(1)).toBe(false)
    expect(r.notes.get(1)).toMatchObject({ score: 7, first: 7, kept: 5 })
  })

  it('a dead sign-in never stops the run either (record 0055): the pictures stay unscored', async () => {
    const svc: ClaudeService = { ask: () => Promise.reject(new EngineError('missing_tool', 'claude is not signed in')) }
    const ctx = makeCtx(testServices(path.join(tmp.dir, 'dead'), { claude: svc }))
    const r = await illustrationPass(ctx, { items, files, skip: new Set(), parallel: 1, remake: async () => undefined })
    expect(r.notes.size).toBe(0)
    expect(r.line).toBe('illustration : non vérifiée')
  })
})

describe('pictures in the LLM layer', () => {
  it('Claude Code reads them with its Read tool, on their folders only, listed at the head of the prompt', () => {
    const req = { model: 'claude-sonnet-5-5', prompt: 'Score them.', images: ['C:/frames/a.jpg', 'C:/frames/b.jpg', 'D:/other/c.png'] }
    const args = agentArgs(req, tmp.dir)
    expect(args.slice(0, 4)).toEqual(['--tools', 'Read', '--allowedTools', 'Read'])
    expect(args).toContain('dontAsk')
    expect(args.filter((_a, i) => args[i - 1] === '--add-dir').map((d) => d.replace(/\\/g, '/'))).toEqual(['C:/frames', 'D:/other'])
    expect(withPictures(req)).toMatch(/^Read these pictures first[\s\S]*1\. C:\/frames\/a\.jpg[\s\S]*3\. D:\/other\/c\.png[\s\S]*Score them\.$/)
    // a call without pictures is unchanged
    expect(agentArgs({ model: 'm', prompt: 'x' }, tmp.dir)).toEqual(['--tools', '', '--strict-mcp-config'])
    expect(withPictures({ model: 'm', prompt: 'x' })).toBe('x')
  })

  it('the Anthropic API gets them as image blocks before the text', () => {
    const body = buildRequest({ model: 'claude-sonnet-5-5', prompt: 'Score them.', images: [files0()] })
    const content = body.messages[0]?.content as { type: string; source?: { media_type: string; data: string } }[]
    expect(content.map((c) => c.type)).toEqual(['image', 'text'])
    expect(content[0]?.source?.media_type).toBe('image/jpeg')
    expect(Buffer.from(content[0]?.source?.data ?? '', 'base64').toString()).toBe('a picture')
  })
})

function files0(): string {
  const f = path.join(tmp.dir, 'one.jpg')
  writeFileSync(f, 'a picture')
  return f
}
