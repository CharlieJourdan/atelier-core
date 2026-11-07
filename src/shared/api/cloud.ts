// IPC contract, module "cloud": the app's connection to Atelier Cloud (device login, account, catalogue) and the local
// copy of Cloud spending (lot P5). Tokens never travel here: the renderer only sees whether the app is connected.
import type { BlueprintApplyResult, BlueprintPlan, BlueprintStatus } from '../blueprint'
import type { CloudCatalog } from '../features'
import type { KitWithLinks } from '../cloud-kit'

/** Where the device login stands. `pending`: the browser page waits for the code; `error`: a French message. */
export type CloudLoginState =
  | 'idle'
  | 'connected'
  | { pending: true; userCode: string; verificationUri: string }
  | { error: true; message: string }

export interface CloudAccountRef {
  email: string
  name: string
  teamName: string
}

export interface CloudStatus {
  connected: boolean
  baseUrl: string
  deviceId: string | null
  account?: CloudAccountRef
}

export interface CloudAccount extends CloudAccountRef {
  role: 'owner' | 'admin' | 'member'
  wallet: { balance: number; held: number; available: number }
  caps: { dailyCredits: number | null; monthlyCredits: number | null }
  /** Value of one credit in euros (null when the Cloud did not say). */
  creditValueEur: number | null
}

/** The signed-in account as the sidebar and Réglages › Compte show it (`/v1/me` + `/v1/billing`). */
export interface CloudProfile extends CloudAccountRef {
  role: 'owner' | 'admin' | 'member'
  emailVerified: boolean
  /** The plan of the running subscription (`starter`, `creator`…), or null without one. */
  plan: string | null
  planStatus: 'active' | 'past_due' | 'canceled' | null
  credits: { balance: number; held: number; available: number }
}

/** A person of the Cloud team (Réglages › Compte › Équipe). */
export interface CloudTeamMember {
  accountId: string
  email: string
  name: string
  role: 'owner' | 'admin' | 'member'
}

/** An invitation that waits for its person (the link was e-mailed; it is never shown). */
export interface CloudTeamInvite {
  id: string
  email: string
  role: 'admin' | 'member'
  invitedBy: string
  createdAt: string
  expiresAt: string
}

/** The team block: its members, and its pending invitations when the caller may invite (owner or admin). */
export interface CloudTeam {
  canInvite: boolean
  members: CloudTeamMember[]
  invites: CloudTeamInvite[]
}

export interface CloudSpendSummary {
  month: string
  /** Credits held by Cloud jobs that have not ended yet. */
  reservedCredits: number
  /** Credits captured by finished jobs. */
  spentCredits: number
  spentEur: number
  jobs: number
}

/** One voice of the Cloud's catalogue: the platform's own (in demo, the fake ones) or one this team cloned. */
export interface CloudVoice {
  id: string
  name: string
  /** Two letters (`fr`, `en`). */
  language: string
  /** A demo voice: the Cloud's fake provider speaks it, nothing paid. */
  demo: boolean
  cloned: boolean
  /** The Cloud's default real voice of its language (a new channel's placeholder voice, issue #95). */
  default?: boolean
}

/**
 * The voices the Cloud offers. `not-connected` / `unreachable`: no voice is invented, the screen says why. `clone`: whether
 * cloning a voice is real (a real provider and paid calls on) or a demo; null when the Cloud does not offer it.
 */
export interface CloudVoices {
  status: 'ok' | 'not-connected' | 'unreachable'
  voices: CloudVoice[]
  clone: 'real' | 'demo' | null
}

/** A recording to clone into a new voice (10 s to 5 min, at most 20 MB, mp3 / m4a / wav). */
export interface CloneVoiceRequest {
  name: string
  language: string
  fileName: string
  bytes: Uint8Array
  /** The tick of decision 0025: the person holds the rights to this voice. Refused without it. */
  consent: boolean
  /** The voice engine that clones (`voice:fish-s2`…); absent: the Cloud's configured clone provider. */
  engine?: string
}

/**
 * A video's publication kit on the platform, as the screens see it: the texts and a short-lived link per file. `none`: the
 * Cloud has no kit for this video (not published, or expired); `not-connected` / `unreachable`: why it cannot be asked.
 */
export type CloudKitState = { status: 'ok'; kit: KitWithLinks } | { status: 'none' | 'not-connected' | 'unreachable' }

/** Where a kit download landed: the files saved (names) and their folder (null when the browser saved them). */
export interface CloudKitDownload {
  saved: string[]
  dir: string | null
}

/** What one publish sent to the platform. */
export interface CloudKitPublished {
  files: number
  bytes: number
}

export interface CloudContract {
  'cloud.status': { args: []; result: CloudStatus }
  /** Starts a device login and opens the browser on the approval page (`signup`: on its « Créer un compte » form). */
  'cloud.connect': { args: [mode?: 'signin' | 'signup']; result: CloudLoginState }
  /** Opens the approval page of the pending login again (the person closed the tab). */
  'cloud.reopenLogin': { args: [mode?: 'signin' | 'signup']; result: void }
  'cloud.loginState': { args: []; result: CloudLoginState }
  'cloud.cancelLogin': { args: []; result: void }
  'cloud.disconnect': { args: []; result: void }
  /** http only for a loopback host, else https. Changing the address signs the app out of the previous Cloud. */
  'cloud.setBaseUrl': { args: [url: string]; result: CloudStatus }
  /** null when the app is not connected; throws a French message when the Cloud is unreachable. */
  'cloud.account': { args: []; result: CloudAccount | null }
  /** null when not connected or unreachable (every Cloud function then stays demo). */
  'cloud.catalog': { args: []; result: CloudCatalog | null }
  /** The account, its plan and credits; null when not connected; throws a French message when the Cloud is unreachable. */
  'cloud.profile': { args: []; result: CloudProfile | null }
  /** The Cloud team: members and pending invitations; null when not connected. */
  'cloud.team': { args: []; result: CloudTeam | null }
  /** Invites a person by e-mail (owner or admin): the Cloud e-mails a single-use link. Throws a French message. */
  'cloud.invite': { args: [email: string, role?: 'admin' | 'member']; result: CloudTeamInvite }
  'cloud.revokeInvite': { args: [inviteId: string]; result: void }
  'cloud.spend': { args: [month?: string]; result: CloudSpendSummary }
  /** The voices the Cloud offers (platform + cloned by the team), or why there are none. */
  'cloud.voices': { args: []; result: CloudVoices }
  /** Clones a voice from a recording through the Cloud (quoted, paid once, copied into the ledger); throws a French message. */
  'cloud.cloneVoice': { args: [request: CloneVoiceRequest]; result: CloudVoice }
  /**
   * The blueprint the founder published (read-only): « version publiée N », the agents it maps onto the runtime, the
   * templates to recruit and the pipelines (as drawings). `refresh` asks the Cloud now (else the cached version).
   * Not connected, or nothing published: state `not-connected` / `none`, the built-in defaults apply.
   */
  'cloud.blueprint': { args: [refresh?: boolean]; result: BlueprintStatus }
  /**
   * The platform reference of a video's kit (`<database id>-<video id>`): answered by the brain that holds the video (the
   * team computer when one is connected), since a video's id is only unique in its own database.
   */
  'cloud.kitRef': { args: [videoId: number]; result: string }
  /**
   * The publication kit of a video on the platform (the app's own Cloud session asks, even when the brain is on a team
   * computer: it holds no person's token). `videoId` is the video's id in the brain; `ref` its reference from
   * `cloud.kitRef` (without it: this app's own database).
   */
  'cloud.kit': { args: [videoId: number, ref?: string]; result: CloudKitState }
  /**
   * Sends a finished run's package to the platform now (it is also sent when a run ends, unless turned off). Runs on the
   * machine that holds the package: the app, or the team computer. Throws a French message.
   */
  'cloud.kitPublish': { args: [runId: number]; result: CloudKitPublished }
  /** Saves one file of the video's kit (all of them without `name`) in the Downloads folder and shows it. */
  'cloud.kitDownload': { args: [videoId: number, name?: string | null, ref?: string]; result: CloudKitDownload }
  /** What « Appliquer la version N » would change on each existing agent. */
  'cloud.blueprintPlan': { args: []; result: BlueprintPlan }
  /** Brings the picked agents (those the user confirmed) to version `version`; refused if the published version moved. */
  'cloud.blueprintApply': { args: [version: number, agentIds: number[]]; result: BlueprintApplyResult }
}

export const CLOUD_METHODS = [
  'cloud.status',
  'cloud.connect',
  'cloud.reopenLogin',
  'cloud.loginState',
  'cloud.cancelLogin',
  'cloud.disconnect',
  'cloud.setBaseUrl',
  'cloud.account',
  'cloud.catalog',
  'cloud.profile',
  'cloud.team',
  'cloud.invite',
  'cloud.revokeInvite',
  'cloud.spend',
  'cloud.voices',
  'cloud.cloneVoice',
  'cloud.blueprint',
  'cloud.blueprintPlan',
  'cloud.blueprintApply',
  'cloud.kitRef',
  'cloud.kit',
  'cloud.kitPublish',
  'cloud.kitDownload'
] as const satisfies readonly (keyof CloudContract)[]
