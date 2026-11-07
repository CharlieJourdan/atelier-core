// The channel's own promo in the script (promo-motion): where it goes when the script already speaks of the offer, and the words of the
// demo runs. Pure helpers of `script.sponsor` (the placement of a written mention is formats/sponsor.ts `effectiveRule`).
import { fold, siteStem } from '../formats/promo'
import type { Sponsor } from '../formats/sponsor'
import { countWords } from '../text/script'
import type { Slot } from './script-sponsor'

/**
 * The paragraph of the script that already speaks of the promo's offer (placement « mention »): the first one that names the site (as
 * said aloud: « exemple-compagnon-tout-en-un-mot.fr » still holds « exemplecompagnon ») or the product. Null when none does.
 */
export function promoPassage(paragraphs: readonly string[], s: Sponsor): number | null {
  return promoPassages(paragraphs, s)[0] ?? null
}

/**
 * The passages the promo goes on (placement « mention »): the first paragraph that names the offer, and the last one when a later
 * paragraph names it again (the reference shows its card on the aside and again at the end). Empty when none does.
 */
export function promoPassages(paragraphs: readonly string[], s: Sponsor): number[] {
  const keys = [s.promo ? siteStem(s.promo.site) : '', siteStem(s.link), fold(s.name)].filter((k) => k.length >= 4)
  if (keys.length === 0) return []
  const named = paragraphs.flatMap((p, i) => {
    const f = fold(p)
    return keys.some((k) => f.includes(k)) ? [i] : []
  })
  const first = named[0]
  const last = named.at(-1)
  return first === undefined ? [] : last !== undefined && last !== first ? [first, last] : [first]
}

/** The promo's mention of the demo runs (and the fallback when the model's stays unusable), in the reference's own shape. */
export function promoMention(s: Sponsor, slot: Slot, language: string): string {
  const fr = language === 'fr'
  const site = s.promo?.site ?? s.link.replace(/^https?:\/\//, '')
  if (language === 'de') {
    const de = [
      'Kurz eine Sache in eigener Sache.',
      `${s.name} ist meine eigene Arbeit.`,
      ...(s.pitch ? [s.pitch.replace(/[.!?]?$/u, '.')] : []),
      `Sie finden es auf ${site}, der Link steht ganz oben in der Beschreibung.`
    ]
    const more = ['Da steht alles drin, was ich in all den Jahren gelernt habe.', 'Wenn Ihnen dieses Video hilft, finden Sie dort den Rest.']
    for (let i = 0; countWords(de.join(' ')) < slot.words * 0.9 && i < more.length; i++) de.splice(de.length - 1, 0, more[i] as string)
    return de.join(' ')
  }
  const lines = [
    fr ? 'Petite parenthèse.' : 'A quick word.',
    fr ? `${s.name}, c’est mon travail à moi.` : `${s.name} is my own work.`,
    ...(s.pitch ? [s.pitch.replace(/[.!?]?$/u, '.')] : []),
    fr ? `C’est sur ${site}, le lien est en haut de la description.` : `It is on ${site}, the link is at the top of the description.`
  ]
  const fill = fr
    ? ['J’y ai mis tout ce que j’ai appris, sans détour.', 'Si cette vidéo vous aide, vous y trouverez la suite.']
    : ['I put everything I learned in it, plainly.', 'If this video helps you, you will find the rest there.']
  for (let i = 0; countWords(lines.join(' ')) < slot.words * 0.9 && i < fill.length; i++) lines.splice(lines.length - 1, 0, fill[i] as string)
  return lines.join(' ')
}
