// IPC contract, module "autopilot": the agent team as Charlie drives it (docs/AGENT-RUNTIME.md §24–§25). The power switch
// (on / off / pause until a time, the red stop; the team never runs in the background before a Claude account passed
// « Vérifier »), the live « Activité » snapshot, and each channel's standing goals (time and budget) with its approval
// level, proposed when a channel is created or imported and confirmed or edited by Charlie.
import type { OrchEvent, OrchInboxItem, OrchTaskStatus } from './orchestra'

/** `blocked`: switched on, but no Claude account is connected yet, so nothing runs. */
export const POWER_STATES = ['off', 'on', 'paused', 'blocked'] as const
export type PowerState = (typeof POWER_STATES)[number]

export interface PowerView {
  state: PowerState
  /** While paused: when work resumes by itself. */
  pausedUntil: string | null
  /** A Claude (or Codex, or API) account is enabled and passed « Vérifier ». */
  claudeConnected: boolean
  /** The background loop runs in this process (the team computer's when the app is linked to one). */
  loopRunning: boolean
}

export interface PowerInput {
  state: 'on' | 'off' | 'paused'
  /** For `paused`: when work resumes (ISO, in the future, 30 days at most). */
  until?: string
}

export interface StopResult {
  power: PowerView
  /** Runs that were in flight and were killed. */
  killed: number
  /** Their tasks, back in the queue with their attempts intact. */
  requeued: number
  /** Production runs (fabrications) that were going and were cancelled: nothing more is spent on them. */
  runsStopped: number
}

export interface ActivityRun {
  taskId: number
  agentId: number
  agentName: string
  channelName: string | null
  kind: string
  title: string
  since: string
  account: string | null
}

/** On whom a waiting task waits. */
export type WaitOn = 'charlie' | 'team' | 'accounts' | 'budget' | 'other'

export interface ActivityWait {
  taskId: number
  agentId: number
  agentName: string
  channelName: string | null
  title: string
  on: WaitOn
  /** Names: the sub-tasks' agents, « Charlie », the limited accounts… */
  who: string
  /** When it goes again by itself (accounts, budget), if known. */
  until: string | null
  /** The open inbox item answering it (waiting on Charlie). */
  inboxId: number | null
  since: string
}

export interface ActivityQueued {
  taskId: number
  agentId: number
  agentName: string
  title: string
  notBefore: string | null
}

export interface ActivityRoutine {
  id: number
  name: string
  agentId: number
  agentName: string
  channelName: string | null
  at: string
}

export interface ActivityAccount {
  id: number
  label: string
  kind: string
  /** Enabled, checked and not limited. */
  ready: boolean
  state: string
  limitedUntil: string | null
  running: number
  maxConcurrent: number
}

export interface ActivitySnapshot {
  at: string
  power: PowerView
  running: ActivityRun[]
  waiting: ActivityWait[]
  queued: { count: number; next: ActivityQueued[] }
  nextRoutines: ActivityRoutine[]
  accounts: ActivityAccount[]
  /** What the team's calls cost (the ledger: subscriptions are booked at their estimate). */
  spend: { callsToday: number; usdToday: number; usdMonth: number }
  counts: Partial<Record<OrchTaskStatus, number>>
  /** The latest runtime events, newest first. */
  events: OrchEvent[]
}

/** The gates of a video where Charlie may be asked (approval levels). */
export const GOAL_GATES = ['topic', 'script', 'voice', 'thumbnail', 'video', 'kit'] as const
export type GoalGate = (typeof GOAL_GATES)[number]

/** `recommended`: topics and thumbnails; `all-auto`: no gate (« tout automatique »); `manual`: every gate. */
export const APPROVAL_LEVELS = ['recommended', 'all-auto', 'manual', 'custom'] as const
export type ApprovalLevel = (typeof APPROVAL_LEVELS)[number]

export const LEVEL_GATES: Readonly<Record<Exclude<ApprovalLevel, 'custom'>, readonly GoalGate[]>> = {
  recommended: ['topic', 'thumbnail'],
  'all-auto': [],
  manual: GOAL_GATES
}

/** A publication slot: ISO weekday (1 = Monday … 7 = Sunday), local time `HH:MM`, and the format published then. */
export interface GoalSlot {
  day: number
  time: string
  kind: 'long' | 'short'
}

export interface GoalFormat {
  kind: 'long' | 'short'
  /** Target length in minutes. */
  minutes: number
  perWeek: number
}

export interface GoalDeadline {
  label: string
  /** YYYY-MM-DD */
  date: string
}

export interface ChannelGoals {
  channelId: number
  /** `proposed` until Charlie confirms (or edits) them; the agents treat proposed goals as a draft. */
  status: 'proposed' | 'confirmed'
  slots: GoalSlot[]
  formats: GoalFormat[]
  /** Monthly budget of paid generation, in Atelier credits (1 credit = 0,01 €). */
  budgetCredits: number
  deadlines: GoalDeadline[]
  level: ApprovalLevel
  /** The gates that ask Charlie (from the level, or chosen one by one for `custom`). */
  gates: GoalGate[]
  /** Why these numbers (the competitors' rhythm and lengths, or the lead's analysis). */
  reasons: string
  /** Who wrote the current numbers. */
  source: 'baseline' | 'agent' | 'user'
  /** The action that triggered them. */
  trigger: 'create' | 'import'
  inboxId: number | null
  proposedAt: string
  confirmedAt: string | null
  updatedAt: string
}

export interface ChannelGoalsInput {
  slots?: GoalSlot[]
  formats?: GoalFormat[]
  budgetCredits?: number
  deadlines?: GoalDeadline[]
  level?: ApprovalLevel
  /** Only read with `level: 'custom'`. */
  gates?: GoalGate[]
  /** Saves them as confirmed (« Confirmer »). */
  confirm?: boolean
}

/**
 * A standing-allow rule (« Toujours valider pour ce type »): the questions of this channel about this gate (of this
 * series only, when it has one; for its next `maxUses` questions only, when it has a limit) are approved without asking
 * Charlie. It never covers a question of an agent without a channel.
 */
export interface AllowRule {
  id: number
  channelId: number
  gate: GoalGate
  series: string | null
  maxUses: number | null
  uses: number
  /** The question it was made from. */
  sourceInboxId: number | null
  createdAt: string
  lastUsedAt: string | null
  /** Null while it applies: revoked by Charlie, or used up. */
  revokedAt: string | null
}

export interface AllowAlwaysInput {
  /** Limit the rule to the question's series (« sujets d'une série déjà validée »). */
  series?: boolean
  /** Limit the rule to the next N questions (1–100). */
  maxUses?: number
}

export interface AllowAlwaysResult {
  rule: AllowRule
  /** The question it was made from, answered (its first option). */
  item: OrchInboxItem
  /** Other questions already waiting that the rule answered too. */
  alsoAnswered: number
}

export type ReportKind = 'daily' | 'weekly'

export interface ReportShipped {
  channelName: string
  title: string
  /** `ready`: the publication kit is ready for the slot; `published`: the video was marked published. */
  state: 'ready' | 'published'
  at: string
}

export interface ReportLate {
  channelName: string
  /** The slot (ISO) the warning is about. */
  slotAt: string
  reason: string
  /** Why, in French (the planner's own words). */
  text: string
}

export interface ReportDecision {
  inboxId: number
  channelName: string | null
  title: string
  kind: OrchInboxItem['kind']
  gate: GoalGate | null
  /** Hours it has been waiting. */
  hours: number
}

export interface ReportSpend {
  channelName: string | null
  usd: number
  calls: number
}

/** The daily digest and the weekly report, computed from the real state (no model call). */
export interface TeamReport {
  kind: ReportKind
  from: string
  to: string
  shipped: ReportShipped[]
  late: ReportLate[]
  decisions: ReportDecision[]
  /** Tasks finished and stopped in the period. */
  tasks: { done: number; stopped: number }
  /** Questions approved without Charlie: by the approval levels, and by his « toujours » rules. */
  autoApproved: { level: number; rules: number }
  spend: { usd: number; calls: number; monthUsd: number; byChannel: ReportSpend[] }
  /** The same, as the text posted on Discord. */
  text: string
}

export interface AutopilotContract {
  'autopilot.power': { args: []; result: PowerView }
  /** On is refused (French message) until a Claude account passed « Vérifier ». */
  'autopilot.setPower': { args: [input: PowerInput]; result: PowerView }
  /** « Tout arrêter »: kills every run, puts their tasks back in the queue, switches the team off. */
  'autopilot.stop': { args: []; result: StopResult }
  'autopilot.activity': { args: []; result: ActivitySnapshot }
  /** The channel's goals, or null when none was proposed yet. */
  'autopilot.goals': { args: [channelId: number]; result: ChannelGoals | null }
  /** Charlie edits and / or confirms them. */
  'autopilot.saveGoals': { args: [channelId: number, input: ChannelGoalsInput]; result: ChannelGoals }
  /** Proposes them again from what Atelier read: they are `proposed` again until Charlie confirms them. */
  'autopilot.proposeGoals': { args: [channelId: number]; result: ChannelGoals }
  /** « Toujours valider pour ce type »: the rule from that question, which is answered with its first option. */
  'autopilot.allowAlways': { args: [inboxId: number, input?: AllowAlwaysInput]; result: AllowAlwaysResult }
  /** The rules that apply (of one channel, or all), newest first. */
  'autopilot.rules': { args: [channelId?: number]; result: AllowRule[] }
  /** Charlie takes a rule back: those questions reach him again. */
  'autopilot.revokeRule': { args: [id: number]; result: AllowRule }
  /** The daily digest (last 24 h) or the weekly report (last 7 days). */
  'autopilot.report': { args: [kind: ReportKind]; result: TeamReport }
}

export const AUTOPILOT_METHODS = [
  'autopilot.power',
  'autopilot.setPower',
  'autopilot.stop',
  'autopilot.activity',
  'autopilot.goals',
  'autopilot.saveGoals',
  'autopilot.proposeGoals',
  'autopilot.allowAlways',
  'autopilot.rules',
  'autopilot.revokeRule',
  'autopilot.report'
] as const satisfies readonly (keyof AutopilotContract)[]
