// The Cloud of a DEMO run (moteur-doublures, decision 0109): a demo is free (decision 0102), so its client reaches only the free
// usages — the stock search (Pixabay, Pexels, Commons: 0 credit since decision 0105) and the free media search. Two locks:
//   - every other usage (voice, image, clip, presenter) is refused here, before any request leaves this computer;
//   - the HTTP client is `freeOnly`: a stock quote the Cloud would price above 0 credits is refused before a job exists.
// A demo can therefore never spend, whatever a node asks. The client never says `realRun` (a demo film stays a demo).
import { cloudHttpService, type CloudHttpOptions } from './cloud-http'
import { EngineError } from './errors'
import type { CloudService } from './services'

/** The Cloud usages a demo run may call (every other one is refused). */
export const FREE_DEMO_USAGES = ['searchStock'] as const

const refuse = (usage: string): Promise<never> =>
  Promise.reject(new EngineError('refused', `Une démo est gratuite : ${usage} n’est pas permis (seule la recherche de médias gratuits l’est).`))

/** Restricts a Cloud client to the free usages (pure wrapper; the inner client should be `freeOnly` too). */
export function freeUsagesOnly(inner: CloudService): CloudService {
  return {
    synthesize: () => refuse('synthesize'),
    generateImage: () => refuse('generateImage'),
    generateVideo: () => refuse('generateVideo'),
    talkingAvatar: () => refuse('talkingAvatar'),
    searchStock: (req, opts) => inner.searchStock(req, opts),
    ...(inner.searchMedia ? { searchMedia: inner.searchMedia.bind(inner) } : {})
  }
}

/** The demo run's Cloud client: the free usages, over a client that refuses any priced quote. */
export function demoCloudService(o: Omit<CloudHttpOptions, 'realRun' | 'freeOnly'>): CloudService {
  return freeUsagesOnly(cloudHttpService({ ...o, freeOnly: true }))
}
