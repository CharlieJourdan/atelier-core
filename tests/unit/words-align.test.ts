// Record 0059, « Minutage des mots » (Charlie 01/11 on run 7: « le spray apparaît avant qu'on parle du spray… c'est ultra
// important de ultra bien transcrire avec Whisper »): on run 7's real voice (tests/fixtures/hook-2026-11, `run7`), the voice's
// own times (its pause aligner: the voice engine gave none) against what faster-whisper large-v3 heard; the director replayed
// on the heard times with the real pass of part 4; the brick, its fallbacks and the local recogniser's plumbing.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { EditPlan, GenList } from '../../src/engine/formats/editplan'
import type { Word } from '../../src/engine/formats/timing'
import { joinElisions, wordsFromHeard } from '../../src/engine/media/word-timing'
import { localWhisperService, WHISPER_CPU_MODEL, WHISPER_SCRIPT } from '../../src/engine/media/whisper'
import { beatsSplit } from '../../src/engine/nodes/beats-split'
import { earlyCuts } from '../../src/engine/nodes/director-cutcheck'
import type { DirectorParams } from '../../src/engine/nodes/director-cuts'
import { directorPlan } from '../../src/engine/nodes/director-plan'
import { shiftsOf, wordsAlign } from '../../src/engine/nodes/words-align'
import type { AsrService, ClaudeService, TimedWord } from '../../src/engine/services'
import { avatarBase, compileRecipe, fromBase, technologyRegistry } from '../../src/engine/technologies'
import { art, makeCtx, tempDir, testServices } from './engine-node-helpers'

const HOOK = JSON.parse(readFileSync(path.join(__dirname, '..', 'fixtures', 'hook-2026-11', 'hook-60s.json'), 'utf8')) as {
  outline: unknown
  part4Pass: { roles: unknown; scene: unknown; topUp?: unknown }
  run7: { durationS: number; script: string; voice: Word[]; heard: TimedWord[]; shots: { n: number; a: number; b: number; kind: string; words: string }[] }
}
const R7 = HOOK.run7
const tmp = tempDir('words-align')
afterAll(() => tmp.cleanup())

const heardWords = (): Word[] => wordsFromHeard(R7.script, 'fr', R7.heard, R7.durationS).words
const at = (words: readonly Word[], w: string): number => (words.find((x) => x.w.toLowerCase().startsWith(w)) as Word).start

describe('run 7: the voice’s times against what Whisper heard', () => {
  it('the voice put « spray » 2.9 s and « repeint » 3.4 s early; Whisper hears 99 % of the words', () => {
    const r = wordsFromHeard(R7.script, 'fr', R7.heard, R7.durationS)
    expect(r.matched).toBeGreaterThan(0.95)
    expect(at(R7.voice, 'spray')).toBeCloseTo(14.41, 2)
    expect(at(r.words, 'spray')).toBeCloseTo(17.32, 2)
    expect(at(R7.voice, 'repeint')).toBeCloseTo(17.14, 2)
    expect(at(r.words, 'repeint')).toBeCloseTo(20.5, 2)
    // run 7's shots 5 and 6 started 3.0 and 3.5 s before the words they show
    const shot = (n: number) => R7.shots.find((s) => s.n === n) as { a: number }
    expect(at(r.words, 'spray') - shot(5).a).toBeCloseTo(3.02, 2)
    expect(at(r.words, 'repeint') - shot(6).a).toBeCloseTo(3.5, 2)
    const s = shiftsOf(R7.voice, r.words)
    expect(s.maxMs).toBeGreaterThan(3000)
    expect(s.moved).toBeGreaterThan(40)
  })

  it('Whisper’s pieces are joined back into the script’s words (« L » + « ’an », « grand » + « -chose »)', () => {
    expect(joinElisions([{ word: ' L', start: 1, end: 1.1 }, { word: "'an", start: 1.1, end: 1.3 }, { word: ' grand', start: 2, end: 2.2 }, { word: '-chose', start: 2.2, end: 2.5 }])).toEqual([
      { word: "L'an", start: 1, end: 1.3 },
      { word: 'grand-chose', start: 2, end: 2.5 }
    ])
  })
})

/** The director's params of `avatar@1` as compiled. */
function avatarParams(): DirectorParams {
  const r = compileRecipe(fromBase(avatarBase), technologyRegistry())
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  return directorPlan.params.parse(r.pipeline.nodes.find((n) => n.id === 'director')?.params) as DirectorParams
}

/** Part 4's real pass replayed by the director on `words` (the beats split on them too). */
async function direct(words: Word[]): Promise<{ plan: EditPlan; list: GenList; diagnostics: string[] }> {
  const rec = HOOK.part4Pass
  const svc: ClaudeService = {
    ask: (req) =>
      Promise.resolve({ text: JSON.stringify(req.system.startsWith('You sort the sentences') ? rec.roles : req.prompt.includes('need more pictures') ? (rec.topUp ?? { directives: [], recurring: [] }) : rec.scene) })
  }
  const w = art('json.words', { value: words as never, meta: { durationS: R7.durationS, alignment: 'asr', matched: 1, language: 'fr' } })
  const outline = art('json.outline', { value: HOOK.outline as never })
  const beats = await beatsSplit.run(makeCtx({}), { words: w, outline, script: art('text.script', { value: R7.script }) }, beatsSplit.params.parse({}))
  const out = await directorPlan.run(makeCtx({ claude: svc }), { beats: art('json.beats', { value: beats.beats?.value as never, meta: beats.beats?.meta as never }), words: w, outline }, avatarParams())
  const plan = out.plan?.value as unknown as EditPlan
  return { plan, list: out.genlist?.value as unknown as GenList, diagnostics: plan.diagnostics }
}

describe('the director on the heard times', () => {
  it('every picture starts at most 0.15 s before the word that names it, on the times Whisper heard (« spray », « repeint »)', async () => {
    const words = heardWords()
    const { plan, list } = await direct(words)
    const shotAt = (t: number) => plan.shots.find((s) => s.track === 'base' && s.startFrame / plan.fps <= t + 1e-6 && s.endFrame / plan.fps > t + 1e-6)
    for (const w of ['spray', 'repeint']) {
      const t = at(words, w)
      const sh = shotAt(t) as { startFrame: number; kind: string }
      expect(sh.kind, w).not.toBe('avatar')
      expect(t - sh.startFrame / plan.fps, w).toBeGreaterThanOrEqual(0)
      expect(t - sh.startFrame / plan.fps, w).toBeLessThanOrEqual(0.15)
    }
    expect(earlyCuts(plan, list, words)).toEqual([])
    // the opening: the presenter says « Ce matin, en cherchant les couvertures d'hiver, », the wardrobe is a picture
    expect(shotAt(at(words, 'cherchant'))?.kind).toBe('avatar')
    expect(shotAt(at(words, "l'armoire"))?.kind).not.toBe('avatar')
    // the talk sentences are the presenter's (run 7 gave « je vais vous dire honnêtement » and « en quatre temps » pictures)
    expect(shotAt(at(words, 'honnêtement'))?.kind).toBe('avatar')
    expect(shotAt(at(words, 'faire'))?.kind).toBe('avatar')
    // the plan made on the voice's own times, read on what is really said: its spray and repaint come 3 s early
    const old = await direct(R7.voice)
    const startOf = (re: RegExp): number => {
      const sh = old.plan.shots.find((s) => s.track === 'base' && re.test(old.list.items.find((i) => i.id === s.genItem)?.context.subject ?? '')) as { startFrame: number }
      return sh.startFrame / old.plan.fps
    }
    expect(at(words, 'spray') - startOf(/spray/)).toBeGreaterThan(2.9)
    expect(at(words, 'repeint') - startOf(/repaint/)).toBeGreaterThan(3.3)
    expect(earlyCuts(old.plan, old.list, words).length).toBeGreaterThan(2)
  })
})

describe('the brick « Minutage des mots »', () => {
  const voiceFile = path.join(tmp.dir, 'voice.flac')
  writeFileSync(voiceFile, 'not really audio')
  const inputs = () => ({
    voice: art('audio.voice', { files: [voiceFile], meta: { durationS: R7.durationS } }),
    words: art('json.words', { value: R7.voice as never, meta: { durationS: R7.durationS, alignment: 'aligned', matched: 1, language: 'fr' } }),
    script: art('text.script', { value: R7.script })
  })
  const params = wordsAlign.params.parse({ language: 'fr' })

  it('times every word on what the recogniser heard, and says how far the voice’s times were', async () => {
    const asr: AsrService = { transcribe: () => Promise.resolve({ words: R7.heard, engine: 'whisper-large-v3-cpu' }) }
    const ctx = makeCtx(testServices(tmp.dir, { asr }))
    const out = await wordsAlign.run(ctx, inputs(), params)
    const words = out.words?.value as unknown as Word[]
    expect(at(words, 'spray')).toBeCloseTo(17.32, 2)
    expect(out.words?.meta).toMatchObject({ alignment: 'asr', timing: 'whisper-large-v3-cpu', voiceTiming: 'aligned', language: 'fr' })
    expect(ctx.reports.some((r) => r.kind === 'log' && /Minutage des mots \(whisper-large-v3-cpu\) : 99 % des mots entendus/.test(r.text))).toBe(true)
  })

  it('never stops a run: no recogniser, a failing one or one that hears too little keeps the voice’s times', async () => {
    const failing: AsrService = { transcribe: () => Promise.reject(new Error('cublas64_12.dll is not found')) }
    const deaf: AsrService = { transcribe: () => Promise.resolve({ words: R7.heard.slice(0, 20) }) }
    for (const asr of [undefined, failing, deaf]) {
      const ctx = makeCtx(testServices(tmp.dir, asr ? { asr } : {}))
      const out = await wordsAlign.run(ctx, inputs(), params)
      expect(out.words?.value).toEqual(R7.voice)
      expect(out.words?.meta).toMatchObject({ timing: 'voice', alignment: 'aligned' })
      expect(ctx.reports.some((r) => r.kind === 'log' && r.level === 'warn' && /les temps de la voix sont gardés/.test(r.text))).toBe(true)
    }
  })

  it('is in every base pipeline, right after the voice, and every later brick reads its words', () => {
    const r = compileRecipe(fromBase(avatarBase), technologyRegistry())
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
    const timing = r.pipeline.nodes.find((n) => n.type === 'words.align@1')
    expect(timing?.in).toMatchObject({ voice: 'voice.audio', words: 'voice.words' })
    for (const n of r.pipeline.nodes.filter((x) => x.in && Object.keys(x.in).includes('words') && x.type !== 'words.align@1')) expect(n.in?.words, n.id).toBe(`${timing?.id}.words`)
  })
})

describe('the local recogniser', () => {
  it('runs the fixed program on the first Python that has faster-whisper, then reads the answer from its cache', async () => {
    const calls: { file: string; args: string[]; env: NodeJS.ProcessEnv }[] = []
    const exec = async (file: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> => {
      calls.push({ file, args, env })
      if (args.includes('-c')) {
        if (args[0] === '-3.13') throw new Error('No module named faster_whisper')
        return
      }
      writeFileSync(env.ATELIER_ASR_OUT as string, JSON.stringify({ words: [{ w: ' Ce', s: 0.2, e: 0.4 }, { w: ' matin,', s: 0.4, e: 0.9 }], device: 'cpu' }))
    }
    const asr = localWhisperService({ platform: 'win32', cacheDir: path.join(tmp.dir, 'asr'), exec })
    const r = await asr.transcribe({ audio: voiceFile0(), language: 'fr' }, new AbortController().signal)
    expect(r).toEqual({ words: [{ word: 'Ce', start: 0.2, end: 0.4 }, { word: 'matin,', start: 0.4, end: 0.9 }], engine: 'whisper-large-v3-cpu' })
    const run = calls.find((c) => !c.args.includes('-c'))
    expect(run?.args).toEqual(['-3.12', path.join(tmp.dir, 'asr', 'whisper.py')])
    expect(run?.env.ATELIER_ASR_LANG).toBe('fr')
    expect(readFileSync(path.join(tmp.dir, 'asr', 'whisper.py'), 'utf8')).toBe(WHISPER_SCRIPT)
    const n = calls.length
    await asr.transcribe({ audio: voiceFile0(), language: 'fr' }, new AbortController().signal)
    expect(calls.length).toBe(n)
  })

  it('without a graphics card it uses the small model (vps-rendu: large-v3 on 4 vCPU took 145 s and filled 8 GB) and says so', async () => {
    let env: NodeJS.ProcessEnv = {}
    const exec = async (_file: string, args: string[], e: NodeJS.ProcessEnv): Promise<void> => {
      if (args.includes('-c')) return
      env = e
      writeFileSync(e.ATELIER_ASR_OUT as string, JSON.stringify({ words: [{ w: 'Ce', s: 0.2, e: 0.4 }], device: 'cpu', model: e.ATELIER_ASR_CPU_MODEL }))
    }
    const asr = localWhisperService({ platform: 'linux', cacheDir: path.join(tmp.dir, 'asr-cpu'), exec, python: { file: 'python3', args: [] } })
    const r = await asr.transcribe({ audio: voiceFile0(), language: 'fr' }, new AbortController().signal)
    expect(env.ATELIER_ASR_MODEL).toBe('large-v3')
    expect(env.ATELIER_ASR_CPU_MODEL).toBe(WHISPER_CPU_MODEL)
    expect(r.engine).toBe('whisper-small-cpu')
    // the program never loads (nor downloads) the GPU model on a machine without CUDA
    expect(WHISPER_SCRIPT).toMatch(/get_cuda_device_count\(\) == 0/)
    expect(WHISPER_SCRIPT.indexOf('get_cuda_device_count')).toBeLessThan(WHISPER_SCRIPT.indexOf("run('cuda'"))
  })

  it('without faster-whisper on this computer it answers missing_tool (the brick then keeps the voice’s times)', async () => {
    const asr = localWhisperService({ platform: 'darwin', cacheDir: path.join(tmp.dir, 'asr-none'), exec: () => Promise.reject(new Error('not found')) })
    await expect(asr.transcribe({ audio: voiceFile0(), language: 'fr' }, new AbortController().signal)).rejects.toMatchObject({ code: 'missing_tool' })
  })
})

function voiceFile0(): string {
  const f = path.join(tmp.dir, 'one.flac')
  writeFileSync(f, 'audio bytes')
  return f
}
