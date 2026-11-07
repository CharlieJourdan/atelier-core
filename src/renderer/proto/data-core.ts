// Demo data of the proto layer: channels, workspace, engine accounts and the team computer. Invented values only.
import type { EngineAccount, ProtoChannel, TeamComputer, Workspace } from './types'

export const CHANNELS: ProtoChannel[] = [
  {
    id: 'ch-enigmes',
    name: 'Les Grandes Énigmes',
    handle: '@grandesenigmes',
    color: 1,
    initials: 'GE',
    niche: 'Histoire et mystères, documentaires narrés',
    language: 'fr',
    format: 'long',
    connected: true,
    subscribers: 184_300,
    views28d: 2_410_000,
    revenue28d: 6_870,
    trend: 12,
    cadence: '3 vidéos par semaine',
    automation: { idea: 'validate', script: 'validate', production: 'auto', packaging: 'validate', publishing: 'auto' },
    pipelineIds: ['pl-docu'],
    products: [{ kind: 'ebook', name: 'Le Carnet des Énigmes (e-book)' }],
    createdDaysAgo: 410
  },
  {
    id: 'ch-histoires',
    name: 'Histoires Vraies',
    handle: '@histoiresvraies.fr',
    color: 3,
    initials: 'HV',
    niche: 'Histoires Reddit racontées, gameplay en fond',
    language: 'fr',
    format: 'short',
    connected: true,
    subscribers: 62_800,
    views28d: 9_840_000,
    revenue28d: 1_120,
    trend: 31,
    cadence: '3 shorts par jour',
    automation: { idea: 'auto', script: 'auto', production: 'auto', packaging: 'auto', publishing: 'auto' },
    pipelineIds: ['pl-reddit'],
    products: [],
    createdDaysAgo: 96
  },
  {
    id: 'ch-top',
    name: 'Top Savoirs',
    handle: '@topsavoirs',
    color: 2,
    initials: 'TS',
    niche: 'Classements « top 10 » de culture générale',
    language: 'fr',
    format: 'long',
    connected: false,
    subscribers: 41_200,
    views28d: 512_000,
    revenue28d: 1_480,
    trend: -4,
    cadence: '2 vidéos par semaine',
    automation: { idea: 'validate', script: 'human', production: 'auto', packaging: 'human', publishing: 'human' },
    pipelineIds: ['pl-top10'],
    products: [{ kind: 'sponsor', name: 'Partenariat NordVPN (mars)' }],
    createdDaysAgo: 220
  },
  {
    id: 'ch-mystery',
    name: 'Mystery Files',
    handle: '@mysteryfiles',
    color: 5,
    initials: 'MF',
    niche: 'Version anglaise des Grandes Énigmes',
    language: 'en',
    format: 'long',
    connected: true,
    subscribers: 3_240,
    views28d: 88_000,
    revenue28d: 210,
    trend: 64,
    cadence: '2 vidéos par semaine',
    automation: { idea: 'auto', script: 'auto', production: 'auto', packaging: 'validate', publishing: 'auto' },
    pipelineIds: ['pl-docu-en'],
    translatedFrom: 'ch-enigmes',
    products: [],
    createdDaysAgo: 21
  }
]

export const WORKSPACE: Workspace = {
  name: 'Studio Charlie',
  plan: 'Studio',
  credits: 12_480,
  creditsMonthly: 20_000,
  autoTopUp: true,
  seats: 3,
  members: [
    { name: 'Charlie', role: 'owner', initials: 'C' },
    { name: 'Associé', role: 'admin', initials: 'A' },
    { name: 'Monteuse freelance', role: 'editor', initials: 'M' }
  ]
}

export const ENGINE_ACCOUNTS: EngineAccount[] = [
  { id: 'acc-1', provider: 'claude-code', label: 'Claude Max 20×', owner: 'Charlie', plan: 'Max 20×', usage5h: 34, usageWeek: 61, status: 'ok' },
  { id: 'acc-2', provider: 'claude-code', label: 'Claude Pro', owner: 'Associé', plan: 'Pro', usage5h: 88, usageWeek: 47, status: 'limited' },
  { id: 'acc-3', provider: 'codex', label: 'ChatGPT Plus (Codex)', owner: 'Charlie', plan: 'Plus', usage5h: 9, usageWeek: 22, status: 'ok' },
  { id: 'acc-4', provider: 'atelier', label: 'Forfait IA Atelier', owner: 'Atelier', plan: 'Relais en crédits', usage5h: 0, usageWeek: 3, status: 'ok' }
]

export const TEAM_COMPUTER: TeamComputer = {
  name: 'atelier-pc-01',
  provider: 'Atelier Cloud',
  specs: '8 vCPU · 16 Go · 240 Go NVMe',
  region: 'Falkenstein (UE)',
  cpu: 46,
  ram: 58,
  diskUsedGb: 131,
  diskTotalGb: 240,
  uptimeDays: 12,
  jobs: [
    { label: 'Rendu 1080p · « Le trésor des Templiers »', progress: 72 },
    { label: 'Montage short · « Mon coloc a vendu mon chat »', progress: 35 },
    { label: 'Analyse vidéo · 12 concurrents', progress: 90 }
  ]
}
