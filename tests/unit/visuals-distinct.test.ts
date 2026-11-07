// avatar-qualite part 3 (run 6 stopped at its render on « two shots show almost the same picture »): two stills alike within
// 20 s are dealt with at the stills stage, before any clip: the later one is made again once with a contrasting framing and
// the better of the two is kept; the render only warns. Pictures drawn here with ffmpeg (skipped without it).
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { GenItem } from '../../src/engine/formats/editplan'
import { contrastingShot, distinctPass } from '../../src/engine/nodes/visuals-distinct'
import { FFMPEG_PATH, hasFfmpeg, makeCtx, tempDir, testServices } from './engine-node-helpers'

const tmp = tempDir('distinct')
afterAll(() => tmp.cleanup())

/** A 640×360 picture from an ffmpeg source (`testsrc2`, a gradient, a flipped one…). */
function picture(name: string, filter: string): string {
  const f = path.join(tmp.dir, name)
  execFileSync(FFMPEG_PATH as string, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=1', '-vf', filter, '-frames:v', '1', '-q:v', '3', f])
  return f
}

const item = (id: string, atS: number, size: string, o: Partial<GenItem> = {}): GenItem => ({
  id,
  kind: 'image.gen',
  prompt: `${size} of a bedroom wall corner ${id}`,
  shot: { size, scene: `a bedroom wall corner ${id}` },
  constraints: { durationS: 3, aspect: '16:9' },
  context: { beatText: '', subject: id, keyTerms: [], atS },
  unitPrice: 0,
  units: 1,
  priority: 0,
  shotIds: [`s-${id}`],
  ...o
})

describe.skipIf(!hasFfmpeg)('two stills alike are made again at the stills stage, never a stop', () => {
  it('a contrasting framing: a close picture goes wide, anything else to a close detail', () => {
    expect(contrastingShot(item('a', 0, 'close-up')).size).toBe('wide shot')
    expect(contrastingShot(item('a', 0, 'medium shot')).size).toBe('extreme close-up detail')
    expect(contrastingShot(item('a', 0, 'wide shot')).scene).toMatch(/a different framing from the picture before/)
  })

  it('the later of two alike within 20 s is made again once; the new one stays when it looks less like its neighbours', async () => {
    const a = picture('a.jpg', 'null')
    const b = picture('b.jpg', 'noise=alls=4:allf=t')
    const files = [a, b]
    const remakes: { i: number; item: GenItem }[] = []
    const r = await distinctPass(makeCtx(testServices(tmp.dir)), {
      items: [item('item-1', 10, 'medium shot'), item('item-2', 15, 'medium shot')],
      files,
      skip: new Set(),
      remake: async (i, it) => {
        remakes.push({ i, item: it })
        files[i] = picture(`b-again-${remakes.length}.jpg`, 'hflip,vflip,hue=h=90')
      },
      restore: async () => {
        throw new Error('the new picture is better: nothing to restore')
      }
    })
    expect(remakes.map((x) => x.i)).toEqual([1])
    expect(remakes[0]?.item.shot?.size).toBe('extreme close-up detail')
    expect(r.notes.get(1)).toMatchObject({ kept: 'new' })
    expect((r.notes.get(1)?.likeness ?? 0) > (r.notes.get(1)?.after ?? 1)).toBe(true)
    expect(r.remade.has(1)).toBe(true)
    expect(r.line).toMatch(/1 refaite\(s\) avec un autre cadrage, 1 gardée/)
  })

  it('a new picture no better than the first: the first is put back (from its cache, nothing paid twice)', async () => {
    const a = picture('c.jpg', 'null')
    const files = [a, picture('d.jpg', 'null')]
    let restored = 0
    const r = await distinctPass(makeCtx(testServices(tmp.dir)), {
      items: [item('item-1', 0, 'close-up'), item('item-2', 3, 'close-up')],
      files,
      skip: new Set(),
      remake: async (i) => void (files[i] = picture('d-again.jpg', 'null')),
      restore: async () => void restored++
    })
    expect(restored).toBe(1)
    expect(r.notes.get(1)).toMatchObject({ kept: 'first' })
    expect(r.remade.size).toBe(0)
  })

  it('alike but 25 s apart, two shots of one clip, a hold or a shot without its time: never compared', async () => {
    const files = [picture('e.jpg', 'null'), picture('f.jpg', 'null'), picture('g.jpg', 'null'), picture('h.jpg', 'null')]
    const noTime = item('item-4', 31, 'close-up')
    const r = await distinctPass(makeCtx(testServices(tmp.dir)), {
      items: [item('item-1', 0, 'close-up'), item('item-2', 25, 'close-up'), item('item-3', 28, 'close-up', { sameAs: 'item-2' }), { ...noTime, context: { ...noTime.context, atS: undefined } }],
      files,
      skip: new Set(),
      remake: async () => {
        throw new Error('nothing to remake')
      },
      restore: async () => undefined
    })
    expect(r.notes.size).toBe(0)
    expect(r.line).toBeNull()
  })
})
