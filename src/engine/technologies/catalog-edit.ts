// The editing bricks of production-9 (docs/specs/production-model.md §2.6, pipeline-avatar §2.12–§2.13), each a manifest over its
// node: `edit.chapters` (a chapter mark that pops when a numbered part starts; position and look from the `edit` style) and
// `edit.sponsor` (the channel's sponsor on the exact sentences of its mentions, a card or its own clip, and a QR code). Both hand
// timed layers to `render.assemble`. The simple montage itself is `render.assemble` (the spec's `edit.assemble` simple, `edit.layout`
// and `render.master` in one brick: the shots on the voice, straight cuts, slow moves, the presenter full, split or inset).
import { z } from 'zod'
import { CHAPTER_LOOKS, CHAPTER_POSITIONS } from '../../shared/brick-styles'
import { EDIT_KITS, type EditKitName } from '../formats/edit-kit'
import { defineTechnology } from './types'

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)

/**
 * The style's editing kit (motion-montage, record 0073): transitions per boundary, the stills' camera, punch-ins on the voice's
 * accents and the sound effects, on the plan of the director; it replaces the plan and the music bed for the render.
 */
export const editFx = defineTechnology({
  id: 'edit.fx@1',
  labelKey: 'tech.edit.fx',
  stage: 'montage',
  kind: 'editing',
  styleFamily: 'edit',
  nodes: [{ id: 'fx', type: 'edit.fx@1', in: { plan: '@plan', words: '@words', voice: '@voice?', music: '@music?' } }],
  provides: { plan: 'fx.plan', music: 'fx.music' },
  params: z.object({
    /** A kit measured on a reference (documentary, avatar, pov2d); unset: the plan as the director made it. */
    kit: z.enum(Object.keys(EDIT_KITS) as [EditKitName, ...EditKitName[]]).optional()
  }),
  overridable: { recipe: ['kit'], channel: ['kit'] },
  nodeParams: (p) => ({ fx: { ...(p.kit ? { kit: p.kit } : {}) } }),
  cloudUsages: [],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})

export const editChapters = defineTechnology({
  id: 'edit.chapters@1',
  labelKey: 'tech.edit.chapters',
  stage: 'montage',
  kind: 'chapters',
  styleFamily: 'edit',
  nodes: [{ id: 'chapters', type: 'edit.chapters@1', in: { plan: '@plan' } }],
  provides: { chapters: 'chapters.marks' },
  params: z.object({
    /** Unset: top right (Charlie, 10-31). An `edit` style dressing the brick sets it instead. */
    position: z.enum(CHAPTER_POSITIONS).optional(),
    look: z.enum(CHAPTER_LOOKS).optional(),
    /** A word before the number (« Astuce », « Erreur »); unset: the number alone. */
    prefix: z.string().max(20).optional(),
    showTitle: z.boolean().default(true),
    seconds: z.number().min(1.5).max(12).default(4),
    accent: hex.optional()
  }),
  overridable: { recipe: ['position', 'look', 'prefix', 'showTitle', 'seconds', 'accent'], channel: ['position', 'look', 'prefix', 'showTitle', 'accent'] },
  nodeParams: (p) => ({
    chapters: {
      showTitle: p.showTitle,
      seconds: p.seconds,
      ...(p.position ? { position: p.position } : {}),
      ...(p.look ? { look: p.look } : {}),
      ...(p.prefix !== undefined ? { prefix: p.prefix } : {}),
      ...(p.accent ? { accent: p.accent } : {})
    }
  }),
  // the style's look (decision 0035: a style dressing the brick wins over the brick's own settings; unset fields keep them)
  styleParams: (style) => ({
    chapters: {
      ...(style.chapters?.position ? { position: style.chapters.position } : {}),
      ...(style.chapters?.look ? { look: style.chapters.look } : {}),
      ...(style.chapters?.prefix !== undefined ? { prefix: style.chapters.prefix } : {}),
      ...(style.chapters?.accent ? { accent: style.chapters.accent } : {})
    }
  }),
  cloudUsages: [],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})

export const editSponsor = defineTechnology({
  id: 'edit.sponsor@1',
  labelKey: 'tech.edit.sponsor',
  stage: 'montage',
  kind: 'sponsor',
  nodes: [{ id: 'sponsorslot', type: 'edit.sponsor@1', in: { plan: '@plan', outline: '@outline', words: '@words', sponsor: '$inputs.sponsor' } }],
  provides: { sponsor: 'sponsorslot.slots' },
  inputs: [
    {
      id: 'sponsor',
      kind: 'text',
      required: false,
      label: 'Sponsor',
      help: 'Lignes « nom : », « pitch : », « lien : », « média : <fichier> », « écran : carte | média », « qr : oui | non », « position du qr : bas droite ». Ta propre promo : « type : promo », « titre : », « sous-titre : », « site : », « image : <fichier> », « visuel : produit | écran », « logo : <fichier> » (animée par nos briques), ou « média : <ton clip> ». Vide : pas de sponsor.'
    }
  ],
  params: z.object({ kicker: z.string().min(1).max(40).default('Partenaire'), accent: hex.default('#FFD84D') }),
  overridable: { recipe: ['kicker', 'accent'], channel: ['kicker', 'accent'] },
  nodeParams: (p) => ({ sponsorslot: { kicker: p.kicker, accent: p.accent } }),
  cloudUsages: [],
  agentTools: [],
  access: 'everyone',
  status: 'validated'
})
