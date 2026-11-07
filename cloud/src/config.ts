// The Cloud's configuration: `<data folder>/config.json`, every field optional. paidCalls is OFF unless the file says
// "paidCalls": "on" (§4.10). In v2 the server listens on the loopback only (§4.11); any other host is refused.
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { BILLING_PLANS, CLOUD_DEV_HOST, CLOUD_DEV_PORT } from '../../src/shared/cloud-api.ts'
import { DEFAULT_KIT_RETENTION_DAYS } from '../../src/shared/cloud-kit.ts'
import { DEFAULT_MEDIA_SEARCHES_PER_MINUTE, DEFAULT_REQUESTS_PER_MINUTE } from './http/limits.ts'
import { DEFAULT_MAX_JOBS, DEFAULT_MAX_JOBS_PER_PROVIDER } from './jobs.ts'
import { REPO_ROOT, isInside } from './keysource.ts'
import { FAL_VIDEO_RESOLUTIONS } from './providers/fal.ts'
import { HEDRA_RESOLUTIONS } from './providers/hedra.ts'
import { INFINITETALK_GPUS } from './providers/infinitetalk-gpu.ts'
import { REAL_PRESENTER_ENGINES } from './providers/presenter-engines.ts'
import { MINIMAX_MODELS, MINIMAX_REGIONS } from './providers/minimax.ts'
import { REAL_VISUAL_ENGINES } from './providers/visual-engines.ts'
import { REAL_VOICE_ENGINES } from './providers/voice-engines.ts'

const REAL_ENGINES = [...REAL_VOICE_ENGINES, ...REAL_PRESENTER_ENGINES, ...REAL_VISUAL_ENGINES] as const

export const LOOPBACK_HOSTS = ['127.0.0.1', '::1'] as const

/** Which provider serves a usage. `fake` (the default) is the demo; a real one is used only with paidCalls on AND its key in
 *  the vault (providers/registry.ts). A usage that is not listed here has no real provider yet. */
export const ProvidersConfig = z
  .object({
    synthesize: z.enum(['fake', 'minimax', 'elevenlabs']).default('fake'),
    analyseVideo: z.enum(['fake', 'gemini']).default('fake'),
    generateImage: z.enum(['fake', 'gemini', 'fal']).default('fake'),
    generateVideo: z.enum(['fake', 'fal']).default('fake'),
    talkingAvatar: z.enum(['fake', 'hedra']).default('fake'),
    searchStock: z.enum(['fake', 'pexels', 'wikimedia', 'pixabay']).default('fake'),
    channelData: z.enum(['fake', 'youtube']).default('fake')
  })
  .strict()

export const CloudConfigFile = z
  .object({
    paidCalls: z.enum(['on', 'off']).default('off'),
    host: z.enum(LOOPBACK_HOSTS).default(CLOUD_DEV_HOST),
    port: z.number().int().min(0).max(65535).default(CLOUD_DEV_PORT),
    maxCreditsPerJob: z.number().int().positive().default(100_000),
    /** Jobs running at once, all teams and providers together (env ATELIER_CLOUD_MAX_JOBS wins). */
    maxConcurrentJobs: z.number().int().min(1).max(64).default(DEFAULT_MAX_JOBS),
    /** Jobs running at once on one provider (env ATELIER_CLOUD_MAX_JOBS_PER_PROVIDER wins); HeyGen's MCP plan takes 3 at most. */
    maxJobsPerProvider: z.number().int().min(1).max(64).default(DEFAULT_MAX_JOBS_PER_PROVIDER),
    requestsPerMinute: z.number().int().positive().default(DEFAULT_REQUESTS_PER_MINUTE),
    /** Media searches one account may ask a minute. */
    mediaSearchesPerMinute: z.number().int().positive().default(DEFAULT_MEDIA_SEARCHES_PER_MINUTE),
    retryDelayMs: z.number().int().min(0).default(1000),
    providers: ProvidersConfig.prefault({}),
    /** Engines whose real adapter may serve a job that names them: voice (decision 0029), presenter (0034), still and clip
     *  (0035), e.g. ["voice:fish-s2", "presenter:kling-avatar2-std", "image:flux-schnell"]; each needs its key in the vault
     *  (ELEVENLABS_API_KEY, MINIMAX_API_KEY, FISH_API_KEY, AI33_API_KEY; HEYGEN_MCP_OAUTH (`providers signin heygen`), HEYGEN_API_KEY,
     *  HEDRA_API_KEY, KIE_API_KEY, FAL_KEY, WAVESPEED_API_KEY,
     *  RUNPOD_API_KEY; OPENAI_API_KEY, GEMINI_API_KEY, VERTEX_SERVICE_ACCOUNT_JSON, UNIFICALLY_API_KEY) and paidCalls on. */
    realEngines: z.array(z.enum(REAL_ENGINES)).max(REAL_ENGINES.length).default([]),
    /** InfiniteTalk on a rented GPU (engine presenter:infinitetalk-gpu, vault: RUNPOD_API_KEY): the RunPod serverless endpoint
     *  Charlie deploys (deploy/runpod/infinitetalk/), its GPU (for the price per second), the sampling steps, the most GPU seconds
     *  one job may run (the cost ceiling, decision 0015) and the cold-start reserve counted on top. */
    infinitetalk: z
      .object({
        endpointId: z.string().regex(/^[A-Za-z0-9_-]{4,64}$/, 'a RunPod endpoint id').optional(),
        gpu: z.enum(INFINITETALK_GPUS).default('4090'),
        steps: z.number().int().min(2).max(50).default(8),
        maxGpuSeconds: z.number().int().min(5).max(7200).default(1800),
        coldStartReserveS: z.number().int().min(0).max(1800).default(180)
      })
      .strict()
      .prefault({}),
    /** MiniMax voice (vault: MINIMAX_API_KEY). */
    minimax: z
      .object({
        model: z.enum(MINIMAX_MODELS).default('speech-2.8-hd'),
        region: z.enum(Object.keys(MINIMAX_REGIONS) as [keyof typeof MINIMAX_REGIONS, ...(keyof typeof MINIMAX_REGIONS)[]]).default('global'),
        speed: z.number().min(0.5).max(2).default(1),
        languageBoost: z.string().min(1).max(40).default('auto')
      })
      .strict()
      .prefault({}),
    /** ElevenLabs voice (vault: ELEVENLABS_API_KEY). */
    elevenlabs: z
      .object({
        model: z.string().min(1).max(60).default('eleven_multilingual_v2'),
        speed: z.number().min(0.7).max(1.2).default(1),
        languageCode: z.string().regex(/^[a-z]{2}$/).optional()
      })
      .strict()
      .prefault({}),
    /** Gemini "eyes" (vault: GEMINI_API_KEY). */
    gemini: z
      .object({
        model: z.string().min(1).max(60).default('gemini-3.1-flash-lite'),
        /** The picture model ("Nano Banana") when `providers.generateImage` is "gemini". */
        imageModel: z.string().min(1).max(60).default('gemini-nano-banana-2.1')
      })
      .strict()
      .prefault({}),
    /** fal.ai (vault: FAL_KEY): FLUX schnell pictures and Wan 2.2 video. */
    fal: z.object({ videoResolution: z.enum(FAL_VIDEO_RESOLUTIONS).default('720p') }).strict().prefault({}),
    /** Hedra talking avatars (vault: HEDRA_API_KEY): the model (default Character-3) and the picture size. */
    hedra: z.object({ model: z.string().min(1).max(80).optional(), resolution: z.enum(HEDRA_RESOLUTIONS).default('720p') }).strict().prefault({}),
    /** YouTube Data API v3, read-only (vault: YOUTUBE_API_KEY): the budget of quota units a day (the free allowance is 10 000). */
    youtube: z.object({ dailyQuota: z.number().int().min(100).max(10_000).default(8_000) }).strict().prefault({}),
    /** The founder's HeyGen web plan behind presenter:heygen-mcp (production-10): its monthly fee, shown apart in the estimates
     *  (Pro 49 $ for 1 000 credits, Business 149 $ for 1 500; the price per credit is about the same). */
    heygen: z.object({ plan: z.enum(['pro', 'business']).default('pro') }).strict().prefault({}),
    /** Wikimedia Commons archives (no key): who Wikimedia can reach, added to the User-Agent. */
    wikimedia: z.object({ contact: z.string().min(3).max(100).optional() }).strict().prefault({}),
    /** Run GPU jobs on the local fake RunPod (worker processes on this computer). */
    fakeRunpod: z.enum(['on', 'off']).default('on'),
    /** The team computers: the support SSH public keys put on every machine (real machines need at least one). */
    machines: z
      .object({
        sshKeys: z.array(z.string().max(800)).max(10).default([]),
        /** https URL of the app's code (.tar.gz) a new machine installs at /opt/atelier; without it the code is copied by hand. */
        appBundleUrl: z.string().max(500).regex(/^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._~%/=&?-]*$/, 'an https URL').optional()
      })
      .strict()
      .prefault({}),
    /** The brain relay: how long a relayed call waits, and how many a person may make per minute. */
    relay: z
      .object({ timeoutMs: z.number().int().min(1000).max(600_000).optional(), rpcPerMinute: z.number().int().positive().optional() })
      .strict()
      .prefault({}),
    /** Hosted behind a TLS reverse proxy: the public host name(s) it forwards (the server itself stays on the loopback). */
    publicHosts: z.array(z.string().regex(/^[a-z0-9.-]{1,200}$/i, 'a host name')).max(10).default([]),
    /** Browser origins of the website (CORS), e.g. https://atelier.example. Default: the local site and its preview. */
    siteOrigins: z.array(z.string().regex(/^https?:\/\/[^\s/?#]+$/, 'http(s)://host[:port]')).max(10).optional(),
    /** Payments: the simulated checkout (default), or Stripe (vault: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET). */
    payments: z.enum(['fake', 'stripe']).default('fake'),
    /** Team files: a folder on this server (default), or an S3-compatible bucket such as Cloudflare R2
     *  (vault: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY; the Cloud refuses to start when "s3" lacks its keys). */
    storage: z
      .object({
        kind: z.enum(['local', 's3']).default('local'),
        endpoint: z.string().max(200).optional(),
        bucket: z.string().max(63).optional(),
        region: z.string().min(1).max(40).default('auto')
      })
      .strict()
      .refine((s) => s.kind === 'local' || (!!s.endpoint && !!s.bucket), { message: '"s3" needs storage.endpoint and storage.bucket' })
      .refine((s) => s.kind === 'local' || (s.endpoint !== undefined && /^https:\/\/[^\s/?#]+$|^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(s.endpoint)), {
        message: 'storage.endpoint is https://host (http only for a loopback address), nothing after'
      })
      .prefault({}),
    /** Publication kits kept for the team's people to download (src/shared/cloud-kit.ts). */
    kits: z
      .object({
        retentionDays: z.number().int().min(1).max(3650).default(DEFAULT_KIT_RETENTION_DAYS),
        /** Days per plan (teams without a running plan use retentionDays), e.g. { "starter": 30, "agency": 365 }. */
        byPlan: z.partialRecord(z.enum(BILLING_PLANS), z.number().int().min(1).max(3650)).default({})
      })
      .strict()
      .prefault({}),
    /** E-mails (account confirmation, password reset, receipts): the fake keeps them in the database (`npm run cloud -- mail list`);
     *  `resend` sends them for real (vault: RESEND_API_KEY) from `from` (a domain verified in Resend), with links to
     *  `siteUrl` (default: the first of siteOrigins). */
    mail: z
      .object({
        kind: z.enum(['fake', 'resend']).default('fake'),
        from: z.string().min(3).max(200).regex(/^([^\r\n<>]*<[^\s<>@]+@[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+)$/, 'name <address> or an address').optional(),
        siteUrl: z.string().max(200).regex(/^https?:\/\/[^\s/?#]+$/, 'http(s)://host[:port], nothing after').optional()
      })
      .strict()
      .prefault({}),
    /** The base URL remote executors reach the Cloud at (default: the address it listens on). */
    publicUrl: z
      .string()
      .max(200)
      .regex(/^https?:\/\/[^\s/?#]+$/, 'http(s)://host[:port], nothing after')
      .optional()
  })
  .strict()
export type CloudConfig = z.infer<typeof CloudConfigFile> & { dataDir: string }

/** The e-mail settings createCloud takes, from the configuration. */
export function mailOptions(cfg: CloudConfig): { kind: 'fake' | 'resend'; from?: string; siteUrl?: string } {
  const siteUrl = cfg.mail.siteUrl ?? cfg.siteOrigins?.[0]
  return { kind: cfg.mail.kind, ...(cfg.mail.from ? { from: cfg.mail.from } : {}), ...(siteUrl ? { siteUrl } : {}) }
}

/** The data folder: ATELIER_CLOUD_DATA, else ~/.atelier-cloud (never inside the repository). */
export function dataDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.ATELIER_CLOUD_DATA || join(homedir(), '.atelier-cloud')
}

export function loadConfig(dataDir: string, env: NodeJS.ProcessEnv = process.env): CloudConfig {
  // The data folder holds the database, the link-signing key and the team files: never inside the repository.
  if (isInside(REPO_ROOT, resolve(dataDir), process.platform)) throw new Error('ATELIER_CLOUD_DATA must be outside the repository')
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const path = join(dataDir, 'config.json')
  const raw: unknown = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  const parsed = CloudConfigFile.safeParse(raw)
  if (!parsed.success) throw new Error(`${path}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  const cfg: CloudConfig = { ...parsed.data, dataDir }
  // The port alone may come from the environment (the smoke runs a second Cloud beside a dev one).
  if (env.ATELIER_CLOUD_PORT !== undefined) {
    const port = Number(env.ATELIER_CLOUD_PORT)
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('ATELIER_CLOUD_PORT must be a port number')
    cfg.port = port
  }
  // The job limits too (a busy day on the server: raise them without editing config.json).
  for (const [name, key] of [['ATELIER_CLOUD_MAX_JOBS', 'maxConcurrentJobs'], ['ATELIER_CLOUD_MAX_JOBS_PER_PROVIDER', 'maxJobsPerProvider']] as const) {
    const raw = env[name]
    if (raw === undefined || raw === '') continue
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1 || n > 64) throw new Error(`${name} must be a whole number from 1 to 64`)
    cfg[key] = n
  }
  return cfg
}
