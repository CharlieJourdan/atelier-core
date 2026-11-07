// production-7, the angles' face-similarity check (pipeline-avatar §2.5 a, decision 0034): on the stand-in presenters (ten
// people, each drawn medium = the portrait, wide and close), no other person, black frame or noise frame reaches
// ANGLE_SIMILARITY_MIN, and at least 70 % of the true angles do (a dropped true angle is made again). The scores are printed:
// they are how the threshold was picked (above the best other-person score). Real-looking faces: production-10.
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Framing } from '../../src/shared/presenter-engines'
import { drawPortrait } from '../../src/engine/media/draw-video'
import { PALETTE } from '../../src/engine/media/draw'
import { ANGLE_SIMILARITY_MIN, faceSignature, signatureSimilarity, type FaceSignature } from '../../src/engine/presenter/face'
import { MEDIA, NO_FULL_FFMPEG, hasFullFfmpeg, tempDir } from './engine-node-helpers'

const signal = new AbortController().signal
const t = tempDir('faces')
afterAll(() => t.cleanup())

describe.skipIf(!hasFullFfmpeg)(`the angles' similarity check${NO_FULL_FFMPEG}`, () => {
  it('keeps the same person in another framing and drops another person or a broken picture', { timeout: 240_000 }, async () => {
    const media = MEDIA as NonNullable<typeof MEDIA>
    // a hash per palette entry: ten people
    const people = PALETTE.map((_p, k) => `${k.toString(16).padStart(8, '0')}${(k * 53 + 3).toString(16).padStart(8, '0')}`)
    expect(new Set(people.map((h) => parseInt(h, 16) % PALETTE.length)).size).toBe(PALETTE.length)
    const file = (p: number, f: Framing): string => path.join(t.dir, `p${p}-${f}.png`)
    for (const [p, hash] of people.entries()) {
      for (const f of ['medium', 'wide', 'close'] as const) await drawPortrait(media, { out: file(p, f), hash, aspect: '16:9', framing: f, signal })
    }
    const black = path.join(t.dir, 'black.png')
    const noise = path.join(t.dir, 'noise.png')
    await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:d=1', '-frames:v', '1', black], { signal })
    await media.run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'nullsrc=s=1920x1080:d=1,geq=random(1)*255:128:128', '-frames:v', '1', noise], { signal })
    const sig = new Map<string, FaceSignature | null>()
    for (const f of [...people.keys()].flatMap((p) => (['medium', 'wide', 'close'] as const).map((g) => file(p, g))).concat([black, noise])) sig.set(f, await faceSignature(media, f, signal))
    const sim = (x: string, y: string): number => signatureSimilarity(sig.get(x) ?? null, sig.get(y) ?? null)
    const same: number[] = []
    const other: number[] = []
    for (const p of people.keys()) {
      for (const f of ['wide', 'close'] as const) same.push(sim(file(p, 'medium'), file(p, f)))
      for (const q of people.keys()) {
        if (q === p) continue
        for (const f of ['medium', 'wide', 'close'] as const) other.push(sim(file(p, 'medium'), file(q, f)))
      }
    }
    const broken = [sim(file(0, 'medium'), black), sim(file(0, 'medium'), noise)]
    const worstSame = Math.min(...same)
    const bestOther = Math.max(...other)
    console.log(`same person: min ${worstSame} median ${same.sort()[same.length >> 1]}; other people: max ${bestOther} median ${other.sort()[other.length >> 1]}; black / noise: ${broken.join(' / ')}`)
    // never another person; most true angles kept (a dropped one is made again)
    expect(bestOther).toBeLessThan(ANGLE_SIMILARITY_MIN)
    expect(same.filter((x) => x >= ANGLE_SIMILARITY_MIN).length / same.length).toBeGreaterThanOrEqual(0.7)
    expect(worstSame).toBeLessThanOrEqual(1)
    for (const b of broken) expect(b).toBeLessThan(ANGLE_SIMILARITY_MIN)
  })
})
