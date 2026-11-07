// The channel presenter as the app shows it (production-7, decisions 0025 and 0034, docs/specs/pipeline-avatar.md §2.5 a). Contract:
// src/shared/api/channel-presenters.ts. The renderer never gets a picture's bytes or a path: it gets what the screen needs.
import type { Framing } from './presenter-engines'

/** What the person ticks before a presenter is cloned from the channel's videos (decision 0025). */
export interface PresenterConsentInput {
  granted: boolean
  statement: 'own-channel'
  /** Who ticks (the person's name); defaults to « propriétaire ». */
  by?: string
}

/** The stored consent: who, when, what. A presenter made from words is `designed` (no one's face is copied). */
export interface PresenterConsent {
  by: string
  at: string
  statement: PresenterConsentInput['statement'] | 'designed'
}

export interface PresenterAngleView {
  framing: Framing
  /** The face-similarity score against the portrait (0..1). */
  score: number
}

export interface ChannelPresenterView {
  id: number
  channelId: number
  name: string
  method: 'portrait' | 'clone'
  description: string
  status: 'proposed' | 'active' | 'retired'
  isDefault: boolean
  hasPortrait: boolean
  /** The angles that passed the similarity check. */
  angles: PresenterAngleView[]
  /** The presenter engines this face is registered on (the ids stay in main). */
  registeredEngines: string[]
  /** The channel voice linked to this presenter, when there is one. */
  voiceId: number | null
  consent: PresenterConsent | null
}

export interface PresenterAnglesResult {
  presenter: ChannelPresenterView
  kept: PresenterAngleView[]
  /** Angles that stayed below the similarity threshold after their retry (their best score). */
  dropped: PresenterAngleView[]
  /** How the angles were checked: OpenCV face recognition (`face-id`, the director text check) or the skin-patch check (`skin`). */
  check?: 'face-id' | 'skin'
  /** The image engine the angles were made with. */
  engine?: string
}

/**
 * The image engines an angle may be edited with from the portrait (they take the portrait as a reference). GPT Image 2.5 medium by
 * default; Seedream 5.0 Lite and Nano Banana 2.1 measured on the bench (research note benchmark-2026-11 (old repository)).
 */
export const ANGLE_ENGINES = ['image:gpt-image-25-medium', 'image:seedream-50-lite', 'image:nano-banana-21'] as const
export type AngleEngine = (typeof ANGLE_ENGINES)[number]
