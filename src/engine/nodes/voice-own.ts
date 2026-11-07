// `voice.own@1` (docs/ENGINE-SPEC.md §19.4): the user's own recording. Loudness normalised, leading and trailing
// silence trimmed, then every script word is timed: by the host's speech recogniser when it has one (Whisper-family,
// `services.asr`), else by our deterministic aligner on the recording's pauses. Without a script, the recogniser's
// transcript becomes the script; without both, the node cannot know the words and says so.
import path from 'node:path'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { NodeOutputs } from '../artefacts'
import { defineNode, type ResolvedInputs, type RunCtx } from '../registry'
import { readFile0, scratch } from './common'
import { Pace, finishVoice } from './voice-common'

export const VoiceOwnParams = z.object({
  language: z.string().min(2).default('fr'),
  pace: Pace.default('natural')
})

export const voiceOwn = defineNode({
  type: 'voice.own@1',
  inputs: { recording: { type: 'audio.voice', required: true }, script: { type: 'text.script', required: false } },
  outputs: { audio: 'audio.voice', words: 'json.words', text: 'text.script' },
  params: VoiceOwnParams,
  reads: ['minutes'],
  executors: ['local'],
  estimate: (ctx) => ({ units: [], durationS: 10 + ctx.minutes * 6 }),
  run: ownVoice,
  // there is nothing to fake: the user's file is real and the steps are local
  fake: ownVoice
})

async function ownVoice(ctx: RunCtx, inputs: ResolvedInputs, p: z.infer<typeof VoiceOwnParams>): Promise<NodeOutputs> {
  const recording = readFile0(inputs.recording, 'the recording')
  const dir = await scratch(ctx, 'voice-own')
  let script = typeof inputs.script?.value === 'string' && inputs.script.value.trim() ? inputs.script.value : null
  if (!script) {
    const asr = ctx.services.asr
    if (!asr) {
      throw new EngineError('bad_input', 'Sans script, il faut la reconnaissance vocale pour transcrire ton enregistrement : ajoute le texte lu.')
    }
    const { words } = await asr.transcribe({ audio: recording, language: p.language }, ctx.signal)
    script = words.map((w) => w.word).join(' ').trim()
    if (!script) throw new EngineError('bad_input', 'Aucun mot n’a été reconnu dans ton enregistrement.')
  }
  const out = await finishVoice(ctx, {
    raw: recording,
    script,
    language: p.language,
    dir: path.resolve(dir),
    trim: true,
      pace: p.pace,
      targetS: ctx.minutes * 60,
      minMatch: 0.75,
      ...(ctx.services.asr ? { asr: ctx.services.asr } : {}),
      meta: { demo: false, source: 'own' }
    })
    return { ...out, text: { value: script, meta: { language: p.language, pasted: true } } }
}
