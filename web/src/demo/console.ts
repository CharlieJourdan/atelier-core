// Demo fixtures of the rest: the founder console's overview, machines, releases and Blueprints, and the signed-in team's
// own machines and publication kits (« Mes vidéos »). Invented, kept in memory, never sent anywhere.
import type { Blueprint } from '../admin/blueprint'
import { PUBLISHED_V3 } from '../admin/blueprint'
import type { ReleaseRow } from '../admin/releases'
import { DEMO_RELEASES } from '../admin/releases'
import type { CloudMachine, SiteKit } from '../cloud'
import { ago, crmTotals, demoTeams } from './crm'
import { DEMO_ACCOUNT } from './mode'

// ---- machines (console) ----------------------------------------------------------------------------------------------

type MachineStatus = CloudMachine['status']
interface AdminMachine {
  id: string
  teamName: string
  plan: string
  serverType: string
  location: string
  status: MachineStatus
  ipv4: string | null
  demo: boolean
  error: string | null
  createdAt: string
}

const LOCATIONS = ['fsn1', 'nbg1', 'hel1']
const machines: AdminMachine[] = demoTeams()
  .filter((t) => t.machines > 0)
  .flatMap((t, i) =>
    Array.from({ length: t.machines }, (_, k): AdminMachine => {
      const n = i * 3 + k
      const status: MachineStatus = n % 7 === 3 ? 'hibernated' : n === 5 ? 'error' : 'running'
      return {
        id: `vm_demo${String(n + 1).padStart(2, '0')}`,
        teamName: t.name,
        plan: t.plan ?? '—',
        serverType: t.plan === 'studio' ? 'cx53' : 'cx33',
        location: LOCATIONS[n % LOCATIONS.length] ?? 'fsn1',
        status,
        // documentation range (RFC 5737): never a real address
        ipv4: status === 'running' ? `192.0.2.${10 + n}` : null,
        demo: true,
        error: status === 'error' ? 'Démarrage trop long : nouvel essai prévu' : null,
        createdAt: ago(1_440 * (10 + n))
      }
    })
  )

export const adminMachines = (): { provider: 'fake'; machines: AdminMachine[] } => ({ provider: 'fake', machines: machines.map((m) => ({ ...m })) })

export function machineAction(id: string, action: unknown): boolean {
  const m = machines.find((x) => x.id === id)
  if (!m) return false
  if (action === 'hibernate' && m.status === 'running') Object.assign(m, { status: 'hibernated', ipv4: null })
  else if (action === 'resume' && m.status === 'hibernated') Object.assign(m, { status: 'running', ipv4: `192.0.2.${200 + machines.indexOf(m)}` })
  else return false
  return true
}

// ---- overview --------------------------------------------------------------------------------------------------------

const PLAN_EUR: Record<string, number> = { starter: 19, creator: 49, studio: 129, agency: 299, network: 699 }

export function overview(): unknown {
  const t = crmTotals()
  const mrr = t.plans.reduce((n, p) => n + (PLAN_EUR[p.plan] ?? 0) * 100 * p.active, 0)
  const running = machines.filter((m) => m.status === 'running').length
  const hibernated = machines.filter((m) => m.status === 'hibernated').length
  return {
    accounts: t.accounts,
    teams: t.teams,
    plans: t.plans,
    mrrCents: mrr,
    monthRevenueCents: { subscription: Math.round(mrr * 0.82), pack: 34_500, topup: 12_900 },
    machines: { running, hibernated, monthlyCostEur: running * 8.99 + hibernated * 1.2, demo: true },
    creditsThisMonth: { granted: 62_000, spent: 58_430 },
    paymentsProvider: 'fake',
    providerAlerts: [{ provider: 'HeyGen', message: 'Connexion à renouveler (démo : rien à faire)', raisedAt: ago(140) }]
  }
}

// ---- releases --------------------------------------------------------------------------------------------------------

const releases: ReleaseRow[] = [
  ...DEMO_RELEASES.map((r) => ({ ...r, files: r.files.map((f) => ({ ...f })) })),
  {
    id: 'rel_demo4',
    version: '0.2.0',
    channel: 'beta',
    platform: 'mac',
    notes: 'Première version macOS pour les testeurs.',
    state: 'published',
    createdAt: '2026-10-23T10:00:00.000Z',
    publishedAt: '2026-10-23T10:30:00.000Z',
    withdrawnAt: null,
    files: [{ name: 'Atelier-0.2.0-arm64.zip', size: 141_000_000, sha512: 'démo' }]
  }
]

export const releaseList = (): { releases: ReleaseRow[] } => ({ releases: releases.map((r) => ({ ...r })) })

export function releaseAction(id: string, action: string): 'ok' | 'missing' | 'refused' {
  const i = releases.findIndex((r) => r.id === id)
  const r = releases[i]
  if (!r) return 'missing'
  const now = new Date().toISOString()
  if (action === 'publish' && r.state !== 'published') Object.assign(r, { state: 'published', publishedAt: now, withdrawnAt: null })
  else if (action === 'withdraw' && r.state === 'published') Object.assign(r, { state: 'withdrawn', withdrawnAt: now })
  else if (action === 'delete' && r.state === 'draft') releases.splice(i, 1)
  else return 'refused'
  return 'ok'
}

// ---- Blueprints ------------------------------------------------------------------------------------------------------

interface BlueprintVersion {
  version: number
  blueprint: Blueprint
  note: string
  publishedBy: string
  publishedAt: string
}
const blueprints: BlueprintVersion[] = [
  { version: 3, blueprint: structuredClone(PUBLISHED_V3), note: 'Voix HD pour les documentaires', publishedBy: DEMO_ACCOUNT.name, publishedAt: ago(1_300) },
  { version: 2, blueprint: { ...structuredClone(PUBLISHED_V3), version: 2 }, note: 'Contrôle qualité avant chaque validation', publishedBy: DEMO_ACCOUNT.name, publishedAt: ago(1_440 * 58) },
  { version: 1, blueprint: { ...structuredClone(PUBLISHED_V3), version: 1 }, note: 'Organisation initiale : 9 agents, 3 pipelines', publishedBy: DEMO_ACCOUNT.name, publishedAt: ago(1_440 * 86) }
]

export function blueprintState(): unknown {
  const current = blueprints[0]
  return {
    current: current ? { version: current.version, blueprint: structuredClone(current.blueprint) } : null,
    versions: blueprints.map((b) => ({ version: b.version, note: b.note, publishedBy: b.publishedBy, publishedAt: b.publishedAt }))
  }
}

export function publishBlueprint(body: Record<string, unknown>): { version: number } | null {
  const b = body.blueprint as Blueprint | undefined
  if (!b || typeof b !== 'object' || !Array.isArray(b.agents)) return null
  const version = (blueprints[0]?.version ?? 0) + 1
  blueprints.unshift({ version, blueprint: { ...structuredClone(b), version }, note: typeof body.note === 'string' ? body.note : '', publishedBy: DEMO_ACCOUNT.name, publishedAt: new Date().toISOString() })
  return { version }
}

// ---- the signed-in team: machines and kits ---------------------------------------------------------------------------

let paidAt: number | null = null
const PROVISION_MS = 4_500

/** The simulated checkout was completed: the team's computer is « created » and runs a few seconds later. */
export function markPaid(): void {
  paidAt = Date.now()
}

export function teamMachines(): { provider: 'fake'; machines: CloudMachine[] } {
  const status: MachineStatus = paidAt !== null && Date.now() - paidAt < PROVISION_MS ? 'creating' : 'running'
  return { provider: 'fake', machines: [{ id: 'vm_demo_team', status, serverType: 'cx53', location: 'fsn1', demo: true }] }
}

const textUrl = (text: string): string => `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`
const KITS: Omit<SiteKit, 'files' | 'createdAt' | 'expiresAt'>[] = [
  {
    id: 'kit_demo1',
    videoId: 'vid_demo1',
    title: 'Le phare qui s’allumait tout seul',
    alternatives: ['Pourquoi ce phare brille sans gardien', 'L’énigme du phare de l’île inventée'],
    description: 'Une histoire inventée pour la démonstration : un phare sur une île imaginaire, et l’enquête qui suit.',
    tags: ['histoire', 'mystère', 'phare'],
    chapters: [
      { at: 0, title: 'Introduction' },
      { at: 74, title: 'La première nuit' },
      { at: 312, title: 'L’explication' }
    ],
    language: 'fr',
    demo: true
  },
  {
    id: 'kit_demo2',
    videoId: 'vid_demo2',
    title: '10 inventions qui n’ont jamais existé',
    alternatives: ['Dix machines imaginaires'],
    description: 'Un top 10 illustré, entièrement fictif, produit par la démo d’Atelier.',
    tags: ['top 10', 'inventions'],
    chapters: [],
    language: 'fr',
    demo: true
  },
  {
    id: 'kit_demo3',
    videoId: 'vid_demo3',
    title: 'How a made-up city got its trams',
    alternatives: [],
    description: 'An invented documentary, translated by the demo team.',
    tags: ['documentary', 'trams'],
    chapters: [{ at: 0, title: 'Start' }],
    language: 'en',
    demo: true
  }
]

function kitFiles(k: (typeof KITS)[number], withUrls: boolean): SiteKit['files'] {
  const srt = `1\n00:00:00,000 --> 00:00:04,000\n${k.title}\n\n2\n00:00:04,000 --> 00:00:08,000\n(Démo : sous-titres fictifs)\n`
  const txt = `${k.title}\n\n${k.description}\n`
  // the media files of the demo have no link (nothing to download); the text ones are made in the browser
  return [
    { name: 'video.mp4', mime: 'video/mp4', size: 184_000_000, sha256: 'demo' },
    { name: 'thumbnail.jpg', mime: 'image/jpeg', size: 412_000, sha256: 'demo' },
    { name: 'captions.srt', mime: 'application/x-subrip', size: srt.length, sha256: 'demo', ...(withUrls ? { url: textUrl(srt) } : {}) },
    { name: 'description.txt', mime: 'text/plain', size: txt.length, sha256: 'demo', ...(withUrls ? { url: textUrl(txt) } : {}) }
  ]
}

function kit(k: (typeof KITS)[number], i: number, withUrls: boolean): SiteKit {
  return { ...k, createdAt: ago(1_440 * (i + 1)), expiresAt: new Date(Date.now() + 86_400_000 * (28 - i * 6)).toISOString(), files: kitFiles(k, withUrls) }
}

export const teamKits = (): { kits: SiteKit[] } => ({ kits: KITS.map((k, i) => kit(k, i, false)) })

export function teamKit(videoId: string): SiteKit | null {
  const i = KITS.findIndex((k) => k.videoId === videoId)
  const k = KITS[i]
  return k ? kit(k, i, true) : null
}
