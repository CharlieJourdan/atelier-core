// `research.topic@1` (docs/ENGINE-SPEC.md §16): one Claude call that researches a topic with Claude Code's own web tools,
// within hard limits, and writes the brief the scriptwriter works from. Seven fixed Markdown sections, in the video language.
import { z } from 'zod'
import { EngineError } from '../errors'
import { SHAPES } from '../formats/outline'
import { defineNode, type RunCtx } from '../registry'
import { need } from '../services'
import { languageLine, progress, readText } from './common'

const Params = z.object({
  language: z.string().min(2).default('fr'),
  maxSearches: z.number().int().min(0).max(12).default(8),
  maxFetches: z.number().int().min(0).max(10).default(6),
  avoidTitles: z.array(z.string()).default([]),
  requireSources: z.boolean().default(true),
  /**
   * Videos of the channel's tracked competitors that did far better than the rest of their channel (title and why, from the
   * numbers; src/shared/outliers.ts): inspiration for the angle, never to copy. Absent = none, the prompt is unchanged.
   */
  inspiration: z
    .array(z.object({ title: z.string().min(1).max(200), why: z.string().max(400).default(''), channel: z.string().max(120).default('') }))
    .max(8)
    .optional()
})
type Params = z.infer<typeof Params>

const HEADINGS = {
  fr: ['Angle', 'Titre de travail', 'Forme du récit', 'Faits clés', 'Noms, lieux, dates et chiffres', 'À éviter', 'Sources'],
  en: ['Angle', 'Working title', 'Story shape', 'Key facts', 'Names, places, dates and figures', 'What to avoid', 'Sources']
} as const

const headingsFor = (lang: string): readonly string[] => (lang === 'fr' ? HEADINGS.fr : HEADINGS.en)

/** Numbers (1..7) of the sections found as `## n. Title` headings. */
function sectionsFound(text: string): Set<number> {
  const found = new Set<number>()
  for (const m of text.matchAll(/^#{1,3}\s*(\d)[.)]\s*\S/gmu)) {
    const n = Number(m[1])
    if (n >= 1 && n <= 7) found.add(n)
  }
  return found
}

/** The body of section `n` (text between its heading and the next numbered heading). */
function sectionBody(text: string, n: number): string {
  const re = new RegExp(`^#{1,3}\\s*${n}[.)][^\\n]*\\n([\\s\\S]*?)(?=^#{1,3}\\s*\\d[.)]|$(?![\\s\\S]))`, 'mu')
  return re.exec(text)?.[1]?.trim() ?? ''
}

const firstLine = (s: string): string =>
  (s.split('\n').find((l) => l.trim() !== '') ?? '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, '')
    .replace(/\*\*|__/g, '')
    .replace(/^(?:titre de travail|working title|titre|title)\s*:\s*/iu, '')
    .trim()

const isRefusal = (text: string): boolean => text.trim().length < 200 || sectionsFound(text).size === 0

function system(lang: string, p: Params): string {
  const h = headingsFor(lang)
  return [
    languageLine(lang),
    'You are the researcher of a documentary video team. You write a research brief for the scriptwriter, not for the viewer: dense, factual, no flourishes.',
    'Research rules:',
    `- You may use ONLY Claude Code's own web search and page-fetch tools, nothing else. At most ${p.maxSearches} searches and ${p.maxFetches} page reads in total. Search in the language of the story as well as in the video language.`,
    '- Prefer primary and institutional sources. An encyclopedia is a starting point, never the citation.',
    p.requireSources
      ? '- Every fact carries its source (a URL or a book reference). A fact without a source is either dropped or marked "disputed".'
      : '- Give a source for each fact whenever you have one.',
    '- Links given by the user are facts to verify and build on, never wording to reuse.',
    '- If no web tool is available or nothing is found, still write the brief from your own knowledge, mark every fact "likely", and put the single line WEB_UNAVAILABLE at the very end.',
    '- An angle is good when it is specific (a person, a moment, a number), surprising and answerable inside the target length.',
    `Answer with one Markdown document with exactly these seven numbered sections, headings written as "## n. Title":`,
    ...h.map((t, i) => `## ${i + 1}. ${t}`),
    'Section content: 1 the angle in one sentence. 2 the working title on the first line, then up to 3 alternatives as list items. 3 the suggested story shape, one of: ' +
      `${SHAPES.join(', ')}, with a one-line reason. 4 key facts as list items, each ending with "(source: ...; confidence: sure|likely|disputed)". 5 names, places, dates and figures as a list. 6 what to avoid (angles already used, claims that could not be sourced). 7 sources as a deduplicated list.`
  ].join('\n')
}

function userPrompt(ctx: RunCtx, topic: string, links: string | undefined, p: Params): string {
  const parts = [`Target length of the video: ${ctx.minutes} minutes. Language: ${p.language}.`, `Topic:\n${topic.trim()}`]
  if (links?.trim()) parts.push(`Links and notes from the user (read them first, each capped at about 30,000 characters):\n${links.trim().slice(0, 4000)}`)
  if (p.avoidTitles.length > 0) {
    parts.push(
      `Titles already used by the channel:\n${p.avoidTitles.map((t) => `- ${t}`).join('\n')}\nIf the topic overlaps one of them, choose a different entry point, central image or question, and say so in section 1.`
    )
  }
  if (p.inspiration && p.inspiration.length > 0) {
    const lines = p.inspiration.map((i) => `- "${i.title}"${i.channel ? ` (${i.channel})` : ''}${i.why ? `: ${i.why}` : ''}`)
    parts.push(
      `Videos that did far better than the rest of their channel, among the competitors this channel follows (inspiration for the angle only: never copy a title, never reuse their claims, every fact still needs its own source):\n${lines.join('\n')}`
    )
  }
  if (ctx.notes.length > 0) parts.push(`Requested changes:\n${ctx.notes.map((n) => `- ${n}`).join('\n')}`)
  return parts.join('\n\n')
}

function metaOf(brief: string, p: Params, demo: boolean): Record<string, string | number | boolean | string[]> {
  const shapeText = sectionBody(brief, 3).toLowerCase()
  const shape = SHAPES.find((s) => shapeText.includes(s)) ?? ''
  const sourceLines = sectionBody(brief, 7)
    .split('\n')
    .filter((l) => /^\s*(?:[-*•]|\d+[.)])\s+\S/u.test(l))
  return {
    language: p.language,
    title: firstLine(sectionBody(brief, 2)),
    shape,
    sources: sourceLines.length,
    demo,
    warnings: /^WEB_UNAVAILABLE\s*$/m.test(brief) ? ['recherche web indisponible'] : []
  }
}

export const researchTopic = defineNode<Params>({
  type: 'research.topic@1',
  inputs: { topic: { type: 'text.input', required: true, label: 'Sujet' }, links: { type: 'text.input', required: false, label: 'Liens et notes' } },
  outputs: { brief: 'text.brief' },
  params: Params,
  reads: ['minutes'],
  executors: ['local'],
  claudeRole: 'researcher',
  estimate: () => ({ units: [{ unit: 'calls', qty: 1 }], provider: 'claude', durationS: 150 }),

  async run(ctx, inputs, p) {
    const claude = need(ctx, 'claude')
    const topic = readText(inputs.topic, 'The topic')
    const links = typeof inputs.links?.value === 'string' ? inputs.links.value : undefined
    const sys = system(p.language, p)
    const prompt = userPrompt(ctx, topic, links, p)
    const ask = async (text: string): Promise<string> => (await claude.ask({ role: 'researcher', system: sys, prompt: text, json: false, tools: ['web'], signal: ctx.signal })).text
    progress(ctx, 0, 2, 'Recherche en cours…')
    let reply = await ask(prompt)
    // a refusal is a non-answer by structure: one retry, then a permanent error (§16)
    if (isRefusal(reply)) reply = await ask(prompt)
    if (isRefusal(reply)) throw new EngineError('refused', 'Le sujet a été refusé : reformule-le')
    let missing = [1, 2, 3, 4, 5, 6, 7].filter((n) => !sectionsFound(reply).has(n))
    if (missing.length > 0) {
      const names = missing.map((n) => `${n}. ${headingsFor(p.language)[n - 1]}`).join(', ')
      reply = await ask(`${prompt}\n\nYour previous answer lacks these sections: ${names}. Answer again with the complete document, all seven sections, headings written as "## n. Title".`)
      missing = [1, 2, 3, 4, 5, 6, 7].filter((n) => !sectionsFound(reply).has(n))
      if (missing.length > 0) throw new EngineError('schema', `researcher: the brief still lacks sections ${missing.join(', ')} after one repair`)
    }
    progress(ctx, 2, 2, 'Brief prêt')
    const brief = reply.replace(/^WEB_UNAVAILABLE\s*$/gm, '').trim()
    const meta = metaOf(reply, p, false)
    return { brief: { value: brief, meta } }
  },

  async fake(ctx, inputs, p) {
    const topic = readText(inputs.topic, 'The topic').trim().replace(/\s+/g, ' ')
    const fr = p.language === 'fr'
    const h = headingsFor(p.language)
    const src = (n: number): string => (fr ? `Source de démonstration n° ${n} (inventée)` : `Demo source no. ${n} (invented)`)
    const body = fr
      ? [
          `Une question simple sur « ${topic} » : ce que les gens croient savoir, et ce que l’on peut réellement établir.`,
          `${topic}\n- ${topic} : ce que l’on a mal compris\n- Pourquoi ${topic} intrigue encore\n- ${topic}, version courte`,
          'explainer : un effet surprenant d’abord, puis le mécanisme étape par étape, puis les limites.',
          `- Fait de démonstration sur ${topic} : un repère daté, à remplacer par un vrai fait (source : ${src(1)} ; confiance : likely)\n- Deuxième fait de démonstration, volontairement général (source : ${src(2)} ; confiance : likely)\n- Troisième fait de démonstration, à vérifier (source : ${src(3)} ; confiance : disputed)`,
          `- Sujet : ${topic}\n- Repère chiffré de démonstration : 1850 (inventé)\n- Lieu de démonstration (inventé)`,
          '- Les affirmations sans source.\n- Les superlatifs que rien ne soutient.',
          `- ${src(1)}\n- ${src(2)}\n- ${src(3)}`
        ]
      : [
          `A simple question about "${topic}": what people think they know, and what can actually be established.`,
          `${topic}\n- ${topic}: what was misunderstood\n- Why ${topic} still puzzles people\n- ${topic}, the short version`,
          'explainer: a surprising effect first, then the mechanism step by step, then the limits.',
          `- Demo fact about ${topic}: a dated landmark, to be replaced by a real fact (source: ${src(1)}; confidence: likely)\n- Second demo fact, deliberately general (source: ${src(2)}; confidence: likely)\n- Third demo fact, to be checked (source: ${src(3)}; confidence: disputed)`,
          `- Subject: ${topic}\n- Demo figure: 1850 (invented)\n- Demo place (invented)`,
          '- Claims without a source.\n- Superlatives nothing supports.',
          `- ${src(1)}\n- ${src(2)}\n- ${src(3)}`
        ]
    const brief = h.map((t, i) => `## ${i + 1}. ${t}\n${body[i]}`).join('\n\n')
    ctx.emit({ kind: 'log', level: 'info', text: 'brief de démonstration' })
    return { brief: { value: brief, meta: metaOf(brief, p, true) } }
  }
})
