// A channel's clip library (clone-reddit-shorts): the vertical clips a background pipeline cuts its pictures from, and the round
// avatar of its post card. Shared by main and the renderer.

/** Where the library's clips came from. */
export type ClipLibrarySource = 'stock' | 'own'

export interface ChannelClipsView {
  channelId: number
  /** The folder a run of the channel reads (`gameplay` input). */
  folder: string
  clips: number
  fromStock: number
  own: number
  /** The avatar picture, or null (the post card then draws the channel's initial). */
  avatar: string | null
  /** The channel's own music under its story shorts, or null (the library's). */
  music: string | null
}
