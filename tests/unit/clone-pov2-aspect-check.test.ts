// moteur-pov-2 — the reference's measured format is a BLOCKING check on the delivered film (decision 0102's family): measured by
// ffprobe, a wrong frame is re-framed and measured again, still wrong → the film is refused. Never a judge's opinion.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkedAspect } from '../../src/engine/nodes/render-assemble'
import { aspectDefect, parseSize, reframeArgs } from '../../src/engine/review/blocking-aspect'
import { isBlocking } from '../../src/engine/review/blocking'
import { createMediaService } from '../../src/engine/media/tools'
import type { MediaService } from '../../src/engine/services'
import type { RunCtx } from '../../src/engine/registry'
import type { NodeOutputs } from '../../src/engine/artefacts'
import { MONDE_POV } from '../../src/main/production/clone/definition/fixtures/profiles'
import { runDefinition } from '../../src/main/production/clone/definition/fixtures/run'
import { settingsFromDefinition } from '../../src/main/production/clone/plan-rules'
import { withAtPath, type Sourced, type StyleDefinition } from '../../src/shared/clone'

const ctxWith = (media: MediaService): RunCtx => ({ services: { media }, signal: new AbortController().signal, emit: () => undefined }) as unknown as RunCtx
const filmOf = (file: string, w: number, h: number): NodeOutputs => ({ video: { files: [file], meta: { durationS: 2, width: w, height: h } } }) as unknown as NodeOutputs

/** A media service whose ffprobe always reads `size` (ffmpeg does nothing): a re-frame that does not take. */
const stuck = (size: string): MediaService => ({
  run: async (tool: string) => ({ stdout: Buffer.from(tool === 'ffprobe' ? size : ''), stderr: '' }),
  stream: () => { throw new Error('unused') }
}) as unknown as MediaService

describe('the frame format check', () => {
  it('is a real error, measured: a wide film for a vertical reference, an unreadable film', () => {
    expect(parseSize('1920,1080\n')).toEqual({ w: 1920, h: 1080 })
    expect(aspectDefect('9:16', { w: 1080, h: 1920 }, 10)).toBeNull()
    const d = aspectDefect('9:16', { w: 1920, h: 1080 }, 10)!
    expect(d.kind).toBe('wrong_aspect')
    expect(isBlocking(d)).toBe(true)
    expect(aspectDefect('16:9', null, 10)?.kind).toBe('wrong_aspect')
    expect(reframeArgs('a.mp4', 'b.mp4', '9:16').join(' ')).toContain('pad=1080:1920')
    expect(reframeArgs('a.mp4', 'b.mp4', '9:16').join(' ')).not.toContain('crop=')
  })

  it('a wrong frame that cannot be repaired is refused, whatever the render was asked', async () => {
    await expect(checkedAspect(ctxWith(stuck('1920,1080')), { aspect: '9:16', crf: 18 }, filmOf('x.mp4', 1920, 1080))).rejects.toMatchObject({ code: 'verify_failed' })
    // a right frame passes untouched; no measured format: no check
    const ok = filmOf('x.mp4', 1080, 1920)
    expect(await checkedAspect(ctxWith(stuck('1080,1920')), { aspect: '9:16', crf: 18 }, ok)).toBe(ok)
    expect(await checkedAspect(ctxWith(stuck('1920,1080')), { crf: 18 }, ok)).toBe(ok)
  })

  const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0
  it.runIf(ffmpeg)('re-frames a real wide film to the vertical format and says so', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'asp-'))
    const film = path.join(dir, 'final.mp4')
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x180:d=1', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', film])
    const out = await checkedAspect(ctxWith(createMediaService({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' })), { aspect: '9:16', crf: 30 }, filmOf(film, 320, 180))
    const meta = out.video!.meta as Record<string, unknown>
    expect([meta.width, meta.height]).toEqual([1080, 1920])
    expect(String(meta.aspectRepaired)).toContain('320×180')
    expect(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', film]).toString().trim()).toBe('1080,1920')
  })

  it('the measured format reaches render.assemble from the definition; an unmeasured one checks nothing', async () => {
    const { definition } = await runDefinition(MONDE_POV)
    expect(settingsFromDefinition(definition).find((s) => s.key === 'render.assemble.aspect')?.value).toBeNull()
    const tall = withAtPath(definition, 'editing.aspect', { value: '9:16', source: 'measured', evidence: [{ video: 'v1', atS: 0, frames: ['f.jpg'] }] } as Sourced) as StyleDefinition
    expect(settingsFromDefinition(tall).find((s) => s.key === 'render.assemble.aspect')?.value).toBe('9:16')
  })
})
