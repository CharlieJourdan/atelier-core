// IPC contract, module "channelPresenters" (production-7, decision 0025): the presenter of a channel, made once (`portrait`
// from a description with the image engine, or `clone` from frames of the channel's own videos with the consent tick),
// given angles that keep the same face (each kept only when the similarity check passes) and registered per presenter engine.
// Every method added here must also be listed in CHANNEL_PRESENTERS_METHODS (tests/unit/ipc.test.ts compares the list with
// main). Change topic: 'production' after every write. Errors are thrown with a French message.
import type { ChannelPresenterView, PresenterAnglesResult, PresenterConsentInput } from '../channel-presenters'

export type * from '../channel-presenters'

export interface ChannelPresentersContract {
  /** The channel's presenters (active and proposed first, the default one on top). */
  'channelPresenters.list': { args: [channelId: number]; result: ChannelPresenterView[] }
  /** Makes a presenter from an art-direction description (style `presenter-studio`); it becomes the default when the channel has none. */
  'channelPresenters.portrait': { args: [input: { channelId: number; name: string; description: string }]; result: ChannelPresenterView }
  /** Makes a presenter from frames of the channel's own videos (picked by the eyes); refused without the consent tick, PROPOSED until accepted. */
  'channelPresenters.clone': { args: [input: { channelId: number; name: string; frames: string[]; consent: PresenterConsentInput }]; result: ChannelPresenterView }
  /** 3 to 6 angles of the same person, made from the portrait; each is kept only when its face-similarity check passes. */
  'channelPresenters.angles': { args: [presenterId: number, input?: { count?: number; engine?: string }]; result: PresenterAnglesResult }
  /** « Nettoyer le portrait »: the image engine remakes the portrait sharper (same face, outfit, room); kept only when the
   *  face-similarity check passes, the original kept beside it, the registrations reset. */
  'channelPresenters.clean': { args: [presenterId: number]; result: { presenter: ChannelPresenterView; demo: boolean; score: number } }
  /** Records the id of the presenter's face on a presenter engine (`presenter:*`). */
  'channelPresenters.register': { args: [presenterId: number, engine: string, id: string]; result: ChannelPresenterView }
  /** Accepts a proposed presenter: it becomes active and the channel's default. */
  'channelPresenters.accept': { args: [presenterId: number]; result: ChannelPresenterView }
  /** Makes an active presenter the one the channel's videos use. */
  'channelPresenters.setDefault': { args: [presenterId: number]; result: ChannelPresenterView }
  /** Retires a presenter (kept for the videos already made, never used again). */
  'channelPresenters.retire': { args: [presenterId: number]; result: ChannelPresenterView }
  /** Links a presenter to one of the channel's voices (null: unlinks). */
  'channelPresenters.linkVoice': { args: [presenterId: number, voiceId: number | null]; result: ChannelPresenterView }
}

export const CHANNEL_PRESENTERS_METHODS = [
  'channelPresenters.list',
  'channelPresenters.portrait',
  'channelPresenters.clone',
  'channelPresenters.angles',
  'channelPresenters.clean',
  'channelPresenters.register',
  'channelPresenters.accept',
  'channelPresenters.setDefault',
  'channelPresenters.retire',
  'channelPresenters.linkVoice'
] as const satisfies readonly (keyof ChannelPresentersContract)[]
