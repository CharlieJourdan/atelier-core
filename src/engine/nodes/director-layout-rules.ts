// What a sentence is, for the presenter's layout (avatar-layouts, 2026-11-02): the kinds of moment Charlie's references lay the
// presenter out differently on (research note avatar-layouts-2026-11 (old repository)). A pipeline's `presenterLayouts.triggers` maps a kind to
// the layouts a presenter appearance that opens on such a sentence takes; the kinds are words, so a pipeline of another language
// or another habit rewrites the table (the setting), never the engine.
import { z } from 'zod'

export const LAYOUT_TRIGGERS = ['intro', 'cta', 'item', 'question', 'story', 'claim', 'explain'] as const
export type LayoutTrigger = (typeof LAYOUT_TRIGGERS)[number]

/**
 * The marks of each kind, French and English, tried in this order (a sentence can carry several: the first wins):
 *  - intro: the presenter says who he is (« je m'appelle Marcel », « j'ai été plombier pendant 40 ans »)
 *  - cta: a call to act (« dites-moi en commentaire », « abonnez-vous », « le lien est en description »)
 *  - item: the opening of a numbered item, step or mistake (« la troisième chose », « première erreur », « step two »)
 *  - question: asked of the viewer
 *  - story: a told case (« une dame à Cali », « je me souviens », « last year »)
 *  - claim: a warning or a verdict (« la plus grosse facture », « jamais », « the biggest mistake »)
 * Anything else is an explanation.
 */
const MARKS: readonly [Exclude<LayoutTrigger, 'explain'>, RegExp][] = [
  ['intro', /\b(je m['’]appelle|je suis [a-zà-ÿ]+,|j['’]ai (?:été|passé|fait|travaillé)\b[^.]{0,40}\b\d+ ans|ich hei(?:ß|ss)e|ich war \d+ jahre|my name is|i['’]m [a-z]+ and i['’]ve|i['’]ve been (?:a|an|doing)\b)/i],
  ['cta', /\b(en commentaires?|dans les commentaires|abonn(?:e|ez|ement)|la cloche|prochaine vid[ée]o|dans la description|en description|dites-moi|racontez-moi|subscribe|in the comments|leave a comment|next video|in the description|tell me)\b/i],
  ['item', /\b(?:la |le |une |un |cette )?(?:premi[eè]re?|deuxi[eè]me|second[e]?|troisi[eè]me|quatri[eè]me|cinqui[eè]me|sixi[eè]me|derni[eè]re?)\s+(?:chose|geste|[eé]tape|erreur|astuce|point|r[eè]gle|[eé]l[eé]ment)|\b(?:first|second|third|fourth|fifth|sixth|last|next)\s+(?:thing|step|mistake|tip|rule|point)|\b(?:[eé]tape|step|geste|erreur|mistake|tip|astuce)\s+(?:n[°o]\s*)?\d/i],
  ['question', /\?/],
  ['story', /\b(une dame|un client|une cliente|un jour|l['’]an dernier|je me souviens|il y a \w+ ans|une famille|my client|one day|i remember|last year|a lady|years ago)\b/i],
  ['claim', /\b(la plus grosse|la pire|le pire|jamais|attention|danger|dangereux|ne faites pas|ne le faites|c['’]est (?:là|ce) qui|the biggest|the worst|never|careful|warning|don['’]t do)\b/i]
]

/** The kind of a sentence, by the words (pure, no model call: the scene pass and the director agree on it everywhere). */
export function triggerOf(text: string): LayoutTrigger {
  // « Ich bin Klaus. »: a German introduction is a capitalised name, so this mark is matched with its case (not « Ich bin müde. »)
  if (/(?:^|\s)[Ii]ch bin [A-ZÄÖÜ][a-zäöüß]+[.,]/.test(text)) return 'intro'
  for (const [kind, re] of MARKS) if (re.test(text)) return kind
  return 'explain'
}

const weight = z.number().min(0).max(1)
/** How a kind of moment shares the presenter's layouts (weights, normalised by the planner; absent kinds weigh nothing). */
export const LayoutWeights = z.object({ full: weight.optional(), split: weight.optional(), pip: weight.optional() }).refine((w) => (w.full ?? 0) + (w.split ?? 0) + (w.pip ?? 0) > 0, 'a kind of moment needs at least one layout')
export type LayoutWeights = z.infer<typeof LayoutWeights>
