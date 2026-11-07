// The base pipelines Atelier ships (decision 0022), by id. Add a new one here; its test compiles every option.
import { avatarBase } from './avatar'
import { avatarChannelBase } from './avatar-channel'
import type { BasePipeline } from './types'
import { voiceoverBase } from './voiceover'
import { documentary2Base } from './documentary2'
import { storyShortBase } from './story-short'
import { povBase } from './pov'

export type { BasePipeline } from './types'
export { avatarBase, avatarOptions } from './avatar'
export { avatarChannelBase, AVATAR_CHANNEL_PROFILE, AVATAR_CHANNEL_CURVE } from './avatar-channel'
export { AVATAR_VARIANTS, avatarVariant, variantDoc, type AvatarVariant } from './avatar-variants'
export { voiceoverBase } from './voiceover'
export { documentary2Base, DOCUMENTARY2_PROFILE } from './documentary2'
export { storyShortBase, STORY_SHORT_PROFILE } from './story-short'
export { povBase, POV_PROFILE } from './pov'
export { DOCUMENTARY_PROFILE, type DocumentaryProfile } from './documentary-profile'

export const BASE_PIPELINES: readonly BasePipeline[] = [avatarBase, voiceoverBase, storyShortBase, povBase, documentary2Base, avatarChannelBase]

export function basePipeline(id: string | null): BasePipeline | undefined {
  return id === null ? undefined : BASE_PIPELINES.find((b) => b.id === id)
}

/** A copy of a base pipeline to save as the team's own: `base` names it, the options are left at their defaults. */
export function fromBase(b: BasePipeline, name?: string): BasePipeline['doc'] {
  return { ...structuredClone(b.doc), base: b.id, ...(name ? { name } : {}) }
}
