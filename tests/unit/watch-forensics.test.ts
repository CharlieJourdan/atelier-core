// The pixels' say on how a shot was made (chantier rea-video, decision 0110): the palette separates flat-colour pictures
// (motion design, vector drawings) from photographic ones, stillness is measured, and a « generated » shot made of a few
// flat colours is counted as a drawing or motion design. Synthetic frames only; no ffmpeg.
import { describe, expect, it } from 'vitest'
import { FX, FX_H, FX_W, forensicsOf, framesIn, meanChange, palette95, rgbFramesArgs, shotForensics, splitFrames, textureOf, type RgbFrame } from '../../src/engine/watch/forensics'
import { guardedOrigin } from '../../src/main/production/clone/analysis/forensic-guard'

/** A flat vector frame: a few solid colour bands. */
function flatFrame(colours: [number, number, number][], shift = 0): RgbFrame {
  const px = new Uint8Array(FX_W * FX_H * 3)
  for (let y = 0; y < FX_H; y++) for (let x = 0; x < FX_W; x++) {
    const c = colours[Math.floor(((x + shift) % FX_W) / (FX_W / colours.length))]!
    px.set(c, 3 * (y * FX_W + x))
  }
  return { w: FX_W, h: FX_H, px }
}

/** A photographic frame: a smooth gradient with seeded noise in every channel (hundreds of colours). */
function photoFrame(seed: number): RgbFrame {
  let s = seed
  const rnd = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  const px = new Uint8Array(FX_W * FX_H * 3)
  for (let i = 0; i < FX_W * FX_H; i++) {
    const x = i % FX_W
    const y = Math.floor(i / FX_W)
    px[3 * i] = Math.min(255, (x * 1.5 + rnd() * 60) | 0)
    px[3 * i + 1] = Math.min(255, (y * 2.5 + rnd() * 60) | 0)
    px[3 * i + 2] = Math.min(255, ((x + y) + rnd() * 60) | 0)
  }
  return { w: FX_W, h: FX_H, px }
}

describe('the palette and stillness of a shot', () => {
  it('a flat vector picture has a small palette, a noisy photo a large one', () => {
    expect(palette95(flatFrame([[10, 20, 30], [200, 120, 40], [250, 250, 250]]))).toBeLessThanOrEqual(3)
    expect(palette95(photoFrame(1))).toBeGreaterThanOrEqual(FX.photoPalette)
    expect(textureOf(FX.renderedPalette)).toBe('rendered')
    expect(textureOf(FX.renderedPalette + 1)).toBe('mixed')
    expect(textureOf(FX.photoPalette)).toBe('photographic')
  })

  it('a held picture is static, a moving one is not', () => {
    const a = flatFrame([[0, 0, 0], [255, 255, 255]])
    expect(meanChange(a, a)).toBe(0)
    const held = shotForensics(1, [a, a, a])
    expect(held).toMatchObject({ n: 1, frames: 3, static: true, texture: 'rendered' })
    const moving = shotForensics(2, [a, flatFrame([[0, 0, 0], [255, 255, 255]], 20)])
    expect(moving.static).toBe(false)
    expect(moving.change).toBeGreaterThan(FX.staticChange)
    expect(shotForensics(3, [a]).static).toBe(false)
  })

  it('frames are split from one raw file and picked inside each shot (at least one)', () => {
    const f = [flatFrame([[1, 2, 3]]), photoFrame(2), photoFrame(3), flatFrame([[9, 9, 9]])]
    const buf = new Uint8Array(f.length * FX_W * FX_H * 3)
    f.forEach((x, k) => buf.set(x.px, k * FX_W * FX_H * 3))
    const frames = splitFrames(buf)
    expect(frames).toHaveLength(4)
    // the frame exactly on the cut is left out (it may still show the shot before)
    expect(framesIn(0.5, 1.6, 4)).toEqual([2])
    expect(framesIn(1.6, 1.7, 4)).toHaveLength(1)
    const fx = forensicsOf([{ n: 1, startS: 0, endS: 0.4 }, { n: 2, startS: 0.5, endS: 1.6 }], frames)
    expect(fx.map((x) => x.texture)).toEqual(['rendered', 'photographic'])
    expect(rgbFramesArgs('in.mp4', 'out.raw')).toContain('rawvideo')
  })
})

describe('the palette overrules « generated » on flat-colour pictures', () => {
  const rendered = shotForensics(1, [flatFrame([[10, 10, 10], [240, 200, 0]])])
  const photo = shotForensics(1, [photoFrame(4)])
  it('a flat-colour « generated » shot is a drawing, or motion design for a card or a map', () => {
    expect(guardedOrigin('generated', 'generated', rendered)).toBe('drawn')
    expect(guardedOrigin('generated', 'illustration', rendered)).toBe('drawn')
    expect(guardedOrigin('generated', 'map', rendered)).toBe('motion')
  })
  it('a photographic « generated » shot stays generated, other origins are never touched, nothing without a measure', () => {
    expect(guardedOrigin('generated', 'generated', photo)).toBe('generated')
    // black-and-white archives have few colours too: a found shot is never re-routed by its palette
    expect(guardedOrigin('found', 'archive-film', rendered)).toBe('found')
    expect(guardedOrigin('generated', 'generated', undefined)).toBe('generated')
  })
})
