// « Moteur réel » in the app and in the headless brain (production-16, decision 0044): what ProductionRuns gets of Atelier
// Cloud. A run can go real while the app (or the brain) is signed in to a Cloud; its quote is checked against the Cloud's
// wallet and its paid bricks go through the production host's Cloud client (host.ts `forCloudRun`).
import type { ProductionHost } from './host'
import { notSignedIn, type CloudRunsPort } from './runs/cloud'
import type { CloudApi, CloudSession } from '../cloud'

export function cloudRunsPort(o: { host: ProductionHost; session: Pick<CloudSession, 'connected'>; api: Pick<CloudApi, 'wallet' | 'job'> }): CloudRunsPort {
  return {
    state: () => (o.session.connected() ? { available: true, reason: '' } : notSignedIn()),
    // the client's refusals are French already (unreachable, signed out…); nothing is paid by a refused quote
    balance: async () => {
      const w = await o.api.wallet()
      return { available: w.available, held: w.held, total: w.balance, simulated: 0, example: 0 }
    },
    job: (id) => o.api.job(id),
    // a demo run reaches the free stock search only (decision 0109): its found stand-ins
    forDemoRun: (r) => (o.session.connected() ? o.host.forDemoRun(r) : null),
    forRun: (r) => {
      const host = o.host.forCloudRun({
        dataDir: r.dataDir,
        resourcesDir: r.resourcesDir,
        tags: { videoId: r.videoId, channelId: r.channelId, capCredits: r.capCredits, ...(r.run ? { run: r.run } : {}) },
        onJob: r.onJob
      })
      if (!host) throw new Error(notSignedIn().reason)
      return host
    }
  }
}
