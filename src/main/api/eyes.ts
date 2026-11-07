// IPC handlers, module "eyes" (lot "eyes"): competitors, reads, outliers, analyses and the channel style profile. Every argument is
// checked here or in the store (the renderer is untrusted). Reads and analyses go through Atelier Cloud and nothing else.
import type { ApiHandlers } from '../../shared/api'
import path from 'node:path'
import type { EYES_METHODS, WatchVideoOptions } from '../../shared/api/eyes'
import { isYoutubeUrl } from '../../shared/cloud-api'
import { t } from '../../shared/fr'
import type { ApiContext } from './context'

const id = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error(what)
  return v
}

export function eyesApi(ctx: ApiContext): Pick<ApiHandlers, (typeof EYES_METHODS)[number]> {
  const { eyes } = ctx
  const channel = (v: unknown): number => id(v, t('eyes.err.unknownChannel'))
  return {
    'eyes.get': (channelId) => eyes.detail(channel(channelId)),
    'eyes.addCompetitor': (channelId, url) => eyes.addCompetitor(channel(channelId), url),
    'eyes.setWatched': (competitorId, watched) => eyes.setWatched(id(competitorId, t('eyes.err.unknownCompetitor')), watched === true),
    'eyes.removeCompetitor': (competitorId) => eyes.removeCompetitor(id(competitorId, t('eyes.err.unknownCompetitor'))),
    'eyes.read': (channelId) => eyes.read(channel(channelId)),
    'eyes.outliers': (channelId) => eyes.outliers(channel(channelId)),
    'eyes.analyse': (channelId, max) => eyes.analyse(channel(channelId), max),
    'eyes.build': (channelId, note) => eyes.build(channel(channelId), typeof note === 'string' ? note : ''),
    'eyes.save': (channelId, profile, note) => eyes.save(channel(channelId), profile, typeof note === 'string' ? note : ''),
    'eyes.version': (channelId, version) => eyes.version(channel(channelId), id(version, t('eyes.err.unknownVersion'))),
    'eyes.watchVideo': async (url, options) => {
      const o = (options && typeof options === 'object' ? options : {}) as WatchVideoOptions
      if (typeof url !== 'string' || (url.trim() !== '' && !isYoutubeUrl(url.trim()))) throw new Error('Colle un lien de vidéo YouTube public.')
      const file = typeof o.file === 'string' && path.isAbsolute(o.file) ? o.file : undefined
      if (!url.trim() && !file) throw new Error('Donne un lien de vidéo ou un fichier.')
      const maxUsd = typeof o.maxUsd === 'number' && Number.isFinite(o.maxUsd) ? Math.min(5, Math.max(0, o.maxUsd)) : undefined
      const r = await ctx.cloud.intel.watch(
        {
          ...(url.trim() ? { url: url.trim() } : {}),
          ...(file ? { file } : {}),
          ...(typeof o.title === 'string' ? { title: o.title.slice(0, 200) } : {}),
          ...(typeof o.durationS === 'number' && o.durationS > 0 ? { durationS: o.durationS } : {}),
          ...(maxUsd !== undefined ? { maxUsd } : {}),
          ...(o.refresh === true ? { refresh: true } : {}),
          ...(o.modelOnly === true ? { modelOnly: true } : {}),
          ...(typeof o.language === 'string' ? { language: o.language.slice(0, 30) } : {})
        },
        new AbortController().signal
      )
      return { line: r.line, cached: r.cached, tried: r.tried, log: r.log }
    }
  }
}
