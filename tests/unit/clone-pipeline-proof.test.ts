// Chantier C's proof run (decision 0099): the four acceptance plans compiled and run end to end on the engine's fakes, with the real
// local bricks (director, styled motion cards, render). Skipped unless CLONE_PIPELINE_RUN_DIR names where to save films and frames
// (it needs ffmpeg and a browser; minutes long). `CLONE_PIPELINE_ONLY=finary,marcel` runs some.
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAcceptanceOnFakes } from '../../src/main/production/clone/pipeline/demo'

const DIR = process.env['CLONE_PIPELINE_RUN_DIR']

describe.skipIf(!DIR)('P5 plans run end to end on fakes (proof)', () => {
  it('every acceptance plan runs and renders', async () => {
    const failed = await runAcceptanceOnFakes({
      outDir: DIR!,
      resourcesDir: path.resolve(import.meta.dirname, '..', '..', 'resources'),
      minutes: Number(process.env['CLONE_PIPELINE_MINUTES'] ?? '0.6'),
      ...(process.env['CLONE_PIPELINE_ONLY'] ? { only: process.env['CLONE_PIPELINE_ONLY'].split(',') } : {}),
      say: (s) => void process.stdout.write(s + '\n')
    })
    expect(failed).toEqual([])
  }, 3_600_000)
})

describe.skipIf(!DIR)('the channel-styled card family, a short real render (proof)', () => {
  it('draws five templates in each acceptance channel’s measured style', async () => {
    const { renderStyledReel } = await import('../../src/main/production/clone/pipeline/styled-reel')
    const { runDefinition } = await import('../../src/main/production/clone/definition/fixtures/run')
    const P = await import('../../src/main/production/clone/definition/fixtures/profiles')
    const channels = [
      { name: 'finary', def: (await runDefinition(P.FINARY)).definition },
      { name: 'marcel', def: (await runDefinition(P.MARCEL, { intent: 'own-channel', ownChannel: true })).definition },
      { name: 'japanese', def: (await runDefinition(P.JAPANESE, { intent: 'translate', language: 'fr', sourceLanguage: 'en' })).definition },
      { name: 'monde-pov', def: (await runDefinition(P.MONDE_POV)).definition }
    ]
    const r = await renderStyledReel({ outDir: path.join(DIR!, 'styled-cards'), resourcesDir: path.resolve(import.meta.dirname, '..', '..', 'resources'), channels })
    process.stdout.write(`${JSON.stringify(r.styles)}\n${r.film}\n`)
    expect(r.frames.length).toBe(20)
  }, 1_800_000)
})
