// System prompts of the Analyste and the Builder (both run on the user's Claude Code through ctx.ask), and the
// extraction of their fenced blocks: ```atelier-adjust``` (Analyste) and ```atelier-pipeline``` (Builder).
import { AdjustSchema, type Adjust, type AnalysisDetail } from '../../shared/analysis'
import { COMPONENT_IDS } from '../../shared/gauge'
import { catalogText } from './catalog'

export const ADJUST_TAG = 'atelier-adjust'
export const PIPELINE_TAG = 'atelier-pipeline'

/** Finds the first ```<tag> … ``` block; returns the text without it (trimmed) and the block's body. */
export function extractBlock(text: string, tag: string): { shown: string; block: string | null; count: number } {
  const re = new RegExp('```' + tag + '[ \\t]*\\r?\\n([\\s\\S]*?)```', 'g')
  const bodies: string[] = []
  const shown = text.replace(re, (_m, body: string) => {
    bodies.push(body)
    return ''
  })
  return { shown: shown.replace(/\n{3,}/g, '\n\n').trim(), block: bodies[0] ?? null, count: bodies.length }
}

/** Parses an adjustment strictly: one block, valid JSON, only the allowed keys and values. */
export function parseAdjust(body: string): Adjust | null {
  try {
    const res = AdjustSchema.safeParse(JSON.parse(body))
    return res.success ? res.data : null
  } catch {
    return null
  }
}

export function analystSystem(a: AnalysisDetail): string {
  const p = a.profile
  const g = a.gauge
  const lines = [
    'Tu es l’Analyste d’Atelier. Tu as analysé le format d’une chaîne YouTube et tu aides l’utilisateur à l’adapter.',
    'Réponds en français, en 2 à 6 phrases, sans recopier de texte d’une vidéo : on reproduit une manière de faire, jamais un contenu.',
    '',
    `Chaîne analysée : ${a.reference.name} — ${a.reference.format} (${a.reference.niche}).`,
    p ? `Profil : ${p.summary}` : 'Profil : pas encore établi (aucune vidéo d’exemple choisie).',
    p ? `Parts de temps : ${p.components.map((c) => `${c.component} ${Math.round(c.share * 100)} %`).join(', ')}.` : '',
    p ? `Notes : voix ${p.notes.voice}, script ${p.notes.script}, montage ${p.notes.edit}. Coupes par minute : ${p.cutsPerMinute}.` : '',
    g ? `Jauge actuelle : ${g.score}/100 en ${a.mode} (Qualité max ${g.perMode.qualite_max}, Usage max ${g.perMode.usage_max}).` : '',
    `Questions : ${a.questions.length ? a.questions.join(', ') : 'aucune'} ; réponses : ${JSON.stringify(a.answers)} ; remplacements : ${JSON.stringify(a.replace)}.`,
    `Réglages : ${JSON.stringify(a.adjust)}.`,
    '',
    'Quand l’utilisateur demande un changement, ajoute à la fin de ta réponse UN SEUL bloc :',
    '```' + ADJUST_TAG,
    '{"answers":{"camera":false},"replace":{"face_camera":"avatar"},"maxCreditsPerVideo":150,"script":{"length":"court","tone":"drôle"}}',
    '```',
    'Clés permises (toutes facultatives, au moins une) :',
    '- answers : { "camera" | "gameplay" : true | false } (l’utilisateur a ou non ces images) ;',
    `- replace : { composant : composant } avec les composants ${COMPONENT_IDS.filter((c) => c !== 'clip').join(', ')} ;`,
    '- mode : "qualite_max" | "usage_max" ;',
    '- maxCreditsPerVideo : entier ≥ 0 ;',
    '- minutes : durée visée, de 1 à 120 ;',
    '- script : { "length": "court" | "moyen" | "long", "tone": texte court }.',
    'N’ajoute pas de bloc si rien ne change. La jauge est recalculée par l’application, ne l’annonce pas toi-même.'
  ]
  return lines.filter((l, i, all) => !(l === '' && all[i - 1] === '')).join('\n')
}

export function builderSystem(draftJson: string): string {
  return [
    'Tu es le Builder d’Atelier : tu construis des pipelines de production vidéo au format atelier.pipeline/1.',
    'Réponds en français. Explique en quelques phrases ce que tu changes, puis mets le pipeline COMPLET dans un seul bloc :',
    '```' + PIPELINE_TAG,
    '{ … le document JSON entier … }',
    '```',
    'Règles :',
    '- "$schema": "atelier.pipeline/1", format youtube_long en 16:9, des nœuds typés du catalogue ci-dessous, sans cycle ;',
    '- une entrée de nœud se branche sur "<nœud>.<sortie>" ou "$inputs.<id>" ; un réglage peut valoir "$style.<champ>" ;',
    '- les champs de style connus : language, voice, pace, captions, burn ;',
    '- validations : "none", "review" ou "owner" ; le paquet final reste "owner" ;',
    '- n’invente pas de type de nœud : s’il manque, dis-le sans l’ajouter ;',
    '- vise le coût le plus bas pour la qualité demandée (Usage max : images plutôt que vidéos générées).',
    'L’application valide ton bloc ; un pipeline invalide est refusé et le brouillon précédent est gardé.',
    '',
    'Catalogue des nœuds :',
    catalogText(),
    '',
    'Brouillon actuel :',
    '```json',
    draftJson,
    '```'
  ].join('\n')
}
