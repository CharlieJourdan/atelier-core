// avatar-qualite (Charlie 01/11 on the first real hook from the app): no music by default in `avatar@1` (the reference has
// none; the option brings the library back, its before / after preview made by pipeline-ui); the presenter is asked in 1080p
// where it costs no more; one lossy encode in the render chain (every intermediate is lossless H.264, the final pass the only
// compression), the HeyGen cut read as BT.709 and gently sharpened; two pictures alike within 20 s are only a warning at the render.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { OPTION_PREVIEWS, optionPreviewKey } from '../../src/shared/option-previews'
import { INTERMEDIATE_ENCODER, SEGMENT_ENCODER, segmentArgs } from '../../src/engine/render/segments'
import { shotProblems, shotWarnings, type CheckedShot } from '../../src/engine/render/shot-check'
import { NEAR_LIKENESS, likeness } from '../../src/engine/nodes/visuals-checks'
import { PRESENTER_SHARPEN } from '../../src/engine/presenter/talk'
import { avatarBase, compileRecipe, fromBase, technologyRegistry, type RecipeDoc } from '../../src/engine/technologies'
import { resolutionFor } from '../../src/shared/presenter-engines'

const reg = technologyRegistry()
const compiled = (doc: RecipeDoc) => {
  const r = compileRecipe(doc, reg)
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  return r.pipeline
}
const ROOT = path.join(__dirname, '..', '..')

describe('avatar-qualite: no music by default', () => {
  it('avatar@1 compiles without the music brick; the option « Bibliothèque » brings it back', () => {
    const doc = fromBase(avatarBase)
    expect(avatarBase.options.find((o) => o.id === 'music')?.default).toBe('none')
    expect(compiled(doc).nodes.map((n) => n.id)).not.toContain('sound')
    expect(compiled({ ...doc, options: { music: 'library' } }).nodes.map((n) => n.id)).toContain('sound')
  })

  it('the option shows its before / after with the sound (pipeline-ui’s option previews): « Aucune » then « Bibliothèque »', () => {
    expect(OPTION_PREVIEWS.find((o) => o.option === 'music')).toEqual({ option: 'music', before: 'none', after: 'library', sound: true })
    expect(optionPreviewKey('music', 'none')).toBe('option:music:none')
  })
})

describe('avatar-qualite: the presenter is asked in 1080p', () => {
  it('avatar@1 asks 1080p; HeyGen (plan and API) gets it at the same price; a dearer 1080p or a 720p-only fallback stays at 720p', () => {
    const avatar = compiled(fromBase(avatarBase)).nodes.find((n) => n.id === 'avatar')
    expect((avatar?.params as { talk?: { resolution?: string } }).talk?.resolution).toBe('1080p')
    expect(resolutionFor('presenter:heygen-mcp', '1080p')).toBe('1080p')
    expect(resolutionFor('presenter:heygen-avatar4', '1080p')).toBe('1080p')
    expect(resolutionFor('presenter:kling-avatar-kie', '1080p')).toBe('720p')
    expect(resolutionFor('presenter:infinitetalk-gpu', '1080p')).toBe('720p')
    // never dearer than the engine's default (Charlie 01/11): Hedra and Pruna charge more for 1080p
    expect(resolutionFor('presenter:hedra-c3', '1080p')).toBe('720p')
    expect(resolutionFor('presenter:pruna-avatar', '1080p')).toBe('720p')
    expect(resolutionFor('presenter:kling-avatar2-std', '1080p')).toBe('1080p')
    // the request HeyGen's servers receive: cloud/tests/cloud-presenter-1080p.test.ts
  })
})

describe('avatar-qualite: one lossy encode in the render chain', () => {
  it('every intermediate (presenter cut, clip piece, segment, join) is lossless H.264; only the final pass compresses', () => {
    for (const enc of [INTERMEDIATE_ENCODER, SEGMENT_ENCODER]) {
      expect(enc.join(' ')).toContain('-qp 0')
      expect(enc).not.toContain('-crf')
    }
    const seg = segmentArgs({ shotId: 's1', frames: 30, image: 'a.jpg', clip: { file: 'c.mp4', durationS: 1 }, motion: undefined, dipIn: false, dipOut: false, grade: 'none' }, 'out.mp4')
    expect(seg.join(' ')).toContain('-qp 0')
    expect(seg).not.toContain('-crf')
    // the files of the chain: a lossy rate setting (-crf) is written in the final pass only
    const chain = ['src/engine/presenter/talk.ts', 'src/engine/nodes/clip-make.ts', 'src/engine/render/segments.ts', 'src/engine/nodes/background-clips.ts', 'src/engine/render/final.ts']
    const lossy = chain.filter((f) => /'-crf'/.test(readFileSync(path.join(ROOT, f), 'utf8')))
    expect(lossy).toEqual(['src/engine/render/final.ts'])
  })

  it('the presenter cut gets a mild luma sharpen, chroma untouched', () => {
    expect(PRESENTER_SHARPEN).toBe('unsharp=5:5:0.35:5:5:0')
  })
})

describe('avatar-qualite: two pictures alike within 20 s are only a warning at the render (part 3)', () => {
  // 32×18 grey thumbnails: a diagonal ramp, the same with a little noise, its mirror (another picture), a flat field
  const ramp = Array.from({ length: 576 }, (_, i) => ((i % 32) + Math.floor(i / 32)) * 5)
  const noisy = ramp.map((v, i) => v + ((i * 37) % 11) - 5)
  const mirror = ramp.map((_, i) => ramp[575 - i] as number)
  const shot = (id: string, startS: number, grey: number[], o: Partial<CheckedShot> = {}): CheckedShot => ({ id, presenter: false, startS, endS: startS + 3, source: id, borrowed: false, grey, ...o })

  it('alike within 20 s: a warning, never a problem; 25 s apart, different, or the two shots of one clip: nothing', () => {
    expect(NEAR_LIKENESS).toBe(0.85)
    expect(likeness(ramp, noisy)).toBeGreaterThan(0.95)
    expect(likeness(ramp, mirror)).toBeLessThan(0)
    const pair = [shot('s1', 0, ramp), shot('s2', 4, noisy)]
    expect(shotProblems(pair)).toEqual([])
    expect(shotWarnings(pair)).toEqual([expect.stringMatching(/^les plans de 0:00 et 0:04 se ressemblent \(\d+ %\)$/)])
    expect(shotWarnings([shot('s1', 0, ramp), shot('s2', 25, noisy)])).toEqual([])
    expect(shotWarnings([shot('s1', 0, ramp), shot('s2', 4, mirror)])).toEqual([])
    expect(shotWarnings([shot('s1', 0, ramp, { group: 'item-1' }), shot('s2', 4, noisy, { group: 'item-1' })])).toEqual([])
    // a demo drawing has no thumbnail: never compared
    expect(shotWarnings([shot('s1', 0, ramp), { ...shot('s2', 4, ramp), grey: undefined }])).toEqual([])
  })
})
