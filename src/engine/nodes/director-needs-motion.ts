// « Motion only where it is seen » (vrais-tests Part C, 2026-11-01, research note reference-video-2026-11 (old repository)): a generated clip is
// paid for only when something moves in the picture — a person or hands at work, water, smoke, a gesture. A place, an object or
// a ceiling is a still with a slow camera move, made by the render for free. Measured on Charlie's Headcast reference: 101 of its
// 159 B-roll shots show such motion, 58 are places or objects. The director asks it of each clip shot's scene; the same text test
// (in English, the scene pass's language) needs no model. And « one clip, two shots » pairs only two shots of one action.
import { mentionsPerson } from './visuals-look'

/** Things that move by themselves, and the verbs of an action someone does (English prompts). */
const MOTION =
  /\b(?:water|rain(?:s|ing)?|drips?|dripping|pour(?:s|ing|ed)?|flow(?:s|ing)?|splash(?:es|ing)?|stream(?:s|ing)?|gush(?:es|ing)?|leak(?:s|ing)?|puddle\s+(?:grows|spreads)|steam(?:s|ing)?|smoke|mist\s+drifts|fog\s+rolls|wind|blow(?:s|ing)|flames?|fire|boil(?:s|ing)?|bubbl(?:es|ing)|stir(?:s|ring)?|brush(?:es|ing)|scrub(?:s|bing)?|wip(?:es|ing)|roll(?:s|ing)|paint(?:s|ing)|spray(?:s|ing)?|mix(?:es|ing)|sand(?:s|ing)|scrap(?:es|ing)|saw(?:s|ing)|hammer(?:s|ing)|drill(?:s|ing)|cut(?:s|ting)|open(?:s|ing)|clos(?:es|ing)|walk(?:s|ing)|run(?:s|ning)|lift(?:s|ing)|carr(?:ies|ying)|pick(?:s|ing)\s+up|turn(?:s|ing)|pull(?:s|ing)|push(?:es|ing)|point(?:s|ing)|tap(?:s|ping)|knock(?:s|ing)|press(?:es|ing)|shak(?:es|ing)|wav(?:es|ing)|nod(?:s|ding)|talk(?:s|ing)|writ(?:es|ing)|read(?:s|ing)|lay(?:s|ing)|spread(?:s|ing)|apply(?:ing)?|applies|dab(?:s|bing)|sweep(?:s|ing)|fill(?:s|ing)|rub(?:s|bing)|scoop(?:s|ing)|slid(?:es|ing)|slide|smooth(?:s|ing)|strokes?|set(?:s|ting)\s+down|plac(?:es|ing))\b/i

/** True when the scene shows something moving: a person or a part of one, flowing water or smoke, an action. */
export function needsMotion(scene: string): boolean {
  return mentionsPerson(scene) || MOTION.test(scene)
}

const WORD = /[a-z]{4,}/g
const STOP = new Set(['with', 'from', 'into', 'onto', 'over', 'under', 'that', 'this', 'their', 'there', 'then', 'shot', 'close', 'wide', 'medium', 'detail', 'angle', 'view', 'scene'])
const words = (s: string): Set<string> => new Set((s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(WORD) ?? []).filter((w) => !STOP.has(w)))

/** Two shots show one continuous action when their subjects share most of their words (one in the other, or Jaccard ≥ 0.5). */
export function sameAction(a: string, b: string): boolean {
  const x = words(a)
  const y = words(b)
  if (x.size === 0 || y.size === 0) return false
  let both = 0
  for (const w of x) if (y.has(w)) both++
  return both === Math.min(x.size, y.size) || both / (x.size + y.size - both) >= 0.5
}
