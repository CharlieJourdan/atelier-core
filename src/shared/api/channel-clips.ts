// IPC contract, module "channelClips" (clone-reddit-shorts): a channel's clip library (free stock videos found once through Atelier
// Cloud, or the owner's own clips) and the avatar of its post card, read by the channel's runs as the pipeline's `gameplay` and
// `channelAvatar` inputs. Every method added here must also be listed in CHANNEL_CLIPS_METHODS (tests/unit/ipc.test.ts compares the list with
// main). Change topic: 'production' after every write. Errors are thrown with a French message.
import type { ChannelClipsView } from '../channel-clips'

export type * from '../channel-clips'

export interface ChannelClipsContract {
  /** What the channel's library holds. */
  'channelClips.get': { args: [channelId: number]; result: ChannelClipsView }
  /**
   * Fills the library from free videos: `cloud` (portrait stock through Atelier Cloud — Pixabay, Pexels —, about 0.002 $ a search) or `commons`
   * (Wikimedia Commons, free, landscape cropped to 9:16, a credit line per clip); `count` per search (≤ 10), the given searches or the
   * « satisfying » ones.
   */
  'channelClips.fromStock': {
    args: [channelId: number, req?: { queries?: string[]; count?: number; source?: 'cloud' | 'commons' }]
    result: ChannelClipsView & { added: number; credits: number }
  }
  /** Adds the owner's own clips (full paths of video files). */
  'channelClips.addFiles': { args: [channelId: number, files: string[]]; result: ChannelClipsView & { added: number } }
  /** Sets the round picture of the post card (a png, jpg or webp). */
  'channelClips.setAvatar': { args: [channelId: number, file: string]; result: ChannelClipsView }
  /** Sets the channel's own music (mp3, m4a, wav, flac or ogg), played under its story shorts instead of the library. */
  'channelClips.setMusic': { args: [channelId: number, file: string]; result: ChannelClipsView }
}

export const CHANNEL_CLIPS_METHODS = ['channelClips.get', 'channelClips.fromStock', 'channelClips.addFiles', 'channelClips.setAvatar', 'channelClips.setMusic'] as const
