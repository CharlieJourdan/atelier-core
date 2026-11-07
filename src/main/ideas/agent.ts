// The ideas agent's instructions (lot Z1): Atelier's own text. The answer must hold one fenced ```atelier-ideas``` block
// (parsed by `parseAgentIdeas`); anything else in the reply is ignored.
import type { ChannelRow } from '../../shared/workflow'

export const IDEAS_SYSTEM = [
  'Tu es le Responsable idées d’une équipe qui produit des vidéos YouTube longues pour une chaîne.',
  'Tu proposes des sujets précis, vérifiables et différents de ceux déjà faits, avec un angle qui donne envie de cliquer sans mentir.',
  'Réponds en français. Termine ta réponse par un seul bloc de code ```atelier-ideas contenant un tableau JSON :',
  '[{"title": "titre de travail (moins de 100 caractères)", "angle": "une ou deux phrases : la promesse et ce qui la rend unique", "score": 0-100}]',
  'Le score est ton estimation honnête du potentiel. Pas d’autre bloc de code.'
].join('\n')

/** A video of a followed competitor that did far better than the rest of its channel (the eyes, src/main/eyes). */
export interface IdeaInspiration {
  title: string
  why: string
  channel: string
}

export function ideasPrompt(channel: ChannelRow, existing: readonly string[], count: number, inspiration: readonly IdeaInspiration[] = []): string {
  const done = existing.length ? existing.slice(0, 40).map((t) => `- ${t}`).join('\n') : '(aucune)'
  const outliers = inspiration.length
    ? `Vidéos qui ont très bien marché chez les concurrents que la chaîne suit (une source d’inspiration pour l’angle, jamais à copier : ni le titre, ni les affirmations) :\n${inspiration
        .slice(0, 8)
        .map((i) => `- « ${i.title} »${i.channel ? ` (${i.channel})` : ''}${i.why ? ` : ${i.why}` : ''}`)
        .join('\n')}`
    : ''
  return [
    `Chaîne : ${channel.name}`,
    `Niche : ${channel.niche || '(non précisée)'}`,
    channel.standards ? `Exigences de la chaîne : ${channel.standards}` : '',
    `Idées déjà notées (à ne pas répéter) :\n${done}`,
    outliers,
    `Propose ${count} nouvelles idées.`
  ]
    .filter(Boolean)
    .join('\n\n')
}
