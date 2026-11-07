// The bricks of the Idée and Script stages of the avatar pipeline (production-4, docs/specs/pipeline-avatar.md §2.1, §2.2,
// §2.13): the idea as given, its support videos, the presenter's script (written, or imported), the sponsor mentions and
// the optional fact check. Models per use (decision 0013): Sonnet writes, Haiku fits and tags; the backend is the team's.
import { z } from 'zod'
import { PROMO_PLACES } from '../formats/promo'
import { DemoObjectsSchema } from '../nodes/script-prompts'
import { defineTechnology } from './types'

export const ideaBrief = defineTechnology({
  id: 'idea.brief@1',
  labelKey: 'tech.idea.brief',
  stage: 'idee',
  kind: 'idea',
  nodes: [{ id: 'idea', type: 'idea.brief@1', in: { title: '$inputs.topic', brief: '$inputs.brief' } }],
  provides: { brief: 'idea.brief' },
  inputs: [
    { id: 'topic', kind: 'text', required: true, label: 'Titre (l’idée)' },
    { id: 'brief', kind: 'text', required: false, label: 'Brief', help: 'Quelques lignes : ce que la vidéo doit dire, pour qui.' }
  ],
  params: z.object({}),
  overridable: { recipe: [], channel: [] },
  nodeParams: () => ({ idea: { language: '$style.language' } }),
  cloudUsages: [],
  agentTools: ['ideas.list'],
  access: 'everyone',
  status: 'validated'
})

export const ideaSupport = defineTechnology({
  id: 'idea.support@1',
  labelKey: 'tech.idea.support',
  stage: 'idee',
  kind: 'idea',
  nodes: [{ id: 'support', type: 'idea.support@1', in: { videos: '$inputs.supportVideos' } }],
  provides: { support: 'support.support' },
  inputs: [
    {
      id: 'supportVideos',
      kind: 'text',
      required: false,
      label: 'Vidéos d’appui',
      help: 'Une vidéo par ligne : « sujet : lien » (de quoi parler) ou « structure : lien » (comment la construire).'
    }
  ],
  params: z.object({ supportMax: z.number().int().min(0).max(10).default(3) }),
  overridable: { recipe: ['supportMax'], channel: ['supportMax'] },
  nodeParams: (p) => ({ support: { language: '$style.language', supportMax: p.supportMax } }),
  cloudUsages: ['analyseVideo'],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})

export const scriptWrite2 = defineTechnology({
  id: 'script.write@2',
  labelKey: 'tech.script.write2',
  stage: 'script',
  kind: 'script',
  engineFamily: 'llm',
  styleFamily: 'script',
  nodes: [{ id: 'script', type: 'script.write@2', in: { brief: '@brief', support: '@support?' } }],
  provides: { script: 'script.text', outline: 'script.outline' },
  params: z.object({
    revise: z.boolean().default(true),
    /** Unset: the channel's style profile, else the end of the video. */
    ctaMode: z.enum(['none', 'end', 'mid_end']).optional(),
    /** A numbered list (yes), the mistake arc (no), or the model's choice (auto). */
    numberedParts: z.enum(['auto', 'yes', 'no']).default('auto'),
    /** The channel's own measured words per minute; unset: the language's measured default (180 in French). */
    wpm: z.number().int().min(60).max(300).optional(),
    /** The persona's authority line. */
    persona: z.string().max(300).optional(),
    /** The owner validates the script before the voice (option « Script » : écrit par l'agent, avec validation). */
    review: z.boolean().default(false),
    /** How many chapters (the parts the on-screen chapter marks number, production-9); unset: the writer's choice from 6 minutes. */
    chapters: z.number().int().min(0).max(8).optional(),
    /** How the base's references open (documentary@2, a writing guide); a channel's own measured style replaces it. */
    hookPattern: z.string().max(80).optional(),
    hookSeconds: z.number().min(0).max(120).optional(),
    /** moteur-pov-2: the things the channel's stories handle in the viewer's hands, measured (the demo script follows them too). */
    objects: DemoObjectsSchema.optional(),
    /** moteur-pov-2: how the channel addresses the viewer (measured). */
    address: z.enum(['you', 'we', 'i', 'neutral']).optional()
  }),
  overridable: { recipe: ['revise', 'ctaMode', 'numberedParts', 'wpm', 'persona', 'review', 'chapters', 'hookPattern', 'hookSeconds', 'objects', 'address'], channel: ['ctaMode', 'numberedParts', 'wpm', 'persona', 'chapters'] },
  nodeParams: (p) => ({
    script: {
      language: '$style.language',
      revise: p.revise,
      numberedParts: p.numberedParts,
      ...(p.ctaMode ? { ctaMode: p.ctaMode } : {}),
      ...(p.wpm ? { wpm: p.wpm } : {}),
      ...(p.persona ? { persona: p.persona } : {}),
      ...(p.chapters !== undefined ? { chapters: p.chapters } : {}),
      ...(p.hookPattern || p.objects || p.address
        ? { style: { ...(p.hookPattern ? { hookPattern: p.hookPattern } : {}), ...(p.hookSeconds !== undefined ? { hookSeconds: p.hookSeconds } : {}), ...(p.objects ? { objects: p.objects } : {}), ...(p.address ? { address: p.address } : {}) } }
        : {})
    }
  }),
  ownerGate: (p) => p.review,
  cloudUsages: [],
  agentTools: ['script.brief', 'script.save'],
  access: 'everyone',
  status: 'validated'
})

/** The person's own script (option « Script » : importé): it skips writing; only its beats and chapters are tagged. */
export const scriptImport = defineTechnology({
  id: 'script.import@1',
  labelKey: 'tech.script.import',
  stage: 'script',
  kind: 'script',
  engineFamily: 'llm',
  nodes: [{ id: 'script', type: 'script.write@2', in: { brief: '@brief?', pasted: '$inputs.script' } }],
  provides: { script: 'script.text', outline: 'script.outline' },
  inputs: [{ id: 'script', kind: 'text', required: true, label: 'Script', help: 'Ton texte, tel qu’il sera dit : il n’est ni rallongé ni réécrit.' }],
  params: z.object({
    wpm: z.number().int().min(60).max(300).optional(),
    /** False: the script's beats are cut here, without the model (no chapters needed). */
    tagging: z.boolean().optional()
  }),
  overridable: { recipe: ['wpm', 'tagging'], channel: ['wpm'] },
  nodeParams: (p) => ({ script: { language: '$style.language', ...(p.wpm ? { wpm: p.wpm } : {}), ...(p.tagging === false ? { tagImport: false } : {}) } }),
  cloudUsages: [],
  agentTools: ['script.save'],
  access: 'everyone',
  status: 'validated'
})

/** The channel's sponsor mentions, where its placement rule says (§2.13); without a sponsor the script passes as is. */
export const scriptSponsor = defineTechnology({
  id: 'script.sponsor@1',
  labelKey: 'tech.script.sponsor',
  stage: 'script',
  kind: 'sponsor',
  engineFamily: 'llm',
  nodes: [{ id: 'sponsor', type: 'script.sponsor@1', in: { script: '@script', outline: '@outline', sponsor: '$inputs.sponsor' } }],
  provides: { script: 'sponsor.text', outline: 'sponsor.outline' },
  inputs: [
    {
      id: 'sponsor',
      kind: 'text',
      required: false,
      label: 'Sponsor',
      help: 'Lignes « nom : », « pitch : », « lien : », « placement : début | milieu | fin », « rappel : oui | non ». Ta propre promo : « type : promo », « place : après l’accroche | fin | mention | aucune », « moment : 1:25 », « mode : identique | adaptée | par vidéo ». Vide : pas de mention.'
    }
  ],
  params: z.object({ wpm: z.number().int().min(60).max(300).optional(), place: z.enum(PROMO_PLACES).optional() }),
  overridable: { recipe: ['wpm', 'place'], channel: ['wpm'] },
  nodeParams: (p) => ({ sponsor: { language: '$style.language', ...(p.wpm ? { wpm: p.wpm } : {}), ...(p.place ? { place: p.place } : {}) } }),
  cloudUsages: [],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})

/** Option « Vérification des faits »: exact unique-quote fixes, the original kept beside (ENGINE-SPEC §18). */
export const scriptFactcheck = defineTechnology({
  id: 'script.factcheck@1',
  labelKey: 'tech.script.factcheck',
  stage: 'script',
  kind: 'factcheck',
  engineFamily: 'llm',
  nodes: [{ id: 'factcheck', type: 'script.factcheck@1', in: { script: '@script', outline: '@outline', brief: '@brief?' } }],
  provides: { script: 'factcheck.text', outline: 'factcheck.outline' },
  params: z.object({ partWords: z.number().int().min(150).max(2000).default(550) }),
  overridable: { recipe: ['partWords'], channel: [] },
  nodeParams: (p) => ({ factcheck: { language: '$style.language', partWords: p.partWords } }),
  cloudUsages: [],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})
