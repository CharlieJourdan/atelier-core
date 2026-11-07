// Ready bases the cloning engine may START from (Charlie, 2026-11-04; MOTEUR-CLONAGE.md « Start from an existing base »):
// a base is the measured style of a kind of channel Atelier already does well, with the pipeline that runs it. P4 starts
// from the base that fits the analysis (base-match.ts) and checks every one of its settings against THIS channel's
// measurements (base-start.ts): a setting is kept only when it is measured equal, everything else is replaced. A base never
// supplies what the user says (presenter, voice, language, cost target) nor a value nothing measured here. Pure data + types.
import type { Evidence } from '../../../../shared/clone'
import { AVATAR_MARCEL_STYLE } from './bases/avatar-marcel'

/** One measured setting of a base: its value and where it was measured (the base's own references). */
export interface BaseField { value: unknown; evidence: Evidence[] }

/** An improvement a base's own comparison rounds earned (P8 on its references): `target` went from `before` to `after` and the
 *  blind judge scored better. It transfers to a clone whose measurement of `target` equals `before` (the same situation). */
export interface EarnedChange { round: number; target: string; before: unknown; after: unknown; why: string; sheet: string }

/** What the base's own renders proved (null: measured but never rendered and compared yet). */
export interface BaseProof {
  /** Comparison rounds the base went through on its references (each one a render + a blind judgement). */
  rounds: number
  /** The blind judge's last answer on the base's references. */
  sameChannel: boolean
  /** Measured on its real runs. */
  usdPerMinute: number
  makeMinutesPerMinute: number
  /** Where the rounds are saved. */
  where: string
}

export interface ReadyBase {
  /** `avatar-marcel`: stable id recorded in every definition started from it. */
  id: string
  /** The base pipeline that runs it (BASE_PIPELINES id): its bricks are the starting point of P5. */
  pipelineId: string
  /** What it is good for, in words (shown in the decision log and the report). */
  goodFor: string
  /** Where its measured style comes from. */
  source: string
  /** Its measured style, by Style Definition path (only measured fields). */
  style: Readonly<Record<string, BaseField>>
  /** Improvements its own rounds earned (empty until it has been rendered and compared). */
  earned: readonly EarnedChange[]
  proof: BaseProof | null
}

/** The avatar base: a talking presenter (full in the hook, then split / inset over the pictures) + pictures that illustrate
 *  every sentence, few motion cards, no music. Measured on Marcel's references; its pipeline is « Chaîne avatar » avatar@2 (decision 0104); not render-proven as a base yet (chantier
 *  « Avatar · base Marcel » proves it and records its rounds here). */
export const AVATAR_MARCEL: ReadyBase = {
  id: 'avatar-marcel',
  pipelineId: 'avatar@2',
  goodFor: 'a presenter who talks to camera (full in the hook, then half / inset over the pictures) with pictures that illustrate every sentence, few motion cards',
  source: 'Marcel (Charlie\'s own channel), two reference videos measured by P2/P4 (moteur-definition)',
  style: AVATAR_MARCEL_STYLE,
  earned: [],
  proof: null
}

/** The bases the engine ships, in the order they are tried. Add one here when a kind of channel is done well. */
export const READY_BASES: readonly ReadyBase[] = [AVATAR_MARCEL]
