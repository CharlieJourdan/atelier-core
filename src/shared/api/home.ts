// IPC contract, module "home" (lot Z1): Accueil (overview), Validations (inbox) and Ordinateurs (agent browsers, machines).
// Every method added here must also be listed in HOME_METHODS and counted, with a comment, in its area's unit test.
import type { CreditsBalance } from '../runs'
import type { PendingApproval } from '../workflow'

// ---- Validations -------------------------------------------------------------------------------------------------

/** A production run stopped at a gate: the owner approves it or asks for changes (`production.approve` / `requestChanges`). */
export interface InboxGate {
  runId: number
  nodeId: string
  /** The node's French label (« Script », « Montage »…). */
  nodeLabel: string
  /** `review` = a review gate of the pipeline, `owner` = only the owner may decide. */
  gateKind: 'review' | 'owner'
  videoId: number
  videoTitle: string
  channelId: number
  channelName: string
  pipelineLabel: string
  /** Made with demo providers (nothing debited, not to publish). */
  demo: boolean
  /** The run's last progress sentence at this node, or null. */
  step: string | null
}

export interface HomeInbox {
  /** Workflow deliverables waiting for a decision (`approvals.approve` / `approvals.requestRevision`). */
  approvals: PendingApproval[]
  /** Production runs waiting at a gate. */
  gates: InboxGate[]
  /** approvals + gates. */
  total: number
}

// ---- Accueil -----------------------------------------------------------------------------------------------------

export interface HomeChannel {
  id: number
  name: string
  niche: string
  /** The channel belongs to the example workspace. */
  example: boolean
  /** Videos that are not finished (idea, in progress, waiting). */
  videosOpen: number
  videosPublished: number
  /** Deliverables and gates of this channel waiting for the owner. */
  waiting: number
}

export interface HomeVideo {
  videoId: number
  title: string
  channelId: number
  channelName: string
  example: boolean
  /** `production` = an active engine run, `workflow` = a video in the agents' workflow. */
  source: 'production' | 'workflow'
  /** French label of the state (« En cours », « En attente de ta validation »…). */
  state: 'running' | 'waiting' | 'queued' | 'in_progress' | 'idea' | 'waiting_approval'
  /** 0..1 for a production run, null otherwise. */
  progress: number | null
  runId: number | null
  /** Sentence shown under the title (the node running now), or null. */
  step: string | null
  updatedAt: string
}

export interface HomeAgentActivity {
  /** Task id. */
  id: number
  agentId: string
  agentName: string
  title: string
  status: 'running' | 'ready' | 'blocked' | 'waiting_approval' | 'done' | 'failed' | 'cancelled'
  videoId: number | null
  videoTitle: string | null
  updatedAt: string
}

export interface HomeOverview {
  channels: HomeChannel[]
  /** Videos being made, runs first. */
  videos: HomeVideo[]
  /** The five oldest items waiting for the owner (the full list is `home.inbox`). */
  validations: { total: number; top: InboxTopItem[] }
  /** The wallet (credits). */
  credits: CreditsBalance
  /** The 6 most recent agent tasks. */
  agents: { working: number; recent: HomeAgentActivity[] }
  /** Model spend of the current UTC month (the ledger, in USD). */
  spend: { month: string; spentUsd: number; reservedUsd: number; capUsd: number | null }
}

export interface InboxTopItem {
  kind: 'approval' | 'gate'
  /** `deliverable:<id>` or `run:<id>:<nodeId>`: stable key. */
  key: string
  title: string
  videoTitle: string
  channelName: string
}

// ---- Ordinateurs -------------------------------------------------------------------------------------------------

/** One browser session of an agent (lot Z1: the row is real; the live picture is a labelled mock, see feature `remote-desktop-control`). */
export interface BrowserSession {
  id: number
  /** Agent role (`researcher`…). */
  role: string
  agentName: string
  startUrl: string
  status: 'open' | 'closed'
  /** Absolute path of the last screenshot, or null (no browser is driven yet). */
  screenshotPath: string | null
  createdAt: string
  closedAt: string | null
  example: boolean
}

export interface BrowserSessionInput {
  role: string
  /** `http://` or `https://` address. */
  startUrl: string
}

export const MACHINE_OSES = ['windows', 'macos', 'linux'] as const
export type MachineOs = (typeof MACHINE_OSES)[number]

export const MACHINE_STATUSES = ['unknown', 'reachable', 'unreachable'] as const
export type MachineStatus = (typeof MACHINE_STATUSES)[number]

/** A remote PC the owner declared (« PC distant (H1) »). The connection test is a TCP connect, nothing more. */
export interface Machine {
  id: number
  name: string
  os: MachineOs
  host: string
  port: number
  status: MachineStatus
  /** Last time the test connected, or null. */
  lastSeenAt: string | null
  /** Last time a test ran, or null. */
  lastCheckedAt: string | null
  /** French reason of the last failed test, or null. */
  lastError: string | null
  createdAt: string
  example: boolean
}

export interface MachineInput {
  name: string
  os: MachineOs
  host: string
  /** Default 22. */
  port?: number
}

export interface MachineTestResult {
  machine: Machine
  ok: boolean
  /** Round trip in milliseconds when it connected. */
  ms: number | null
  /** French sentence shown in the toast. */
  message: string
}

export interface HomeContract {
  /** Everything the dashboard shows, in one call (channels, videos in progress, validations, credits, agents, spend). */
  'home.overview': { args: []; result: HomeOverview }
  /** Everything waiting for the owner: workflow approvals and production gates. */
  'home.inbox': { args: []; result: HomeInbox }
  'browsers.list': { args: []; result: BrowserSession[] }
  /** Opens a session for an agent role on an http(s) address. */
  'browsers.open': { args: [input: BrowserSessionInput]; result: BrowserSession }
  'browsers.close': { args: [id: number]; result: BrowserSession }
  /** Removes a closed session from the list. */
  'browsers.remove': { args: [id: number]; result: void }
  'machines.list': { args: []; result: Machine[] }
  'machines.add': { args: [input: MachineInput]; result: Machine }
  'machines.rename': { args: [id: number, name: string]; result: Machine }
  'machines.remove': { args: [id: number]; result: void }
  /** TCP connect to host:port with a 4 s timeout; records the status and the last-seen time. No login, no command. */
  'machines.test': { args: [id: number]; result: MachineTestResult }
}

export const HOME_METHODS = [
  'home.overview',
  'home.inbox',
  'browsers.list',
  'browsers.open',
  'browsers.close',
  'browsers.remove',
  'machines.list',
  'machines.add',
  'machines.rename',
  'machines.remove',
  'machines.test'
] as const satisfies readonly (keyof HomeContract)[]
