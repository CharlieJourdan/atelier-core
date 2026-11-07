// Roles of the agent runtime. Built-in roles of the existing registry (shared/roles + agents/roles: researcher,
// scriptwriter, director, packaging, competitor_analyst, publisher, video_producer = the editor "Monteur"…) are reused
// as they are (name, one-line job, instructions); the roles the runtime adds live here: the principal agent, the channel
// lead, the production supervisor, the pipeline architect, the sponsor manager and the QC eye. They are deliberately
// not added to shared/roles ROLES: that list drives the 27 agents of the Agents screen and their colours.
// The seeded hierarchy (one workspace = one Atelier database):
//   principal ─┬─ pipeline_architect
//              └─ channel_lead (one per channel) ─┬─ researcher, competitor_analyst, qc_eye, publisher, sponsor_manager
//                                                 └─ production_supervisor ── scriptwriter, packaging, director, editor
import { agentDefault } from '../agents/roles'
import { roleName } from '../../shared/roles'

export interface RuntimeRole {
  role: string
  name: string
  job: string
  instructions: string
  /** Task kind its routine or a delegation gets by default. */
  defaultKind: string
}

const RUNTIME_ROLES: readonly RuntimeRole[] = [
  {
    role: 'principal',
    name: 'Atlas',
    job: 'top of the funnel: plans the week, hands work to the channel leads, reports to the owner',
    defaultKind: 'plan',
    instructions:
      "You are the principal agent of the owner's YouTube business: the top of the funnel. You turn his goals into work " +
      'for the channel leads, follow what they deliver, and report to him clearly. Delegate instead of doing the ' +
      'specialist work yourself, ask the owner only when a decision is really his, and never invent results. A custom brick ' +
      'for a channel (an animated presentation card, a subscribe reminder, a caption or title style) is made by that ' +
      "channel's Monteur: hand it to the channel's lead with the request as it is."
  },
  {
    role: 'channel_lead',
    name: 'Responsable de chaîne',
    job: 'runs one channel: priorities, the weekly plan, hands work to its specialists',
    defaultKind: 'plan',
    instructions:
      'You run one YouTube channel like a team lead. You know its niche, standards and results, plan what the channel ' +
      'publishes, hand each piece to the right specialist, check what comes back and consolidate it for the principal. A ' +
      'custom brick (an animated card, a reminder, a title style) goes to the production supervisor, who gives it to the Monteur.'
  },
  {
    role: 'production_supervisor',
    name: 'Superviseur de production',
    job: 'keeps each video moving: script, thumbnail, director, editor',
    defaultKind: 'production',
    instructions:
      'You supervise the production of each video: the script, the thumbnail, the director and the editor. You hand ' +
      'each step to its specialist in the right order, check quality and deadlines, and say early what is blocked. A custom ' +
      'brick for the channel is the Monteur’s (video_producer): delegate it with the request as it is.'
  },
  {
    role: 'pipeline_architect',
    name: 'Architecte pipeline',
    job: 'designs production pipelines and formats that the engine can run',
    defaultKind: 'architecture',
    instructions:
      'You design production pipelines: which steps a video format needs, which engine node runs each one, what it ' +
      'costs per budget mode and where a human checks. Propose, explain the trade-offs, never start a paid run.'
  },
  {
    role: 'sponsor_manager',
    name: 'Responsable sponsors',
    job: 'sponsor pipeline: prospects, drafts, follow-ups (never sends anything)',
    defaultKind: 'sponsors',
    instructions:
      'You manage sponsorships for the channel: find fitting brands, draft outreach and follow-ups, track deals. You ' +
      'only draft: Charlie sends every message himself.'
  },
  {
    role: 'qc_eye',
    name: 'Œil qualité',
    job: 'final quality check of a video package: facts, promise, thumbnail and title, visuals',
    defaultKind: 'qc_check',
    instructions:
      'You are the last pair of eyes before a video ships: facts, the title and thumbnail promise, pacing, visuals, ' +
      'risky claims. List each check as pass or fail with a short note, then a verdict. Listen as well as look: qc.check of the ' +
      'run lists the silence, the loudness and the voice holes, clicks and music level; never write that the music or the voice ' +
      'is fine when it says the sound was not verified.'
  }
]

/** Aliases: names used in the founder's brief for roles that already exist under another id. */
export const ROLE_ALIASES: Readonly<Record<string, string>> = {
  editor: 'video_producer',
  'competitor-analyst': 'competitor_analyst',
  'production-supervisor': 'production_supervisor',
  'pipeline-architect': 'pipeline_architect',
  'sponsor-manager': 'sponsor_manager',
  'qc-eye': 'qc_eye'
}

const DEFAULT_KINDS: Readonly<Record<string, string>> = {
  researcher: 'research',
  scriptwriter: 'script',
  director: 'production',
  packaging: 'packaging',
  competitor_analyst: 'competitor_scan',
  publisher: 'publish_package',
  video_producer: 'production',
  qc: 'qc_check'
}

export function canonicalRole(role: string): string {
  return ROLE_ALIASES[role] ?? role
}

/** Name, job and instructions of a role: runtime role, then the existing registry, then a generic custom role. */
export function roleInfo(role: string): RuntimeRole {
  const id = canonicalRole(role)
  const own = RUNTIME_ROLES.find((r) => r.role === id)
  if (own) return own
  const existing = agentDefault(id)
  if (existing) {
    return { role: id, name: existing.name, job: existing.job, instructions: existing.instructions, defaultKind: DEFAULT_KINDS[id] ?? 'task' }
  }
  return { role: id, name: roleName(id), job: id.replace(/_/g, ' '), instructions: `You are the ${roleName(id)} of the team.`, defaultKind: 'task' }
}

export function isRuntimeRole(role: string): boolean {
  return RUNTIME_ROLES.some((r) => r.role === canonicalRole(role))
}

export interface SeedNode {
  role: string
  children?: SeedNode[]
}

/** The team of one channel, under its lead. */
export const CHANNEL_TEAM: readonly SeedNode[] = [
  { role: 'researcher' },
  { role: 'competitor_analyst' },
  {
    role: 'production_supervisor',
    children: [{ role: 'scriptwriter' }, { role: 'packaging' }, { role: 'director' }, { role: 'video_producer' }]
  },
  { role: 'qc_eye' },
  { role: 'publisher' },
  { role: 'sponsor_manager' }
]

/** Workspace-level specialists, directly under the principal. */
export const PRINCIPAL_TEAM: readonly SeedNode[] = [{ role: 'pipeline_architect' }]

export interface SeedRoutine {
  role: string
  name: string
  kind: string
  cron: string
  title: string
}

/** Routines created with the seeded team (the loop only runs them while `orchestra.enabled` is on). */
export const SEED_ROUTINES: readonly SeedRoutine[] = [
  { role: 'principal', name: 'Digest quotidien', kind: 'digest', cron: '0 8 * * *', title: 'Daily digest for Charlie' },
  { role: 'channel_lead', name: 'Idées du lundi', kind: 'topics', cron: '0 9 * * 1', title: "Next week's topics" },
  { role: 'competitor_analyst', name: 'Veille concurrence', kind: 'competitor_scan', cron: '0 7 * * *', title: 'Morning competitor scan' }
]
