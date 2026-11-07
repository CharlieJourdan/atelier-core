// Several voices in one video (docs/ENGINE-SPEC.md §19.5): speaker tags in a script, the segment plan, the cloud path with a
// fake Cloud service (one synthesis per speaker's turn, cached per segment, continuous word times, captions that follow) and
// the demo path with a fake system voice (two different voices). Nothing paid, no network.
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CloudService, SpeechService } from '../../src/engine'
import type { EditPlan } from '../../src/engine/formats/editplan'
import type { Word } from '../../src/engine/formats/timing'
import { probe } from '../../src/engine/media/probe'
import { writeWav } from '../../src/engine/media/wav'
import { spokenText } from '../../src/engine/media/word-timing'
import { assignSystemVoices, planSegments, speakerPieces, SPEAKER_GAP_S } from '../../src/engine/nodes/voice-speakers'
import { voiceTts, VoiceTtsParams } from '../../src/engine/nodes/voice-tts'
import { makeCues } from '../../src/engine/text/captions'
import { parseScript, speakerSegments } from '../../src/engine/text/script'
import { art, hasFfmpeg, makeCtx, MEDIA, tempDir, testServices } from './engine-node-helpers'

const DIALOGUE = [
  'Un soir, deux amis se retrouvent au bord du lac.',
  '',
  'ALICE: Tu as vu la lune ce soir ?',
  'BOB: Oui, elle est immense. Je ne l’avais jamais vue si grosse !',
  '',
  'Elle éclairait toute la rive.',
  'ALICE: Alors restons un peu.',
  'NARRATEUR: Ils restèrent jusqu’à minuit.'
].join('\n')

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})
function work(label: string): string {
  const t = tempDir(label)
  cleanups.push(t.cleanup)
  return t.dir
}

describe('speaker tags in a script', () => {
  it('strips the tags, keeps what is said, and starts a paragraph at every tag', () => {
    const p = parseScript(DIALOGUE)
    expect(p.speakers).toEqual(['ALICE', 'BOB'])
    expect(p.paragraphs).toEqual([
      'Un soir, deux amis se retrouvent au bord du lac.',
      'Tu as vu la lune ce soir ?',
      'Oui, elle est immense. Je ne l’avais jamais vue si grosse !',
      'Elle éclairait toute la rive.',
      'Alors restons un peu.',
      'Ils restèrent jusqu’à minuit.'
    ])
    expect(p.tokens.some((t) => /:$/.test(t.w) && t.w === t.w.toUpperCase())).toBe(false)
    const who = (word: string): string | undefined => p.tokens.find((t) => t.w === word)?.speaker
    expect(who('Un')).toBeUndefined() // before any tag: the narrator
    expect(who('lune')).toBe('ALICE')
    expect(who('immense.')).toBe('BOB')
    expect(who('Elle')).toBe('BOB') // the floor stays with the last speaker across a blank line
    expect(who('restons')).toBe('ALICE')
    expect(who('restèrent')).toBeUndefined() // NARRATEUR: gives it back to the narrator
  })

  it('cuts segments at every change of speaker, merging consecutive paragraphs of one speaker', () => {
    const segs = speakerSegments(parseScript(DIALOGUE))
    expect(segs.map((s) => s.speaker)).toEqual([undefined, 'ALICE', 'BOB', 'ALICE', undefined])
    const p = parseScript('ALICE: Un.\n\nDeux.\nBOB: Trois.')
    expect(speakerSegments(p).map((s) => [s.speaker, s.first, s.last])).toEqual([['ALICE', 0, 1], ['BOB', 2, 2]])
  })

  it('reads a tag only in upper case with at least two different names', () => {
    for (const text of ['NOTE: ceci est un texte.\n\nSuite du texte.', 'Note: texte.\nAttention: autre texte.', 'ALICE: seule.\nALICE: encore.', 'Voir HTTP://x.fr pour plus.']) {
      const p = parseScript(text)
      expect(p.speakers).toBeUndefined()
      expect(p.tokens.every((t) => !('speaker' in t))).toBe(true)
    }
    // a tag-only line gives the floor to the lines that follow; accents and a two-word name are fine
    const p = parseScript('ÉLODIE:\nBonjour à toi.\nJEAN LUC: Salut.')
    expect(p.speakers).toEqual(['ÉLODIE', 'JEAN LUC'])
    expect(p.tokens.map((t) => [t.w, t.speaker])).toEqual([['Bonjour', 'ÉLODIE'], ['à', 'ÉLODIE'], ['toi.', 'ÉLODIE'], ['Salut.', 'JEAN LUC']])
  })

  it('a single-voice script parses exactly as before (no speaker field anywhere)', () => {
    const text = 'Premier paragraphe. Il continue ici.\n\nSecond paragraphe : avec deux points, et NOTE: au milieu.'
    const p = parseScript(text)
    expect(p).toEqual({
      paragraphs: ['Premier paragraphe. Il continue ici.', 'Second paragraphe : avec deux points, et NOTE: au milieu.'],
      sentences: [
        { index: 0, paragraph: 0, text: 'Premier paragraphe.', first: 0, last: 1 },
        { index: 1, paragraph: 0, text: 'Il continue ici.', first: 2, last: 4 },
        { index: 2, paragraph: 1, text: 'Second paragraphe : avec deux points, et NOTE: au milieu.', first: 5, last: 14 }
      ],
      tokens: expect.any(Array)
    })
    expect(p.tokens).toHaveLength(15)
    expect(speakerSegments(p)).toEqual([])
  })
})

describe('the segment plan', () => {
  const parsed = parseScript(DIALOGUE)
  const { forms } = spokenText(parsed, 'fr')
  it('maps each character to its voice (names matched in upper case); the others use the narrator voice', () => {
    const plan = planSegments(parsed, forms, { alice: 'demo-claire', Bob: 'demo-hugo' }, 'demo-ava')
    expect(plan.map((s) => [s.speaker ?? 'NARRATEUR', s.voice])).toEqual([
      ['NARRATEUR', 'demo-ava'],
      ['ALICE', 'demo-claire'],
      ['BOB', 'demo-hugo'],
      ['ALICE', 'demo-claire'],
      ['NARRATEUR', 'demo-ava']
    ])
    expect(plan[2]?.written).toBe('Oui, elle est immense. Je ne l’avais jamais vue si grosse !\n\nElle éclairait toute la rive.')
    expect(planSegments(parsed, forms, undefined, 'demo-ava').every((s) => s.voice === 'demo-ava')).toBe(true)
    expect(planSegments(parseScript('Un seul texte.'), ['Un', 'seul', 'texte.'], undefined, 'v')).toEqual([])
  })

  it('cuts the pieces per turn, with a gap before every turn but the first', () => {
    const plan = planSegments(parsed, forms, { ALICE: 'a', BOB: 'b' }, 'n')
    const pieces = speakerPieces(plan, 900)
    expect(pieces.map((x) => [x.voice, x.gapBefore])).toEqual([['n', false], ['a', true], ['b', true], ['a', true], ['n', true]])
    expect(pieces.every((x) => !/ALICE|BOB|NARRATEUR/.test(x.text))).toBe(true)
  })

  it('gives each distinct voice its own system voice while the machine has enough of them', () => {
    const voices = [
      { id: 's1', name: 'Un' },
      { id: 's2', name: 'Deux' },
      { id: 's3', name: 'Trois' }
    ]
    const picks = assignSystemVoices(['demo-claire', 'demo-hugo', 'demo-ava'], voices, undefined)
    expect(new Set([...picks.values()].map((v) => v.id)).size).toBe(3)
    expect(assignSystemVoices(['x', 'y'], voices, 's3').get('x')?.id).toBe('s3')
    expect(assignSystemVoices(['x', 'y'], [], undefined).size).toBe(0)
  })
})

// ---- the cloud path with a fake Cloud service ---------------------------------------------------------------------------

interface Call {
  text: string
  voiceId: string
}
/** A Cloud that "speaks" each text as a tone (pitch by voice), 0.2 s per word, with exact word times. */
function fakeCloud(): { cloud: CloudService; calls: Call[] } {
  const calls: Call[] = []
  const cloud: CloudService = {
    async synthesize(req, opts) {
      calls.push({ text: req.text, voiceId: req.voiceId })
      const rate = 24_000
      const words = req.text.split(/\s+/).filter(Boolean)
      const freq = 200 + (parseInt(Buffer.from(req.voiceId).toString('hex').slice(0, 4), 16) % 400)
      const per = Math.round(0.2 * rate)
      const samples = new Float32Array(per * words.length)
      for (let k = 0; k < samples.length; k++) samples[k] = 0.3 * Math.sin((2 * Math.PI * freq * k) / rate)
      const file = path.join(opts.dir, 'voice.wav')
      await writeWav(file, samples, rate)
      return { audioFile: file, words: words.map((word, i) => ({ word, start: i * 0.2, end: (i + 1) * 0.2 })), durationS: words.length * 0.2, demo: true }
    },
    generateImage: () => Promise.reject(new Error('not used')),
    searchStock: () => Promise.reject(new Error('not used')),
    generateVideo: () => Promise.reject(new Error('not used')),
    talkingAvatar: () => Promise.reject(new Error('not used'))
  }
  return { cloud, calls }
}

const ttsParams = (o: Record<string, unknown> = {}): ReturnType<typeof VoiceTtsParams.parse> => VoiceTtsParams.parse(o)
const SPEAKERS = { ALICE: 'voix-alice', BOB: 'voix-bob' }

describe.skipIf(!hasFfmpeg)('voice.tts run with several voices (fake Cloud service)', () => {
  it('synthesises one segment per turn with that character’s voice, joins them with continuous word times', { timeout: 120_000 }, async () => {
    const dir = work('cloud-multi')
    const { cloud, calls } = fakeCloud()
    const ctx = makeCtx(testServices(dir, { cloud }), { node: voiceTts, where: 'cloud', minutes: 1 })
    const out = await voiceTts.run(ctx, { script: art('text.script', { value: DIALOGUE }) }, ttsParams({ voice: 'voix-narrateur', speakers: SPEAKERS, parallel: 1 }))  // one at a time: the calls come in script order

    expect(calls.map((c) => c.voiceId)).toEqual(['voix-narrateur', 'voix-alice', 'voix-bob', 'voix-alice', 'voix-narrateur'])
    expect(calls.every((c) => !/ALICE|BOB|NARRATEUR/.test(c.text))).toBe(true)
    expect(calls[2]?.text).toContain('\n\n') // BOB's two paragraphs travel together

    const parsed = parseScript(DIALOGUE)
    const words = out.words?.value as unknown as Word[]
    expect(words.map((w) => w.w)).toEqual(parsed.tokens.map((t) => t.w))
    expect((out.words?.meta as { alignment: string }).alignment).toBe('provider')

    // continuous: every word starts after the previous one, and a change of speaker leaves the silence that was laid there
    let prev = 0
    for (const w of words) {
      expect(w.start).toBeGreaterThanOrEqual(prev - 0.01)
      expect(w.end).toBeGreaterThanOrEqual(w.start)
      prev = w.start
    }
    const durations = calls.map((c) => c.text.split(/\s+/).filter(Boolean).length * 0.2)
    const seams = [0, 1, 2, 3, 4].map((i) => ({ first: speakerSegments(parsed)[i]?.first as number, last: speakerSegments(parsed)[i]?.last as number }))
    for (let i = 1; i < seams.length; i++) {
      const gap = (words[(seams[i] as { first: number }).first] as Word).start - (words[(seams[i - 1] as { last: number }).last] as Word).end
      expect(gap).toBeGreaterThanOrEqual(SPEAKER_GAP_S - 0.12) // the gap, minus the last word's own trailing share
      expect(gap).toBeLessThan(SPEAKER_GAP_S + 0.12)
    }
    const total = durations.reduce((a, b) => a + b, 0) + SPEAKER_GAP_S * 4
    const info = await probe(MEDIA as NonNullable<typeof MEDIA>, (out.audio as { files: string[] }).files[0] as string, new AbortController().signal)
    expect(Math.abs(info.durationS - total)).toBeLessThan(0.1)
    expect((out.audio as { meta: Record<string, unknown> }).meta).toMatchObject({
      source: 'cloud',
      segments: 5,
      speakers: { NARRATEUR: 'voix-narrateur', ALICE: 'voix-alice', BOB: 'voix-bob' }
    })
  })

  it('caches per segment: a second run calls nothing, and an edit re-synthesises only the edited turn', { timeout: 120_000 }, async () => {
    const dir = work('cloud-cache')
    const { cloud, calls } = fakeCloud()
    const run = (script: string): Promise<Awaited<ReturnType<typeof voiceTts.run>>> =>
      voiceTts.run(makeCtx(testServices(dir, { cloud }), { node: voiceTts, where: 'cloud', minutes: 1 }), { script: art('text.script', { value: script }) }, ttsParams({ speakers: SPEAKERS }))
    await run(DIALOGUE)
    expect(calls).toHaveLength(5)
    await run(DIALOGUE)
    expect(calls).toHaveLength(5)
    await run(DIALOGUE.replace('Tu as vu la lune ce soir ?', 'Tu as vu les étoiles ce soir ?'))
    expect(calls).toHaveLength(6)
    expect(calls[5]?.voiceId).toBe('voix-alice')
  })

  it('captions follow the speakers: no tag in the cues, every cue inside the spoken words', { timeout: 120_000 }, async () => {
    const dir = work('cloud-captions')
    const { cloud } = fakeCloud()
    const out = await voiceTts.run(makeCtx(testServices(dir, { cloud }), { node: voiceTts, where: 'cloud', minutes: 1 }), { script: art('text.script', { value: DIALOGUE }) }, ttsParams({ speakers: SPEAKERS }))
    const words = out.words?.value as unknown as Word[]
    const plan = { schema: 'atelier.editplan/1', fps: 30, size: [1920, 1080], frames: 3000, tracks: { base: [], overlay: [], labels: [] }, captionsPreset: 'highlight', shots: [], chapters: [], diagnostics: [] } as unknown as EditPlan
    const cues = makeCues(words, plan, { preset: 'highlight', maxChars: 42, lines: 1, leadMs: 50 })
    expect(cues.length).toBeGreaterThan(2)
    const text = JSON.stringify(cues)
    expect(text).not.toMatch(/ALICE|BOB|NARRATEUR/)
    expect(text).toContain('lune')
    expect(text).toContain('restons')
    expect(cues.every((c) => c.start >= (words[0] as Word).start - 0.2 && c.end <= (words.at(-1) as Word).end + 0.5)).toBe(true)
  })

  it('a single-voice script makes the same calls as before: the narrator voice, no gap, no speaker meta', { timeout: 120_000 }, async () => {
    const dir = work('cloud-single')
    const { cloud, calls } = fakeCloud()
    const text = 'Bonjour à tous. Voici une courte histoire de phare.\n\nElle commence ici.'
    const out = await voiceTts.run(makeCtx(testServices(dir, { cloud }), { node: voiceTts, where: 'cloud', minutes: 1 }), { script: art('text.script', { value: text }) }, ttsParams({ voice: 'v1', speakers: SPEAKERS }))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ text: 'Bonjour à tous. Voici une courte histoire de phare.\n\nElle commence ici.', voiceId: 'v1' })
    const meta = (out.audio as { meta: Record<string, unknown> }).meta
    expect(meta).not.toHaveProperty('speakers')
    expect(meta).not.toHaveProperty('segments')
  })
})

// ---- the demo path with a fake system voice -----------------------------------------------------------------------------

/** Two "system voices": each speaks a tone of its own pitch (0.25 s per word), so the voices can be told apart. */
function fakeSpeech(): { speech: SpeechService; spoken: { voiceId: string; text: string }[] } {
  const spoken: { voiceId: string; text: string }[] = []
  const speech: SpeechService = {
    voices: () =>
      Promise.resolve([
        { id: 'sys-1', name: 'Voix Un', language: 'fr' },
        { id: 'sys-2', name: 'Voix Deux', language: 'fr' }
      ]),
    async speak(req) {
      spoken.push({ voiceId: req.voiceId, text: req.text })
      const rate = 24_000
      const n = req.text.split(/\s+/).filter(Boolean).length
      const freq = req.voiceId === 'sys-1' ? 220 : 440
      const lead = Math.round(0.3 * rate)
      const samples = new Float32Array(lead + Math.round(0.25 * rate) * n + lead)
      for (let k = lead; k < samples.length - lead; k++) samples[k] = 0.3 * Math.sin((2 * Math.PI * freq * k) / rate)
      await writeWav(req.out, samples, rate)
      return { marks: null }
    }
  }
  return { speech, spoken }
}

describe.skipIf(!hasFfmpeg)('voice.tts fake with several voices', () => {
  it('speaks each character with a different system voice and times every word on its own segment', { timeout: 120_000 }, async () => {
    const dir = work('fake-multi')
    const { speech, spoken } = fakeSpeech()
    const ctx = makeCtx(testServices(dir, { speech }), { node: voiceTts, minutes: 1 })
    const out = await voiceTts.fake(ctx, { script: art('text.script', { value: DIALOGUE }) }, ttsParams({ speakers: SPEAKERS }))
    expect(spoken).toHaveLength(5)
    const ids = new Set(spoken.map((s) => s.voiceId))
    expect(ids.size).toBe(2)
    // the three distinct voice ids (narrator, alice, bob) share two system voices; alice and bob never share one
    expect(spoken[1]?.voiceId).not.toBe(spoken[2]?.voiceId)
    const meta = (out.audio as { meta: Record<string, unknown> }).meta
    expect(meta).toMatchObject({ demo: true, source: 'system', segments: 5 })
    expect((meta.segmentS as number[]).length).toBe(5)
    const words = out.words?.value as unknown as Word[]
    expect(words).toHaveLength(parseScript(DIALOGUE).tokens.length)
    let prev = 0
    for (const w of words) {
      expect(w.start).toBeGreaterThanOrEqual(prev - 1e-6)
      prev = w.start
    }
    expect((out.words?.meta as { alignment: string }).alignment).toBe('provider')
  })

  it('falls back to tones of different pitches when the machine has no system voice', { timeout: 120_000 }, async () => {
    const dir = work('fake-tone')
    const ctx = makeCtx(testServices(dir), { node: voiceTts, minutes: 1 })
    const out = await voiceTts.fake(ctx, { script: art('text.script', { value: 'ALICE: Bonjour toi.\nBOB: Salut, ça va ?' }) }, ttsParams({ speakers: SPEAKERS }))
    expect((out.audio as { meta: Record<string, unknown> }).meta).toMatchObject({ source: 'tone', segments: 2 })
    expect((out.words?.value as unknown as Word[]).map((w) => w.w)).toEqual(['Bonjour', 'toi.', 'Salut,', 'ça', 'va', '?'])
  })
})
