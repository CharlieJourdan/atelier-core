// Extra demo history for the Messages screen (group chats, hand-offs, status lines) and the canned answers of the
// agents. System lines have authorId 'system' (text is the whole line). Ids start with 'x' so they never collide with
// the messages of data-team.ts. Pure data.
import type { AgentRole, ProtoMessage } from './types'

export const SYSTEM_ID = 'system'

export const EXTRA_MESSAGES: ProtoMessage[] = [
  // Les Grandes Énigmes
  { id: 'x-g1', threadId: 'th-group-ch-enigmes', authorId: 'ag-enigmes-lead', text: 'Bonjour l’équipe. Priorités du jour : le rendu des Templiers, le script de Dyatlov à finaliser et la miniature d’Atlantide avant 17 h.', minutesAgo: 640 },
  { id: 'x-g2', threadId: 'th-group-ch-enigmes', authorId: SYSTEM_ID, text: 'Hugo a confié le script de « Col Dyatlov » à Camille', minutesAgo: 636 },
  { id: 'x-g3', threadId: 'th-group-ch-enigmes', authorId: 'ag-enigmes-script', text: 'Je démarre. @Léa tu as les sources sur le col Dyatlov ?', minutesAgo: 560 },
  { id: 'x-g4', threadId: 'th-group-ch-enigmes', authorId: 'ag-enigmes-research', text: 'Oui, 14 sources dans le cerveau, dont le rapport d’enquête de 1959. Je te les épingle.', minutesAgo: 556 },
  { id: 'x-g5', threadId: 'th-group-ch-enigmes', authorId: SYSTEM_ID, text: 'Jade a confié le montage de « Le trésor des Templiers » à Axel', minutesAgo: 330 },
  { id: 'x-g6', threadId: 'th-group-ch-enigmes', authorId: 'ag-enigmes-pack', text: 'Trois miniatures pour Atlantide : A visage et eau, B carte du Critias, C texte seul. Ma préférée est B, elle reste lisible en petit.', minutesAgo: 140, card: { type: 'approval', title: 'Miniature à choisir', detail: 'Atlantide · 3 propositions · publication ce soir 18 h', videoId: 'v-atlantide' } },
  { id: 'x-g7', threadId: 'th-group-ch-enigmes', authorId: SYSTEM_ID, text: '« Le trésor des Templiers » est passé en montage final', minutesAgo: 30 },
  { id: 'x-g8', threadId: 'th-group-ch-enigmes', authorId: 'ag-enigmes-lead', text: '@Clara Charlie n’a pas encore choisi pour Atlantide. Je demande à l’agent principal de le relancer à 15 h.', minutesAgo: 14 },

  // Histoires Vraies
  { id: 'x-h1', threadId: 'th-group-ch-histoires', authorId: 'ag-histoires-research', text: '40 histoires triées, 12 passent le filtre « vérifiable ». @Lou je t’envoie les 3 meilleures.', minutesAgo: 310 },
  { id: 'x-h2', threadId: 'th-group-ch-histoires', authorId: 'ag-histoires-script', text: 'Reçu. Je prends celle du voisin et du wifi, elle a un bon retournement à 40 secondes.', minutesAgo: 304 },
  { id: 'x-h3', threadId: 'th-group-ch-histoires', authorId: SYSTEM_ID, text: 'Noé a confié « Le voisin qui volait notre wifi depuis 3 ans » à Lou', minutesAgo: 300 },
  { id: 'x-h4', threadId: 'th-group-ch-histoires', authorId: 'ag-histoires-edit', text: 'Le short de midi est monté : 58 secondes, sous-titres posés.', minutesAgo: 125, card: { type: 'video', title: 'Mon coloc a vendu mon chat pendant mes vacances', detail: 'Montage · 64 %', videoId: 's-coloc' } },
  { id: 'x-h5', threadId: 'th-group-ch-histoires', authorId: 'ag-histoires-pack', text: 'J’ai changé la couleur des sous-titres : plus lisible sur le fond de gameplay. Le CTR du dernier lot est à +0,6 point.', minutesAgo: 75 },
  { id: 'x-h6', threadId: 'th-group-ch-histoires', authorId: SYSTEM_ID, text: '« Mon frère a caché le testament de papy » attend des clips de gameplay', minutesAgo: 59 },

  // Top Savoirs
  { id: 'x-t1', threadId: 'th-group-ch-top', authorId: 'ag-top-lead', text: 'On passe la publication au jeudi 16 h, comme décidé avec l’agent principal.', minutesAgo: 520 },
  { id: 'x-t2', threadId: 'th-group-ch-top', authorId: 'ag-top-pack', text: 'Je teste 3 miniatures pour « 10 villes qui vont disparaître » : une carte, une photo satellite, un chiffre en gros.', minutesAgo: 480 },
  { id: 'x-t3', threadId: 'th-group-ch-top', authorId: 'ag-top-compet', text: 'Un concurrent a sorti « 10 animaux les plus dangereux » : 1,2 M de vues en 3 jours. @Malo notre vidéo sur les plus rapides vise le même public.', minutesAgo: 300 },
  { id: 'x-t4', threadId: 'th-group-ch-top', authorId: 'ag-top-lead', text: 'Intéressant. Charlie écrit ce script lui-même, je lui laisse la note dans l’Accueil.', minutesAgo: 292, card: { type: 'task', title: 'Script à importer', detail: 'Top Savoirs · « Les 10 animaux les plus rapides du monde »', videoId: 'v-animaux' } },
  { id: 'x-t5', threadId: 'th-group-ch-top', authorId: 'ag-top-director', text: 'Illustrations de « 10 villes » à 52 %. Il manque la 7e, Venise : je la génère.', minutesAgo: 100 },
  { id: 'x-t6', threadId: 'th-group-ch-top', authorId: 'ag-top-edit', text: 'Prêt à monter dès que les illustrations sont finies.', minutesAgo: 45 },

  // Mystery Files
  { id: 'x-m1', threadId: 'th-group-ch-mystery', authorId: 'ag-mystery-lead', text: 'Roswell est à l’étape voix. @Iris tu valides la traduction des noms propres ?', minutesAgo: 430 },
  { id: 'x-m2', threadId: 'th-group-ch-mystery', authorId: 'ag-mystery-script', text: 'Oui. J’ai gardé « Roswell Army Air Field » tel quel et adapté le reste. Deux tournures à faire relire par un anglophone, je les signale à Charlie.', minutesAgo: 420 },
  { id: 'x-m3', threadId: 'th-group-ch-mystery', authorId: SYSTEM_ID, text: 'June a confié la voix anglaise de « Roswell 1947 » à la voix de la chaîne', minutesAgo: 410 },
  { id: 'x-m4', threadId: 'th-group-ch-mystery', authorId: 'ag-mystery-edit', text: '« Atlantis » est programmé demain à 15 h, rendu final vérifié.', minutesAgo: 240, card: { type: 'video', title: 'Atlantis: What Plato Really Wrote', detail: 'Programmé · demain 15 h', videoId: 'v-en-atlantis' } },
  { id: 'x-m5', threadId: 'th-group-ch-mystery', authorId: 'ag-mystery-compet', text: 'Mystery Files : +64 % de vues sur 7 jours, surtout depuis les suggestions des chaînes de documentaires anglophones.', minutesAgo: 120 },

  // Principal
  { id: 'x-p1', threadId: 'th-principal', authorId: SYSTEM_ID, text: 'Axel est à 82 % de charge : les shorts de demain passent à Yanis', minutesAgo: 8 }
]

/* ---------- canned answers (demo) ---------- */

export const REPLIES: Partial<Record<AgentRole, string[]>> = {
  'channel-manager': [
    'C’est noté. Je répartis ça dans l’équipe et je te confirme le planning avant ce soir.',
    'Bien reçu. Je le mets dans la semaine et je préviens les autres dans le groupe.',
    'Ça change le planning, mais c’est faisable. Je te propose un nouvel ordre dans l’heure.'
  ],
  researcher: [
    'Je regarde ça tout de suite. Je te sors trois pistes avec les chiffres des concurrents dans vingt minutes.',
    'Compris. Je croise avec ce que j’ai déjà en mémoire sur la chaîne et je reviens avec une liste classée.'
  ],
  scriptwriter: [
    'Noté, je reprends le script avec ça. Nouvelle version dans la demi-heure, je te signale ce qui a bougé.',
    'D’accord. Je garde le fond et je réécris le rythme. Tu auras les deux versions côte à côte.'
  ],
  director: [
    'Reçu. Je refais le découpage des plans concernés et je te montre les remplacements.',
    'Compris, je change le type d’image sur ces passages et je relance la récupération des plans.'
  ],
  'production-supervisor': [
    'J’ai transmis aux bonnes personnes. Je surveille l’échéance et je te préviens si ça glisse.',
    'Pris en compte. Je regarde l’impact sur le rendu et je te dis ce que ça change.'
  ],
  editor: [
    'Reçu. Je l’applique au montage et je relance le rendu : compte une dizaine de minutes sur le PC de l’équipe.',
    'Compris, je corrige et je te renvoie une version propre, sous-titres relus.'
  ],
  packaging: [
    'Compris, je prépare trois variantes et je te les montre ici avec mon choix.',
    'D’accord. Je change l’angle et je teste contre les miniatures des concurrents.'
  ],
  'competitor-analyst': [
    'Je m’en occupe. Je regarde ce que font les autres chaînes là-dessus et je te rends un résumé.',
    'Noté. Je surveille ce point cette semaine et je t’alerte au premier signal.'
  ],
  'qc-eye': ['Je repasse dessus avec ça en tête et je te dis s’il reste un problème.'],
  'pipeline-architect': ['Je teste ça sur une vidéo pilote et je te donne le coût réel avant d’aller plus loin.'],
  'sponsor-manager': ['Je regarde les marques qui correspondent et je te prépare une proposition. Rien n’est envoyé sans toi.'],
  custom: ['C’est noté, je m’en occupe et je te fais un retour ici.']
}

export type FeedbackKind = 'pace' | 'thumb' | 'archives'

export function feedbackKind(text: string): FeedbackKind | null {
  const q = text.toLowerCase()
  if (/(rythme|lent|nerveu|coupe|mont)/.test(q)) return 'pace'
  if (/(miniature|titre|thumbnail)/.test(q)) return 'thumb'
  if (/(archive|images?|plans?)/.test(q)) return 'archives'
  return null
}

/** The agent who handles a kind of feedback, what they say, and the hand-off line posted just before. */
export const FEEDBACK_REPLY: Record<FeedbackKind, { role: AgentRole; handoff: string; text: string }> = {
  pace: {
    role: 'editor',
    handoff: 'a confié le nouveau rythme au monteur',
    text: 'Compris : je resserre les plans d’environ 20 % et je coupe les silences de plus d’une seconde. Nouvelle version dans une dizaine de minutes.'
  },
  thumb: {
    role: 'packaging',
    handoff: 'a confié une nouvelle miniature à Packaging',
    text: 'Je repars de zéro avec un autre angle : trois nouvelles miniatures dans un quart d’heure, avec celle que je préfère en premier.'
  },
  archives: {
    role: 'researcher',
    handoff: 'a confié la recherche d’archives à la Recherche',
    text: 'Je cherche plus d’archives d’époque (Gallica, Wikimedia, archives nationales) et je remplace les images générées quand j’en trouve de nettes.'
  }
}

/** What a colleague adds, by role, when another agent has just been asked something (group chats). */
export const FOLLOW_UPS_BY_ROLE: Partial<Record<AgentRole, string[]>> = {
  researcher: ['Je te sors les références et les chiffres des concurrents pour appuyer ça.'],
  'competitor-analyst': ['Je regarde ce que les autres chaînes font là-dessus et je te donne un comparatif.'],
  scriptwriter: ['Si ça change le fond, je reprends le script en parallèle.'],
  director: ['Je prépare les plans qu’il faudra remplacer pour que ça ne bloque personne.'],
  'production-supervisor': ['Je surveille l’échéance et je décale le rendu si besoin.'],
  editor: ['Dis-moi quand c’est prêt, je libère un créneau de montage et de rendu.'],
  packaging: ['Je prépare des variantes de miniature en attendant, au cas où.'],
  'qc-eye': ['Je repasserai derrière avant la validation.'],
  'channel-manager': ['Je mets ça au planning de la semaine.']
}

/** Second voices in a group chat: a colleague who answers the first one (the agents talk to each other). */
export const FOLLOW_UPS: string[] = [
  'Je m’en occupe de mon côté, je donne l’avancement dans le groupe dans l’heure.',
  'Bien vu. Je prépare ce qu’il faut pour que ça ne bloque personne.',
  'Pour moi c’est bon, je peux le prendre dès que j’ai fini ce que j’ai en cours.'
]
