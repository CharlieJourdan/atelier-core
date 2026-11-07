// The app's calls to Atelier Cloud outside the engine (account, catalogue, wallet, one job), through the engine's shared
// caller (src/engine/cloud-http.ts: HTTP, contract checks and error mapping). An unreachable Cloud keeps the French
// UNREACHABLE message; a signed-out app gets the session's French message. Also maps the catalogue to the app's
// feature registry (src/shared/features.ts).
import type { z } from 'zod'
import { ENGINES_ROUTE, EnginesResponse } from '../../shared/cloud-engines'
import { KitWithLinks } from '../../shared/cloud-kit'
import { MEDIA_ROUTES, MediaWatchRequest, MediaWatchResponse } from '../../shared/cloud-media'
import { BillingResponse, BlueprintResponse, CatalogResponse, EstimateResponse, Invite, InvitesResponse, Job, MeResponse, MembersResponse, OkResponse, WalletResponse } from '../../shared/cloud-api'
import type { CloudCatalog, CloudFunctionId } from '../../shared/features'
import type { CloudAccount, CloudProfile, CloudTeam, CloudTeamInvite } from '../../shared/api'
import type { Usage } from '../../shared/cloud-api'
import { EngineError } from '../../engine/errors'
import { plainCloudError, type CloudSession } from './session'

export type Catalog = z.infer<typeof CatalogResponse>
export type Wallet = z.infer<typeof WalletResponse>
export type CloudJob = z.infer<typeof Job>

const REQUEST_TIMEOUT_MS = 15_000

/** Which feature of the registry each Cloud usage makes real (the platform's Claude API has none yet). */
export const USAGE_FEATURES: Record<Usage, CloudFunctionId> = {
  synthesize: 'voice-platform',
  generateImage: 'image-generation',
  generateVideo: 'video-generation',
  talkingAvatar: 'avatar',
  channelData: 'youtube-research',
  analyseVideo: 'video-analysis',
  submitGpuJob: 'gpu-render',
  searchStock: 'stock-media',
  cloneVoice: 'voice-platform',
  designVoice: 'voice-platform'
}

/** The registry's view of a catalogue: a function is real when its provider is real and paid calls are on. */
export function catalogToFeatures(catalog: Catalog, wallet: Pick<Wallet, 'available'>): CloudCatalog {
  const functions: CloudCatalog['functions'] = {}
  for (const p of catalog.providers) {
    const id = USAGE_FEATURES[p.usage]
    // several providers for one usage: one real one is enough
    if (functions[id] === 'real') continue
    functions[id] = p.status === 'real' && catalog.paidCalls ? 'real' : 'demo'
  }
  return { functions, hasCredits: wallet.available > 0 }
}

export class CloudApi {
  constructor(readonly session: CloudSession) {}

  /** One call; an access token the Cloud refuses is refreshed once (a refused refresh signs the app out). */
  private async get<T>(url: string, schema: z.ZodType<T>, method: 'GET' | 'POST' = 'GET', body?: unknown, o: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
    const signal = (): AbortSignal => (o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(o.timeoutMs ?? REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(o.timeoutMs ?? REQUEST_TIMEOUT_MS))
    const once = (): Promise<T> => this.session.caller().call(method, url, schema, signal(), body)
    try {
      try {
        return await once()
      } catch (e) {
        if (!(e instanceof EngineError && e.code === 'missing_tool' && this.session.connected())) throw e
        this.session.expireAccess()
        return await once()
      }
    } catch (e) {
      throw plainCloudError(e)
    }
  }

  me(): Promise<z.infer<typeof MeResponse>> {
    return this.get('/v1/me', MeResponse)
  }

  catalog(): Promise<Catalog> {
    return this.get('/v1/catalog', CatalogResponse)
  }

  /** The engines registry the Cloud publishes (decision 0021). */
  engines(): Promise<EnginesResponse> {
    return this.get(ENGINES_ROUTE.path, EnginesResponse)
  }

  /** The blueprint the founder published last; null before the first publish (the Cloud answers 404). */
  async blueprint(): Promise<z.infer<typeof BlueprintResponse> | null> {
    try {
      return await this.get('/v1/blueprint', BlueprintResponse)
    } catch (e) {
      // the Cloud's refusal is mapped to a French « refusé (not_found) » message
      if (e instanceof EngineError && e.code === 'refused' && e.message.includes('(not_found)')) return null
      throw e
    }
  }

  /** The video's publication kit with fresh download links; null when the platform has none (never sent, or expired). */
  async kit(videoRef: string): Promise<z.infer<typeof KitWithLinks> | null> {
    try {
      return await this.get(`/v1/team/videos/${encodeURIComponent(videoRef)}/kit`, KitWithLinks)
    } catch (e) {
      if (e instanceof EngineError && e.code === 'refused' && e.message.includes('(not_found)')) return null
      throw e
    }
  }

  /** Google's model reads one range of a public video (« watch a whole video »): internal and test teams only, cost reported. */
  mediaWatch(body: MediaWatchRequest, signal?: AbortSignal): Promise<MediaWatchResponse> {
    return this.get(MEDIA_ROUTES.mediaWatch.path, MediaWatchResponse, 'POST', MediaWatchRequest.parse(body), { timeoutMs: 240_000, ...(signal ? { signal } : {}) })
  }

  wallet(): Promise<Wallet> {
    return this.get('/v1/wallet', WalletResponse)
  }

  job(id: string): Promise<CloudJob> {
    return this.get(`/v1/jobs/${encodeURIComponent(id)}`, Job)
  }

  cancelJob(id: string): Promise<CloudJob> {
    return this.get(`/v1/jobs/${encodeURIComponent(id)}/cancel`, Job, 'POST')
  }

  /** The value of one credit in euros, read from a free estimate of nothing; null when the Cloud does not say. */
  async creditValueEur(): Promise<number | null> {
    try {
      const r = await this.get('/v1/estimates', EstimateResponse, 'POST', { items: [{ key: 'credit-value', usage: 'synthesize', quantity: 0 }] })
      return r.creditValueEur
    } catch {
      return null
    }
  }

  /** The account panel: names, team, role, wallet and caps (with the credit value when known). */
  async account(): Promise<CloudAccount> {
    const me = await this.me()
    return {
      email: me.account.email,
      name: me.account.name,
      teamName: me.team.name,
      role: me.role,
      wallet: { ...me.wallet },
      caps: { ...me.caps },
      creditValueEur: await this.creditValueEur()
    }
  }

  /** The sidebar's account: names, role, the running plan and the credits (`/v1/me` + `/v1/billing`). */
  async profile(): Promise<CloudProfile> {
    const [me, billing] = await Promise.all([this.me(), this.get('/v1/billing', BillingResponse).catch(() => null)])
    const sub = billing?.subscription ?? null
    return {
      email: me.account.email,
      name: me.account.name,
      teamName: me.team.name,
      role: me.role,
      emailVerified: me.account.emailVerified !== false,
      plan: sub && sub.status !== 'canceled' ? sub.plan : null,
      planStatus: sub?.status ?? null,
      credits: { ...me.wallet }
    }
  }

  /** The team block: members, and the pending invitations when the caller may invite. */
  async team(): Promise<CloudTeam> {
    const [me, members] = await Promise.all([this.me(), this.get('/v1/team/members', MembersResponse)])
    const canInvite = me.role !== 'member'
    const invites = canInvite ? (await this.get('/v1/team/invites', InvitesResponse)).invites : []
    return {
      canInvite,
      members: members.members.map((m) => ({ accountId: m.accountId, email: m.email, name: m.name, role: m.role })),
      invites: invites.map((i) => ({ ...i }))
    }
  }

  invite(email: string, role: 'admin' | 'member'): Promise<CloudTeamInvite> {
    return this.get('/v1/team/invites', Invite, 'POST', { email, role })
  }

  async revokeInvite(id: string): Promise<void> {
    await this.get(`/v1/team/invites/${encodeURIComponent(id)}/revoke`, OkResponse, 'POST')
  }

  /** The registry's view of this Cloud (catalogue + wallet). */
  async features(): Promise<CloudCatalog> {
    const [catalog, wallet] = await Promise.all([this.catalog(), this.wallet()])
    return catalogToFeatures(catalog, wallet)
  }
}
