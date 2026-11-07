// Outlier detection (src/shared/outliers.ts): views against the channel's median, compared per age, pure maths.
import { describe, expect, it } from 'vitest'
import { ageDaysOf, median, outliersOf, scoreVideos, whyItWorked, type VideoStat } from '../../src/shared/outliers'

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0)
const DAY = 86_400_000
const at = (ageDays: number): string => new Date(NOW - ageDays * DAY).toISOString()
const video = (id: string, ageDays: number, views: number, extra: Partial<VideoStat> = {}): VideoStat => ({ id, title: `Titre ${id}`, views, publishedAt: at(ageDays), ...extra })

/** A channel whose videos gain views with age the way real ones do: fast at first, then flat. One video a week. */
const channel = (n = 20): VideoStat[] => Array.from({ length: n }, (_, i) => video(`v${i}`, 7 * (i + 1), Math.round(100_000 * (1 - Math.exp(-(7 * (i + 1)) / 30)))))

describe('median and age', () => {
  it('median of odd, even and empty lists', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBe(0)
  })

  it('age in days; unreadable or future dates are 0', () => {
    expect(ageDaysOf(at(10), NOW)).toBeCloseTo(10, 6)
    expect(ageDaysOf('not a date', NOW)).toBe(0)
    expect(ageDaysOf(new Date(NOW + 3 * DAY).toISOString(), NOW)).toBe(0)
  })
})

describe('scoring videos by age', () => {
  it('a channel with a steady rise has no outlier: old videos are not judged against young ones', () => {
    const scored = scoreVideos(channel(), { now: NOW })
    expect(scored.every((v) => !v.outlier)).toBe(true)
    // a video sits close to its neighbours of the same age (the very freshest are judged against older ones, so they read low)
    for (const v of scored.filter((s) => s.ageDays >= 35)) {
      expect(v.score).toBeGreaterThan(0.7)
      expect(v.score).toBeLessThan(1.5)
    }
  })

  it('finds a video that does 5 times what its neighbours in age do, and not the oldest simply for being old', () => {
    const base = channel()
    const spiked = base.map((v) => (v.id === 'v8' ? { ...v, views: v.views * 5 } : v))
    const out = outliersOf(spiked, { now: NOW })
    expect(out.map((v) => v.id)).toEqual(['v8'])
    expect(out[0]?.score).toBeGreaterThan(4)
    expect(out[0]?.baseline).toBeGreaterThan(0)
    // compared with the whole channel's median the oldest videos would all look like outliers: they must not
    expect(spiked.at(-1)?.views).toBeGreaterThan(median(spiked.map((v) => v.views)))
    expect(out.find((v) => v.id === 'v19')).toBeUndefined()
  })

  it('does not judge a video younger than the minimum age, and gives it no baseline', () => {
    const vids = [...channel(), video('fresh', 0.5, 99_999)]
    const fresh = scoreVideos(vids, { now: NOW }).find((v) => v.id === 'fresh')
    expect(fresh).toMatchObject({ tooYoung: true, score: null, baseline: null, outlier: false })
  })

  it('needs enough comparable videos: three at least, else no score', () => {
    const few = [video('a', 30, 1000), video('b', 40, 1000), video('c', 50, 100_000)]
    expect(scoreVideos(few, { now: NOW }).every((v) => v.score === null && !v.outlier)).toBe(true)
    const four = [...few, video('d', 60, 1000)]
    expect(scoreVideos(four, { now: NOW }).find((v) => v.id === 'c')?.score).toBeCloseTo(100, 0)
  })

  it('ignores a spike that is too small in absolute terms (minViews) and honours the threshold option', () => {
    const tiny = Array.from({ length: 10 }, (_, i) => video(`t${i}`, 10 + i * 5, i === 3 ? 90 : 10))
    expect(outliersOf(tiny, { now: NOW })).toEqual([])
    expect(outliersOf(tiny, { now: NOW, minViews: 50 }).map((v) => v.id)).toEqual(['t3'])
    const base = channel().map((v) => (v.id === 'v5' ? { ...v, views: Math.round(v.views * 2.2) } : v))
    expect(outliersOf(base, { now: NOW, threshold: 3 })).toEqual([])
    expect(outliersOf(base, { now: NOW, threshold: 2 }).map((v) => v.id)).toEqual(['v5'])
  })

  it('a baseline of zero gives no score (nothing to divide by)', () => {
    const zeros = Array.from({ length: 6 }, (_, i) => video(`z${i}`, 10 + i, 0))
    expect(scoreVideos(zeros, { now: NOW }).every((v) => v.score === null)).toBe(true)
  })

  it('sorts outliers strongest first', () => {
    const base = channel(24).map((v) => (v.id === 'v4' ? { ...v, views: v.views * 3 } : v.id === 'v12' ? { ...v, views: v.views * 6 } : v))
    expect(outliersOf(base, { now: NOW }).map((v) => v.id)).toEqual(['v12', 'v4'])
  })
})

describe('why an outlier worked, from the numbers alone', () => {
  const base = channel().map((v, i) => ({ ...v, likes: Math.round(v.views * 0.03), durationS: 600 + (i % 3) * 20 }))
  const spiked = base.map((v) => (v.id === 'v8' ? { ...v, views: v.views * 5, likes: v.views * 5 * 0.09, durationS: 1500 } : v))
  const top = outliersOf(spiked, { now: NOW })[0]

  it('says how far above the same-age videos it is, with the real figures', () => {
    expect(top?.id).toBe('v8')
    const fr = whyItWorked(top!, spiked, 'fr')
    expect(fr).toMatch(/^\d+(,\d)? fois les vues des vidéos de même âge/)
    expect(fr).toContain((top!.views).toLocaleString('fr-FR'))
    const en = whyItWorked(top!, spiked, 'en')
    expect(en).toMatch(/^\d+(\.\d)?x the views of the channel's videos of the same age/)
  })

  it('adds engagement and length only when they really differ from the channel’s median', () => {
    const fr = whyItWorked(top!, spiked, 'fr')
    expect(fr).toContain('mentions « j’aime » que d’habitude')
    expect(fr).toContain('plus longue que d’habitude')
    const plain = outliersOf(base.map((v) => (v.id === 'v8' ? { ...v, views: v.views * 5 } : v)), { now: NOW })[0]!
    const text = whyItWorked(plain, base, 'fr')
    expect(text).not.toContain('plus longue')
    expect(text).not.toContain('j’aime')
  })

  it('says nothing for a video that has no score', () => {
    const young = scoreVideos([...base, video('fresh', 0.2, 5)], { now: NOW }).find((v) => v.id === 'fresh')!
    expect(whyItWorked(young, base, 'fr')).toBe('')
  })
})
