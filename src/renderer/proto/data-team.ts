// Demo team: the main agent at the top, one lead per channel, specialists under each lead, plus workspace-wide agents.
// Threads and messages read like a real team chat (the agents talk to each other, @mention, hand work over).
import { CHANNELS } from './data-core'
import type { AgentRole, InboxItem, ModelTier, ProtoAgent, ProtoMessage, ProtoThread } from './types'

export const PRINCIPAL_ID = 'ag-principal'
export const DEFAULT_PRINCIPAL_NAME = 'Atlas'

const LEADS: Record<string, string> = {
  'ch-enigmes': 'Hugo',
  'ch-histoires': 'Inès',
  'ch-top': 'Malo',
  'ch-mystery': 'June'
}

/** Specialists of every channel: role, display name per channel, model tier, the slug used in ids. */
const SPECIALISTS: { role: AgentRole; slug: string; model: ModelTier; names: string[] }[] = [
  { role: 'researcher', slug: 'research', model: 'haiku', names: ['Léa', 'Noé', 'Zoé', 'Ezra'] },
  { role: 'scriptwriter', slug: 'script', model: 'opus', names: ['Camille', 'Lou', 'Sacha', 'Iris'] },
  { role: 'director', slug: 'director', model: 'sonnet', names: ['Basile', 'Nina', 'Ilan', 'Mila'] },
  { role: 'production-supervisor', slug: 'prod', model: 'sonnet', names: ['Jade', 'Tom', 'Rose', 'Owen'] },
  { role: 'editor', slug: 'edit', model: 'codex', names: ['Axel', 'Yanis', 'Elio', 'Ava'] },
  { role: 'packaging', slug: 'pack', model: 'sonnet', names: ['Clara', 'Maé', 'Rayan', 'Lily'] },
  { role: 'competitor-analyst', slug: 'compet', model: 'haiku', names: ['Victor', 'Alma', 'Nils', 'Esmé'] },
  { role: 'qc-eye', slug: 'qc', model: 'haiku', names: ['Œil', 'Œil', 'Œil', 'Œil'] }
]

const TASKS: Partial<Record<string, string>> = {
  'ag-enigmes-edit': 'Monte « Le trésor des Templiers » (72 %)',
  'ag-enigmes-script': 'Attend ta relecture du script « Col Dyatlov »',
  'ag-enigmes-director': 'Découpe « Voynich » en 64 plans',
  'ag-enigmes-pack': 'Attend ton choix de miniature « Atlantide »',
  'ag-enigmes-compet': 'Surveille 14 chaînes concurrentes',
  'ag-histoires-edit': 'Monte 2 shorts du jour',
  'ag-histoires-script': 'Écrit « Le voisin qui volait notre wifi »',
  'ag-histoires-research': 'Trie 40 histoires candidates',
  'ag-top-director': 'Illustrations de « 10 villes qui vont disparaître »',
  'ag-mystery-lead': 'Voix anglaise de « Roswell 1947 »'
}

function status(id: string): ProtoAgent['status'] {
  const task = TASKS[id]
  if (!task) return id.endsWith('-qc') ? 'sleeping' : 'idle'
  return task.startsWith('Attend') ? 'waiting' : 'working'
}

function build(): ProtoAgent[] {
  const agents: ProtoAgent[] = [
    { id: PRINCIPAL_ID, name: DEFAULT_PRINCIPAL_NAME, role: 'principal', channelId: null, parentId: null, status: 'working', task: 'Coordonne 4 chaînes · 11 vidéos en cours', model: 'opus', load: 38, memoryItems: 1_284, tasksDone7d: 212, colorIndex: 0 },
    { id: 'ag-architect', name: 'Archi', role: 'pipeline-architect', channelId: null, parentId: PRINCIPAL_ID, status: 'working', task: 'Teste la réplication de @textify.stories (46 %)', model: 'opus', load: 52, memoryItems: 310, tasksDone7d: 18, colorIndex: 5 },
    { id: 'ag-sponsor', name: 'Margaux', role: 'sponsor-manager', channelId: null, parentId: PRINCIPAL_ID, status: 'idle', model: 'sonnet', load: 4, memoryItems: 46, tasksDone7d: 3, colorIndex: 6 }
  ]
  CHANNELS.forEach((ch, ci) => {
    const short = ch.id.replace('ch-', '')
    const leadId = `ag-${short}-lead`
    agents.push({
      id: leadId,
      name: LEADS[ch.id] ?? 'Lead',
      role: 'channel-manager',
      channelId: ch.id,
      parentId: PRINCIPAL_ID,
      status: TASKS[leadId] ? 'working' : 'idle',
      ...(TASKS[leadId] ? { task: TASKS[leadId] } : { task: 'Planifie la semaine' }),
      model: 'sonnet',
      load: 20 + ci * 9,
      memoryItems: 420 - ci * 70,
      tasksDone7d: 64 - ci * 9,
      colorIndex: (ci + 1) % 8
    })
    SPECIALISTS.forEach((sp, si) => {
      // The translated channel and the hand-written top 10 need fewer specialists.
      if (ch.id === 'ch-mystery' && (sp.role === 'researcher' || sp.role === 'director')) return
      if (ch.id === 'ch-top' && sp.role === 'scriptwriter') return
      const id = `ag-${short}-${sp.slug}`
      const task = TASKS[id]
      agents.push({
        id,
        name: sp.names[ci % sp.names.length] ?? sp.slug,
        role: sp.role,
        channelId: ch.id,
        parentId: sp.role === 'editor' || sp.role === 'director' || sp.role === 'qc-eye' ? `ag-${short}-prod` : leadId,
        status: status(id),
        ...(task ? { task } : {}),
        model: sp.model,
        load: (si * 13 + ci * 7) % 70,
        memoryItems: 40 + ((si * 37 + ci * 11) % 200),
        tasksDone7d: 3 + ((si * 5 + ci * 3) % 30),
        colorIndex: (si + ci + 2) % 8
      })
    })
  })
  return agents
}

export const AGENTS: ProtoAgent[] = build()

export function agentById(id: string): ProtoAgent | undefined {
  return AGENTS.find((a) => a.id === id)
}

export const THREADS: ProtoThread[] = [
  { id: 'th-principal', kind: 'principal', title: DEFAULT_PRINCIPAL_NAME, agentId: PRINCIPAL_ID, participantIds: [PRINCIPAL_ID, 'user'], unread: 1 },
  ...CHANNELS.map<ProtoThread>((ch) => ({
    id: `th-group-${ch.id}`,
    kind: 'channel-group',
    title: ch.name,
    channelId: ch.id,
    participantIds: AGENTS.filter((a) => a.channelId === ch.id).map((a) => a.id),
    unread: ch.id === 'ch-enigmes' ? 3 : ch.id === 'ch-histoires' ? 1 : 0
  })),
  { id: 'th-video-templiers', kind: 'video', title: 'Le trésor des Templiers', channelId: 'ch-enigmes', videoId: 'v-templiers', participantIds: ['ag-enigmes-lead', 'ag-enigmes-edit', 'ag-enigmes-director', 'user'], unread: 0 },
  { id: 'th-video-dyatlov', kind: 'video', title: 'Col Dyatlov', channelId: 'ch-enigmes', videoId: 'v-dyatlov', participantIds: ['ag-enigmes-script', 'ag-enigmes-lead', 'user'], unread: 1 }
]

export const MESSAGES: ProtoMessage[] = [
  // Main agent ↔ user
  { id: 'm1', threadId: 'th-principal', authorId: PRINCIPAL_ID, text: 'Bonjour Charlie. Cette nuit : 2 vidéos rendues, 3 shorts publiés, et Mystery Files a pris +64 % de vues sur la semaine. Trois choses t’attendent, dont le script de « Col Dyatlov ».', minutesAgo: 182 },
  { id: 'm2', threadId: 'th-principal', authorId: 'user', text: 'Ok. Pourquoi Top Savoirs baisse ?', minutesAgo: 175 },
  { id: 'm3', threadId: 'th-principal', authorId: PRINCIPAL_ID, text: 'Victor (analyse concurrence) voit deux causes : les miniatures sont moins lisibles que celles de @Top10Zone depuis 3 semaines, et on publie le mardi alors que la niche performe le jeudi. Je te propose de laisser Clara tester 3 miniatures par vidéo et de décaler au jeudi 16 h.', minutesAgo: 174, card: { type: 'report', title: 'Top Savoirs · baisse de 4 %', detail: 'CTR 4,1 % → 3,2 % · meilleur jour de la niche : jeudi' } },
  { id: 'm4', threadId: 'th-principal', authorId: 'user', text: 'Vas-y pour les deux.', minutesAgo: 170 },
  { id: 'm5', threadId: 'th-principal', authorId: PRINCIPAL_ID, text: 'C’est lancé. Malo a déplacé les deux prochaines publications au jeudi. Il me manque ton script pour « Les 10 animaux les plus rapides » : tu peux le déposer ici ou dans Accueil.', minutesAgo: 168, card: { type: 'task', title: 'Script à importer', detail: 'Top Savoirs · « Les 10 animaux les plus rapides du monde »', videoId: 'v-animaux' } },

  // Les Grandes Énigmes group chat
  { id: 'g1', threadId: 'th-group-ch-enigmes', authorId: 'ag-enigmes-compet', text: '@Hugo la chaîne Nota Bene a sorti un format « 3 énigmes en 20 min » hier : 410 k vues en 18 h, 4× sa moyenne.', minutesAgo: 95 },
  { id: 'g2', threadId: 'th-group-ch-enigmes', authorId: 'ag-enigmes-lead', text: 'Intéressant. @Léa tu peux me sortir 3 triplés d’énigmes qui se tiennent ? On le propose à Charlie demain.', minutesAgo: 92 },
  { id: 'g3', threadId: 'th-group-ch-enigmes', authorId: 'ag-enigmes-research', text: 'Je regarde. Premier jet dans 20 min.', minutesAgo: 91 },
  { id: 'g4', threadId: 'th-group-ch-enigmes', authorId: 'ag-enigmes-edit', text: 'Rendu des Templiers à 72 %. Le plan 41 était une archive de 1923 floue : remplacé par une image générée, même cadrage.', minutesAgo: 40, card: { type: 'video', title: 'Le trésor des Templiers', detail: 'Montage · 72 %', videoId: 'v-templiers' } },
  { id: 'g5', threadId: 'th-group-ch-enigmes', authorId: 'ag-enigmes-qc', text: 'Vu la version 2. Rien à signaler sauf un « 1037 » au lieu de « 1307 » à 4:12. @Axel', minutesAgo: 22 },
  { id: 'g6', threadId: 'th-group-ch-enigmes', authorId: 'ag-enigmes-edit', text: 'Corrigé, merci l’Œil.', minutesAgo: 20 },

  // Histoires Vraies group chat
  { id: 'h1', threadId: 'th-group-ch-histoires', authorId: 'ag-histoires-edit', text: 'Il me manque des clips de gameplay pour le short de 20 h : le dossier n’a plus que 3 clips jamais utilisés. @Inès tu préviens Charlie ?', minutesAgo: 60 },
  { id: 'h2', threadId: 'th-group-ch-histoires', authorId: 'ag-histoires-lead', text: 'C’est dans son Accueil. En attendant je décale ce short à demain midi si rien n’arrive avant 17 h.', minutesAgo: 58 },

  // Video thread
  { id: 'vd1', threadId: 'th-video-dyatlov', authorId: 'ag-enigmes-script', text: 'Script prêt : 1 640 mots, 11 min 20 à la voix. J’ai gardé l’ouverture « la tente découpée de l’intérieur » qui a bien marché sur Roswell.', minutesAgo: 34, card: { type: 'approval', title: 'Script à valider', detail: 'Col Dyatlov · 1 640 mots', videoId: 'v-dyatlov' } }
]

export const INBOX: InboxItem[] = [
  { id: 'in-1', kind: 'validate-script', videoId: 'v-dyatlov', channelId: 'ch-enigmes', title: 'Script de « Col Dyatlov »', detail: '1 640 mots · 11 min 20 · ouverture testée sur Roswell', agentId: 'ag-enigmes-script', minutesAgo: 34 },
  { id: 'in-2', kind: 'validate-thumbnail', videoId: 'v-atlantide', channelId: 'ch-enigmes', title: 'Miniature de « Atlantide »', detail: '3 propositions · publication ce soir 18 h', agentId: 'ag-enigmes-pack', minutesAgo: 51 },
  { id: 'in-3', kind: 'upload-input', videoId: 's-heritage', channelId: 'ch-histoires', title: 'Clips de gameplay', detail: 'Le dossier est presque vide : il en faut 10 pour la semaine', agentId: 'ag-histoires-edit', minutesAgo: 60 },
  { id: 'in-4', kind: 'upload-input', videoId: 'v-animaux', channelId: 'ch-top', title: 'Ton script « 10 animaux les plus rapides »', detail: 'Tu écris les scripts de Top Savoirs', agentId: 'ag-top-lead', minutesAgo: 168 },
  { id: 'in-5', kind: 'validate-idea', videoId: null, channelId: 'ch-enigmes', title: '5 nouveaux sujets proposés', detail: 'Dont « 3 énigmes en 20 min », format qui monte chez les concurrents', agentId: 'ag-enigmes-research', minutesAgo: 12 }
]
