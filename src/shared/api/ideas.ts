// IPC contract, module "ideas" (lot Z1): ideas and automations of the Production section.
// Every method added here must also be listed in IDEAS_METHODS and counted, with a comment, in its area's unit test.

export const IDEA_STATUSES = ['new', 'kept', 'rejected', 'used'] as const
export type IdeaStatus = (typeof IDEA_STATUSES)[number]

export interface IdeaRow {
  id: number
  channelId: number
  channelName: string
  title: string
  angle: string
  /** 'agent': proposed by the ideas agent (« Trouver des idées »); 'manual': typed by the user. */
  source: 'manual' | 'agent'
  /** 0–100, the agent's own estimate of the idea's potential (null for manual ideas). */
  score: number | null
  status: IdeaStatus
  /** The video created from the idea (« Créer la vidéo »). */
  videoId: number | null
  example: boolean
  createdAt: string
}

export interface IdeaInput {
  channelId: number
  title: string
  angle?: string
}

export interface IdeaPatch {
  title?: string
  angle?: string
  status?: IdeaStatus
}

export const CADENCES = ['manual', 'daily', 'weekly'] as const
export type Cadence = (typeof CADENCES)[number]

export interface AutomationRow {
  id: number
  name: string
  channelId: number
  channelName: string
  cadence: Cadence
  /** 0 = Sunday … 6 = Saturday (weekly only). */
  weekday: number | null
  /** Local hour of the firing (daily / weekly). */
  hour: number
  /** 'ideas': the channel's next kept idea (else its newest new idea); 'fixed': `topic`. */
  topicFrom: 'ideas' | 'fixed'
  topic: string
  minutes: number
  budgetMode: 'usage_max' | 'qualite_max'
  gateMode: 'step' | 'all'
  enabled: boolean
  lastRunAt: string | null
  /** Next firing (null for manual or disabled automations). */
  nextRunAt: string | null
  example: boolean
}

export type AutomationInput = Omit<AutomationRow, 'id' | 'channelName' | 'lastRunAt' | 'nextRunAt' | 'example'>
export type AutomationPatch = Partial<AutomationInput>

export interface AutomationRunRow {
  id: number
  automationId: number
  videoId: number | null
  runId: number | null
  status: 'started' | 'skipped' | 'failed'
  message: string
  example: boolean
  createdAt: string
}

export interface IdeasContract {
  'ideas.list': { args: [channelId?: number]; result: IdeaRow[] }
  'ideas.create': { args: [input: IdeaInput]; result: IdeaRow }
  'ideas.update': { args: [id: number, patch: IdeaPatch]; result: IdeaRow }
  'ideas.delete': { args: [id: number]; result: void }
  /** Asks the ideas agent (the user's Claude Code) for `count` new ideas for a channel. */
  'ideas.generate': { args: [channelId: number, count?: number]; result: IdeaRow[] }
  /** Creates a plain video row from the idea (no agent task) and marks the idea used. */
  'ideas.toVideo': { args: [id: number]; result: IdeaRow }
  'automations.list': { args: []; result: AutomationRow[] }
  'automations.create': { args: [input: AutomationInput]; result: AutomationRow }
  'automations.update': { args: [id: number, patch: AutomationPatch]; result: AutomationRow }
  'automations.delete': { args: [id: number]; result: void }
  /** Fires the automation now: picks the topic, creates the video and starts a run of our engine. */
  'automations.runNow': { args: [id: number]; result: AutomationRunRow }
  'automations.history': { args: [id?: number]; result: AutomationRunRow[] }
}

export const IDEAS_METHODS = [
  'ideas.list',
  'ideas.create',
  'ideas.update',
  'ideas.delete',
  'ideas.generate',
  'ideas.toVideo',
  'automations.list',
  'automations.create',
  'automations.update',
  'automations.delete',
  'automations.runNow',
  'automations.history'
] as const satisfies readonly (keyof IdeasContract)[]
