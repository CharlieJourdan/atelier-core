// controles-bloquants (decision 0102): a voice take that breaks inside a word (Le Monde en POV: 6 breaks, the Japanese example: 13) is
// asked again by voice.tts before anything is built on it; a whole take is asked once. Real ffmpeg, a fake provider (nothing paid).
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Artefact, EngineServices } from '../../src/engine'
import { writeWav } from '../../src/engine/media/wav'
import { voiceTts, VoiceTtsParams } from '../../src/engine/nodes/voice-tts'
import type { TimedWord } from '../../src/engine/services'
import { art, hasFfmpeg, makeCtx, tempDir, testServices } from './engine-node-helpers'

const RATE = 48_000
const TEXT = 'Personne ne savait vraiment pourquoi la tour appartient encore au village aujourd’hui.'

/** A take: each word a burst of noise, silence between; `hole`: 0.25 s of nothing 0.1 s into the word « appartient ». */
async function take(file: string, hole: boolean): Promise<TimedWord[]> {
  const ws = TEXT.split(' ')
  const words: TimedWord[] = []
  let t = 0.3
  for (const w of ws) {
    const len = Math.max(0.3, w.length * 0.07)
    words.push({ word: w, start: t, end: t + len })
    t += len + 0.12
  }
  const s = new Float32Array(Math.ceil((t + 0.3) * RATE))
  let seed = 7
  for (const w of words) for (let i = Math.floor(w.start * RATE); i < Math.floor(w.end * RATE); i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    s[i] = (seed / 2147483648 - 0.5) * 0.4
  }
  const a = words.find((w) => w.word === 'appartient') as TimedWord
  if (hole) s.fill(0, Math.floor((a.start + 0.1) * RATE), Math.floor((a.start + 0.35) * RATE))
  await writeWav(file, s, RATE)
  return words
}

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

describe.skipIf(!hasFfmpeg)('voice.tts asks again for a take with a break inside a word', () => {
  const run = async (holes: boolean[]): Promise<{ calls: string[]; holes: unknown }> => {
    const t = tempDir('retake')
    cleanups.push(t.cleanup)
    const calls: string[] = []
    const cloud = {
      realRun: true,
      synthesize: async (_req: { text: string }, o: { idempotencyKey: string; dir: string }) => {
        const file = path.join(o.dir, `take-${calls.length}.wav`)
        const words = await take(file, holes[calls.length] ?? false)
        calls.push(o.idempotencyKey)
        return { audioFile: file, words, demo: false }
      }
    } as unknown as EngineServices['cloud']
    const services = testServices(t.dir, { cloud })
    const p = VoiceTtsParams.parse({ voice: 'voice-1', language: 'fr' })
    const out = await voiceTts.run(makeCtx(services, { node: voiceTts }), { script: art('text.script', { value: TEXT }) as Artefact }, p)
    return { calls, holes: (out.audio as { meta?: Record<string, unknown> }).meta?.holes }
  }
  it('a broken take is asked again under a new key, and the whole one is kept', { timeout: 120_000 }, async () => {
    const r = await run([true, false])
    expect(r.calls.length).toBe(2)
    expect(r.calls[1]).toMatch(/-take-2$/)
  })
  it('a whole take is asked once', { timeout: 120_000 }, async () => {
    const r = await run([false])
    expect(r.calls.length).toBe(1)
  })
})
