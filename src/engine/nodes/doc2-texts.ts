// The texts documentary@2 writes on screen, written as the reference writes them (qualite-montage): a date is « Spring 1940 », « End of
// 1942 », « Juin 1940 », never the phrase cut from the sentence (« the spring of 1940 », « By the end of 1942 », Charlie's second review),
// and it lands on the word that carries it (the year), not on the phrase's first small word. Pure.

const LEAD_EN = /^(?:(?:by|in|on|at|from|until|till|during|since|after|before|around|about|the|of)\s+)+/i
const LEAD_FR = /^(?:(?:en|au|aux|dès|depuis|vers|jusqu'?en|à|la|le|les|l'|d'|de|du|fin|début)\s*)+(?=\S)/i
const SEASONS = /^(spring|summer|autumn|fall|winter|early|late|end|middle|mid|beginning|start)\s+of\s+(\d{3,4}s?)$/i

/** A date as the reference writes it on screen; `lang` = the video's language. */
export function dateText(said: string, lang = 'en'): string {
  let t = said.trim().replace(/[.,;:!?]+$/u, '').replace(/\s+/g, ' ')
  if (lang === 'fr') {
    // « à la fin de 1942 » → « Fin 1942 », « au printemps 1940 » → « Printemps 1940 »
    const end = /\bfin\s+(?:de\s+|d')?(\d{3,4})/i.exec(t)
    if (end) return `Fin ${end[1]}`
    const start = /\bdébut\s+(?:de\s+|d')?(\d{3,4})/i.exec(t)
    if (start) return `Début ${start[1]}`
    t = t.replace(LEAD_FR, '')
  } else {
    t = t.replace(LEAD_EN, '')
    const m = SEASONS.exec(t)
    if (m) {
      const w = (m[1] as string).toLowerCase()
      const head = w === 'mid' || w === 'middle' ? 'Mid' : w === 'beginning' || w === 'start' ? 'Early' : w
      return `${head.charAt(0).toUpperCase()}${head.slice(1)}${w === 'end' ? ' of' : ''} ${m[2]}`
    }
  }
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : said.trim()
}

/** The word a date lands on: its year when it has one, else its last word. */
export function dateWord(said: string): string {
  const y = /\d{3,4}s?/.exec(said)
  return y ? y[0] : (said.trim().split(/\s+/).at(-1) ?? said)
}
