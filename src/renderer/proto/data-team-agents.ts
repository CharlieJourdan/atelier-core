// Demo detail of every agent of the team screens: instructions, routines, memory, journal, permissions, hourly load and
// the engine numbers (queue, watchdog). Generated per role so the 26 agents of the demo feel individual without a wall of
// fixtures. Pure data and pure functions, no React. French text here is demo content (like data-team.ts).
import type { AgentRole, ModelTier, ProtoAgent } from './types'

/* ---------- model tiers and effort ---------- */

export type Effort = 'fast' | 'balanced' | 'max'
export const EFFORTS: readonly Effort[] = ['fast', 'balanced', 'max']
export const EFFORT_MODEL: Record<Effort, ModelTier> = { fast: 'haiku', balanced: 'sonnet', max: 'opus' }
export const MODEL_LABEL: Record<ModelTier, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', codex: 'Codex' }

export function effortOf(model: ModelTier): Effort {
  return model === 'opus' ? 'max' : model === 'haiku' ? 'fast' : 'balanced'
}

/* ---------- details per agent ---------- */

export interface Routine {
  id: string
  label: string
  schedule: string
  on: boolean
}
export interface MemoryItem {
  id: string
  text: string
  /** 1 = detail, 2 = useful, 3 = essential. */
  importance: 1 | 2 | 3
}
export interface JournalEntry {
  id: string
  minutesAgo: number
  text: string
}
export interface Permissions {
  browser: boolean
  computer: boolean
  publish: boolean
}
export interface AgentDetail {
  instructions: string
  routines: Routine[]
  memory: MemoryItem[]
  journal: JournalEntry[]
  permissions: Permissions
  budgetPerDay: number
}

interface Kit {
  instructions: string
  routines: [string, string, boolean][]
  memory: [string, 1 | 2 | 3][]
  journal: [number, string][]
  permissions: Permissions
  budget: number
}

const KITS: Partial<Record<AgentRole, Kit>> = {
  principal: {
    instructions:
      'Tu es l’agent principal de Charlie. Tu lances les tâches aux responsables de chaîne, tu relis leurs comptes rendus, tu l’alertes seulement quand une décision lui revient et tu équilibres la charge de l’équipe. Tu parles simplement, sans jargon, et tu proposes toujours une action.',
    routines: [
      ['Point du matin avec Charlie', 'Chaque jour à 8 h', true],
      ['Rééquilibrer la charge de l’équipe', 'Toutes les 3 h', true],
      ['Bilan de la semaine', 'Le dimanche à 18 h', true]
    ],
    memory: [
      ['Charlie valide les scripts lui-même sur Les Grandes Énigmes, jamais les shorts', 3],
      ['Il n’aime pas les points d’exclamation dans les titres', 3],
      ['Budget crédits : ne jamais dépasser 20 000 par mois sans le prévenir', 3],
      ['Publier Top Savoirs le jeudi à 16 h depuis le test du mois dernier', 2],
      ['Il lit ses notifications surtout entre 8 h et 9 h', 1]
    ],
    journal: [
      [6, 'A retiré les shorts de demain à Axel, trop chargé'],
      [34, 'A averti Charlie : le script de « Col Dyatlov » l’attend'],
      [75, 'A décalé deux publications de Top Savoirs au jeudi'],
      [190, 'A relancé le rendu de « Atlantide » après un échec réseau'],
      [420, 'Point du matin envoyé à Charlie']
    ],
    permissions: { browser: true, computer: true, publish: false },
    budget: 900
  },
  'channel-manager': {
    instructions:
      'Tu es le responsable de la chaîne {c}. Tu tiens le planning de la chaîne, tu distribues les tâches à tes spécialistes, tu arbitres quand deux agents se contredisent et tu fais remonter à l’agent principal ce qui bloque. Tu connais la ligne éditoriale de la chaîne par cœur.',
    routines: [
      ['Planifier la semaine de la chaîne', 'Le lundi à 9 h', true],
      ['Relire les performances de la veille', 'Chaque matin à 7 h 30', true],
      ['Point avec les spécialistes', 'Chaque jour à 17 h', false]
    ],
    memory: [
      ['Ligne éditoriale de {c} : ton posé, jamais sensationnaliste', 3],
      ['Cadence visée : {cadence}', 3],
      ['Le public décroche après la 9e minute quand il n’y a pas de relance', 2],
      ['Les publications du soir à 18 h performent mieux que celles de midi', 2],
      ['Charlie veut être prévenu avant tout changement de miniature', 1]
    ],
    journal: [
      [18, 'A relancé {n2} sur un livrable en retard'],
      [55, 'A validé le calendrier de la semaine prochaine'],
      [140, 'A signalé à l’agent principal une baisse de clics'],
      [300, 'A déplacé une publication pour éviter un doublon de sujet'],
      [610, 'Point du matin terminé']
    ],
    permissions: { browser: true, computer: false, publish: false },
    budget: 320
  },
  researcher: {
    instructions:
      'Tu cherches des sujets pour {c}. Chaque jour, tu proposes des idées appuyées par des chiffres (vues des concurrents, tendance de recherche) et tu écartes ce qui a déjà été traité. Tu classes tes propositions de la plus sûre à la plus risquée, avec une phrase de justification.',
    routines: [
      ['Veille concurrents', 'Chaque matin à 7 h', true],
      ['Trier les sujets proposés', 'Chaque jour à 14 h', true],
      ['Rapport des tendances', 'Le vendredi à 16 h', false]
    ],
    memory: [
      ['Les formats « 3 en 20 min » montent chez les concurrents depuis 3 semaines', 3],
      ['Sujets déjà traités sur {c} : 41 (liste dans le cerveau)', 2],
      ['Éviter les sujets politiques : Charlie les refuse', 3],
      ['Sources fiables : archives nationales, Persée, presse d’époque', 2],
      ['Un titre sous 60 caractères convertit mieux sur cette chaîne', 1]
    ],
    journal: [
      [20, 'A trié 40 candidats et en garde 5'],
      [96, 'A repéré un format qui monte chez un concurrent'],
      [230, 'A écarté 6 sujets déjà traités'],
      [480, 'A envoyé le rapport de veille à {n2}'],
      [700, 'A relu les titres qui ont le mieux performé']
    ],
    permissions: { browser: true, computer: false, publish: false },
    budget: 140
  },
  scriptwriter: {
    instructions:
      'Tu écris les scripts de {c}. Tu pars du sujet validé, tu structures en actes courts, tu soignes les 30 premières secondes et tu cites tes sources dans les notes. Tu écris pour la voix : phrases courtes, pas de mots que l’on ne dit pas à l’oral.',
    routines: [
      ['Relecture orthographique et rythme', 'Après chaque script', true],
      ['Vérifier les sources citées', 'Après chaque script', true]
    ],
    memory: [
      ['Ouverture « la tente découpée de l’intérieur » a bien marché sur Roswell', 3],
      ['Durée cible : 11 à 13 minutes à la voix', 3],
      ['Charlie coupe toujours les conclusions trop longues', 2],
      ['Préférer « on ignore » à « il est certain que »', 2],
      ['Format de relance toutes les 90 secondes', 1]
    ],
    journal: [
      [34, 'Script de « Col Dyatlov » envoyé à Charlie (1 640 mots)'],
      [150, 'A réécrit l’ouverture après le retour de {n2}'],
      [380, 'A vérifié 14 sources du dernier script'],
      [720, 'A terminé le plan en trois actes']
    ],
    permissions: { browser: true, computer: false, publish: false },
    budget: 260
  },
  director: {
    instructions:
      'Tu découpes le script en plans : pour chaque phrase, tu choisis le type d’image (archive, image générée, animation, carte) et tu écris la consigne de prise de vue. Tu limites les images générées aux passages sans archive disponible.',
    routines: [['Découper les scripts validés en plans', 'Dès qu’un script est validé', true]],
    memory: [
      ['Mélange visé : 40 % archives, 35 % images générées, 25 % cartes et textes', 3],
      ['Les archives floues sont remplacées par une image générée de même cadrage', 2],
      ['Pas de plan fixe de plus de 6 secondes', 2],
      ['Style visuel : sépia désaturé, grain léger', 1]
    ],
    journal: [
      [28, 'A découpé 64 plans pour « Voynich »'],
      [200, 'A remplacé 3 archives illisibles'],
      [410, 'A proposé 2 variantes de carte pour l’ouverture']
    ],
    permissions: { browser: true, computer: true, publish: false },
    budget: 180
  },
  'production-supervisor': {
    instructions:
      'Tu supervises la fabrication des vidéos de {c} : script, réalisateur, monteur, contrôle qualité. Tu vérifies que chaque étape rend à l’heure, tu relances un agent qui bloque et tu ne laisses passer que ce qui est prêt.',
    routines: [
      ['Faire le tour des vidéos en cours', 'Toutes les 2 h', true],
      ['Vérifier les échéances de la semaine', 'Le lundi à 9 h', true]
    ],
    memory: [
      ['Une vidéo en retard de plus de 12 h remonte au responsable de chaîne', 3],
      ['Le contrôle qualité passe toujours avant la planification', 3],
      ['Le PC de l’équipe est plus rapide le matin, avant 11 h', 1]
    ],
    journal: [
      [45, 'A relancé le montage de « Templiers » après un plan flou'],
      [160, 'A vérifié 3 vidéos avant le passage au contrôle qualité'],
      [520, 'A prévenu {n2} d’un risque de retard']
    ],
    permissions: { browser: false, computer: true, publish: false },
    budget: 150
  },
  editor: {
    instructions:
      'Tu montes les vidéos de {c} : tu assembles voix, images, musique et sous-titres, tu règles le rythme et tu lances le rendu. Tu corriges ce que le contrôle qualité signale et tu n’envoies à la validation qu’une version propre.',
    routines: [
      ['Lancer les rendus de la nuit', 'Chaque jour à 23 h', true],
      ['Nettoyer les fichiers temporaires', 'Le dimanche à 3 h', true]
    ],
    memory: [
      ['Sous-titres : 2 lignes maximum, 38 caractères par ligne', 3],
      ['Musique : −18 dB sous la voix, jamais de morceau déjà utilisé cette semaine', 2],
      ['Charlie trouve les transitions « flash » trop agressives', 3],
      ['Le rendu 1080p sur le PC de l’équipe prend 8 à 14 minutes', 1],
      ['Export final en H.264, 14 Mb/s', 1]
    ],
    journal: [
      [8, 'Rendu des Templiers à 72 %'],
      [40, 'A remplacé le plan 41 (archive floue)'],
      [60, 'A corrigé « 1037 » en « 1307 » à 4:12'],
      [260, 'A terminé 2 shorts et les a envoyés au contrôle qualité'],
      [610, 'A lancé le rendu de nuit']
    ],
    permissions: { browser: false, computer: true, publish: false },
    budget: 240
  },
  packaging: {
    instructions:
      'Tu fabriques les miniatures et les titres de {c}. Pour chaque vidéo, tu proposes trois miniatures lisibles en petit format et deux titres, tu expliques ton choix en une phrase et tu testes les variantes quand la chaîne le permet.',
    routines: [
      ['Tester 3 miniatures par vidéo', 'À chaque publication', true],
      ['Comparer aux miniatures des concurrents', 'Le mercredi à 10 h', false]
    ],
    memory: [
      ['Visage ou objet à gauche, texte de 3 mots maximum à droite', 3],
      ['Contraste fort : les miniatures claires perdent des clics sur cette chaîne', 2],
      ['Titres sans point d’exclamation, jamais en majuscules', 3],
      ['Le CTR moyen de la chaîne est de 4,1 %', 1]
    ],
    journal: [
      [51, '3 miniatures prêtes pour « Atlantide », en attente de Charlie'],
      [210, 'A testé 3 variantes sur la dernière vidéo : B gagne de 0,9 point'],
      [500, 'A relu les titres de la semaine']
    ],
    permissions: { browser: true, computer: true, publish: false },
    budget: 160
  },
  'competitor-analyst': {
    instructions:
      'Tu surveilles les chaînes concurrentes de {c} : nouvelles vidéos, formats qui montent, changements de miniatures. Tu signales seulement ce qui change quelque chose pour nous, avec le chiffre et le lien.',
    routines: [
      ['Relever les nouvelles vidéos des concurrents', 'Toutes les 4 h', true],
      ['Résumé de la veille', 'Chaque matin à 7 h', true]
    ],
    memory: [
      ['14 chaînes suivies, liste modifiable dans le cerveau', 2],
      ['Seuil d’alerte : une vidéo à 3× la moyenne de sa chaîne', 3],
      ['Ne jamais copier un titre à l’identique', 3]
    ],
    journal: [
      [95, 'A signalé le format « 3 énigmes en 20 min » (410 k vues en 18 h)'],
      [260, 'A relevé 9 nouvelles vidéos concurrentes'],
      [590, 'A envoyé le résumé de veille']
    ],
    permissions: { browser: true, computer: false, publish: false },
    budget: 110
  },
  'qc-eye': {
    instructions:
      'Tu relis chaque vidéo avant la validation : dates, noms, chiffres, sous-titres, niveau sonore, plans flous. Tu listes ce qui cloche avec l’horodatage et tu ne bloques que ce qui est vraiment faux.',
    routines: [['Relecture complète avant validation', 'À chaque version finale', true]],
    memory: [
      ['Vérifier chaque date et chaque nom propre cité dans le script', 3],
      ['Niveau sonore cible : −14 LUFS', 2]
    ],
    journal: [
      [22, 'Version 2 des Templiers relue : une erreur de date signalée'],
      [300, 'A relu 3 shorts, rien à signaler']
    ],
    permissions: { browser: false, computer: true, publish: false },
    budget: 60
  },
  'pipeline-architect': {
    instructions:
      'Tu construis et testes des pipelines de production à partir de chaînes de référence. Tu mesures à quel point on peut reproduire leur style, tu estimes le coût d’une vidéo et tu proposes la version la plus économique qui tient la qualité.',
    routines: [['Tester un nouveau pipeline sur une vidéo pilote', 'À la demande', true]],
    memory: [
      ['Un pipeline à plus de 80 % de réplicabilité peut partir en production', 3],
      ['Garder au moins 60 % du travail sur les abonnements Claude Code et Codex', 2]
    ],
    journal: [
      [30, 'Réplication de @textify.stories testée : 46 %'],
      [360, 'A estimé le coût d’un format avatar : 620 crédits']
    ],
    permissions: { browser: true, computer: true, publish: false },
    budget: 280
  },
  'sponsor-manager': {
    instructions:
      'Tu gères les partenariats : tu repères les marques qui correspondent à chaque chaîne, tu prépares les propositions et tu suis les contreparties. Tu ne t’engages jamais sans l’accord de Charlie.',
    routines: [['Chercher des marques à contacter', 'Le jeudi à 11 h', false]],
    memory: [
      ['Partenariat NordVPN en cours sur Top Savoirs', 3],
      ['Pas de partenariat sur les contenus sensibles', 3]
    ],
    journal: [[1_400, 'A préparé une proposition pour une marque de jeux de société']],
    permissions: { browser: true, computer: false, publish: false },
    budget: 40
  },
  custom: {
    instructions:
      'Tu es un agent sur mesure de l’équipe. Tu fais ce que Charlie te demande pour {c}, tu rends compte brièvement et tu demandes avant toute action qui coûte des crédits.',
    routines: [['Compte rendu hebdomadaire', 'Le vendredi à 17 h', true]],
    memory: [['Nouvel agent : encore peu de souvenirs, il apprend en travaillant avec l’équipe', 1]],
    journal: [[1, 'Vient de rejoindre l’équipe']],
    permissions: { browser: true, computer: false, publish: false },
    budget: 100
  }
}

/** Short stable hash of a string (0 to 2^31). */
export function hash(s: string): number {
  let h = 7
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 2_147_483_647
  return h
}

export interface DetailContext {
  channelName: string
  cadence: string
  /** A colleague's first name, used in journal lines. */
  colleague: string
}

function fill(text: string, ctx: DetailContext, agent: Pick<ProtoAgent, 'name'>): string {
  return text
    .replaceAll('{c}', ctx.channelName)
    .replaceAll('{cadence}', ctx.cadence)
    .replaceAll('{n2}', ctx.colleague)
    .replaceAll('{n}', agent.name)
}

/** The starting detail of an agent (before the user edits anything). Deterministic. */
export function detailFor(agent: Pick<ProtoAgent, 'id' | 'name' | 'role' | 'task'>, ctx: DetailContext): AgentDetail {
  const kit = KITS[agent.role] ?? (KITS.custom as Kit)
  const memory: MemoryItem[] = kit.memory.map(([text, importance], i) => ({ id: `${agent.id}-mem-${i}`, text: fill(text, ctx, agent), importance }))
  const journal: JournalEntry[] = kit.journal.map(([minutesAgo, text], i) => ({ id: `${agent.id}-log-${i}`, minutesAgo, text: fill(text, ctx, agent) }))
  if (agent.task && !agent.task.startsWith('Attend')) journal.unshift({ id: `${agent.id}-log-now`, minutesAgo: 2, text: agent.task })
  return {
    instructions: fill(kit.instructions, ctx, agent),
    routines: kit.routines.map(([label, schedule, on], i) => ({ id: `${agent.id}-rt-${i}`, label, schedule, on })),
    memory,
    journal,
    permissions: { ...kit.permissions },
    budgetPerDay: kit.budget
  }
}

/* ---------- why a tier (shown under the effort control) ---------- */

export const EFFORT_WHY: Record<Effort, string> = {
  fast: 'Réponses très rapides pour des tâches simples et répétitives : tri, relevés, veille. Coûte peu.',
  balanced: 'Le bon rapport qualité et vitesse pour le suivi, la coordination, le montage et les miniatures.',
  max: 'Le raisonnement le plus poussé, pour ce qui se voit à l’écran : scripts, arbitrages, décisions de l’équipe.'
}

/* ---------- load ---------- */

/**
 * Loads shown in the demo for a few agents, so the balance message of the main agent matches what the screens show.
 * (Agents not listed keep the load of the shared demo data.)
 */
export const LOAD_CALIBRATION: Record<string, number> = {
  'ag-enigmes-edit': 82,
  'ag-histoires-edit': 71,
  'ag-enigmes-script': 64,
  'ag-histoires-script': 58,
  'ag-enigmes-pack': 12,
  'ag-top-pack': 9,
  'ag-mystery-edit': 33,
  'ag-histoires-pack': 14
}

export type Rest = 'rested' | 'balanced' | 'busy' | 'overloaded'
export function restOf(load: number): Rest {
  return load < 30 ? 'rested' : load < 70 ? 'balanced' : load < 85 ? 'busy' : 'overloaded'
}

/** Peak hour (0 to 23) of the day for a role, where its work concentrates. */
const PEAK: Partial<Record<AgentRole, number>> = {
  researcher: 8,
  'competitor-analyst': 7,
  scriptwriter: 11,
  director: 13,
  'production-supervisor': 14,
  editor: 22,
  packaging: 16,
  'channel-manager': 9,
  principal: 9,
  'pipeline-architect': 15
}

/** 24 values (0 to 100), oldest first, the last one being the current hour. Deterministic. */
export function hourlyLoad(agent: Pick<ProtoAgent, 'id' | 'role' | 'load' | 'status'>, load = agent.load, nowHour = 15): number[] {
  const peak = PEAK[agent.role] ?? 12
  const seed = hash(agent.id)
  const out: number[] = []
  for (let i = 0; i < 24; i += 1) {
    const hour = (nowHour - 23 + i + 48) % 24
    const d = Math.min(Math.abs(hour - peak), 24 - Math.abs(hour - peak))
    const bump = Math.exp(-(d * d) / 18)
    const jitter = (((seed >> (i % 13)) + i * 7) % 17) / 17
    const night = hour >= 0 && hour < 6 ? 0.45 : 1
    const v = load * (0.25 + 1.15 * bump) * night * (0.8 + 0.4 * jitter)
    out.push(Math.max(0, Math.min(100, Math.round(v))))
  }
  if (agent.status === 'sleeping') return out.map((v) => Math.round(v * 0.3))
  return out
}

/* ---------- engine (queue and watchdog) ---------- */

export const ACCOUNT_RESET: Record<string, string> = { 'acc-2': '18 h' }

export const WATCHDOG = {
  restarts24h: 2,
  lost24h: 0,
  lastRestart: 'Il y a 3 h : rendu de « Atlantide », relancé après une coupure réseau'
}

/* ---------- recruiting templates ---------- */

export interface RecruitTemplate {
  id: string
  /** i18n key suffix (team.recruit.tpl.<id>.name / .blurb). */
  role: AgentRole
  model: ModelTier
  instructions: string
  budget: number
}

export const RECRUIT_TEMPLATES: readonly RecruitTemplate[] = [
  {
    id: 'community',
    role: 'custom',
    model: 'sonnet',
    budget: 90,
    instructions:
      'Tu réponds aux commentaires de la chaîne : tu remercies, tu réponds aux questions simples, tu masques le spam et tu me signales les critiques sérieuses. Ton chaleureux, jamais défensif. Tu ne promets rien de la part de Charlie.'
  },
  {
    id: 'clipper',
    role: 'editor',
    model: 'codex',
    budget: 160,
    instructions:
      'Tu découpes les vidéos longues en shorts de moins d’une minute : tu repères les moments forts, tu recadres en vertical, tu ajoutes les sous-titres et une accroche dans les trois premières secondes. Tu envoies chaque short au contrôle qualité.'
  },
  {
    id: 'translator',
    role: 'custom',
    model: 'sonnet',
    budget: 120,
    instructions:
      'Tu adaptes les scripts et les titres vers une autre langue : tu gardes le ton de la chaîne, tu adaptes les références culturelles et tu demandes une relecture quand une expression n’a pas d’équivalent.'
  },
  {
    id: 'seo',
    role: 'researcher',
    model: 'haiku',
    budget: 70,
    instructions:
      'Tu optimises les titres, descriptions et tags : tu cherches les requêtes que les gens tapent vraiment, tu proposes deux titres par vidéo et tu vérifies que la miniature et le titre se complètent.'
  },
  {
    id: 'partner',
    role: 'sponsor-manager',
    model: 'sonnet',
    budget: 60,
    instructions:
      'Tu cherches des marques et des partenariats adaptés à la chaîne, tu prépares les propositions et tu suis les réponses. Tu ne t’engages sur rien sans l’accord de Charlie.'
  },
  {
    id: 'custom',
    role: 'custom',
    model: 'sonnet',
    budget: 100,
    instructions: 'Décris ce que cet agent doit faire, à qui il rend compte et ce qu’il ne doit jamais faire.'
  }
]
