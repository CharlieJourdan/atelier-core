// Demo fixtures, lab: Idées (the ideas board of each channel, « Trouver des idées » simulated with a short wait) and
// Automatisations (a channel's videos launched on a cadence, their history). All topics are invented.
import type { AutomationInput, AutomationRow, AutomationRunRow, IdeaRow } from '../../../shared/api/ideas'
import { changed, wait, type DemoHandlers } from './bridge'
import { DEMO_CHANNELS, ago, channelName, nextId } from './world'

const idea = (channelId: number, title: string, angle: string, score: number | null, status: IdeaRow['status'], minutesAgo: number): IdeaRow => ({
  id: nextId(),
  channelId,
  channelName: channelName(channelId),
  title,
  angle,
  source: score === null ? 'manual' : 'agent',
  score,
  status,
  videoId: null,
  example: false,
  createdAt: ago(minutesAgo)
})

const ideas: IdeaRow[] = [
  idea(1, 'Le phare qui s’éteignait chaque 13 du mois', 'Une enquête d’archives sur un phare breton imaginaire et ses gardiens.', 88, 'new', 35),
  idea(1, 'La carte qui menait à une île inexistante', 'Les erreurs de cartographes qui ont créé des îles fantômes.', 82, 'kept', 60 * 5),
  idea(1, 'Le village englouti qui réapparaît en été', 'Quand le lac baisse, les toits ressortent : récit et témoignages.', 76, 'new', 60 * 20),
  idea(1, 'Pourquoi l’horloge de la gare retardait de 7 minutes', '', null, 'rejected', 60 * 48),
  idea(2, 'J’ai retrouvé le journal de ma grand-mère dans le grenier', 'Histoire à la première personne, chute inattendue.', 91, 'new', 20),
  idea(2, 'Mon colocataire parlait à quelqu’un la nuit', 'Suspense, révélation douce à la fin.', 79, 'kept', 60 * 9),
  idea(3, 'Top 10 des inventions nées d’une erreur', 'Classement rythmé, une anecdote vérifiée par entrée.', 85, 'new', 50),
  idea(3, 'Top 7 des records les plus étranges', 'Records réels et vérifiables, ton léger.', 73, 'used', 60 * 70),
  idea(4, 'The lighthouse that went dark every 13th', 'English version of the Grandes Énigmes episode.', 80, 'new', 60 * 3)
]

const GENERATED: Record<number, [string, string][]> = {
  1: [
    ['L’observatoire abandonné et ses carnets codés', 'Déchiffrer pas à pas des notes d’astronome inventées.'],
    ['La cloche qui sonnait sans sonneur', 'Explications possibles, de la plus simple à la plus étrange.'],
    ['Le train fantôme de la ligne 9', 'Une ligne fermée, un horaire toujours affiché.'],
    ['Le manuscrit illisible de l’abbaye', 'Hypothèses, fausses pistes et ce qu’on sait vraiment.'],
    ['Les lumières du marais en novembre', 'Folklore local et phénomènes naturels.']
  ],
  2: [
    ['Le voisin qui arrosait des plantes en plastique', 'Histoire tendre, chute qui fait sourire.'],
    ['J’ai reçu une lettre adressée à moi il y a 20 ans', 'Mystère, puis retrouvailles.'],
    ['Le chat qui rentrait avec des tickets de bus', 'Enquête de quartier, ton léger.'],
    ['Ma collègue connaissait la fin de tous les films', 'Suspense, révélation inattendue.'],
    ['La clé trouvée dans un livre d’occasion', 'Chasse au trésor à la première personne.']
  ],
  3: [
    ['Top 10 des animaux aux super-pouvoirs réels', 'Une capacité vérifiée par entrée.'],
    ['Top 8 des villes construites sur l’eau', 'Géographie et chiffres simples.'],
    ['Top 10 des mots français venus d’ailleurs', 'Étymologie, un exemple par mot.'],
    ['Top 7 des expériences scientifiques ratées devenues célèbres', 'Anecdotes vérifiées.'],
    ['Top 10 des illusions d’optique expliquées', 'Visuel, rythmé.']
  ]
}

function findIdea(id: number): IdeaRow {
  const i = ideas.find((x) => x.id === id)
  if (!i) throw new Error('Idée introuvable.')
  return i
}

// ------------------------------------------------------------------------------------------------ automations

const nextRun = (a: Pick<AutomationRow, 'cadence' | 'enabled' | 'hour' | 'weekday'>): string | null => {
  if (!a.enabled || a.cadence === 'manual') return null
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(a.hour)
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
  if (a.cadence === 'weekly' && a.weekday !== null) while (d.getDay() !== a.weekday) d.setDate(d.getDate() + 1)
  return d.toISOString()
}

function automation(input: AutomationInput, lastMinutesAgo: number | null): AutomationRow {
  return { ...input, id: nextId(), channelName: channelName(input.channelId), lastRunAt: lastMinutesAgo === null ? null : ago(lastMinutesAgo), nextRunAt: nextRun(input), example: false }
}

const automations: AutomationRow[] = [
  automation({ name: 'Énigme du mardi', channelId: 1, cadence: 'weekly', weekday: 2, hour: 9, topicFrom: 'ideas', topic: '', minutes: 14, budgetMode: 'qualite_max', gateMode: 'step', enabled: true }, 60 * 24 * 6),
  automation({ name: 'Short quotidien', channelId: 2, cadence: 'daily', weekday: null, hour: 18, topicFrom: 'ideas', topic: '', minutes: 1, budgetMode: 'usage_max', gateMode: 'all', enabled: true }, 60 * 6),
  automation({ name: 'Classement du week-end', channelId: 3, cadence: 'weekly', weekday: 6, hour: 10, topicFrom: 'fixed', topic: 'Top 10 des objets du quotidien inventés par hasard', minutes: 9, budgetMode: 'usage_max', gateMode: 'step', enabled: false }, null)
]

const run = (a: AutomationRow, status: AutomationRunRow['status'], message: string, minutesAgo: number): AutomationRunRow => ({
  id: nextId(),
  automationId: a.id,
  videoId: status === 'started' ? nextId() : null,
  runId: status === 'started' ? nextId() : null,
  status,
  message,
  example: false,
  createdAt: ago(minutesAgo)
})

const [a1, a2] = automations as [AutomationRow, AutomationRow, AutomationRow]
const history: AutomationRunRow[] = [
  run(a2, 'started', 'Vidéo lancée : « Mon colocataire parlait à quelqu’un la nuit »', 60 * 6),
  run(a2, 'skipped', 'Aucune idée gardée ni nouvelle pour la chaîne : rien lancé.', 60 * 30),
  run(a1, 'started', 'Vidéo lancée : « La carte qui menait à une île inexistante »', 60 * 24 * 6),
  run(a2, 'failed', 'Démo : crédits insuffisants au moment du lancement.', 60 * 54)
]

function findAutomation(id: number): AutomationRow {
  const a = automations.find((x) => x.id === id)
  if (!a) throw new Error('Automatisation introuvable.')
  return a
}

export const ideasHandlers: DemoHandlers = {
  'ideas.list': (channelId) => ideas.filter((i) => channelId === undefined || i.channelId === channelId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  'ideas.create': (input) => {
    if (!input.title.trim()) throw new Error('Donne un titre à l’idée.')
    const row = idea(input.channelId, input.title.trim(), input.angle?.trim() ?? '', null, 'new', 0)
    ideas.unshift(row)
    changed('ideas')
    return row
  },
  'ideas.update': (id, patch) => {
    const i = findIdea(id)
    Object.assign(i, patch)
    changed('ideas')
    return { ...i }
  },
  'ideas.delete': (id) => {
    const at = ideas.findIndex((x) => x.id === id)
    if (at >= 0) ideas.splice(at, 1)
    changed('ideas')
  },
  'ideas.generate': async (channelId, count = 5) => {
    await wait(1800)
    const pool = GENERATED[channelId] ?? GENERATED[1] ?? []
    const rows = pool.slice(0, count).map(([title, angle], k) => idea(channelId, title, angle, 70 + ((k * 7 + channelId * 3) % 25), 'new', 0))
    ideas.unshift(...rows)
    changed('ideas')
    return rows
  },
  'ideas.toVideo': (id) => {
    const i = findIdea(id)
    i.status = 'used'
    i.videoId = nextId()
    changed('ideas', 'videos')
    return { ...i }
  },
  'automations.list': () => automations.map((a) => ({ ...a })),
  'automations.create': (input) => {
    if (!input.name.trim()) throw new Error('Donne un nom à l’automatisation.')
    if (!DEMO_CHANNELS.some((c) => c.id === input.channelId)) throw new Error('Choisis une chaîne.')
    const row = automation(input, null)
    automations.unshift(row)
    changed('ideas')
    return row
  },
  'automations.update': (id, patch) => {
    const a = findAutomation(id)
    Object.assign(a, patch)
    a.channelName = channelName(a.channelId)
    a.nextRunAt = nextRun(a)
    changed('ideas')
    return { ...a }
  },
  'automations.delete': (id) => {
    const at = automations.findIndex((x) => x.id === id)
    if (at >= 0) automations.splice(at, 1)
    changed('ideas')
  },
  'automations.runNow': async (id) => {
    const a = findAutomation(id)
    await wait(900)
    const pick = a.topicFrom === 'fixed' ? a.topic : (ideas.find((i) => i.channelId === a.channelId && i.status === 'kept') ?? ideas.find((i) => i.channelId === a.channelId && i.status === 'new'))?.title
    const row = pick ? run(a, 'started', `Vidéo lancée : « ${pick} »`, 0) : run(a, 'skipped', 'Aucune idée gardée ni nouvelle pour la chaîne : rien lancé.', 0)
    a.lastRunAt = row.createdAt
    history.unshift(row)
    changed('ideas', 'production')
    return row
  },
  'automations.history': (id) => history.filter((h) => id === undefined || h.automationId === id)
}
