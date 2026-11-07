// Typed sample data for every card and rich block of the chat. Shown in Réglages › Galerie and used by the tests and
// the screenshots; lot 13 (group-chat engine) feeds the same shapes with real data. Never sent anywhere.
import type { MessageRow } from '../../../shared/chat'
import type { AnyCard, BlockName } from '../../../shared/chat-rich'
import type { ThreadMessage, ToolStep } from './thread'

const fence = (name: string, data: unknown): string => '```' + name + '\n' + JSON.stringify(data, null, 1) + '\n```'

export const BLOCK_SAMPLES: Record<BlockName, unknown> = {
  stats: {
    items: [
      { label: 'Vues (28 j)', value: '184 K', delta: '+12 %' },
      { label: 'Abonnés', value: '+1 240', delta: '+3 %' },
      { label: 'Durée moyenne', value: '6 min 10', delta: '-4 %' },
      { label: 'RPM', value: '$7,4' }
    ]
  },
  chart: {
    kind: 'bar',
    title: 'Vues par vidéo (milliers)',
    series: [
      { label: 'V1', value: 42 },
      { label: 'V2', value: 88 },
      { label: 'V3', value: 31 },
      { label: 'V4', value: 120 },
      { label: 'V5', value: 76 }
    ]
  },
  ideas: {
    items: [
      { title: 'La ville engloutie que personne ne cherche', hook: 'Une cloche sonne encore sous l’eau, chaque nuit.' },
      { title: 'Le dernier phare habité', hook: 'Trois gardiens, un registre truqué.' },
      { title: 'Trois cartes, un seul trésor', hook: 'Pourquoi les experts se disputent encore.' }
    ]
  },
  concepts: {
    items: [
      { title: 'Documentaire nocturne', summary: 'Voix grave, images sombres, rythme lent, une révélation à mi-parcours.', tags: ['mystère', 'long format'] },
      { title: 'Enquête en 3 actes', summary: 'Un indice par acte, une conclusion ouverte.', tags: ['enquête'] },
      { title: 'Carnet de terrain', summary: 'Ton intime, cartes animées, archives.' }
    ]
  },
  beats: {
    items: [
      { label: 'Accroche', text: 'La cloche sonne : plan fixe sur la mer.', seconds: 12 },
      { label: 'Contexte', text: 'Ys, la légende et les premières sources.', seconds: 70 },
      { label: 'Tension', text: 'Les fouilles de 1931 et ce qu’elles ont trouvé.', seconds: 140 },
      { label: 'Chute', text: 'Ce que les plongeurs ont vu en dernier.', seconds: 60 }
    ]
  },
  keywords: {
    items: [
      { term: 'ville engloutie', volume: 22000, difficulty: 38 },
      { term: 'légende d’Ys', volume: 9800, difficulty: 22 },
      { term: 'Atlantide bretonne', volume: 3100, difficulty: 14 }
    ]
  },
  tags: { items: ['histoire', 'mystère', 'bretagne', 'documentaire', 'légendes'] },
  sources: {
    items: [
      { title: 'Archives départementales du Finistère', url: 'https://www.archives.example.org/ys', note: 'registre de 1931' },
      { title: 'Revue d’archéologie sous-marine', url: 'https://revue.example.net/n12', note: 'n° 12' },
      { title: 'Entretien avec un plongeur' }
    ]
  },
  trend: { title: 'Recherche « ville engloutie »', points: [12, 14, 13, 18, 22, 21, 30, 38], delta: '+216 %' },
  steps: {
    items: [
      { label: 'Recherche des sources', state: 'done' },
      { label: 'Plan en trois actes', state: 'done' },
      { label: 'Écriture du script', state: 'running' },
      { label: 'Relecture qualité', state: 'todo' }
    ]
  }
}

export const CARD_SAMPLES: AnyCard[] = [
  {
    type: 'approval',
    deliverableId: 9001,
    versionId: 1,
    deliverableType: 'script',
    title: 'Script · Ys, la ville engloutie',
    excerpt: 'Une cloche sonne sous la mer.\nElle sonne, dit-on, depuis mille ans…',
    ownerGate: true,
    status: 'waiting_approval'
  },
  {
    type: 'qc',
    passed: false,
    summary: 'Contrôle du script',
    items: [
      { label: 'Durée cible respectée', ok: true },
      { label: 'Sources citées', ok: false, note: 'deux affirmations sans source' },
      { label: 'Pas de contenu protégé', ok: true }
    ]
  },
  { type: 'budget', scope: 'channel', capUsd: 20, spentUsd: 19.4, requestedUsd: 1.2, message: 'Le plafond mensuel de la chaîne est atteint.', taskId: 7, held: true },
  { type: 'proposal', proposalId: 12, title: 'Nouvelle vidéo : Le dernier phare habité', detail: 'Pour la chaîne Histoires oubliées ; l’équipe commence par la recherche.', status: 'pending' },
  { type: 'task', taskId: 31, title: 'Écrire le script', status: 'in_progress', assignee: 'scriptwriter' },
  { type: 'goal', goalId: 2, title: '12 vidéos ce trimestre', target: 12, progress: 5, unit: 'vidéos', deadline: '31/12' },
  { type: 'engine', slug: 'ys-1', title: 'Rendu · Ys, la ville engloutie', stage: 'Assemblage des plans', percent: 64, state: 'running', detail: 'Environ 6 minutes restantes' },
  { type: 'handoff', from: 'scriptwriter', to: 'voiceover', ask: 'Quel rythme de lecture pour l’introduction ?', state: 'answered', answerExcerpt: 'Lent, 140 mots par minute, pauses sur les noms propres.' }
]

export const TOOL_STEPS_DONE: ToolStep[] = [
  { id: 't1', label: 'A lu la file du moteur', state: 'done' },
  { id: 't2', label: 'A cherché dans la mémoire', state: 'done' },
  { id: 't3', label: 'A listé les vidéos de la chaîne', state: 'done' }
]
export const TOOL_STEPS_RUNNING: ToolStep[] = [
  { id: 't1', label: 'A lu la file du moteur', state: 'done' },
  { id: 't4', label: 'Lit les statistiques de la chaîne…', state: 'running' }
]

let nextId = 1
const msg = (m: Partial<ThreadMessage> & Pick<ThreadMessage, 'authorType' | 'body'>): ThreadMessage => ({
  id: nextId++,
  authorId: null,
  card: null,
  attachments: [],
  createdAt: '2026-10-19T09:30:00.000Z',
  ...m
})

/** A thread that shows every kind of content once: grouped agents, tool steps, blocks, cards, an attachment. */
export const SAMPLE_THREAD: ThreadMessage[] = [
  msg({ authorType: 'owner', body: '@Scénariste et @Voix_off : où en est le script de la vidéo sur Ys ?', attachments: [{ name: 'brief.pdf', mime: 'application/pdf', size: 1200, path: '' }] }),
  msg({ authorType: 'agent', authorId: 'scriptwriter', body: 'Le plan est prêt, **l’écriture est en cours**.\n\n- trois actes\n- une accroche de 12 secondes\n- sources à confirmer', toolSteps: TOOL_STEPS_DONE }),
  msg({ authorType: 'agent', authorId: 'scriptwriter', body: 'Voici la structure :\n' + fence('beats', BLOCK_SAMPLES.beats) }),
  msg({ authorType: 'agent', authorId: 'scriptwriter', body: '', card: CARD_SAMPLES[7] ?? null }),
  msg({ authorType: 'agent', authorId: 'voiceover', body: 'Je lis lentement, avec des pauses sur les noms propres.' }),
  msg({ authorType: 'system', body: 'Le script est passé en relecture.' }),
  msg({ authorType: 'agent', authorId: 'qc', body: '', card: CARD_SAMPLES[1] ?? null })
]

/** Messages for the real list (shape of the v1 contract), used by unit tests. */
export const sampleRow = (over: Partial<MessageRow> = {}): MessageRow => ({
  id: 1,
  conversationId: 1,
  authorType: 'agent',
  authorId: 'scriptwriter',
  body: 'Bonjour',
  card: null,
  attachments: [],
  tools: [],
  createdAt: '2026-10-19T09:30:00.000Z',
  ...over
})

export const blockMessageBody = (name: BlockName): string => fence(name, BLOCK_SAMPLES[name])
