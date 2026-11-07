// Which Atelier channel a YouTube channel is: the owner types a channel id (UC…), an @handle or a channel address in the
// channel's settings; Google gives the id and the handle of each channel of his account. Shared by the main process
// (google.status, google.channelStats) and the renderer (real mode maps the figures to the channels it shows).

export interface AtelierChannelRef {
  id: number
  name: string
  /** What the owner typed in the channel's settings: a UC… id, an @handle, or a channel address. */
  youtubeChannelId: string | null
}

/** The channel id or the handle an Atelier channel's « YouTube » field holds (an id, an @handle, a channel URL). */
export function parseYoutubeRef(raw: string | null): { id: string | null; handle: string | null } {
  const s = (raw ?? '').trim()
  if (!s) return { id: null, handle: null }
  const byId = /(?:^|\/channel\/)(UC[\w-]{22})(?:[/?#]|$)/.exec(s)
  if (byId) return { id: byId[1] ?? null, handle: null }
  const byHandle = /(?:^|\/)(@[\w.-]{3,100})(?:[/?#]|$)/.exec(s)
  if (byHandle) return { id: null, handle: (byHandle[1] ?? '').toLowerCase() }
  return /^[\w.-]{3,100}$/.test(s) && !s.startsWith('UC') ? { id: null, handle: `@${s.toLowerCase()}` } : { id: s, handle: null }
}

/** The Atelier channel a YouTube channel of the account feeds: same channel id first, else the same handle. */
export function matchChannel<C extends Pick<AtelierChannelRef, 'youtubeChannelId'>>(yt: { id: string; handle: string | null }, channels: readonly C[]): C | null {
  const refs = channels.map((c) => ({ c, ref: parseYoutubeRef(c.youtubeChannelId) }))
  const byId = refs.find((r) => r.ref.id !== null && r.ref.id === yt.id)
  if (byId) return byId.c
  const handle = yt.handle?.toLowerCase() ?? null
  const byHandle = handle ? refs.find((r) => r.ref.handle === handle) : undefined
  return byHandle?.c ?? null
}
