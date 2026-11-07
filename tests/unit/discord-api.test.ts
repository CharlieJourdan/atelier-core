// IPC module "discord": every method, listed one by one, and the handlers through the real `atelier:call` dispatcher
// (errors as envelopes), on an in-memory core with a fake Discord. The token goes in and never comes out.
import { afterEach, describe, expect, it } from 'vitest'
import { API_METHODS } from '../../src/shared/api'
import { DISCORD_METHODS } from '../../src/shared/api/discord'
import { FakeDiscord } from '../../src/main/discord/fake'
import { handleCall } from '../../src/main/ipc'
import { memoryCore } from './helpers'

const TOKEN = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OQ' + '.GabcDE.abcdefghijklmnopqrstuvwxyz0123456789'

const open: ReturnType<typeof memoryCore>[] = []
afterEach(() => {
  for (const c of open.splice(0)) c.close()
})

describe('discord IPC', () => {
  it('lists its 9 methods, all in the contract', () => {
    expect([...DISCORD_METHODS]).toEqual([
      'discord.status', // token set / not set, bot, server, channels, bridge on/off, last pass and error
      'discord.setToken', // checks the token with Discord, stores it encrypted; never returned
      'discord.clearToken', // forgets the token and switches the bridge off
      'discord.inviteUrl', // OAuth2 link: scope bot, view / send / manage channels / reactions / history
      'discord.guilds', // the servers the bot has been invited to
      'discord.setup', // « Tout créer »: category Atelier, #atlas, #à-valider, #production, one room per channel (idempotent)
      'discord.setEnabled', // the explicit switch of the bridge (needs a token and created channels)
      'discord.configure', // daily summary hour, allowed Discord users
      'discord.test' // a test message in #atlas
    ])
    for (const m of DISCORD_METHODS) expect(API_METHODS).toContain(m)
  })

  it('walks the whole setup through atelier:call and never returns the token', async () => {
    const fake = new FakeDiscord(TOKEN)
    const guild = fake.addGuild('Mon serveur')
    const core = memoryCore({ discord: { fetch: fake.fetch, sleep: async () => undefined } })
    open.push(core)
    core.context.workflow.channels.create({ name: 'Histoire' })
    const results: unknown[] = []
    const call = async <T>(m: string, ...args: unknown[]): Promise<T> => {
      const res = await handleCall(core.api, m, args)
      if (!res.ok) throw new Error(`${m}: ${res.error.message}`)
      results.push(res.value)
      return res.value as T
    }
    expect(await call('discord.status')).toMatchObject({ tokenSet: false, enabled: false, running: false, channels: [] })
    const bad = await handleCall(core.api, 'discord.setToken', ['pas un jeton'])
    expect(bad.ok).toBe(false)
    expect(await call('discord.setToken', TOKEN)).toMatchObject({ tokenSet: true, bot: { name: 'AtelierBot' } })
    expect(await call<{ url: string }>('discord.inviteUrl')).toMatchObject({ url: expect.stringContaining('scope=bot') })
    expect(await call('discord.guilds')).toEqual([{ id: guild.id, name: 'Mon serveur', owner: false }])
    const refused = await handleCall(core.api, 'discord.setEnabled', [true])
    expect(refused.ok).toBe(false)
    expect(await call('discord.setup', guild.id)).toMatchObject({ created: 5, reused: 0 })
    expect(await call('discord.configure', { summaryHour: 18 })).toMatchObject({ summaryHour: 18 })
    expect(await call('discord.test')).toEqual({ ok: true, channel: 'atlas' })
    expect(fake.botMessages(fake.channel(guild.id, 'atlas')?.id as string).at(-1)?.content).toContain('Test réussi')
    const on = await call<{ enabled: boolean; running: boolean }>('discord.setEnabled', true)
    expect(on).toMatchObject({ enabled: true, running: true })
    expect(await call('discord.setEnabled', false)).toMatchObject({ enabled: false, running: false })
    expect(await call('discord.clearToken')).toMatchObject({ tokenSet: false })
    expect(JSON.stringify(results)).not.toContain(TOKEN)
    const bare = await handleCall(core.api, 'discord.inviteUrl', [])
    expect(bare.ok).toBe(false)
  })

  it('nothing runs on a fresh core: no timer, no request', () => {
    const fake = new FakeDiscord(TOKEN)
    const core = memoryCore({ discord: { fetch: fake.fetch } })
    open.push(core)
    expect(core.discord.bridge.running).toBe(false)
    expect(fake.calls).toHaveLength(0)
  })
})
