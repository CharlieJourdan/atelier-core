// Motion design that fits the channel (motion-montage, Charlie 02/11: « adaptive to the channel », « understand the style as a viewer would »).
// Two steps, both pure:
//   - `measureMotion`: what motion design a reference already has, from its shots as described (by the eyes or a person): how much of
//     the screen time is graphics, which families a minute (maps, data, documents, words on screen, timelines, name straps), and which
//     look (period paper, newsprint, modern);
//   - `motionAdvice`: what a pipeline built from it should do. A reference WITH motion design: clone its families and look, and propose
//     the improvements it lacks. One WITHOUT: propose adding some (many users want it), only the families its register uses and in the
//     look of its subject's era. Always: what a viewer of this register would find off (neon and HUD on a 17th-century subject, whips on a
//     sober documentary, effects nobody measured).
// The style agent (« Créer une pipeline ») turns the advice into settings: `motion.render` `look`, the editing kit (`edit.fx`), the
// director's card families. Every value is a proposal shown to the user, never a rule of the engine.
import type { EditKitName } from '../formats/edit-kit'

export const MOTION_FAMILIES = ['map', 'data', 'document', 'words', 'timeline', 'strap'] as const
export type MotionFamily = (typeof MOTION_FAMILIES)[number]

/** The cards and overlays that draw a family (formats/cards.ts, formats/motion.ts). */
export const FAMILY_TEMPLATES: Record<MotionFamily, readonly string[]> = {
  map: ['map', 'map3d'],
  data: ['chart', 'bars', 'studio'],
  document: ['document', 'archive', 'prints'],
  words: ['kinetic', 'title', 'quote'],
  timeline: ['timeline'],
  strap: ['lower-third']
}

export type MotionLookPreset = 'period' | 'newsprint' | 'modern'

/** What a reference's motion design measures. */
export interface MotionProfile {
  /** Share of the screen time that is motion design (cards, overlays), 0–1. */
  graphicsShare: number
  /** Graphics a minute, by family. */
  perMinute: Partial<Record<MotionFamily, number>>
  /** The look its graphics have, when the descriptions say. */
  look?: MotionLookPreset
}

/** A shot of a reference as described (text from the eyes or a person), its span in seconds. */
export interface DescribedShot {
  start: number
  end: number
  text: string
}

const FAMILY_WORDS: Record<MotionFamily, RegExp> = {
  map: /\b(map|maps|carte|cartes|globe|route|itin[ée]raire|trajet)\b/,
  data: /\b(chart|graph|graphique|courbe|histogramme|bar[s]?|barres|counter|compteur|chiffres?|statisti\w*|infograph\w*|percentage|pourcentage)\b/,
  document: /\b(document|letter|lettre|newspaper|journal|contrat|contract|archive document|manuscri\w*|parchemin|parchment|telegram|t[ée]l[ée]gramme|souligne\w*|underline\w*|highlight\w*|surlign\w*)\b/,
  words: /\b(kinetic|animated (text|title|words)|texte anim[ée]|titre anim[ée]|on-screen text|texte [àa] l'[ée]cran|big (text|number)|gros (texte|chiffre)|quote card|citation)\b/,
  timeline: /\b(timeline|frise|chronolog\w*)\b/,
  strap: /\b(lower[- ]third|bandeau|name strap|nom et (r[ôo]le|titre))\b/
}
const GRAPHIC = /\b(motion|graphic|graphique|animated|anim[ée]|card|carte anim[ée]e|overlay|infograph\w*|2d animation)\b/
const LOOKS: [MotionLookPreset, RegExp][] = [
  ['period', /\b(parchment|parchemin|sepia|s[ée]pia|old paper|vieux papier|engrav\w*|gravure|vintage|aged|ink|encre|antique|period)\b/],
  ['newsprint', /\b(newsprint|newspaper|journal|halftone|tram[ée]|typewriter|machine [àa] [ée]crire|archive footage)\b/],
  ['modern', /\b(neon|n[ée]on|glow|futuristic|futuriste|hud|flat design|gradient|d[ée]grad[ée]|glassmorph\w*|3d render|clean modern|tech)\b/]
]

/** What motion design a reference has, from its described shots (lower-case matching, French or English). */
export function measureMotion(shots: readonly DescribedShot[]): MotionProfile {
  const total = shots.reduce((s, x) => s + Math.max(0, x.end - x.start), 0)
  const minutes = Math.max(1 / 60, total / 60)
  let graphics = 0
  const counts: Partial<Record<MotionFamily, number>> = {}
  const looks: Record<MotionLookPreset, number> = { period: 0, newsprint: 0, modern: 0 }
  for (const s of shots) {
    const t = s.text.toLowerCase()
    const fams = MOTION_FAMILIES.filter((f) => FAMILY_WORDS[f].test(t))
    if (fams.length || GRAPHIC.test(t)) graphics += Math.max(0, s.end - s.start)
    for (const f of fams) counts[f] = (counts[f] ?? 0) + 1
    for (const [look, re] of LOOKS) if (re.test(t)) looks[look] += 1
  }
  const perMinute = Object.fromEntries(Object.entries(counts).map(([f, n]) => [f, Math.round(((n as number) / minutes) * 100) / 100])) as MotionProfile['perMinute']
  const best = (Object.entries(looks) as [MotionLookPreset, number][]).sort((a, b) => b[1] - a[1])[0]
  return { graphicsShare: total > 0 ? Math.round((graphics / total) * 100) / 100 : 0, perMinute, ...(best && best[1] > 0 ? { look: best[0] } : {}) }
}

/** What the video is, as a viewer sees it. */
export interface VideoStyle {
  /** documentary (history, economics, true stories), explainer (how things work, 2D animated), story (a narrated tale), avatar (a presenter
   *  talking to camera), vlog (filmed life), news, tutorial. */
  register: 'documentary' | 'explainer' | 'story' | 'avatar' | 'vlog' | 'news' | 'tutorial'
  /** When the subject happens (a year, negative before our era); missing: today. */
  subjectYear?: number
  /** Sober (no gimmick), lively, playful. */
  tone?: 'sober' | 'lively' | 'playful'
}

export interface MotionAdvice {
  /** clone: the reference has motion design, keep it; propose: it has none, offer some; none: nothing fits. */
  mode: 'clone' | 'propose' | 'none'
  look: MotionLookPreset
  /** Families and how many a minute (cloned from the reference, or proposed for the register). */
  families: { family: MotionFamily; perMinute: number; templates: readonly string[] }[]
  /** The editing kit to start from. */
  kit: EditKitName
  /** Improvements (clone) or additions (propose), each a short line for the user, in English (the agent translates). */
  proposals: string[]
  /** What a viewer of this register and era would find off. */
  avoid: string[]
}

/** The families a register uses when its reference has none, a minute (what the best channels of that register show). */
const REGISTER_FAMILIES: Record<VideoStyle['register'], Partial<Record<MotionFamily, number>>> = {
  documentary: { map: 0.6, data: 0.5, document: 0.5, words: 0.6, timeline: 0.2 },
  explainer: { words: 1.5, data: 0.8, map: 0.3, timeline: 0.2 },
  story: { map: 0.3, words: 0.4, strap: 0.2 },
  avatar: { words: 0.8, data: 0.3, strap: 0.3 },
  vlog: { strap: 0.3, words: 0.3 },
  news: { strap: 1, map: 0.5, data: 0.5, words: 0.5 },
  tutorial: { words: 1, strap: 0.2 }
}

const REGISTER_KIT: Record<VideoStyle['register'], EditKitName> = { documentary: 'documentary', explainer: 'pov2d', story: 'documentary', avatar: 'avatar', vlog: 'avatar', news: 'documentary', tutorial: 'avatar' }

/** The look of a subject's era: a print before photography's newspapers, newsprint for the age of the press, modern after. */
export function lookOfEra(year: number | undefined): MotionLookPreset {
  if (year === undefined) return 'modern'
  if (year < 1880) return 'period'
  if (year < 1975) return 'newsprint'
  return 'modern'
}

/** What a pipeline built from this reference should do with motion design (see the file's head). */
export function motionAdvice(profile: MotionProfile | undefined, style: VideoStyle): MotionAdvice {
  const era = lookOfEra(style.subjectYear)
  const measured = profile && (profile.graphicsShare >= 0.05 || Object.values(profile.perMinute).reduce((a, b) => a + (b ?? 0), 0) >= 0.5)
  const kit = REGISTER_KIT[style.register]
  const avoid: string[] = []
  if (era !== 'modern') avoid.push('neon, glow, glossy gradients, HUD frames and tech sans-serif fonts: they read as futuristic on this period')
  if (era === 'period') avoid.push('photographic 3D globes and satellite looks unless the reference uses them: prefer ink maps on paper')
  if (style.tone !== 'playful') avoid.push('whips, flashes and zoom transitions without a reason; bouncy pops on serious facts')
  avoid.push('sound effects the reference does not have (none unless measured)', 'a zoom that goes in and out, or a still held with nothing happening')
  if (measured && profile) {
    const look = profile.look ?? era
    // a reference that looks modern on a period subject is cloned as is: its audience knows that look; the improvement is offered
    const proposals: string[] = []
    if (profile.look === 'modern' && era !== 'modern') proposals.push(`a ${era} look for the graphics (the subject is from ${style.subjectYear}): ink on paper, a serif, engraved fills`)
    if ((profile.perMinute.data ?? 0) > 0 || style.register === 'documentary') proposals.push('the numbers the voice says set on their word (« ×20 »)')
    if ((profile.perMinute.map ?? 0) > 0) proposals.push('routes drawn along the real way, the camera riding their head')
    if ((profile.perMinute.document ?? 0) > 0) proposals.push('documents followed mark by mark as the voice reads them')
    proposals.push('camera moves that glide towards each picture’s subject', 'motion blur on fast graphics')
    const families = MOTION_FAMILIES.filter((f) => (profile.perMinute[f] ?? 0) > 0).map((f) => ({ family: f, perMinute: profile.perMinute[f] as number, templates: FAMILY_TEMPLATES[f] }))
    return { mode: 'clone', look, families, kit, proposals, avoid }
  }
  const wanted = REGISTER_FAMILIES[style.register]
  const families = MOTION_FAMILIES.filter((f) => (wanted[f] ?? 0) > 0).map((f) => ({ family: f, perMinute: wanted[f] as number, templates: FAMILY_TEMPLATES[f] }))
  if (!families.length) return { mode: 'none', look: era, families: [], kit, proposals: [], avoid }
  const proposals = families.map((f) => `add ${f.family} graphics (≈ ${f.perMinute} a minute) in a ${era} look`)
  return { mode: 'propose', look: era, families, kit, proposals, avoid }
}

/** The advice as a short brief for the style agent's prompt (English; it explains it to the user in their language). */
export function motionBrief(a: MotionAdvice): string {
  const fam = a.families.map((f) => `${f.family} ${f.perMinute}/min (${f.templates.join(', ')})`).join('; ')
  const head =
    a.mode === 'clone'
      ? `The reference already has motion design: clone it (${fam}), look « ${a.look} », editing kit « ${a.kit} ».`
      : a.mode === 'propose'
        ? `The reference has no motion design. Propose adding some, as an option the user accepts: ${fam}; look « ${a.look} », editing kit « ${a.kit} ».`
        : 'No motion design fits this reference: do not add any.'
  const props = a.proposals.length ? `\nProposals to show (each optional): ${a.proposals.map((p) => `- ${p}`).join(' ')}` : ''
  return `${head}${props}\nWhat a viewer would find off here: ${a.avoid.join('; ')}.`
}
