// `words.align@1`, « Minutage des mots » (record 0059, Charlie 01/11: « c'est ultra important de ultra bien transcrire avec
// Whisper… pour savoir exactement ce qui est dit à quel moment »): after the voice, the narration we ship is heard again by a
// speech recogniser (faster-whisper on this computer, free) and every script word gets the time it is really said. Every later
// brick (director, captions, sponsor, presenter) reads these times. Run 7: the voice's own times (its pause aligner, the voice
// engine gave none) put « spray » at 14.4 s when it is said at 17.3 s. Without a recogniser, or when it hears too few of the
// words, the voice's own times are kept and the log says so: the run never stops here.
import { z } from 'zod'
import type { NodeOutputs } from '../artefacts'
import { WordsMeta, WordsValue, type Word } from '../formats/timing'
import { wordsFromHeard } from '../media/word-timing'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { metaNumber, progress, readFile0, readText, readValue } from './common'

export const WordsAlignParams = z.object({
  language: z.string().min(2).max(12),
  /** Under this share of the script's words heard, the voice's own times are kept. */
  minMatch: z.number().min(0.3).max(1).default(0.8)
})
type Params = z.infer<typeof WordsAlignParams>

/** Words moved by more than this are counted in the log (the director's tolerance on a cut, record 0059). */
export const MOVED_S = 0.15

/** How far the heard times are from the voice's own: median and largest move, and how many words moved more than 0.15 s. */
export function shiftsOf(before: readonly Word[], after: readonly Word[]): { medianMs: number; maxMs: number; moved: number } {
  if (before.length !== after.length || after.length === 0) return { medianMs: 0, maxMs: 0, moved: 0 }
  const d = after.map((w, i) => Math.abs(w.start - (before[i] as Word).start)).sort((a, b) => a - b)
  return { medianMs: Math.round((d[Math.floor((d.length - 1) / 2)] as number) * 1000), maxMs: Math.round((d.at(-1) as number) * 1000), moved: d.filter((x) => x > MOVED_S).length }
}

async function align(ctx: RunCtx, inputs: ResolvedInputs, p: Params): Promise<NodeOutputs> {
  const before = readValue(inputs.words, WordsValue, 'the voice’s words')
  const meta = WordsMeta.safeParse(inputs.words?.meta)
  const audio = readFile0(inputs.voice, 'the voice')
  const script = readText(inputs.script, 'the script')
  const durationS = metaNumber(inputs.voice, 'durationS') ?? (meta.success ? meta.data.durationS : (before.at(-1) as Word).end)
  const keep = (why: string): NodeOutputs => {
    ctx.emit({ kind: 'log', level: 'warn', text: `Minutage des mots : ${why} ; les temps de la voix sont gardés` })
    return { words: { value: before, meta: { ...(inputs.words?.meta ?? {}), timing: 'voice', timingNote: why } } }
  }
  const asr = ctx.services.asr
  if (!asr) return keep('pas de reconnaissance vocale sur cet ordinateur')
  progress(ctx, 0, 1, 'Minutage des mots : écoute de la voix')
  let heard: Awaited<ReturnType<typeof asr.transcribe>>
  try {
    heard = await asr.transcribe({ audio, language: p.language }, ctx.signal)
  } catch (e) {
    if (ctx.signal.aborted) throw e
    return keep(`la reconnaissance vocale a échoué (${e instanceof Error ? e.message.slice(0, 200) : String(e)})`)
  }
  const r = wordsFromHeard(script, p.language, heard.words, durationS)
  if (r.matched < p.minMatch) return keep(`seulement ${Math.round(r.matched * 100)} % des mots entendus`)
  const s = shiftsOf(before, r.words)
  const engine = heard.engine ?? 'asr'
  ctx.emit({
    kind: 'log',
    level: 'info',
    text: `Minutage des mots (${engine}) : ${Math.round(r.matched * 100)} % des mots entendus ; écart avec la voix ${s.medianMs} ms en médiane, ${s.moved} mot(s) déplacé(s) de plus de 150 ms (au plus ${s.maxMs} ms)`
  })
  return {
    words: {
      value: r.words,
      meta: {
        durationS,
        alignment: 'asr',
        matched: r.matched,
        language: p.language,
        timing: engine,
        ...(meta.success ? { voiceTiming: meta.data.alignment } : {}),
        shiftMedianMs: s.medianMs,
        shiftMaxMs: s.maxMs,
        moved: s.moved
      }
    }
  }
}

export const wordsAlign = defineNode({
  type: 'words.align@1',
  inputs: {
    voice: { type: 'audio.voice', required: true, label: 'La voix finale' },
    words: { type: 'json.words', required: true, label: 'Les temps de la voix' },
    script: { type: 'text.script', required: true, label: 'Le script lu' }
  },
  outputs: { words: 'json.words' },
  params: WordsAlignParams,
  executors: ['local'],
  // faster-whisper large-v3: about real time on the processor, a few seconds a minute on the graphics card
  estimate: () => ({ units: [], durationS: 60 }),
  run: align,
  // a demonstration voice keeps its own times (the recogniser is never started by a demo run)
  fake: (ctx, inputs) => {
    const before = readValue(inputs.words, WordsValue, 'the voice’s words')
    return Promise.resolve({ words: { value: before, meta: { ...(inputs.words?.meta ?? {}), timing: 'voice', timingNote: 'démo' } } })
  }
})
