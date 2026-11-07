// The pipeline's « locale / culture » (avatar-efficience): where the video's world is. A French channel's pictures show French
// homes, the equipment and brands sold in France, euros and metric units; Marcel's first full video showed American outdoor units
// and breaker panels in a French house. The director reads it in its rules and every picture prompt carries it. Pure.
import { z } from 'zod'

/** A BCP 47 tag with a region (`fr-FR`, `fr-BE`, `en-GB`…); the language alone (`fr`) means its main country. */
export const Locale = z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/)
export type Locale = z.infer<typeof Locale>

/** An object-accuracy note: `subject: how it really looks` (« condensate pipe: a thin 16 mm flexible white PVC tube… »). */
export const ObjectNotes = z.array(z.string().trim().min(3).max(300)).max(30)

const MAIN_REGION: Record<string, string> = { fr: 'FR', en: 'US', es: 'ES', de: 'DE', it: 'IT', pt: 'PT', ja: 'JP', nl: 'NL' }

/** What a country's pictures must look like, where the generic line is not enough (equipment people get wrong). */
const DETAILS: Record<string, string> = {
  FR: 'European wall-mounted air-conditioner and heat-pump units, a French « tableau électrique » with white modular DIN-rail breakers, French two-pin sockets, French tiles, shutters and radiators',
  BE: 'European wall-mounted units, a Belgian electrical panel with white modular DIN-rail breakers, European two-pin sockets',
  GB: 'British three-pin sockets, a British consumer unit, British brick terraced houses',
  JP: 'Japanese homes and appliances, Japanese sockets and signs'
}

/** The locale of a language (`fr` → `fr-FR`; a tag with its region stays), or null when unknown. */
export function localeOf(language: string | null | undefined): string | null {
  if (!language) return null
  const [lang, region] = language.split('-')
  const r = region ?? MAIN_REGION[lang ?? '']
  return lang && r ? `${lang}-${r.toUpperCase()}` : null
}

/** The country of a locale (`fr` → `FR`), or null when it names none. */
export function regionOf(locale: string | undefined): string | null {
  if (!locale) return null
  const [lang, region] = locale.split('-')
  return region ?? MAIN_REGION[lang ?? ''] ?? null
}

/** The English line the director and the pictures carry (empty without a locale). */
export function cultureLine(locale: string | undefined): string {
  const region = regionOf(locale)
  if (!region) return ''
  const country = new Intl.DisplayNames(['en'], { type: 'region' }).of(region) ?? region
  const currency = region === 'US' ? 'dollars' : region === 'GB' ? 'pounds' : region === 'JP' ? 'yen' : 'euros'
  const units = region === 'US' ? 'imperial units' : 'metric units'
  const details = DETAILS[region]
  return `Set in ${country}: ${country === 'United States' ? 'American' : 'local'} homes, the equipment, brands, signs and plugs sold in ${country}${details ? ` (${details})` : ''}, never another country's appliances, panels or outlets; prices in ${currency}, ${units}.`
}

/**
 * The notes whose subject a prompt names, as one clause (empty when none applies). A subject is the text before « : », its
 * alternatives split by « / »; an alternative is named when all its words are in the prompt (« drain hose » needs both).
 */
export function notesFor(prompt: string, notes: readonly string[] | undefined): string {
  const p = prompt.toLowerCase()
  const hit = (notes ?? []).filter((n) => {
    const subject = (n.split(':')[0] ?? '').toLowerCase()
    return subject.split('/').some((alt) => {
      const words = alt.trim().split(/\s+/).filter((w) => w.length > 2)
      return words.length > 0 && words.every((w) => p.includes(w))
    })
  })
  return hit.join('; ')
}
