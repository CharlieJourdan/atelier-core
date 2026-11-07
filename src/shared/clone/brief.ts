// P0 — the written brief of a clone (spec §2 P0): what the user wants, which style, the language, the test budget he
// accepts, which human inputs he can supply, whether it is his own channel.
import { z } from 'zod'
import { head } from './common'

export const CLONE_INTENTS = ['own-channel', 'copy-channel', 'copy-video', 'translate', 'inspiration', 'mix'] as const
export type CloneIntent = (typeof CLONE_INTENTS)[number]

/** Axes the user may take from a reference when he only wants inspiration or a mix. */
export const INSPIRATION_AXES = ['script', 'voice', 'presenter', 'motion', 'editing', 'sound', 'captions', 'packaging'] as const

export const BriefReference = z.object({
  url: z.string().min(1),
  kind: z.enum(['channel', 'video']),
  /** For inspiration/mix: which axes come from this reference (empty = all). */
  axes: z.array(z.enum(INSPIRATION_AXES)).default([])
})

export const Brief = z.object({
  ...head('brief'),
  intent: z.enum(CLONE_INTENTS),
  references: z.array(BriefReference).min(1),
  /** When a channel has several styles: the one the user picked, in his words (null = one style only). */
  style: z.string().nullable(),
  /** Language of the videos to make (BCP-47) and of the reference. */
  language: z.string().min(2),
  sourceLanguage: z.string().min(2).nullable(),
  /** Test budget the user accepted for the whole clone, in dollars. */
  testBudgetUsd: z.number().positive(),
  /** Human inputs he can supply. */
  humanInputs: z.object({ face: z.boolean(), voice: z.boolean(), footage: z.boolean() }),
  /** His own channel: his existing presenter and voice clones are used instead of look-alikes. */
  ownChannel: z.boolean(),
  /** The conversation lines the brief was written from (short). */
  said: z.array(z.string()).default([])
  // an older brief may still carry `reviewBeforePaid` (the pause before the first paid round, removed by decision 0110):
  // zod drops the unknown key, so it parses and is ignored
})
export type Brief = z.infer<typeof Brief>

// ── The intake conversation (chantier E): a draft brief that every free message changes ──────────────────────────────

/** The fields of the draft the conversation fills (one question each). */
export const INTAKE_FIELDS = ['intent', 'references', 'style', 'language', 'sourceLanguage', 'testBudgetUsd', 'humanInputs', 'ownChannel'] as const
export type IntakeField = (typeof INTAKE_FIELDS)[number]

/** What the conversation has understood so far. `null` = not said yet. */
export interface IntakeDraft {
  intent: CloneIntent | null
  references: z.infer<typeof BriefReference>[]
  /** `undefined` = not asked, `null` = one style only / the agent decides, a string = the user's pick. */
  style: string | null | undefined
  language: string | null
  sourceLanguage: string | null
  testBudgetUsd: number | null
  humanInputs: { face: boolean; voice: boolean; footage: boolean } | null
  ownChannel: boolean | null
}

/** One change a message made to the draft: shown to the user as « avant → après ». */
export interface IntakeChange { field: IntakeField; before: string; after: string }

export interface IntakeState {
  draft: IntakeDraft
  /** What the user said, in order (becomes `Brief.said`). */
  said: string[]
  /** The field the agent asked about last (a bare answer like « 8 » or « oui » goes there). */
  asked: IntakeField | null
  /** The agent asked which axes come from which reference; the next message answers (naming none = all). */
  axesAsked?: boolean
  /** What he can supply was answered to the question (a partial remark said unprompted does not settle it). */
  inputsSettled?: boolean
  axesAnswered?: boolean
}

/** The agent's turn: what changed (never empty when the message said something), what it still needs, the next question. */
export interface IntakeTurn {
  state: IntakeState
  changes: IntakeChange[]
  /** Copy key + values of the agent's answer, French text comes from `fr-clone.ts`. */
  reply: { key: string; vars: Record<string, string | number> }[]
  /** Fields still missing for a brief. */
  missing: IntakeField[]
  /** The next question (a copy key), or null when the brief is ready to be confirmed. */
  question: string | null
  ready: boolean
}

// ── What the screen shows while a clone works (derived from the saved artefacts, so it survives a restart) ─────────────

export const PROGRESS_STEPS = ['intake', 'channel', 'watch', 'can', 'definition', 'pipeline', 'rounds', 'example', 'report'] as const
export type ProgressStep = (typeof PROGRESS_STEPS)[number]
export type StepStatus = 'done' | 'running' | 'waiting' | 'stopped' | 'skipped'

/** One thing the clone found, as a copy key + values (`clone.progress.fact.*`), so the screen says it in plain words. */
export interface ProgressFact { key: string; vars: Record<string, string | number> }

export interface ProgressStepView {
  step: ProgressStep
  status: StepStatus
  facts: ProgressFact[]
  /** Pictures that prove it (paths under the clone folder): frames watched, matched pairs. */
  frames: string[]
}

/** What the screen draws while a clone works for hours. Built only from the saved artefacts: a restart loses nothing. */
export interface CloneProgress {
  cloneId: string
  steps: ProgressStepView[]
  spentUsd: number
  budgetUsd: number | null
  /** The one line that says what is happening now (a copy key + values). */
  now: ProgressFact
  /** Why it stopped, when it did (disk, budget, a refused check). */
  stoppedBecause: ProgressFact | null
  /** The last thing decided, newest first, a few lines: « why it did what it did ». */
  recent: { phase: string; decision: string; why: string }[]
}
