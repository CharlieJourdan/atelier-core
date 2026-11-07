// IPC contract, module "discord": Atlas (the principal agent) on the phone through a Discord bot (src/main/discord).
// The bot token is a secret: `setToken` stores it encrypted, nothing ever returns it (the renderer only sees « set / not
// set »). Off by default: nothing runs without a token, a created server layout and the explicit toggle.
// Every method added here must also be listed in DISCORD_METHODS (tests/unit/discord-api.test.ts counts them).

export type DiscordRoomKey = 'atlas' | 'approvals' | 'production' | 'room'

export interface DiscordRoomStatus {
  key: DiscordRoomKey
  /** The Discord channel's name (`atlas`, `à-valider`, `production`, or the YouTube channel's). */
  name: string
  discordId: string
  /** Atelier channel id for a `room`, else null. */
  channelId: number | null
}

export interface DiscordStatus {
  /** A bot token is stored (its value is never sent to the renderer). */
  tokenSet: boolean
  bot: { id: string; name: string } | null
  applicationId: string | null
  /** The Discord server the layout was created in. */
  guild: { id: string; name: string } | null
  /** The category and channels created (empty before « Tout créer »). */
  channels: DiscordRoomStatus[]
  /** Discord user ids allowed to talk to Atlas and approve (default: the server's owner). */
  allowedUserIds: string[]
  /** The bridge is switched on (persisted). */
  enabled: boolean
  /** The polling loop is running right now. */
  running: boolean
  /** Hour (0–23, local time) of the daily summary; null = no summary. */
  summaryHour: number | null
  lastPollAt: string | null
  lastError: string | null
  /** The agent team is switched on (`orchestra.enabled`): without it Atlas receives the messages but never answers. */
  teamOn: boolean
  /** Messages arrive empty: the « Message Content Intent » is off in the Discord developer portal. */
  contentIntentMissing: boolean
  /** Which posts ping the phone: only decisions and alerts (default), everything, or nothing. */
  notifications: DiscordNotifications
  /** ISO weekday (1 = Monday) of the weekly report in #atlas, at the summary hour; null = none. */
  weeklyDay: number | null
  /** The buttons « Valider une fois / Refuser / Toujours valider » work right now (the live connection is up). */
  buttonsLive: boolean
}

export type DiscordNotifications = 'important' | 'everything' | 'nothing'

export interface DiscordGuild {
  id: string
  name: string
  /** The bot is allowed to create channels there (always true once the invitation was accepted). */
  owner: boolean
}

export interface DiscordInvite {
  applicationId: string
  /** OAuth2 link (scope bot, permissions: view, send, manage channels, add reactions, read history). */
  url: string
}

export interface DiscordSetupResult {
  created: number
  reused: number
  guild: { id: string; name: string }
  channels: DiscordRoomStatus[]
}

export interface DiscordConfigInput {
  /** 0–23, or null for no daily summary. */
  summaryHour?: number | null
  /** Discord user ids (17–20 digits). */
  allowedUserIds?: string[]
  notifications?: DiscordNotifications
  /** 1–7 (Monday = 1), or null for no weekly report. */
  weeklyDay?: number | null
}

export interface DiscordTestResult {
  ok: boolean
  /** The channel the test message was posted in. */
  channel: string
}

export interface DiscordContract {
  'discord.status': { args: []; result: DiscordStatus }
  /** Checks the token with Discord, then stores it encrypted. Throws a clear message when Discord refuses it. */
  'discord.setToken': { args: [token: string]; result: DiscordStatus }
  /** Forgets the token and switches the bridge off. */
  'discord.clearToken': { args: []; result: DiscordStatus }
  'discord.inviteUrl': { args: []; result: DiscordInvite }
  /** The servers the bot has been invited to. */
  'discord.guilds': { args: []; result: DiscordGuild[] }
  /** Creates (or reuses) the category « Atelier » and its channels in that server; idempotent. */
  'discord.setup': { args: [guildId: string]; result: DiscordSetupResult }
  'discord.setEnabled': { args: [enabled: boolean]; result: DiscordStatus }
  'discord.configure': { args: [input: DiscordConfigInput]; result: DiscordStatus }
  /** Posts a test message in #atlas. */
  'discord.test': { args: []; result: DiscordTestResult }
}

export const DISCORD_METHODS = [
  'discord.status',
  'discord.setToken',
  'discord.clearToken',
  'discord.inviteUrl',
  'discord.guilds',
  'discord.setup',
  'discord.setEnabled',
  'discord.configure',
  'discord.test'
] as const satisfies readonly (keyof DiscordContract)[]
