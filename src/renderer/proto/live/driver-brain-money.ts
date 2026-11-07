// Real mode, Cerveau and Monétisation, the IPC side: reads the ideas and the money facts for a snapshot, and sends the
// user's actions (create / edit / delete / generate an idea, launch it as a video, enter a revenue, type a subscription
// price) to the main process. Only used in the desktop app. The mappings are in mapping-brain.ts / mapping-money.ts.
import { call } from '@/state/client'
import type { RunSummary } from '../../../shared/runs'
import type { ChannelRow, VideoRow } from '../../../shared/workflow'
import { mapIdeas } from './mapping-brain'
import { mapGoogle, type LiveGoogle } from './mapping-google'
import { mapSubscriptions, mapVideoCosts, subscriptionsSetting, SUBSCRIPTIONS_SETTING, type LiveMoney } from './mapping-money'
import type { LiveBrainDriver, LiveMoneyDriver, LiveSnapshot } from './registry'

/** The owner's YouTube figures through Google, matched to the channels; undefined when they could not be read. */
export async function loadGoogle(channels: readonly ChannelRow[]): Promise<LiveGoogle | undefined> {
  try {
    return mapGoogle(await call('google.channelStats'), channels)
  } catch {
    return undefined
  }
}

/** The ideas board of every channel; null when the ideas could not be read (the screen then says so). */
async function loadIdeas(): Promise<LiveSnapshot['ideas']> {
  try {
    return mapIdeas(await call('ideas.list'))
  } catch {
    return undefined
  }
}

async function loadMoney(runs: readonly RunSummary[], videos: readonly VideoRow[], google: LiveGoogle | undefined): Promise<LiveMoney | undefined> {
  try {
    const [overview, spend, perVideo, revenues, subscriptions] = await Promise.all([
      call('money.overview'),
      call('spend.overview'),
      call('spend.summary', 'video'),
      call('money.revenues.list'),
      call('settings.get', SUBSCRIPTIONS_SETTING)
    ])
    return {
      overview,
      spend,
      videoCosts: mapVideoCosts(perVideo, runs, videos),
      revenues: revenues.filter((r) => r.source !== 'example' && !r.example),
      subscriptions: mapSubscriptions(subscriptions),
      ...(google ? { google } : {})
    }
  } catch {
    return undefined
  }
}

/** What a snapshot adds for Cerveau and Monétisation (a part that failed to load is left out, not invented). */
export async function loadBrainMoney(runs: readonly RunSummary[], videos: readonly VideoRow[], google?: LiveGoogle): Promise<Pick<LiveSnapshot, 'ideas' | 'money'>> {
  const [ideas, money] = await Promise.all([loadIdeas(), loadMoney(runs, videos, google)])
  return { ...(ideas ? { ideas } : {}), ...(money ? { money } : {}) }
}

export const brainDriver: LiveBrainDriver = {
  createIdea: (input) => call('ideas.create', input),
  updateIdea: (id, patch) => call('ideas.update', id, patch),
  deleteIdea: async (id) => {
    await call('ideas.delete', id)
  },
  generateIdeas: (channelId, count) => call('ideas.generate', channelId, count),
  ideaToVideo: (id) => call('ideas.toVideo', id)
}

export const moneyDriver: LiveMoneyDriver = {
  saveRevenue: (input) => call('money.revenues.save', input),
  deleteRevenue: async (id) => {
    await call('money.revenues.delete', id)
  },
  setSubscriptions: async (prices) => {
    await call('settings.set', SUBSCRIPTIONS_SETTING, subscriptionsSetting(prices))
  }
}
