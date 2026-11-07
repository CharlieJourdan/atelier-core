// P0 — what he can supply (face, voice, own footage), read from a natural answer in French or English. Clause by clause:
// each clause that names an item says yes or no for it; a clause that names nothing (« non », « rien », « mets des
// provisoires », « oui, tout ») speaks for all three; « sauf » flips the polarity. Pure, no model.
// `s` is already lower-cased, accent-free and with straight apostrophes (`parse.ts` `strip`).

export type InputKey = 'face' | 'voice' | 'footage'
export type InputsSaid = Partial<Record<InputKey, boolean>>

const KEYS: InputKey[] = ['face', 'voice', 'footage']
const ITEMS: [InputKey, RegExp][] = [
  ['face', /\b(visages?|tete|face|avatar|tronche|figure|me filmer|je me filme|my face|my avatar|on camera)\b/],
  ['voice', /\b(voix|voice|m'enregistrer|je m'enregistre|record myself)\b/],
  ['footage', /\b(images?|rushe?s?|rushs|sequences?|plans|prises|footage|clips?|archives?|b-?roll|photos?|(?:mes|mon|ma|my|own|propres?)\s+videos?)\b/]
]
const NEG = /\b(non|ne|n'|pas|ni|sans|aucune?|rien|jamais|nope|nan|nada|no|not|don't|doesn't|can't|cannot|without|nothing|none|never|neither|nor)\b/
const PLACEHOLDER = /\b(provisoires?|placeholders?|temporaires?|temporary|stand-?ins?|par defaut|default|bouche-?trous?|faux|fake|generiques?|generic|au hasard|n'importe quoi)\b/
const YES_ALL = /\b(tout|tous|toutes|les trois|all|all three|everything|the three)\b/
const YES = /\b(oui|yes|yep|yeah|ouais|bien sur|of course|sure|volontiers|d'accord)\b/
const UNSURE = /\b(sais pas|sais plus|ca depend|depend|peut-etre|maybe|pas sur|not sure|dunno|no idea|hmm+|euh+|i don't know)\b/
const ONLY = /\b(seulement|juste|uniquement|only|just)\b/
/** Unprompted, an item counts only when he offers or owns it (« mon visage », « j'ai », « je peux fournir »). */
const CUE = /\b(mon|ma|mes|my|mine|j'ai|n'ai|je peux|je fournis|je dispose|i have|i can|i provide|own|propre|propres)\b/
const EXCEPT = /\b(sauf|excepte|except|apart from|besides)\b/g
const SPLIT = /[,;.:!?()]+|\s+(?:mais|but|however)\s+|\s+et\s+pas\s+|\s+and\s+not\s+/

export function readInputs(s: string, asked: boolean): InputsSaid {
  const text = s.replace(/pas du tout|not at all/g, 'non').replace(/\b(aucun|pas de|no) (souci|probleme|problem)s?\b/g, 'ok').replace(EXCEPT, ', exc ')
  const res: InputsSaid = {}
  let noAll = false, yesAll = false, yes = false, onlyMode = false, positives = 0
  for (const raw of text.split(SPLIT)) {
    const exc = raw.trim().startsWith('exc ')
    const clause = raw.trim().replace(/^exc\s+/, '')
    if (!clause) continue
    const found = ITEMS.filter(([, re]) => re.test(clause)).map(([k]) => k)
    const neg = NEG.test(clause)
    if (found.length > 0) {
      // Asked: the item must be offered/refused plainly (a cue, a negation, or a short clause), not just mentioned in a sentence.
      if (!CUE.test(clause) && (!asked || (!neg && clause.split(/\s+/).length > 4))) continue
      const value = exc ? noAll : !neg
      for (const k of found) res[k] = value
      if (value) { positives++; if (ONLY.test(clause)) onlyMode = true }
    } else if (UNSURE.test(clause)) continue
    else if (PLACEHOLDER.test(clause)) { if (asked) noAll = true }
    else if (neg) { if (asked) noAll = true }
    else if (asked && YES_ALL.test(clause)) yesAll = true
    else if (asked && YES.test(clause)) yes = true
  }
  const out: InputsSaid = {}
  if (noAll) for (const k of KEYS) out[k] = false
  else if ((yesAll || yes) && positives === 0) for (const k of KEYS) out[k] = true
  if (onlyMode) for (const k of KEYS) out[k] = false
  const all = { ...out, ...res }
  // A lone refusal (« pas mon visage ») does not decide the other two: asked again rather than guessed.
  return Object.keys(all).length >= 2 || Object.values(all).some(Boolean) ? all : {}
}
