// An invented presenter's portrait is made on the Cloud's image engine while the app is signed in (style-japanese: « Kenji »
// came out as the stand-in drawing although the brain was signed in); an angle sends the portrait as its reference; signed
// out, the stand-in drawing stays.
import { trackTemp } from '../setup/track-temp'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { cloudPresenterPictures, PORTRAIT_ENGINE, type PresenterPictures } from '../../src/main/production/presenters/pictures'

const tmp = (): string => trackTemp(mkdtempSync(path.join(os.tmpdir(), 'atelier-presenter-pictures-')))

function fakeCloud(dir: string) {
  const calls: { prompt: string; width: number; height: number; engine?: string; references?: string[]; key: string }[] = []
  return {
    calls,
    cloud: {
      async generateImage(req: { prompt: string; width: number; height: number; engine?: string; references?: string[] }, opts: { idempotencyKey: string }) {
        calls.push({ ...req, key: opts.idempotencyKey })
        const file = path.join(dir, `made-${calls.length}.png`)
        writeFileSync(file, 'png')
        return { files: [file], demo: false }
      }
    }
  }
}

const fallback = (): PresenterPictures & { used: string[] } => {
  const used: string[] = []
  return {
    used,
    async portrait() {
      used.push('portrait')
      return { file: 'drawn.png', demo: true }
    },
    async edit() {
      used.push('edit')
      return { file: 'drawn-angle.png', demo: true }
    }
  }
}

const media = { run: async () => ({ stdout: Buffer.from('1920,1080\n'), stderr: Buffer.from(''), code: 0 }) }

describe('cloudPresenterPictures', () => {
  it('signed in: the portrait from its words and an angle from the portrait, on the image engine', async () => {
    const dir = tmp()
    const c = fakeCloud(dir)
    const fb = fallback()
    const pics = cloudPresenterPictures({ dir, media: media as never, cloud: () => c.cloud, fallback: fb })
    const p = await pics.portrait({ prompt: 'Kenji, a 54-year-old Japanese man, selfie at home', aspect: '16:9', identity: '2' })
    expect(p.demo).toBe(false)
    expect(c.calls[0]).toMatchObject({ engine: PORTRAIT_ENGINE, width: 1920, height: 1080, prompt: 'Kenji, a 54-year-old Japanese man, selfie at home' })
    expect(c.calls[0]?.references).toBeUndefined()
    await pics.edit({ reference: p.file, prompt: 'the same man, three-quarter angle', framing: 'medium', identity: '2' })
    expect(c.calls[1]).toMatchObject({ engine: PORTRAIT_ENGINE, references: [p.file] })
    expect(fb.used).toEqual([])
  })

  it('signed out: the stand-in drawing', async () => {
    const fb = fallback()
    const pics = cloudPresenterPictures({ dir: tmp(), media: media as never, cloud: () => null, fallback: fb })
    expect((await pics.portrait({ prompt: 'x', aspect: '16:9' })).demo).toBe(true)
    expect((await pics.edit({ reference: 'p.png', prompt: 'y', framing: 'medium' })).demo).toBe(true)
    expect(fb.used).toEqual(['portrait', 'edit'])
  })
})
