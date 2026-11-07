// IPC contract, module "channelSponsor" (production-9, decision 0025): the channel's sponsor asset (product, pitch, link, media,
// placement rule, QR code), read by the channel's runs as the pipeline's `sponsor` input. Every method added here must also be listed
// in CHANNEL_SPONSOR_METHODS (tests/unit/ipc.test.ts compares the list with main). Change topic: 'production' after every write.
// Errors are thrown with a French message.
import type { ChannelSponsorView } from '../channel-sponsors'

export type * from '../channel-sponsors'

export interface ChannelSponsorContract {
  /** The channel's sponsor, or null when it has none. */
  'channelSponsor.get': { args: [channelId: number]; result: ChannelSponsorView | null }
  /** Saves the channel's sponsor (refused when the text names no product); an empty text removes it. */
  'channelSponsor.set': { args: [channelId: number, text: string]; result: ChannelSponsorView | null }
}

export const CHANNEL_SPONSOR_METHODS = ['channelSponsor.get', 'channelSponsor.set'] as const
