// Offer pack (Produits et offres): the prompt sent to the model and the strict parse of its answer.
// The answer ends with ONE fenced ```atelier-offer {json}``` block; anything else is refused and nothing is saved.
import { z } from 'zod'
import { extractOfferBlock, type OfferPack, type OfferRow, type SponsorDealRow } from '../../shared/money'

const text = z.string().trim().min(1)

export const offerPackSchema = z.object({
  ideas: z.array(z.object({ title: text, pitch: text })).length(3),
  names: z.array(text).length(5),
  prices: z.array(z.object({ label: text, amountEur: z.number().min(0).max(100000) })).min(1).max(6),
  funnel: z.array(z.object({ step: text, detail: text })).min(2).max(8)
})

export function parseOfferPack(answer: string): OfferPack {
  const block = extractOfferBlock(answer)
  if (!block) throw new Error('La réponse du modèle ne contient pas de bloc « atelier-offer ». Rien n’a été enregistré ; réessaie.')
  let raw: unknown
  try {
    raw = JSON.parse(block)
  } catch {
    throw new Error('Le bloc « atelier-offer » n’est pas du JSON valide. Rien n’a été enregistré ; réessaie.')
  }
  const r = offerPackSchema.safeParse(raw)
  if (!r.success) {
    const where = r.error.issues.map((i) => i.path.join('.') || 'bloc').slice(0, 3).join(', ')
    throw new Error(`Le pack d’offre est incomplet ou mal formé (${where}). Rien n’a été enregistré ; réessaie.`)
  }
  return r.data
}

export const PACK_SYSTEM = [
  'Tu es le conseiller produits d’une chaîne YouTube francophone. Tu proposes des offres simples à vendre à son audience.',
  'Réponds en français, en quelques lignes de contexte, puis termine par UN SEUL bloc de code balisé exactement ainsi :',
  '```atelier-offer',
  '{"ideas":[{"title":"","pitch":""}],"names":[""],"prices":[{"label":"","amountEur":0}],"funnel":[{"step":"","detail":""}]}',
  '```',
  'Contraintes : exactement 3 idées, exactement 5 noms, 1 à 6 prix (en euros), un tunnel de vente de 2 à 8 étapes. JSON valide uniquement dans le bloc.'
].join('\n')

export function packPrompt(offer: OfferRow): string {
  return [
    `Offre : ${offer.name}`,
    `Type : ${offer.kind}`,
    offer.channelName ? `Chaîne : ${offer.channelName}` : '',
    offer.priceCents > 0 ? `Prix envisagé : ${(offer.priceCents / 100).toFixed(2)} €` : '',
    'Propose le pack d’offre.'
  ]
    .filter(Boolean)
    .join('\n')
}

export const SPONSOR_SYSTEM = [
  'Tu es le Rédacteur sponsor d’une chaîne YouTube francophone.',
  'Tu écris un BROUILLON de message à une marque, en français, courtois et concret (objet, corps, signature « — »).',
  'Atelier n’envoie rien : l’utilisateur relit et envoie lui-même. Tu n’inventes aucun chiffre qui ne figure pas dans la fiche.'
].join('\n')

export function sponsorPrompt(deal: SponsorDealRow): string {
  const stageHint: Record<SponsorDealRow['stage'], string> = {
    prospect: 'premier contact (présentation de la chaîne et proposition)',
    contacted: 'relance courtoise',
    negotiation: 'réponse de négociation sur les conditions',
    signed: 'confirmation de l’accord et des prochaines étapes',
    to_deliver: 'point d’avancement de la livraison',
    delivered: 'envoi du lien de la vidéo livrée',
    paid: 'remerciement après paiement'
  }
  return [
    `Marque : ${deal.brand}`,
    deal.contact && `Contact : ${deal.contact}`,
    deal.channelName && `Chaîne : ${deal.channelName}`,
    deal.amountCents > 0 && `Montant : ${(deal.amountCents / 100).toFixed(2)} ${deal.currency}`,
    deal.terms && `Conditions : ${deal.terms}`,
    deal.requiredPhrases && `Phrases imposées : ${deal.requiredPhrases}`,
    deal.placement && `Placement : ${deal.placement}`,
    deal.dueDate && `Échéance : ${deal.dueDate}`,
    `Étape : ${stageHint[deal.stage]}`,
    'Rédige le message.'
  ]
    .filter(Boolean)
    .join('\n')
}
