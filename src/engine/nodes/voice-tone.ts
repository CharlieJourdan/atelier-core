// The tone voice of last resort (docs/ENGINE-SPEC.md §19, Fake): one soft tone per word, used by `voice.tts` when the
// machine has no system voice. `shiftHz` moves the pitch so two characters do not sound alike.
import { writeWav } from '../media/wav'
import { spokenText } from '../media/word-timing'
import { syllables } from '../text/align'
import { endsSentence, parseScript } from '../text/script'

/** The tone voice of last resort: one soft tone per word at ~150 words per minute, pauses at punctuation. */
export async function toneVoice(script: string, language: string, out: string, shiftHz = 0): Promise<void> {
  const rate = 48_000
  const parsed = parseScript(script)
  const { forms } = spokenText(parsed, language)
  const parts: Float32Array[] = []
  const silence = (s: number): Float32Array => new Float32Array(Math.round(s * rate))
  parts.push(silence(0.3))
  parsed.tokens.forEach((t, i) => {
    const syl = syllables(forms[i] as string)
    if (syl === 0) return
    const dur = 0.13 * syl + 0.05
    const tone = new Float32Array(Math.round(dur * rate))
    const f = 180 + shiftHz + ((i * 37) % 60)
    for (let k = 0; k < tone.length; k++) {
      const env = Math.min(1, k / (0.02 * rate), (tone.length - k) / (0.03 * rate))
      tone[k] = 0.25 * env * Math.sin((2 * Math.PI * f * k) / rate)
    }
    parts.push(tone)
    const next = parsed.tokens[i + 1]
    parts.push(silence(!next ? 0.4 : next.paragraph !== t.paragraph ? 0.7 : endsSentence(t.w) ? 0.45 : /[,;:]$/.test(t.w) ? 0.22 : 0.07))
  })
  const total = parts.reduce((n, p) => n + p.length, 0)
  const all = new Float32Array(total)
  let at = 0
  for (const p of parts) {
    all.set(p, at)
    at += p.length
  }
  await writeWav(out, all, rate)
}
