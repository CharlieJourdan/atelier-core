// Discord REST v10 shapes the bridge uses (only the fields it reads) and the constants of the setup.

export const DISCORD_API = 'https://discord.com/api/v10'

/** Channel types we create or read. */
export const CHANNEL_TEXT = 0
export const CHANNEL_CATEGORY = 4
export const CHANNEL_PUBLIC_THREAD = 11

/**
 * Permission bits of the invitation: view channels, manage channels, add reactions, send messages, read history, create
 * public threads, send messages in threads (the last two are above bit 31: added, not OR-ed).
 */
export const PERMISSIONS = (1 << 10 /* view */ | 1 << 4 /* manage channels */ | 1 << 6 /* add reactions */ | 1 << 11 /* send */ | 1 << 16) /* history */ + 2 ** 35 /* create public threads */ + 2 ** 38 /* send in threads */

/** Message flags: no push or desktop notification (« @silent »); an interaction reply only its clicker sees. */
export const FLAG_SUPPRESS_NOTIFICATIONS = 1 << 12
export const FLAG_EPHEMERAL = 1 << 6

/** Message components: a row of buttons (style 1 primary, 2 secondary, 3 success, 4 danger). */
export interface DiscordButton {
  type: 2
  style: 1 | 2 | 3 | 4
  label: string
  custom_id: string
}

export interface DiscordActionRow {
  type: 1
  components: DiscordButton[]
}

export const REACT_OK = '✅'
export const REACT_NO = '❌'

export interface DiscordUser {
  id: string
  username: string
  bot?: boolean
}

export interface DiscordGuildRef {
  id: string
  name: string
  owner?: boolean
  icon?: string | null
}

export interface DiscordGuild extends DiscordGuildRef {
  owner_id?: string
}

export interface DiscordChannel {
  id: string
  type: number
  name: string
  parent_id?: string | null
  topic?: string | null
}

export interface DiscordAttachment {
  url: string
  filename?: string
}

export interface DiscordMessage {
  id: string
  channel_id: string
  content: string
  author: DiscordUser
  attachments?: DiscordAttachment[]
  message_reference?: { message_id?: string }
  timestamp?: string
  flags?: number
  components?: DiscordActionRow[]
}

/** A button click, as the gateway hands it over (INTERACTION_CREATE, type 3). */
export interface DiscordInteraction {
  id: string
  token: string
  type: number
  channel_id?: string
  data?: { custom_id?: string; component_type?: number }
  message?: { id: string; channel_id?: string; content?: string }
  member?: { user?: DiscordUser }
  user?: DiscordUser
}

export interface DiscordApplication {
  id: string
  name?: string
}

/** A snowflake compared as a number without losing precision. */
export function snowflakeCompare(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length
  return a < b ? -1 : a > b ? 1 : 0
}

export function maxSnowflake(a: string, b: string): string {
  return snowflakeCompare(a, b) >= 0 ? a : b
}
