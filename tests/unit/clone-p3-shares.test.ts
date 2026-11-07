// P3's element shares agree with the analyses they come from (a single-video clone of a Finary Short stopped at P3 on
// 2026-11-04: archive footage of public figures speaking, « presenter » shots seen off screen, was counted as the channel's
// presenter: 46 % against 34 % measured). The map repairs itself when its rules disagree; P3's check stays strict. Fakes only.
import { describe, expect, it } from 'vitest'
import type { AnalysedShot, Brief, MediaOrigin, VideoAnalysis } from '../../src/shared/clone'
import { crossCheckElements, measureElements } from '../../src/main/production/clone/definition/elements'
import { fakeChannel, fakeCorpus } from '../../src/main/production/clone/fakes/channels'

const brief = { ownChannel: false, humanInputs: { face: false, voice: false, footage: false } } as unknown as Brief

/** A fake analysis whose shots are replaced, its origin shares recomputed from them (as the analysis service does). */
function analysisWith(shots: Omit<AnalysedShot, 'n' | 'startS' | 'words' | 'illustrates' | 'camera' | 'frames' | 'onScreenText'>[]): VideoAnalysis {
  const ch = fakeChannel('presenter-motion')
  const a = ch.analyse(fakeCorpus(ch)[0]!, 'p2/v')
  let t = 0
  const out: AnalysedShot[] = shots.map((s, i) => {
    const shot: AnalysedShot = { ...s, n: i + 1, startS: t, words: 'words', illustrates: 'yes', camera: 'still', frames: [`p2/v/f${i}.jpg`], onScreenText: '' }
    t += s.lengthS
    return shot
  })
  const shares: Partial<Record<MediaOrigin, number>> = {}
  for (const s of out) shares[s.origin] = Math.round((((shares[s.origin] ?? 0) * t + s.lengthS) / t) * 1000) / 1000
  return { ...a, shots: out, coverage: { ...a.coverage, durationS: t, readS: t }, editing: { ...a.editing, originShares: shares } }
}

const P = (lengthS: number): Parameters<typeof analysisWith>[0][number] => ({ kind: 'presenter', origin: 'presenter', layout: 'full', angle: 0, lengthS, shows: 'presenter to camera' })
const F = (lengthS: number, kind: AnalysedShot['kind'] = 'stock-footage'): Parameters<typeof analysisWith>[0][number] => ({ kind, origin: 'found', layout: 'off', angle: null, lengthS, shows: 'found footage' })
const M = (lengthS: number): Parameters<typeof analysisWith>[0][number] => ({ kind: 'motion-graphic', origin: 'motion', layout: 'off', angle: null, lengthS, shows: 'card' })

describe('P3 element shares agree with the analyses', () => {
  it('a person speaking in FOUND footage is footage, not the channel\'s presenter (the Finary Short)', () => {
    const a = analysisWith([P(1.6), F(1.8), P(2.8), F(1.2), M(5), P(2.8), F(0.9), F(1.0, 'chart'), F(2.3), F(1.7), F(1.7, 'presenter'), M(2.3), P(2.7), P(1.8), F(1.8), F(3.6, 'presenter'), F(1.1), F(1.0), P(3.3), M(3.9)])
    const els = measureElements([a], brief)
    expect(crossCheckElements(els, [a])).toEqual([])
    const presenter = els.find((e) => e.id === 'presenter')!
    const presenterS = [1.6, 2.8, 2.8, 2.7, 1.8, 3.3].reduce((x, y) => x + y, 0)
    const total = a.shots.reduce((x, s) => x + s.lengthS, 0)
    expect(presenter.screenShare.value).toBeCloseTo(presenterS / total, 2)
    expect(els.find((e) => e.id === 'found-footage')!.kinds).toContain('presenter')
  })

  it('when the rules disagree with the measured origins, the map repairs itself from the shots\' origins', () => {
    // « presenter » shots the analysis says were GENERATED (a generated talking figure): the rules give them to the presenter,
    // the measured origins say generated; the repair owns every shot by its origin
    const g = (lengthS: number): Parameters<typeof analysisWith>[0][number] => ({ kind: 'presenter', origin: 'generated', layout: 'full', angle: 0, lengthS, shows: 'generated figure talking' })
    const a = analysisWith([P(3), g(3), F(3), g(3), M(3), P(3), g(3), F(3)])
    const els = measureElements([a], brief)
    expect(crossCheckElements(els, [a])).toEqual([])
    expect(els.find((e) => e.id === 'generated')!.screenShare.value).toBeCloseTo(9 / 24, 2)
    expect(els.find((e) => e.id === 'presenter')!.screenShare.value).toBeCloseTo(6 / 24, 2)
  })
})
