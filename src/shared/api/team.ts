// IPC contract, module "team" (lot Z1): Account, team, devices, Claude connections and profiles, Atelier Cloud link, settings pages.
// Every method added here must also be listed in TEAM_METHODS and counted, with a comment, in its area's unit test.
import type { CreditsBalance } from '../runs'

export type TeamRole = 'owner' | 'admin' | 'member'
export type MemberStatus = 'invited' | 'active'

export interface TeamMember {
  id: number
  name: string
  /** null only for the local owner (this app's user), who has no address yet. */
  email: string | null
  role: TeamRole
  status: MemberStatus
  /** Credits the member may spend per month, or null for no cap. */
  monthlyCap: number | null
  /** The user of this app. Cannot be removed or demoted. */
  self: boolean
  example: boolean
  createdAt: string
}

export interface InviteInput {
  name: string
  email: string
  role: Exclude<TeamRole, 'owner'>
  monthlyCap?: number | null
}

export interface MemberPatch {
  role?: Exclude<TeamRole, 'owner'>
  monthlyCap?: number | null
}

export interface TeamDevice {
  id: number
  name: string
  os: string
  lastSeenAt: string
  current: boolean
  example: boolean
}

export type ClaudeKind = 'cli' | 'api'
/** `ready` = usable; `limited` = usage limit reached until `limitedUntil`; `unset` = an API profile without a key. */
export type ClaudeStatus = 'ready' | 'limited' | 'unset'

export interface ClaudeProfile {
  id: number
  name: string
  kind: ClaudeKind
  status: ClaudeStatus
  /** ISO time of the reset while `status` is `limited`. */
  limitedUntil: string | null
  /** API profiles only: whether a key is stored. The key itself never reaches the renderer. */
  keySet: boolean | null
  isDefault: boolean
  example: boolean
}

export interface ClaudeProfileInput {
  /** Omit to create. */
  id?: number
  name: string
  kind: ClaudeKind
  /** API profiles: a new key to store (omit to keep the stored one). */
  apiKey?: string
  isDefault?: boolean
}

export interface ClaudeRoutingRow {
  role: string
  name: string
  /** Model tier of the role (from the `routes` table, source of truth for the model). */
  tier: 'best' | 'balanced' | 'fast'
  /** Profile chosen for the role, or null for the default profile. */
  profileId: number | null
}

export interface AdminPriceLine {
  unit: string
  providerCostUsd: number
  marginPct: number
  creditsPerUnit: number
}

export interface AdminOverview {
  /** Local price grid (placeholder values until the Cloud's own grid, lot P5). */
  prices: { version: number; creditValueEur: number; overheadPct: number; lines: AdminPriceLine[] }
  /** Credits granted so far on this app, by origin. */
  granted: { local: number; simulated: number; example: number }
  balance: CreditsBalance
}

export interface TeamContract {
  'team.members': { args: []; result: TeamMember[] }
  /** Stores an invitation locally (status « invité »). No e-mail is sent. */
  'team.invite': { args: [input: InviteInput]; result: TeamMember }
  'team.updateMember': { args: [id: number, patch: MemberPatch]; result: TeamMember }
  'team.removeMember': { args: [id: number]; result: void }
  'team.devices': { args: []; result: TeamDevice[] }
  /** The current device cannot be revoked. */
  'team.revokeDevice': { args: [id: number]; result: void }
  'claude.profiles': { args: []; result: ClaudeProfile[] }
  'claude.saveProfile': { args: [input: ClaudeProfileInput]; result: ClaudeProfile }
  'claude.removeProfile': { args: [id: number]; result: void }
  /** Manual « limite atteinte »: `until` is an ISO time in the future, null clears the limit. */
  'claude.setLimit': { args: [id: number, until: string | null]; result: ClaudeProfile }
  'claude.routing': { args: []; result: ClaudeRoutingRow[] }
  /** `profileId` null goes back to the default profile. */
  'claude.setRouting': { args: [role: string, profileId: number | null]; result: void }
  /** Owner only. */
  'admin.overview': { args: []; result: AdminOverview }
}

export const TEAM_METHODS = [
  'team.members',
  'team.invite',
  'team.updateMember',
  'team.removeMember',
  'team.devices',
  'team.revokeDevice',
  'claude.profiles',
  'claude.saveProfile',
  'claude.removeProfile',
  'claude.setLimit',
  'claude.routing',
  'claude.setRouting',
  'admin.overview'
] as const satisfies readonly (keyof TeamContract)[]
