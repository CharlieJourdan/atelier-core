// Which sentences are talk and which show something (avatar-qualite part 2). Charlie's reference puts its presenter on the
// sentences that speak to the viewer (« ce n'est pas le mur qui est malade », « on va faire ça en quatre temps », « je vais vous
// dire honnêtement ») and its pictures on the ones that name something (the mould, the sack of lime, the brush); the first
// real hooks did the opposite in places, so a talk sentence got a picture of an idea (a hand on a « healthy » wall, gloves for
// « quatre temps »). One small call (fast tier, cached) sorts the sentences; without Claude, or when it fails, a rule on the words
// does. The presenter's placement then prefers the talk sentences (director-mix.ts `placePresenter`).
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { RunCtx } from '../registry'
import { askJson, atomicWrite, hashOf, languageLine } from './common'
import type { Sentence } from './director-mix'

export type SentenceRole = 'talk' | 'show'

/** Words of a sentence spoken to the viewer: an announcement, an opinion, an argument, a negation, a question. French, then German
 *  (avatar-base-marcel: Klaus's German demo sorted every sentence « show » without Claude, so his presenter got 11 % of the hook). */
const TALK =
  /(\bje\b|\bj['’]|\bon va\b|\bvous dire\b|\bhonnêtement\b|\bpourquoi\b|\bvoici\b|\bvoilà\b|\bretenez\b|\bécoutez\b|\bpetite parenthèse\b|\bma règle\b|\bmon conseil\b|\bce n['’]est pas\b|\bsauf que\b|\?|\.\.\.|…|\bles erreurs\b|\bétapes?\b|\bquatre temps\b|\bich\b|\bwir\b|\bwarten Sie\b|\bschreiben Sie\b|\behrlich\b|\bmein Rat\b|\bwarum\b|\bdas ist nicht\b|\bfangen wir\b)/i

/** The rule on the words (no Claude): a sentence with one of the talk marks is talk. */
export function talkByWords(text: string): SentenceRole {
  return TALK.test(text) ? 'talk' : 'show'
}

const RolesAnswer = z.object({ roles: z.array(z.object({ n: z.number().int().min(1), role: z.enum(['talk', 'show']) })).max(2000) })

const RULES = [
  'You sort the sentences of a narrated YouTube video (an AI presenter talks to camera; pictures illustrate the rest).',
  '« show »: the sentence names something a picture can show at that moment: an object, a gesture, a problem one can see (mould, damp, a crack), a place, a result.',
  '« talk »: the sentence speaks to the viewer about the video or the idea: an announcement (« on va faire ça en quatre temps »), an opinion or argument (« je vais vous dire honnêtement »), a negation (« ce n’est pas le mur qui est malade »), a question, a promise. A picture of it would be a metaphor.',
  'Answer with ONE JSON object: {"roles":[{"n":<sentence number>,"role":"talk"|"show"}]} for every sentence; nothing else.'
].join('\n')

/** The role of every sentence: Claude's (fast tier, cached by the text) when it answers, else the rule on the words. */
export async function sentenceRoles(ctx: RunCtx, sentences: readonly Sentence[], language: string, useClaude: boolean, diag: string[]): Promise<Map<number, SentenceRole>> {
  const byWords = new Map(sentences.map((s) => [s.n, talkByWords(s.text)]))
  if (!useClaude || sentences.length === 0) return byWords
  const prompt = [languageLine(language), 'Sentences (number · text):', ...sentences.map((s) => `${s.n} · ${s.text}`)].join('\n')
  const cacheDir = await ctx.services.workspace?.cache('director').catch(() => undefined)
  const file = cacheDir ? path.join(cacheDir, `${hashOf({ v: 'roles-1', rules: RULES, prompt })}.json`) : null
  let answer: z.infer<typeof RolesAnswer> | null = null
  if (file && existsSync(file)) answer = RolesAnswer.safeParse(await readFile(file, 'utf8').then(JSON.parse).catch(() => null)).data ?? null
  if (!answer) {
    try {
      answer = await askJson(ctx, { role: 'director', tier: 'fast', system: RULES, prompt, schema: RolesAnswer })
      if (file) await atomicWrite(file, JSON.stringify(answer))
    } catch (e) {
      if (ctx.signal.aborted || (e instanceof EngineError && e.code === 'missing_tool')) throw e
      diag.push('phrases parlées / à montrer : par les mots (le tri par Claude a échoué)')
      return byWords
    }
  }
  const out = new Map(byWords)
  for (const r of answer.roles) if (out.has(r.n)) out.set(r.n, r.role)
  return out
}
