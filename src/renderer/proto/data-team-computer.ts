// Demo data of the team computer screen: folders and files, the browser sessions of the agents, connected accounts,
// plans. Invented values only. Pure data.

export interface TeamFile {
  name: string
  sizeMb: number
  by: string
  minutesAgo: number
  note?: string
}

export interface FolderNode {
  id: string
  label: string
  children?: FolderNode[]
}

/** Folders of one channel (the channel id prefixes the folder id). */
export const CHANNEL_FOLDERS: { suffix: string; label: string }[] = [
  { suffix: 'rushes', label: 'Rushes' },
  { suffix: 'voix', label: 'Voix' },
  { suffix: 'exports', label: 'Exports' }
]

export const SHARED_FOLDERS: FolderNode[] = [
  { id: 'shared/gameplay', label: 'Gameplay' },
  { id: 'shared/voix', label: 'Voix de référence' },
  { id: 'shared/exports', label: 'Exports' }
]

const f = (name: string, sizeMb: number, by: string, minutesAgo: number, note?: string): TeamFile => ({ name, sizeMb, by, minutesAgo, ...(note ? { note } : {}) })

export const FILES: Record<string, TeamFile[]> = {
  'shared/gameplay': [
    f('parkour-niveau-12.mp4', 412, 'Charlie', 60 * 26, 'Pas encore utilisé'),
    f('parkour-niveau-13.mp4', 388, 'Charlie', 60 * 26, 'Pas encore utilisé'),
    f('sable-cinetique-loop.mp4', 164, 'Charlie', 60 * 24 * 3),
    f('course-voitures-03.mp4', 520, 'Yanis', 60 * 24 * 5, 'Utilisé 4 fois')
  ],
  'shared/voix': [f('voix-narrateur-grave.wav', 38, 'Charlie', 60 * 24 * 40), f('voix-histoires-douce.wav', 31, 'Charlie', 60 * 24 * 12)],
  'shared/exports': [f('templiers-v2-1080p.mp4', 1_840, 'Axel', 40), f('atlantide-final-1080p.mp4', 1_620, 'Axel', 60 * 9), f('short-jumeau-vertical.mp4', 96, 'Yanis', 60 * 20)],
  'ch-enigmes/rushes': [f('archives-templiers-1307.zip', 212, 'Léa', 60 * 5, 'Analysé : 38 images utilisables'), f('plan-41-remplacement.png', 6, 'Axel', 52), f('carte-critias.svg', 1, 'Basile', 60 * 7)],
  'ch-enigmes/voix': [f('dyatlov-voix-test.wav', 24, 'Camille', 60 * 4), f('templiers-voix-finale.wav', 61, 'Jade', 60 * 30)],
  'ch-enigmes/exports': [f('templiers-v2-1080p.mp4', 1_840, 'Axel', 40), f('roswell-final-1080p.mp4', 1_910, 'Axel', 60 * 24 * 3)],
  'ch-histoires/rushes': [f('reddit-voisin-wifi.txt', 1, 'Noé', 60 * 5), f('clips-restants.zip', 540, 'Yanis', 60 * 2, '3 clips jamais utilisés')],
  'ch-histoires/voix': [f('voix-coloc-chat.wav', 9, 'Tom', 60 * 3), f('voix-jumeau.wav', 8, 'Tom', 60 * 30)],
  'ch-histoires/exports': [f('short-coloc-v1.mp4', 82, 'Yanis', 60 * 2), f('short-mariage-final.mp4', 71, 'Yanis', 60 * 6)],
  'ch-top/rushes': [f('villes-satellite-pack.zip', 780, 'Ilan', 60 * 8), f('venise-generee.png', 5, 'Ilan', 70)],
  'ch-top/voix': [f('villes-voix-brouillon.wav', 44, 'Rose', 60 * 22)],
  'ch-top/exports': [f('top10-record-vitesse.mp4', 1_320, 'Elio', 60 * 24 * 6)],
  'ch-mystery/rushes': [f('roswell-archives-en.zip', 190, 'Ava', 60 * 7)],
  'ch-mystery/voix': [f('roswell-voice-en.wav', 58, 'Owen', 60 * 3)],
  'ch-mystery/exports': [f('atlantis-final-1080p.mp4', 1_480, 'Ava', 60 * 6)]
}

/** The agents' browser sessions: who, where, what they do, and a mock page for « Voir l'écran ». */
export interface BrowserSession {
  id: string
  agentId: string
  site: string
  url: string
  doing: string
  pageTitle: string
  lines: string[]
}

export const BROWSER_SESSIONS: BrowserSession[] = [
  {
    id: 'br-1',
    agentId: 'ag-enigmes-compet',
    site: 'youtube.com',
    url: 'youtube.com/@notabene/videos',
    doing: 'Relève les vidéos publiées depuis hier sur 14 chaînes concurrentes',
    pageTitle: 'Vidéos · chaîne suivie 6 sur 14',
    lines: ['3 énigmes en 20 min · 410 k vues · il y a 18 h', 'Pourquoi Tamam Shud reste un mystère · 96 k vues', 'Les 5 disparitions les plus étranges · 212 k vues']
  },
  {
    id: 'br-2',
    agentId: 'ag-enigmes-research',
    site: 'persee.fr',
    url: 'persee.fr/recherche?q=col+dyatlov',
    doing: 'Cherche des sources sérieuses sur le col Dyatlov',
    pageTitle: '14 résultats · tri par pertinence',
    lines: ['Enquête sur l’incident du col Dyatlov, 1959', 'Hypothèses et lecture critique des rapports', 'Témoignages de l’expédition de recherche']
  },
  {
    id: 'br-4',
    agentId: 'ag-histoires-research',
    site: 'reddit.com',
    url: 'reddit.com/r/TIFU/top/?t=day',
    doing: 'Trie les histoires du jour et écarte celles qui ne sont pas vérifiables',
    pageTitle: 'Top du jour · 40 histoires, 12 retenues',
    lines: ['Mon voisin utilisait notre wifi depuis trois ans', 'J’ai découvert que ma sœur avait vendu mon vélo', 'Mon patron m’a viré puis rappelé deux semaines après']
  },
  {
    id: 'br-3',
    agentId: 'ag-enigmes-director',
    site: 'gallica.bnf.fr',
    url: 'gallica.bnf.fr/services/engine/search?q=voynich',
    doing: 'Cherche des archives nettes pour « Voynich » (plans 12 à 20)',
    pageTitle: 'Gallica · 8 images retenues',
    lines: ['Manuscrit Voynich, folio 67r', 'Gravure d’alchimiste, XVIe siècle', 'Herbier illustré, bibliothèque de Prague']
  }
]

export interface ConnectedService {
  id: string
  label: string
  detail: string
  status: 'ok' | 'limited' | 'attention'
  note?: string
}

export const OTHER_SERVICES: ConnectedService[] = [
  { id: 'svc-yt', label: 'Google · YouTube', detail: '3 chaînes en lecture, analyses réelles', status: 'ok' },
  { id: 'svc-drive', label: 'Google Drive', detail: 'Dossier « Atelier » partagé avec l’équipe', status: 'ok' },
  { id: 'svc-discord', label: 'Discord', detail: 'Notifications dans #atelier', status: 'attention', note: 'À reconnecter' }
]

export interface Plan {
  id: string
  name: string
  specs: string
  price: string
  current?: boolean
}

export const PLANS: Plan[] = [
  { id: 'base', name: 'Atelier', specs: '8 vCPU · 16 Go · 240 Go', price: 'Inclus', current: true },
  { id: 'plus', name: 'Atelier Plus', specs: '16 vCPU · 32 Go · 480 Go', price: '29 € par mois' },
  { id: 'pro', name: 'Atelier Pro', specs: '32 vCPU · 64 Go · 1 To · GPU 24 Go', price: '89 € par mois' }
]
