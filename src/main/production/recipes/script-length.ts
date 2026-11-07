// The length of an imported script (QA B5): a project whose script is pasted is as long as that script, not as the
// pipeline's default (a 66 s script quoted as 12 minutes, filed in the library as 12 minutes).
import { detectLanguage, wpmFor } from '../../../engine/text/lint'

const MIN_MINUTES = 0.5
const MAX_MINUTES = 30

/**
 * The minutes an imported script lasts when spoken (tenths of a minute, 0.5 to 30), or null when there is no script. `wpm`: the
 * pipeline's measured pace (a story short's voice reads ≈ 310 words a minute); absent, the language's natural pace.
 */
export function scriptMinutes(script: string | undefined, wpm?: number): number | null {
  const text = (script ?? '').trim()
  if (!text) return null
  const words = text.split(/\s+/).length
  const lang = detectLanguage(text)
  const minutes = words / (wpm ?? wpmFor(lang === 'other' ? 'fr' : lang))
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(minutes * 10) / 10))
}
