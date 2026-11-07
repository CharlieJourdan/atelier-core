// IPC handlers, module "discord": Atlas on the phone through a Discord bot (src/main/discord). One domain per file.
// The bot token comes in through `setToken` and is never returned: results only say « set / not set ».
import type { ApiHandlers } from '../../shared/api'
import type { DISCORD_METHODS } from '../../shared/api/discord'
import type { ApiContext } from './context'

type DiscordMethodKey = (typeof DISCORD_METHODS)[number]

export function discordApi(ctx: ApiContext): Pick<ApiHandlers, DiscordMethodKey> {
  const d = ctx.discord
  return {
    'discord.status': () => d.status(),
    'discord.setToken': (token) => d.setToken(token),
    'discord.clearToken': () => d.clearToken(),
    'discord.inviteUrl': () => d.inviteUrl(),
    'discord.guilds': () => d.guilds(),
    'discord.setup': (guildId) => d.setup(guildId),
    'discord.setEnabled': (enabled) => d.setEnabled(enabled === true),
    'discord.configure': (input) => d.configure(input),
    'discord.test': () => d.test()
  }
}
