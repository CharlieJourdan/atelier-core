// Demo pipelines: Atelier's presets and the user's own (built from a channel analysis). Credits and minutes are
// plausible estimates for the pitch (1 credit = 0.01 €), not quotes.
import type { PipelineNode, ProtoPipeline } from './types'

function chain(nodes: PipelineNode[]): [string, string][] {
  // Default wiring: each column feeds the next one; nodes sharing a column run in parallel.
  const cols = [...new Set(nodes.map((n) => n.col))].sort((a, b) => a - b)
  const edges: [string, string][] = []
  for (let i = 0; i < cols.length - 1; i++) {
    const from = nodes.filter((n) => n.col === cols[i])
    const to = nodes.filter((n) => n.col === cols[i + 1])
    for (const a of from) for (const b of to) edges.push([a.id, b.id])
  }
  return edges
}

const DOCU_NODES: PipelineNode[] = [
  { id: 'n-idea', kind: 'idea', label: 'Sujet', runner: 'agent', provider: 'Claude Code · Sonnet', detail: 'Repère les sujets qui marchent chez les concurrents et propose 5 angles.', credits: 0, minutes: 3, col: 0, row: 1, gate: true },
  { id: 'n-script', kind: 'script', label: 'Script', runner: 'agent', provider: 'Claude Code · Opus', detail: 'Recherche sourcée puis script de 1 600 mots dans le style de la chaîne.', credits: 0, minutes: 9, col: 1, row: 1, gate: true },
  { id: 'n-director', kind: 'director', label: 'Réalisation', runner: 'agent', provider: 'Claude Code · Sonnet', detail: 'Découpe le script en plans : archive, image IA, carte animée ou texte.', credits: 0, minutes: 4, col: 2, row: 1 },
  { id: 'n-stock', kind: 'stock', label: 'Archives et B-roll', runner: 'api', provider: 'Pexels · Wikimedia · Storyblocks', detail: 'Cherche les plans d’archive qui collent à chaque phrase.', credits: 40, minutes: 5, col: 3, row: 0, share: 45 },
  { id: 'n-images', kind: 'image-gen', label: 'Images IA', runner: 'api', provider: 'FLUX · Nano Banana', detail: 'Génère les plans introuvables, dans la direction artistique de la chaîne.', credits: 180, minutes: 6, col: 3, row: 1, share: 35 },
  { id: 'n-motion', kind: 'motion', label: 'Cartes animées', runner: 'code', provider: 'Moteur Atelier (HTML → vidéo)', detail: 'Cartes, frises et titres animés, rendus sur l’ordinateur de l’équipe.', credits: 0, minutes: 4, col: 3, row: 2, share: 20 },
  { id: 'n-voice', kind: 'voice', label: 'Voix', runner: 'api', provider: 'MiniMax Speech · voix clonée', detail: 'Narration avec la voix de la chaîne, rythme calé sur le script.', credits: 140, minutes: 2, col: 4, row: 0 },
  { id: 'n-music', kind: 'music', label: 'Musique', runner: 'agent', provider: 'Bibliothèque libre de droits', detail: 'Choisit 3 pistes selon l’ambiance de chaque partie.', credits: 0, minutes: 1, col: 4, row: 2 },
  { id: 'n-edit', kind: 'edit', label: 'Montage', runner: 'code', provider: 'Moteur Atelier · PC de l’équipe', detail: 'Timeline, transitions, sous-titres et mixage, rendu 1080p.', credits: 0, minutes: 14, col: 5, row: 1, gate: true },
  { id: 'n-thumb', kind: 'thumbnail', label: 'Miniature et titre', runner: 'api', provider: 'Claude Code + génération d’image', detail: '3 miniatures et 5 titres testés contre les concurrents.', credits: 60, minutes: 3, col: 6, row: 0, gate: true },
  { id: 'n-qc', kind: 'qc', label: 'Contrôle qualité', runner: 'agent', provider: 'L’Œil · analyse vidéo', detail: 'Regarde le rendu : rythme, plans répétés, fautes, son.', credits: 25, minutes: 3, col: 6, row: 2 },
  { id: 'n-publish', kind: 'publish', label: 'Publication', runner: 'agent', provider: 'Planning Atelier', detail: 'Programme la vidéo ou prépare le paquet à poster à la main.', credits: 0, minutes: 1, col: 7, row: 1 }
]

const REDDIT_NODES: PipelineNode[] = [
  { id: 'r-idea', kind: 'idea', label: 'Histoire', runner: 'agent', provider: 'Claude Code · Haiku', detail: 'Trouve une histoire forte et la réécrit à la première personne.', credits: 0, minutes: 1, col: 0, row: 1 },
  { id: 'r-script', kind: 'script', label: 'Script 60 s', runner: 'agent', provider: 'Claude Code · Sonnet', detail: 'Accroche en 2 secondes, chute à la fin, 150 mots.', credits: 0, minutes: 2, col: 1, row: 1 },
  { id: 'r-voice', kind: 'voice', label: 'Voix', runner: 'api', provider: 'MiniMax Speech', detail: 'Voix rapide et expressive.', credits: 12, minutes: 1, col: 2, row: 0 },
  { id: 'r-gameplay', kind: 'gameplay', label: 'Gameplay', runner: 'human', provider: 'Ton dossier de clips', detail: 'Pioche au hasard dans le dossier de clips que tu as déposé.', credits: 0, minutes: 0, col: 2, row: 1 },
  { id: 'r-card', kind: 'card', label: 'Carte d’intro', runner: 'code', provider: 'Code généré pour la chaîne', detail: 'La carte « post Reddit » des 2 premières secondes, recréée à l’identique.', credits: 0, minutes: 1, col: 2, row: 2 },
  { id: 'r-captions', kind: 'captions', label: 'Sous-titres', runner: 'code', provider: 'Moteur Atelier', detail: 'Mot à mot, gros, centrés.', credits: 2, minutes: 1, col: 3, row: 1 },
  { id: 'r-edit', kind: 'edit', label: 'Montage 9:16', runner: 'code', provider: 'Moteur Atelier · PC de l’équipe', detail: 'Assemble, recadre et rend en 1080×1920.', credits: 0, minutes: 2, col: 4, row: 1 },
  { id: 'r-publish', kind: 'publish', label: 'Publication', runner: 'agent', provider: 'Planning Atelier', detail: '3 créneaux par jour.', credits: 0, minutes: 1, col: 5, row: 1 }
]

const TOP_NODES: PipelineNode[] = [
  { id: 't-idea', kind: 'idea', label: 'Sujet', runner: 'agent', provider: 'Claude Code · Sonnet', detail: 'Classements qui performent dans la niche.', credits: 0, minutes: 2, col: 0, row: 1, gate: true },
  { id: 't-script', kind: 'human-input', label: 'Script', runner: 'human', provider: 'Tu écris le script', detail: 'Importe ton script (Docs, texte ou fichier).', credits: 0, minutes: 0, col: 1, row: 1 },
  { id: 't-director', kind: 'director', label: 'Réalisation', runner: 'agent', provider: 'Claude Code · Sonnet', detail: 'Un plan par entrée du top, compte à rebours animé.', credits: 0, minutes: 3, col: 2, row: 1 },
  { id: 't-images', kind: 'image-gen', label: 'Illustrations', runner: 'api', provider: 'FLUX', detail: 'Style flat illustré de la chaîne.', credits: 150, minutes: 5, col: 3, row: 0, share: 70 },
  { id: 't-motion', kind: 'motion', label: 'Compte à rebours', runner: 'code', provider: 'Moteur Atelier', detail: 'Numéros et transitions de la chaîne.', credits: 0, minutes: 3, col: 3, row: 2, share: 30 },
  { id: 't-voice', kind: 'voice', label: 'Voix', runner: 'api', provider: 'MiniMax Speech', detail: 'Voix enjouée.', credits: 110, minutes: 2, col: 4, row: 1 },
  { id: 't-edit', kind: 'edit', label: 'Montage', runner: 'code', provider: 'Moteur Atelier', detail: 'Rendu 1080p.', credits: 0, minutes: 11, col: 5, row: 1 },
  { id: 't-thumb', kind: 'human-input', label: 'Miniature', runner: 'human', provider: 'Tu fais la miniature', detail: 'Dépose ta miniature, l’agent propose seulement des titres.', credits: 0, minutes: 0, col: 6, row: 1 }
]

const AVATAR_NODES: PipelineNode[] = [
  { id: 'a-idea', kind: 'idea', label: 'Sujet', runner: 'agent', provider: 'Claude Code · Sonnet', detail: '', credits: 0, minutes: 2, col: 0, row: 1 },
  { id: 'a-script', kind: 'script', label: 'Script', runner: 'agent', provider: 'Claude Code · Opus', detail: '', credits: 0, minutes: 6, col: 1, row: 1, gate: true },
  { id: 'a-director', kind: 'director', label: 'Réalisation', runner: 'agent', provider: 'Claude Code · Sonnet', detail: 'Alterne avatar face caméra et B-roll.', credits: 0, minutes: 3, col: 2, row: 1 },
  { id: 'a-voice', kind: 'voice', label: 'Voix clonée', runner: 'api', provider: 'MiniMax Speech · clone', detail: '', credits: 120, minutes: 2, col: 3, row: 0 },
  { id: 'a-avatar', kind: 'avatar', label: 'Avatar IA', runner: 'api', provider: 'Avatar parlant (HeyGen / Hedra)', detail: 'Le présentateur de la chaîne, synchronisé sur la voix.', credits: 420, minutes: 12, col: 4, row: 0, share: 55 },
  { id: 'a-broll', kind: 'stock', label: 'B-roll', runner: 'api', provider: 'Pexels · Storyblocks', detail: '', credits: 30, minutes: 4, col: 4, row: 2, share: 45 },
  { id: 'a-edit', kind: 'edit', label: 'Montage', runner: 'code', provider: 'Moteur Atelier', detail: '', credits: 0, minutes: 12, col: 5, row: 1 },
  { id: 'a-thumb', kind: 'thumbnail', label: 'Miniature', runner: 'api', provider: 'Génération d’image', detail: '', credits: 50, minutes: 3, col: 6, row: 1 }
]

const SMS_NODES: PipelineNode[] = [
  { id: 's-idea', kind: 'idea', label: 'Scénario', runner: 'agent', provider: 'Claude Code · Sonnet', detail: 'Conflit entre 3 à 5 personnages, rebondissement final.', credits: 0, minutes: 2, col: 0, row: 1 },
  { id: 's-script', kind: 'script', label: 'Dialogue', runner: 'agent', provider: 'Claude Code · Opus', detail: 'Messages courts, personnages distincts.', credits: 0, minutes: 4, col: 1, row: 1 },
  { id: 's-voices', kind: 'voice', label: 'Voix multiples', runner: 'api', provider: 'MiniMax Speech · 4 voix', detail: 'Une voix par personnage.', credits: 40, minutes: 2, col: 2, row: 0 },
  { id: 's-chat', kind: 'code', label: 'Écran de messages', runner: 'code', provider: 'À coder (bêta)', detail: 'Rendu de la conversation qui défile, bulle par bulle. Un agent de code le construit et le teste.', credits: 0, minutes: 3, col: 2, row: 1 },
  { id: 's-gameplay', kind: 'gameplay', label: 'Gameplay Minecraft', runner: 'human', provider: 'Ton dossier de clips', detail: 'Introuvable automatiquement : à fournir.', credits: 0, minutes: 0, col: 2, row: 2 },
  { id: 's-edit', kind: 'edit', label: 'Montage', runner: 'code', provider: 'Moteur Atelier', detail: '', credits: 0, minutes: 5, col: 3, row: 1 },
  { id: 's-publish', kind: 'publish', label: 'Publication', runner: 'agent', provider: 'Planning Atelier', detail: '', credits: 0, minutes: 1, col: 4, row: 1 }
]

const TRANSLATED_NODES: PipelineNode[] = [
  { id: 'x-source', kind: 'idea', label: 'Vidéo source', runner: 'agent', provider: 'Les Grandes Énigmes', detail: 'Reprend les vidéos qui ont le mieux marché en français.', credits: 0, minutes: 1, col: 0, row: 1 },
  { id: 'x-translate', kind: 'translate', label: 'Adaptation', runner: 'agent', provider: 'Claude Code · Opus', detail: 'Adapte le script (références, rythme, titre) pour un public anglophone.', credits: 0, minutes: 6, col: 1, row: 1, gate: true },
  { id: 'x-voice', kind: 'voice', label: 'Voix anglaise', runner: 'api', provider: 'MiniMax Speech · voix clonée EN', detail: '', credits: 140, minutes: 2, col: 2, row: 0 },
  { id: 'x-reuse', kind: 'stock', label: 'Plans réutilisés', runner: 'code', provider: 'Projet source', detail: '90 % des plans repris du projet français.', credits: 0, minutes: 1, col: 2, row: 2, share: 90 },
  { id: 'x-edit', kind: 'edit', label: 'Montage', runner: 'code', provider: 'Moteur Atelier', detail: 'Sous-titres et textes à l’écran traduits.', credits: 0, minutes: 12, col: 3, row: 1 },
  { id: 'x-thumb', kind: 'thumbnail', label: 'Miniature EN', runner: 'api', provider: 'Génération d’image', detail: '', credits: 40, minutes: 2, col: 4, row: 1, gate: true },
  { id: 'x-publish', kind: 'publish', label: 'Publication', runner: 'agent', provider: 'Planning Atelier', detail: 'Créneau calé sur la soirée américaine.', credits: 0, minutes: 1, col: 5, row: 1 }
]

function total(nodes: PipelineNode[], key: 'credits' | 'minutes'): number {
  return nodes.reduce((s, n) => s + n[key], 0)
}

export const PIPELINES: ProtoPipeline[] = [
  {
    id: 'pl-docu',
    name: 'Documentaire narré',
    description: 'Archives, images IA et cartes animées sur une narration posée. Construit à partir de l’analyse des Grandes Énigmes.',
    kind: 'documentary',
    format: 'long',
    nodes: DOCU_NODES,
    edges: chain(DOCU_NODES),
    replicability: 88,
    creditsPerVideo: total(DOCU_NODES, 'credits'),
    minutesPerVideo: 48,
    minutesCloud: 21,
    basedOn: 'Les Grandes Énigmes',
    channelIds: ['ch-enigmes'],
    preset: false,
    version: 7,
    subscriptionShare: 82
  },
  {
    id: 'pl-reddit',
    name: 'Histoire Reddit + gameplay',
    description: 'Short vertical : voix rapide, carte d’intro, sous-titres mot à mot sur du gameplay.',
    kind: 'reddit',
    format: 'short',
    nodes: REDDIT_NODES,
    edges: chain(REDDIT_NODES),
    replicability: 94,
    creditsPerVideo: total(REDDIT_NODES, 'credits'),
    minutesPerVideo: 6,
    minutesCloud: 3,
    basedOn: 'Histoires Vraies',
    channelIds: ['ch-histoires'],
    preset: false,
    version: 3,
    subscriptionShare: 91
  },
  {
    id: 'pl-top10',
    name: 'Top 10 illustré',
    description: 'Compte à rebours illustré, script et miniature faits à la main.',
    kind: 'top10',
    format: 'long',
    nodes: TOP_NODES,
    edges: chain(TOP_NODES),
    replicability: 76,
    creditsPerVideo: total(TOP_NODES, 'credits'),
    minutesPerVideo: 31,
    minutesCloud: 14,
    basedOn: 'Top Savoirs',
    channelIds: ['ch-top'],
    preset: false,
    version: 2,
    subscriptionShare: 70
  },
  {
    id: 'pl-docu-en',
    name: 'Documentaire traduit (EN)',
    description: 'Traduction de chaîne : reprend les meilleurs épisodes français, adaptés et revoicés en anglais.',
    kind: 'translated',
    format: 'long',
    nodes: TRANSLATED_NODES,
    edges: chain(TRANSLATED_NODES),
    replicability: 93,
    creditsPerVideo: total(TRANSLATED_NODES, 'credits'),
    minutesPerVideo: 24,
    minutesCloud: 11,
    basedOn: 'Les Grandes Énigmes',
    channelIds: ['ch-mystery'],
    preset: false,
    version: 1,
    subscriptionShare: 86
  },
  {
    id: 'pl-avatar',
    name: 'Chaîne avatar IA',
    description: 'Un présentateur IA face caméra, voix clonée, B-roll entre les prises.',
    kind: 'avatar',
    format: 'long',
    nodes: AVATAR_NODES,
    edges: chain(AVATAR_NODES),
    replicability: 81,
    creditsPerVideo: total(AVATAR_NODES, 'credits'),
    minutesPerVideo: 52,
    minutesCloud: 24,
    channelIds: [],
    preset: true,
    version: 1,
    subscriptionShare: 48
  },
  {
    id: 'pl-sms',
    name: 'Conversation SMS + gameplay',
    description: 'Le style de @textify.stories : conversation de groupe qui défile, plusieurs voix, gameplay Minecraft. Difficile à répliquer seul.',
    kind: 'sms-story',
    format: 'short',
    nodes: SMS_NODES,
    edges: chain(SMS_NODES),
    replicability: 46,
    creditsPerVideo: total(SMS_NODES, 'credits'),
    minutesPerVideo: 9,
    minutesCloud: 5,
    basedOn: '@textify.stories',
    channelIds: [],
    preset: true,
    version: 1,
    subscriptionShare: 88
  }
]

export function pipelineById(id: string): ProtoPipeline | undefined {
  return PIPELINES.find((p) => p.id === id)
}
