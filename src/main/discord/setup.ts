// Discord setup: the invitation link, the servers the bot is in, and « Tout créer » — the category « Atelier » with
// #atlas, #à-valider, #production and one room per YouTube channel. Idempotent: ids stored by an earlier run, then names,
// are reused; only what is missing is created. Bots cannot create servers any more: the person creates (or picks) one
// and invites the bot with the link.
import type { DiscordGuild, DiscordInvite, DiscordRoomStatus, DiscordSetupResult } from '../../shared/api/discord'
import { t } from '../../shared/fr'
import type { DiscordRest } from './rest'
import { isSetUp, type DiscordState, type StateStore } from './state'
import { CHANNEL_CATEGORY, CHANNEL_TEXT, PERMISSIONS, type DiscordChannel } from './types'

export const CATEGORY_NAME = 'Atelier'
export const ATLAS_NAME = 'atlas'
export const APPROVALS_NAME = 'à-valider'
export const PRODUCTION_NAME = 'production'
const RESERVED = new Set([ATLAS_NAME, APPROVALS_NAME, PRODUCTION_NAME])

export interface AtelierChannel {
  id: number
  name: string
}

/** Discord's own normalisation of a text channel name: lowercase, spaces to dashes, no odd characters. */
export function channelSlug(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFC')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
  return s || 'chaine'
}

export async function inviteUrl(rest: DiscordRest, store: StateStore): Promise<DiscordInvite> {
  const st = store.get()
  if (!st.applicationId) {
    st.applicationId = (await rest.application()).id
    store.save()
  }
  const url = new URL('https://discord.com/oauth2/authorize')
  url.searchParams.set('client_id', st.applicationId)
  url.searchParams.set('scope', 'bot')
  url.searchParams.set('permissions', String(PERMISSIONS))
  return { applicationId: st.applicationId, url: url.toString() }
}

export async function listGuilds(rest: DiscordRest): Promise<DiscordGuild[]> {
  return (await rest.guilds()).map((g) => ({ id: g.id, name: g.name, owner: g.owner === true }))
}

export function roomStatuses(st: DiscordState, channels: readonly AtelierChannel[]): DiscordRoomStatus[] {
  const out: DiscordRoomStatus[] = []
  if (st.atlasId) out.push({ key: 'atlas', name: ATLAS_NAME, discordId: st.atlasId, channelId: null })
  if (st.approvalsId) out.push({ key: 'approvals', name: APPROVALS_NAME, discordId: st.approvalsId, channelId: null })
  if (st.productionId) out.push({ key: 'production', name: PRODUCTION_NAME, discordId: st.productionId, channelId: null })
  for (const c of channels) {
    const room = st.rooms[String(c.id)]
    if (room) out.push({ key: 'room', name: room.name, discordId: room.discordId, channelId: c.id })
  }
  return out
}

export async function runSetup(
  rest: DiscordRest,
  store: StateStore,
  guildId: string,
  channels: readonly AtelierChannel[]
): Promise<DiscordSetupResult> {
  if (!/^\d{5,25}$/.test(guildId)) throw new Error(t('discord.err.badGuild'))
  const inGuild = (await rest.guilds()).find((g) => g.id === guildId)
  if (!inGuild) throw new Error(t('discord.err.notInGuild'))
  const guild = await rest.guild(guildId)
  const st = store.get()
  if (st.guildId !== null && st.guildId !== guildId) {
    // Another server: the earlier layout does not apply there.
    Object.assign(st, { categoryId: null, atlasId: null, approvalsId: null, productionId: null, rooms: {}, cursors: {}, mirrored: {}, posted: {}, threads: {}, allowedUserIds: [] })
  }
  st.guildId = guildId
  st.guildName = guild.name
  if (st.allowedUserIds.length === 0 && guild.owner_id) st.allowedUserIds = [guild.owner_id]

  const existing = await rest.channels(guildId)
  let created = 0
  let reused = 0

  let category: DiscordChannel | undefined =
    existing.find((c) => c.type === CHANNEL_CATEGORY && c.id === st.categoryId) ??
    existing.find((c) => c.type === CHANNEL_CATEGORY && c.name.toLowerCase() === CATEGORY_NAME.toLowerCase())
  if (category) reused++
  else {
    category = await rest.createCategory(guildId, CATEGORY_NAME)
    existing.push(category)
    created++
  }
  st.categoryId = category.id
  const parentId = category.id

  /** Finds the text channel (stored id, then name under the category) or creates it; a new one gets a welcome line. */
  const ensure = async (storedId: string | null | undefined, name: string, topic: string, welcome: string): Promise<DiscordChannel> => {
    const found =
      existing.find((c) => c.type === CHANNEL_TEXT && c.id === storedId) ??
      existing.find((c) => c.type === CHANNEL_TEXT && c.parent_id === parentId && c.name === name)
    if (found) {
      reused++
      return found
    }
    const ch = await rest.createTextChannel(guildId, name, parentId, topic)
    existing.push(ch)
    created++
    // The first line is the starting point of the channel's cursor: what the person writes after it is read.
    const first = await rest.postMessage(ch.id, welcome)
    st.cursors[ch.id] = first.id
    return ch
  }

  const atlas = await ensure(st.atlasId, ATLAS_NAME, t('discord.topic.atlas'), t('discord.welcome.atlas'))
  const approvals = await ensure(st.approvalsId, APPROVALS_NAME, t('discord.topic.approvals'), t('discord.welcome.approvals'))
  const production = await ensure(st.productionId, PRODUCTION_NAME, t('discord.topic.production'), t('discord.welcome.production'))
  st.atlasId = atlas.id
  st.approvalsId = approvals.id
  st.productionId = production.id

  const taken = new Set(RESERVED)
  const rooms: DiscordState['rooms'] = {}
  for (const c of channels) {
    let name = channelSlug(c.name)
    if (taken.has(name)) name = `chaine-${name}`
    const stored = st.rooms[String(c.id)]
    // A room keeps its stored name (the person may have renamed the channel in Discord).
    const ch = await ensure(stored?.discordId, stored ? existing.find((x) => x.id === stored.discordId)?.name ?? name : name, t('discord.topic.room', { name: c.name }), t('discord.welcome.room', { name: c.name }))
    taken.add(ch.name)
    rooms[String(c.id)] = { discordId: ch.id, name: ch.name }
  }
  st.rooms = rooms
  store.save()
  return { created, reused, guild: { id: guildId, name: guild.name }, channels: roomStatuses(st, channels) }
}

export { isSetUp }
