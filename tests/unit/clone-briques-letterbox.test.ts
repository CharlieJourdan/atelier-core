// moteur-briques — the letterbox measure (P2) and its brick (render.assemble): black bars measured on the reference's frames,
// written into the definition, drawn by the final pass.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { letterboxOf, measureLetterbox, parseCropdetect, type FrameBars } from '../../src/main/production/clone/analysis/letterbox'

const W = 384
const H = 216
const bars = (top: number, bottom = top): FrameBars => ({ width: W, height: H, top, bottom })

describe('letterbox measure', () => {
  it('parses cropdetect lines, a black frame as all bar', () => {
    const err = [
      '[Parsed_cropdetect_0 @ 0x1] x1:0 x2:383 y1:26 y2:187 w:384 h:162 x:0 y:26 pts:0 t:0.000000 limit:24.000000 crop=384:162:0:26',
      '[Parsed_cropdetect_0 @ 0x1] x1:383 x2:0 y1:215 y2:0 w:-384 h:-216 x:0 y:0 pts:1 t:0.04 crop=-384:-216:0:0'
    ].join('\n')
    expect(parseCropdetect(err, W, H)).toEqual([bars(26, 28), { width: W, height: H, top: H, bottom: 0 }])
  })

  it('measures a 2.39:1 letterbox kept on most frames, black fades left out', () => {
    const frames = [...Array.from({ length: 18 }, () => bars(27)), bars(0), bars(H, 0)]
    const m = letterboxOf(frames)
    expect(m).toEqual({ aspect: 2.37, barShare: 0.125, frameShare: 0.947, frames: 19 })
  })

  it('says nothing for a full-frame video, uneven borders or bars on a few frames only', () => {
    expect(letterboxOf(Array.from({ length: 10 }, () => bars(0)))).toBeNull()
    expect(letterboxOf(Array.from({ length: 10 }, () => bars(40, 2)))).toBeNull()
    expect(letterboxOf([bars(27), bars(27), bars(0), bars(0), bars(0)])).toBeNull()
    expect(letterboxOf([])).toBeNull()
  })

  const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0
  it.runIf(ffmpeg)('reads bars drawn by ffmpeg on real frames', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lb-'))
    for (const k of [1, 2, 3]) {
      execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', `color=c=0x6a4a3a:s=${W}x162:d=1`, '-vf', `pad=${W}:${H}:0:27:black`, '-frames:v', '1', '-y', path.join(dir, `f_0000${k}.jpg`)])
    }
    const run = async (cmd: string, args: string[]) => {
      const r = spawnSync(cmd, args, { encoding: 'utf8' })
      return { stdout: r.stdout, stderr: r.stderr }
    }
    const m = await measureLetterbox(run, dir, W, H)
    expect(m?.aspect).toBeGreaterThan(2.3)
    expect(m?.aspect).toBeLessThan(2.45)
    expect(m?.frameShare).toBe(1)
  })
})

describe('letterbox brick', () => {
  it('draws two even black bars for the measured aspect, none when the frame is already that wide', async () => {
    const { letterboxFilters } = await import('../../src/engine/render/final')
    expect(letterboxFilters([1920, 1080], 2.01)).toEqual(['drawbox=x=0:y=0:w=iw:h=62:color=black:t=fill', 'drawbox=x=0:y=ih-62:w=iw:h=62:color=black:t=fill'])
    expect(letterboxFilters([1920, 1080], 2.39)[0]).toContain('h=138')
    expect(letterboxFilters([1920, 1080], 1.78)).toEqual([])
  })

  it('the definition field compiles into render.assemble.letterbox; nothing when the picture fills the frame', async () => {
    const { BRICK_SETTINGS } = await import('../../src/main/production/clone/pipeline/settings')
    const rule = BRICK_SETTINGS.find((r) => r.key === 'render.assemble.letterbox')!
    const def = (v: unknown) => ({ editing: { letterbox: { value: v, source: 'measured', evidence: [] } } }) as never
    expect(rule.fields).toEqual(['editing.letterbox'])
    expect(rule.from(def({ aspect: 2.01, barShare: 0.056 }))).toBe(2.01)
    expect(rule.from(def(null))).toBeNull()
  })
})
