// The Atelier Cloud HTTP contract (PLAN-V2-PRODUCTION §4.2), shared by the server (`cloud/`) and the app's future client
// (`src/main/cloud/`, lot P5). Every route is listed once in CLOUD_ROUTES with its method, path, auth level and zod
// schemas; the server registers exactly these routes and validates both what it reads and what it answers against them.
// Amounts are whole credits; euros are only used for display values.
import { z } from 'zod'

export const CLOUD_API_VERSION = 1
export const CLOUD_DEV_HOST = '127.0.0.1'
export const CLOUD_DEV_PORT = 8787
export const ACCESS_TOKEN_TTL_S = 3600
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 3600
export const SIGNED_LINK_TTL_S = 15 * 60

/** Every error answer has this shape; `code` is stable, `message` is for logs (English). */
export const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) })
export type ErrorBody = z.infer<typeof ErrorBody>

export const ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'token_expired',
  'forbidden',
  'not_found',
  'conflict',
  'gone',
  'insufficient_credits',
  'cap_exceeded',
  'rate_limited',
  'authorization_pending',
  'machine_offline',
  'timeout',
  'too_large',
  'internal'
] as const
export type CloudErrorCode = (typeof ERROR_CODES)[number]

// ---- usages (the provider interface of §4.6) -------------------------------------------------------------------------

export const USAGES = [
  'synthesize',
  'generateImage',
  'generateVideo',
  'talkingAvatar',
  'channelData',
  'analyseVideo',
  'submitGpuJob',
  'searchStock',
  'cloneVoice',
  'designVoice'
] as const
export const Usage = z.enum(USAGES)
export type Usage = z.infer<typeof Usage>

/** Only public YouTube links are accepted (§4.11): the provider reads them, our server never downloads them. */
export function isYoutubeUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
  const host = url.hostname.toLowerCase()
  return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')
}
export const YoutubeUrl = z.string().max(500).refine(isYoutubeUrl, 'only https youtube.com / youtu.be links')

/** A voice engine id (`voice:<provider>-<model>`, src/shared/cloud-engines.ts). A voice job that names one is served by that
 *  engine's adapter (or its fake); without one, by the provider the Cloud's configuration picks for the usage. */
export const VoiceEngine = z.string().regex(/^voice:[a-z0-9][a-z0-9.-]{0,60}$/, 'a voice engine id (voice:…)')
export const SynthesizeInput = z.object({
  text: z.string().min(1).max(50_000),
  voiceId: z.string().min(1).max(100),
  wordTimings: z.boolean().default(true),
  engine: VoiceEngine.optional()
})
/** A still or clip engine id (`image:…`, `clip:…`, src/shared/visual-engines.ts): a job that names one is served by that engine's
 *  adapter (or its fake); without one, by the provider the Cloud's configuration picks for the usage (decision 0035). */
export const ImageEngine = z.string().regex(/^image:[a-z0-9][a-z0-9.-]{0,60}$/, 'an image engine id (image:…)')
export const ClipEngine = z.string().regex(/^clip:[a-z0-9][a-z0-9.-]{0,60}$/, 'a clip engine id (clip:…)')
/** What must never appear (the style's negatives, people and brand rules), sent beside the prompt. */
const Negative = z.string().min(1).max(1500)
export const GenerateImageInput = z.object({
  prompt: z.string().min(1).max(4000),
  width: z.number().int().min(64).max(4096).default(1280),
  height: z.number().int().min(64).max(4096).default(720),
  count: z.number().int().min(1).max(8).default(1),
  engine: ImageEngine.optional(),
  negative: Negative.optional(),
  /** Reference images (uploaded artefacts of the team): the presenter's portrait, the room, a recurring object's first
   *  picture. The engine's edit or multi-image input keeps them; an engine without one never gets them. */
  referenceArtefactIds: z.array(z.string().min(1).max(100)).min(1).max(4).optional()
})
/** The shapes a generated clip or a talking avatar is asked in (the film's own: long-form 16:9, a short 9:16). */
export const CLIP_ASPECTS = ['16:9', '9:16'] as const
/** The longest clip one generated-video job makes (Wan 2.2: 161 frames at 16 per second); the engine cuts longer shots up. */
export const GENERATED_CLIP_MAX_SECONDS = 10
export const GenerateVideoInput = z.object({
  prompt: z.string().min(1).max(4000),
  seconds: z.number().int().min(1).max(120),
  aspect: z.enum(CLIP_ASPECTS).default('16:9'),
  engine: ClipEngine.optional(),
  negative: Negative.optional(),
  /** The still the clip starts from (an uploaded artefact): image to video. Absent: text to video. */
  imageArtefactId: z.string().min(1).max(100).optional()
})
/** A presenter engine id (`presenter:<provider>-<model>`, src/shared/presenter-engines.ts). Like VoiceEngine it is checked by shape here
 *  (this file imports nothing: the Cloud runs it without a resolver, the app typechecks it without `.ts` imports); the quote route
 *  refuses an id the engines registry does not declare. */
export const PresenterEngineId = z.string().regex(/^presenter:[a-z0-9][a-z0-9.-]{0,60}$/, 'a presenter engine id (presenter:…)')
/** The resolutions of src/shared/presenter-engines.ts PRESENTER_RESOLUTIONS (a test keeps the two lists equal). */
export const PRESENTER_RESOLUTION_IDS = ['480p', '540p', '720p', '1080p'] as const
/** A talking head: the avatar (the provider's own id of a portrait), the voice audio it speaks (an uploaded artefact) and
 *  its length in seconds (what is billed). */
export const TalkingAvatarInput = z.object({
  avatarId: z.string().min(1).max(100),
  audioArtefactId: z.string().min(1).max(100).optional(),
  seconds: z.number().int().min(1).max(1800),
  aspect: z.enum(CLIP_ASPECTS).default('16:9'),
  /** The presenter engine (production-7, src/shared/presenter-engines.ts): the job is served by that engine's adapter (or its fake). */
  engine: PresenterEngineId.optional(),
  /** The presenter's portrait, an image uploaded to our storage: the engine gets it as a short signed link (decision 0025). */
  portraitArtefactId: z.string().min(1).max(100).optional(),
  resolution: z.enum(PRESENTER_RESOLUTION_IDS).optional(),
  /** A short motion line for the engines that take one. */
  prompt: z.string().max(300).optional()
})
export const ChannelDataInput = z.object({ url: YoutubeUrl, maxVideos: z.number().int().min(1).max(200).default(30) })
/** One video of a channel as `channelData` lists it (public numbers only; the newest first). */
export const ChannelVideo = z.object({
  id: z.string(),
  title: z.string(),
  views: z.number().int().min(0),
  likes: z.number().int().min(0).nullable().default(null),
  comments: z.number().int().min(0).nullable().default(null),
  durationS: z.number().min(0),
  publishedAt: z.string(),
  thumbnailUrl: z.string().nullable().default(null)
})
export type ChannelVideo = z.infer<typeof ChannelVideo>
/** What a `channelData` job answers in `result`. `subscribers` is null when the channel hides its count; `quotaUnits` is what
 *  the YouTube Data API charged for this read (0 for the demo). */
export const ChannelDataResult = z.object({
  url: z.string(),
  channelId: z.string().default(''),
  title: z.string(),
  subscribers: z.number().int().min(0).nullable(),
  totalViews: z.number().int().min(0).nullable().default(null),
  videoCount: z.number().int().min(0).nullable().default(null),
  videos: z.array(ChannelVideo),
  quotaUnits: z.number().int().min(0).default(0)
})
export type ChannelDataResult = z.infer<typeof ChannelDataResult>
export const AnalyseVideoInput = z.object({ url: YoutubeUrl, minutes: z.number().min(0.1).max(240) })
export const SubmitGpuJobInput = z.object({
  worker: z.enum(['render', 'gpu-video']),
  payload: z.record(z.string(), z.unknown()),
  estimatedGpuSeconds: z.number().int().min(1).max(36_000)
})

/** Stock and archive search: `count` results (photo or video) matching the query and the orientation; their files come back
 *  as artefacts, in the order of `data.results` (each result names its `file`). */
export const STOCK_ORIENTATIONS = ['landscape', 'portrait', 'square'] as const
export const SearchStockInput = z.object({
  query: z.string().trim().min(1).max(300),
  orientation: z.enum(STOCK_ORIENTATIONS).default('landscape'),
  kind: z.enum(['photo', 'video']).default('photo'),
  count: z.number().int().min(1).max(10).default(3)
})
/** One stock result as the job's data lists it. The attribution is kept with the result (Pexels asks for it, Wikimedia
 *  licences require it): the edit lists it in the video's credits. */
export const StockResult = z.object({
  id: z.string(),
  source: z.enum(['pexels', 'wikimedia', 'pixabay', 'archive', 'demo']),
  kind: z.enum(['photo', 'video']),
  title: z.string(),
  creator: z.string(),
  creatorUrl: z.string().nullable(),
  pageUrl: z.string().nullable(),
  licence: z.string(),
  attribution: z.string(),
  attributionRequired: z.boolean(),
  width: z.number().int(),
  height: z.number().int(),
  orientation: z.enum(STOCK_ORIENTATIONS),
  durationS: z.number().nullable(),
  /** The name of the artefact that holds the file. */
  file: z.string()
})
export type StockResult = z.infer<typeof StockResult>
/** The orientation of a width × height (within 5 % of square = square). */
export function orientationOf(width: number, height: number): (typeof STOCK_ORIENTATIONS)[number] {
  if (Math.abs(width - height) <= 0.05 * Math.max(width, height)) return 'square'
  return width > height ? 'landscape' : 'portrait'
}
/** A new voice from a recording the team uploaded (a clip of at least 10 s, at most 5 min, 20 MB; mp3, m4a or wav). */
export const CloneVoiceInput = z.object({
  audioArtefactId: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(60),
  /** The language the voice will speak, shown in the voice lists (a clone speaks any language the provider supports). */
  language: z.string().min(2).max(10).default('fr'),
  /** The engine that clones (decision 0029); absent: the provider the configuration picks. */
  engine: VoiceEngine.optional(),
  /** The consent of decision 0025: the team holds the rights to this voice. No clone without it. */
  consent: z.literal(true, { error: 'cloning a voice needs the consent tick (rights to the voice)' })
})
/** A new voice from a description (decision 0029): `preview` makes a few short previews to listen to; `keep` saves one of
 *  them (its `generatedVoiceId`) as a voice of the team. */
export const DesignVoiceInput = z.object({
  description: z.string().trim().min(20).max(1000),
  /** The text the previews say (100–1000 characters); absent: the provider writes one. */
  text: z.string().trim().min(100).max(1000).optional(),
  language: z.string().min(2).max(10).default('fr'),
  engine: VoiceEngine.optional(),
  keep: z.object({ generatedVoiceId: z.string().min(1).max(200), name: z.string().trim().min(1).max(60) }).optional()
})

export const USAGE_INPUTS = {
  synthesize: SynthesizeInput,
  generateImage: GenerateImageInput,
  generateVideo: GenerateVideoInput,
  talkingAvatar: TalkingAvatarInput,
  channelData: ChannelDataInput,
  analyseVideo: AnalyseVideoInput,
  submitGpuJob: SubmitGpuJobInput,
  searchStock: SearchStockInput,
  cloneVoice: CloneVoiceInput,
  designVoice: DesignVoiceInput
} as const satisfies Record<Usage, z.ZodType>
export type UsageInput<U extends Usage> = z.infer<(typeof USAGE_INPUTS)[U]>

// ---- auth (§4.3: device login through the browser, PKCE S256) -------------------------------------------------------

export const DeviceStartRequest = z.object({
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'base64url SHA-256 of the verifier'),
  codeChallengeMethod: z.literal('S256'),
  deviceName: z.string().min(1).max(100)
})
export const DeviceStartResponse = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUri: z.string(),
  expiresIn: z.number().int(),
  interval: z.number().int()
})
export const DevicePollRequest = z.object({
  deviceCode: z.string().min(1).max(200),
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/, 'RFC 7636 verifier')
})
/** The website's sign-up and sign-in (e-mail + password, a browser session). */
export const SignupRequest = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(100),
  password: z.string().min(10).max(200),
  /** The language of the e-mails sent to this address (the site's current language); French when absent. */
  lang: z.enum(['fr', 'en']).optional()
})
/** E-mail verification and password reset (cloud/src/mail/): single-use links the site's pages post back. */
export const VerifyEmailRequest = z.object({ token: z.string().min(16).max(200) })
export const ForgotPasswordRequest = z.object({ email: z.string().email().max(200), lang: z.enum(['fr', 'en']).optional() })
export const ResetPasswordRequest = z.object({ token: z.string().min(16).max(200), password: z.string().min(10).max(200) })
export const ResendVerificationResponse = z.object({ ok: z.literal(true), alreadyVerified: z.boolean() })
export const PasswordLoginRequest = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) })
export const MachinesResponse = z.object({
  provider: z.enum(['hetzner', 'fake']),
  machines: z.array(
    z.object({
      id: z.string(),
      plan: z.string(),
      serverType: z.string(),
      location: z.string(),
      status: z.enum(['creating', 'running', 'hibernating', 'hibernated', 'resuming', 'deleted', 'error']),
      demo: z.boolean(),
      /** The machine traded its enrolment token for its credential. */
      enrolled: z.boolean(),
      /** Its brain holds the relay open right now (calls through /v1/team/brain reach it). */
      online: z.boolean()
    })
  )
})

// ---- the team computer's link: enrolment and the brain relay (cloud/src/relay, docs/BRAIN-HEADLESS.md) -------------

export const EnrolRequest = z.object({ enrolToken: z.string().regex(/^[A-Za-z0-9_-]{16,200}$/, 'an enrolment token') })
/** The machine credential is shown once, to the machine; the Cloud keeps its SHA-256 only. */
export const EnrolResponse = z.object({ machineId: z.string(), teamId: z.string(), credential: z.string() })
/** An IPC method name of the app (`channels.list`); anything else never reaches a machine or the audit. */
export const BrainMethod = z.string().max(100).regex(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/, 'a method name like channels.list')
/** The IPC envelope, exactly as the app's bus and the headless brain answer it. */
export const BrainEnvelope = z.union([
  z.object({ ok: z.literal(true), value: z.unknown().optional() }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string().max(100), message: z.string().max(4000) }) })
])
export const BrainRpcRequest = z.object({ method: BrainMethod, args: z.array(z.unknown()).max(32).default([]), machineId: z.string().max(60).optional() })
/** Team-computer methods a plain `member` may not call through the relay (decision 0076): they change the machine's keys,
 *  links, spending caps, prices, settings or people. The owner and admins of the team may. */
export const RELAY_ADMIN_METHODS: readonly string[] = [
  'providers.setKey', 'providers.clearKey', 'cloud.setBaseUrl', 'cloud.connect', 'cloud.disconnect', 'cloud.invite', 'cloud.revokeInvite',
  'cloud.kitPublish', 'cloud.blueprintApply', 'brain.connect', 'brain.disconnect', 'spend.setGlobalCap', 'spend.setChannelCap', 'prices.set',
  'money.setRate', 'credits.simulatePurchase', 'settings.set', 'llm.set', 'team.invite', 'team.updateMember', 'team.removeMember',
  'team.revokeDevice', 'discord.set', 'discord.clearToken', 'discord.configure', 'google.setClient', 'google.clearClient', 'app.update.install',
  'app.update.setChannel'
]
/** A name ending in `.set` or `.` covers every method it starts (`llm.setTierModel`, `discord.setToken`). */
export const isRelayAdminMethod = (method: string): boolean =>
  RELAY_ADMIN_METHODS.some((m) => (m.endsWith('.') || m.endsWith('.set') ? method.startsWith(m) : method === m))
export const BrainEventsQuery = z.object({ machineId: z.string().max(60).optional() })
export const RelayNextQuery = z.object({ wait: z.coerce.number().int().min(0).max(30).optional() })
export const RelayNextResponse = z.object({ requests: z.array(z.object({ id: z.string(), method: z.string(), args: z.array(z.unknown()) })) })
export const RelayReplyRequest = z.object({ id: z.string().max(60), response: BrainEnvelope })
/** Events the brain pushes up (`changed`, `stream`), streamed to the team's clients as `GET /v1/team/brain/events`. */
export const RelayEventsRequest = z.object({ events: z.array(z.object({ event: z.enum(['changed', 'stream']), data: z.unknown() })).max(500) })

export const TokenResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
  refreshExpiresIn: z.number().int(),
  deviceId: z.string()
})
export const RefreshRequest = z.object({ refreshToken: z.string().min(1).max(200) })
/** A test brain's key (record 0066) and the name its device gets. */
export const TestBrainRequest = z.object({ key: z.string().min(1).max(200), deviceName: z.string().max(100).default('') })
export const OkResponse = z.object({ ok: z.literal(true) })
export const Device = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  current: z.boolean()
})
export const DevicesResponse = z.object({ devices: z.array(Device) })

// ---- account, team, catalog -----------------------------------------------------------------------------------------

export const Role = z.enum(['owner', 'admin', 'member'])
export type Role = z.infer<typeof Role>
export const Caps = z.object({ dailyCredits: z.number().int().nullable(), monthlyCredits: z.number().int().nullable() })
export const MeResponse = z.object({
  account: z.object({ id: z.string(), email: z.string(), name: z.string(), platformAdmin: z.boolean(), emailVerified: z.boolean().optional() }),
  team: z.object({ id: z.string(), name: z.string(), internal: z.boolean() }),
  role: Role,
  caps: Caps,
  wallet: z.object({ balance: z.number().int(), held: z.number().int(), available: z.number().int() })
})
export const Member = z.object({
  accountId: z.string(),
  email: z.string(),
  name: z.string(),
  role: Role,
  caps: Caps,
  spentToday: z.number().int(),
  spentThisMonth: z.number().int()
})
export const MembersResponse = z.object({ members: z.array(Member) })
export const SetCapsRequest = Caps

// ---- team invitations (an owner or admin invites a person by e-mail; single-use link, 7 days) ----------------------

/** The role an invitation gives (never owner). */
export const InviteRole = z.enum(['admin', 'member'])
export const Invite = z.object({
  id: z.string(),
  email: z.string(),
  role: InviteRole,
  /** The name of the person who invited. */
  invitedBy: z.string(),
  createdAt: z.string(),
  expiresAt: z.string()
})
/** The pending invitations of the caller's team (owner or admin only). */
export const InvitesResponse = z.object({ invites: z.array(Invite) })
export const CreateInviteRequest = z.object({
  email: z.string().email().max(200),
  role: InviteRole.default('member'),
  /** The language of the invitation e-mail; the inviter's when absent. */
  lang: z.enum(['fr', 'en']).optional()
})
/** The token of the invitation link (the site's /invitation page posts it back). */
export const InviteTokenRequest = z.object({ token: z.string().min(16).max(200) })
/** What the invitation page shows before accepting. `hasAccount`: the address already has an account (sign in, then join). */
export const InvitePreviewResponse = z.object({ teamName: z.string(), email: z.string(), invitedBy: z.string(), role: InviteRole, hasAccount: z.boolean() })
/** A new account from an invitation: its address is the invitation's (proven by the link), it joins the team at once. */
export const InviteSignupRequest = z.object({
  token: z.string().min(16).max(200),
  name: z.string().min(1).max(100),
  password: z.string().min(10).max(200),
  lang: z.enum(['fr', 'en']).optional()
})
export const InviteAcceptResponse = z.object({ team: z.object({ id: z.string(), name: z.string() }), role: InviteRole })

export const ProviderStatus = z.enum(['real', 'demo'])
export const CatalogResponse = z.object({
  paidCalls: z.boolean(),
  providers: z.array(
    z.object({ usage: Usage, provider: z.string(), status: ProviderStatus, reason: z.string().nullable() })
  ),
  /** The voices the team can pick: the platform's, then the ones cloned by the team (`cloned`). */
  voices: z.array(z.object({ id: z.string(), name: z.string(), language: z.string(), demo: z.boolean(), cloned: z.boolean().default(false), default: z.boolean().default(false) })),
  models: z.array(z.object({ id: z.string(), usage: Usage, label: z.string(), demo: z.boolean() }))
})

// ---- quotes ---------------------------------------------------------------------------------------------------------

export const QuoteRequest = z.object({ usage: Usage, input: z.record(z.string(), z.unknown()) })
export const QuoteLine = z.object({
  item: z.string(),
  quantity: z.number(),
  unit: z.string(),
  credits: z.number().int(),
  /** What an expert using the provider directly, at its cheapest, would pay (euros); null when unknown. */
  referenceEur: z.number().nullable(),
  /** The line costs more than its reference (only through the 1-credit minimum). Absent in quotes stored before it existed: false. */
  aboveReference: z.boolean().default(false)
})
export const Quote = z.object({
  id: z.string(),
  usage: Usage,
  gridVersion: z.number().int(),
  creditValueEur: z.number(),
  lines: z.array(QuoteLine),
  totalCredits: z.number().int(),
  referenceEur: z.number().nullable(),
  demo: z.boolean(),
  createdAt: z.string(),
  expiresAt: z.string()
})
export type Quote = z.infer<typeof Quote>

// ---- jobs -----------------------------------------------------------------------------------------------------------

export const JOB_STATES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const
export const JobState = z.enum(JOB_STATES)
export type JobState = z.infer<typeof JobState>
export const TERMINAL_JOB_STATES: readonly JobState[] = ['succeeded', 'failed', 'cancelled']

export const CreateJobRequest = z.object({
  quoteId: z.string().min(1).max(100),
  idempotencyKey: z.string().min(8).max(200),
  /** The job serves a run its owner turned real (« Moteur réel », production-17): while the Cloud's paid calls are on, a usage
   *  it can only answer in demo is free (nothing held, nothing charged). */
  real: z.boolean().optional()
})
export const Artefact = z.object({
  id: z.string(),
  name: z.string(),
  mime: z.string(),
  size: z.number().int(),
  sha256: z.string(),
  demo: z.boolean()
})
export const Job = z.object({
  id: z.string(),
  usage: Usage,
  state: JobState,
  quoteId: z.string(),
  credits: z.number().int(),
  attempts: z.number().int(),
  error: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  artefacts: z.array(Artefact),
  demo: z.boolean(),
  /** The engine that ran it (the Cloud's adapter id: `presenter:heygen-mcp`, `fake-avatar`…); absent from older Clouds. */
  provider: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type Job = z.infer<typeof Job>

export const JOB_EVENT_TYPES = [
  'queued',
  'started',
  'progress',
  'retry',
  'artefact',
  'succeeded',
  'failed',
  'cancelled'
] as const
/** One server-sent event of `GET /v1/jobs/:id/events` (`id:` = seq, `event:` = type, `data:` = this JSON). */
export const JobEvent = z.object({
  seq: z.number().int(),
  type: z.enum(JOB_EVENT_TYPES),
  at: z.string(),
  data: z.record(z.string(), z.unknown())
})
export type JobEvent = z.infer<typeof JobEvent>

// ---- files, wallet, support -----------------------------------------------------------------------------------------

export type Artefact = z.infer<typeof Artefact>
export const ArtefactLinkResponse = z.object({ artefact: Artefact, url: z.string(), expiresAt: z.string() })

export const WALLET_KINDS = ['grant', 'hold', 'capture', 'release', 'adjust'] as const
export const WalletKind = z.enum(WALLET_KINDS)
export type WalletKind = z.infer<typeof WalletKind>
/** `delta` moves the balance, `heldDelta` moves the open holds: balance = Σ delta, held = Σ heldDelta. */
export const WalletEntry = z.object({
  id: z.string(),
  kind: WalletKind,
  delta: z.number().int(),
  heldDelta: z.number().int(),
  holdId: z.string().nullable(),
  jobId: z.string().nullable(),
  accountId: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string()
})
export type WalletEntry = z.infer<typeof WalletEntry>
export const WalletResponse = z.object({
  teamId: z.string(),
  balance: z.number().int(),
  held: z.number().int(),
  available: z.number().int()
})
export const WalletEntriesResponse = z.object({ entries: z.array(WalletEntry), nextCursor: z.string().nullable() })

export const SupportRequest = z.object({ subject: z.string().min(1).max(200), body: z.string().min(1).max(10_000) })
export const SupportResponse = z.object({ id: z.string(), createdAt: z.string() })

// ---- lot P5: uploads, unit estimates, the RunPod callback -------------------------------------------------------------

/** Upper bound of one upload (v2: the Cloud runs on the loopback; hosting brings streamed, resumable uploads). */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'lowercase hex SHA-256')
/** `POST /v1/uploads?name=…&sha256=…`, body = the raw bytes (`application/octet-stream`); the hash is checked. */
export const UploadQuery = z.object({
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/, 'a plain file name'),
  sha256: Sha256Hex
})

/** Prices engine estimates in credits without storing a quote (the engine's `Quoter`, R9.2). */
export const EstimateRequest = z.object({
  items: z
    .array(
      z.object({
        key: z.string().min(1).max(200),
        usage: Usage,
        quantity: z.number().min(0).max(1e9),
        /** The engine the work will run on (a declared engine of that usage): priced at its published price, not the grid line's. */
        engine: z.string().max(100).optional()
      })
    )
    .min(1)
    .max(500)
})
export const EstimateResponse = z.object({
  gridVersion: z.number().int(),
  creditValueEur: z.number(),
  lines: z.array(z.object({ key: z.string(), credits: z.number().int(), demo: z.boolean() })),
  totalCredits: z.number().int()
})
export type EstimateResponse = z.infer<typeof EstimateResponse>

/** What RunPod (or the fake RunPod) posts to our callback: its job status object, read loosely. */
export const RunpodCallback = z.object({ id: z.string().max(200), status: z.string().max(40) }).passthrough()

// ---- billing (plans, credit packs, the automatic top-up) -------------------------------------------------------------

export const BILLING_PLANS = ['starter', 'creator', 'studio', 'agency', 'network'] as const
export const BILLING_PACKS = ['pack2k', 'pack5k', 'pack20k'] as const
/** Where the checkout sends the user back: https anywhere, http only on this computer. */
const ReturnUrl = z
  .string()
  .max(500)
  .refine((v) => /^https:\/\/[^\s]+$/.test(v) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s]*)?$/.test(v), 'https, or http on localhost')
export const CheckoutRequest = z.object({
  item: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('subscription'), plan: z.enum(BILLING_PLANS), period: z.enum(['month', 'year']) }),
    z.object({ kind: z.literal('pack'), pack: z.enum(BILLING_PACKS) })
  ]),
  successUrl: ReturnUrl,
  cancelUrl: ReturnUrl
})
export const CheckoutResponse = z.object({ url: z.string(), sessionId: z.string() })
export const AutoRecharge = z.object({
  enabled: z.boolean(),
  thresholdCredits: z.number().int().min(0).max(1_000_000),
  pack: z.enum(BILLING_PACKS),
  monthlyCapCents: z.number().int().min(0).max(200_000),
  spentThisMonthCents: z.number().int()
})
export const AutoRechargeRequest = AutoRecharge.omit({ spentThisMonthCents: true }).partial({ thresholdCredits: true, pack: true, monthlyCapCents: true })
export const BillingResponse = z.object({
  provider: z.enum(['stripe', 'fake']),
  subscription: z
    .object({ plan: z.enum(BILLING_PLANS), period: z.enum(['month', 'year']), status: z.enum(['active', 'past_due', 'canceled']), since: z.string() })
    .nullable(),
  autoRecharge: AutoRecharge,
  cardOnFile: z.boolean()
})
export type BillingResponse = z.infer<typeof BillingResponse>

/** A blueprint: the default agent organisation and the preset pipelines every workspace gets (the console's format). */
const Id = z.string().min(1).max(80)
/**
 * What a pipeline step is, for the editor's drawing (the app's `DRAWING_KINDS`, src/shared/pipeline-drawing.ts: this file
 * imports nothing, the Cloud runs it as it is; a test keeps both lists equal).
 */
export const BLUEPRINT_NODE_KINDS = [
  'idea',
  'script',
  'director',
  'avatar',
  'stock',
  'image-gen',
  'video-gen',
  'motion',
  'voice',
  'music',
  'gameplay',
  'card',
  'captions',
  'edit',
  'thumbnail',
  'qc',
  'publish',
  'translate',
  'human-input',
  'code'
] as const
export const Blueprint = z.object({
  version: z.number().int().min(1),
  agents: z
    .array(
      z.object({
        id: Id,
        role: z.string().min(1).max(120),
        tier: z.enum(['fast', 'balanced', 'deep']),
        routines: z.array(z.string().max(200)).max(20),
        instructions: z.string().max(4000)
      })
    )
    .min(1)
    .max(60),
  pipelines: z
    .array(
      z.object({
        id: Id,
        name: z.string().min(1).max(120),
        nodes: z
          .array(
            z.object({
              id: Id,
              label: z.string().min(1).max(120),
              /** Optional: without it the app deduces the kind from the label (the console warns). */
              kind: z.enum(BLUEPRINT_NODE_KINDS).optional(),
              runner: z.enum(['agent', 'api', 'code']),
              provider: z.string().max(120),
              credits: z.number().min(0).max(1_000_000),
              validate: z.enum(['auto', 'review'])
            })
          )
          .min(1)
          .max(60)
      })
    )
    .min(1)
    .max(60)
})
export const BlueprintResponse = z.object({ version: z.number().int(), blueprint: Blueprint, publishedAt: z.string() })
export const AdminBlueprintsResponse = z.object({
  current: BlueprintResponse.nullable(),
  versions: z.array(z.object({ version: z.number().int(), note: z.string(), publishedBy: z.string(), publishedAt: z.string() }))
})
export const PublishBlueprintRequest = z.object({ blueprint: z.unknown(), note: z.string().max(300).default('') })

// ---- the route table ------------------------------------------------------------------------------------------------

/** `machine`: a team computer's credential (from /v1/machines/enrol), never a person's token. */
export type CloudAuth = 'none' | 'user' | 'platformAdmin' | 'machine'
export interface CloudRoute {
  method: 'GET' | 'POST'
  path: string
  auth: CloudAuth
  body?: z.ZodType
  query?: z.ZodType
  /** null = not JSON (an event stream or a file). */
  response: z.ZodType | null
}

export const CLOUD_ROUTES = {
  deviceStart: { method: 'POST', path: '/v1/auth/device/start', auth: 'none', body: DeviceStartRequest, response: DeviceStartResponse },
  devicePoll: { method: 'POST', path: '/v1/auth/device/poll', auth: 'none', body: DevicePollRequest, response: TokenResponse },
  refresh: { method: 'POST', path: '/v1/auth/refresh', auth: 'none', body: RefreshRequest, response: TokenResponse },
  /** A headless test brain: its key (`admin test-team create`) to the usual tokens of its test team (record 0066). */
  testBrain: { method: 'POST', path: '/v1/auth/test-brain', auth: 'none', body: TestBrainRequest, response: TokenResponse },
  logout: { method: 'POST', path: '/v1/auth/logout', auth: 'user', response: OkResponse },
  /** The website: a new account with its own team, signed in at once. */
  signup: { method: 'POST', path: '/v1/auth/signup', auth: 'none', body: SignupRequest, response: TokenResponse },
  /** The website: e-mail + password to tokens (the apps use the device flow). */
  passwordLogin: { method: 'POST', path: '/v1/auth/login', auth: 'none', body: PasswordLoginRequest, response: TokenResponse },
  /** The link of the verification e-mail, posted by the site's /verifier page (single use, 24 h). */
  verifyEmail: { method: 'POST', path: '/v1/auth/verify-email', auth: 'none', body: VerifyEmailRequest, response: OkResponse },
  /** A new verification e-mail for the signed-in account (rate-limited). */
  resendVerification: { method: 'POST', path: '/v1/auth/resend-verification', auth: 'user', response: ResendVerificationResponse },
  /** « Mot de passe oublié »: always answers ok, whether the address has an account or not (rate-limited). */
  forgotPassword: { method: 'POST', path: '/v1/auth/forgot-password', auth: 'none', body: ForgotPasswordRequest, response: OkResponse },
  /** The link of the reset e-mail plus the new password (single use, 1 h); every session of the account is revoked. */
  resetPassword: { method: 'POST', path: '/v1/auth/reset-password', auth: 'none', body: ResetPasswordRequest, response: OkResponse },
  /** The team computers of the caller's team. */
  teamMachines: { method: 'GET', path: '/v1/team/machines', auth: 'user', response: MachinesResponse },
  /** A new team computer trades its single-use enrolment token (the credential of this call) for its own credential. */
  machineEnrol: { method: 'POST', path: '/v1/machines/enrol', auth: 'none', body: EnrolRequest, response: EnrolResponse },
  /** The machine's long poll: the calls waiting for it (empty after `wait` seconds). */
  relayNext: { method: 'GET', path: '/v1/relay/machine/next', auth: 'machine', query: RelayNextQuery, response: RelayNextResponse },
  relayReply: { method: 'POST', path: '/v1/relay/machine/reply', auth: 'machine', body: RelayReplyRequest, response: OkResponse },
  relayEvents: { method: 'POST', path: '/v1/relay/machine/events', auth: 'machine', body: RelayEventsRequest, response: OkResponse },
  /** One IPC call on the team's computer, relayed: same `{method, args}` → envelope as the app's bus. */
  teamBrainRpc: { method: 'POST', path: '/v1/team/brain/rpc', auth: 'user', body: BrainRpcRequest, response: BrainEnvelope },
  /** Server-sent events of the team's computer (`changed`, `stream`). */
  teamBrainEvents: { method: 'GET', path: '/v1/team/brain/events', auth: 'user', query: BrainEventsQuery, response: null },
  /** The current blueprint (404 before the first publish): what a new workspace starts from. */
  blueprint: { method: 'GET', path: '/v1/blueprint', auth: 'user', response: BlueprintResponse },
  devices: { method: 'GET', path: '/v1/devices', auth: 'user', response: DevicesResponse },
  revokeDevice: { method: 'POST', path: '/v1/devices/:id/revoke', auth: 'user', response: OkResponse },
  me: { method: 'GET', path: '/v1/me', auth: 'user', response: MeResponse },
  members: { method: 'GET', path: '/v1/team/members', auth: 'user', response: MembersResponse },
  setCaps: { method: 'POST', path: '/v1/team/members/:accountId/caps', auth: 'user', body: SetCapsRequest, response: Member },
  /** Team invitations: list, invite by e-mail (the link is e-mailed, never answered), revoke (owner or admin). */
  invites: { method: 'GET', path: '/v1/team/invites', auth: 'user', response: InvitesResponse },
  createInvite: { method: 'POST', path: '/v1/team/invites', auth: 'user', body: CreateInviteRequest, response: Invite },
  revokeInvite: { method: 'POST', path: '/v1/team/invites/:id/revoke', auth: 'user', response: OkResponse },
  /** The invitation page: which team, for which address (the token is the credential). */
  invitePreview: { method: 'POST', path: '/v1/invites/preview', auth: 'none', body: InviteTokenRequest, response: InvitePreviewResponse },
  /** A signed-in account whose address is the invitation's joins the team (spends the link). */
  inviteAccept: { method: 'POST', path: '/v1/invites/accept', auth: 'user', body: InviteTokenRequest, response: InviteAcceptResponse },
  /** No account yet: creates it (address confirmed by the link), joins the team and signs in, like the site's sign-up. */
  inviteSignup: { method: 'POST', path: '/v1/invites/signup', auth: 'none', body: InviteSignupRequest, response: TokenResponse },
  catalog: { method: 'GET', path: '/v1/catalog', auth: 'user', response: CatalogResponse },
  createQuote: { method: 'POST', path: '/v1/quotes', auth: 'user', body: QuoteRequest, response: Quote },
  createJob: { method: 'POST', path: '/v1/jobs', auth: 'user', body: CreateJobRequest, response: Job },
  job: { method: 'GET', path: '/v1/jobs/:id', auth: 'user', response: Job },
  jobEvents: {
    method: 'GET',
    path: '/v1/jobs/:id/events',
    auth: 'user',
    /** Resume after this seq (the `Last-Event-ID` header wins when both are given). */
    query: z.object({ after: z.coerce.number().int().min(0).max(1_000_000).optional() }),
    response: null
  },
  cancelJob: { method: 'POST', path: '/v1/jobs/:id/cancel', auth: 'user', response: Job },
  artefact: { method: 'GET', path: '/v1/artefacts/:id', auth: 'user', response: ArtefactLinkResponse },
  wallet: { method: 'GET', path: '/v1/wallet', auth: 'user', response: WalletResponse },
  walletEntries: {
    method: 'GET',
    path: '/v1/wallet/entries',
    auth: 'user',
    query: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), cursor: z.string().max(100).optional() }),
    response: WalletEntriesResponse
  },
  support: { method: 'POST', path: '/v1/support', auth: 'user', body: SupportRequest, response: SupportResponse },
  // lot P5
  /** One of this team's files with that content, if it was uploaded or produced before (404 otherwise). */
  uploadByHash: { method: 'GET', path: '/v1/uploads/:sha256', auth: 'user', response: Artefact },
  /** Raw bytes (`application/octet-stream`, at most MAX_UPLOAD_BYTES); answers the stored artefact. */
  upload: { method: 'POST', path: '/v1/uploads', auth: 'user', query: UploadQuery, response: Artefact },
  estimates: { method: 'POST', path: '/v1/estimates', auth: 'user', body: EstimateRequest, response: EstimateResponse },
  /** RunPod's completion callback. No bearer token: the `sig` query (HMAC of the job id) is the credential. */
  runpodWebhook: {
    method: 'POST',
    path: '/v1/runpod/webhook/:jobId',
    auth: 'none',
    query: z.object({ sig: z.string().min(16).max(200) }),
    body: RunpodCallback,
    response: OkResponse
  },
  // billing
  billing: { method: 'GET', path: '/v1/billing', auth: 'user', response: BillingResponse },
  billingCheckout: { method: 'POST', path: '/v1/billing/checkout', auth: 'user', body: CheckoutRequest, response: CheckoutResponse },
  billingAutoRecharge: { method: 'POST', path: '/v1/billing/auto-recharge', auth: 'user', body: AutoRechargeRequest, response: AutoRecharge },
  /** The simulated payment: completes a demo checkout (refused when payments are real). */
  billingDemoComplete: { method: 'POST', path: '/v1/billing/demo-complete', auth: 'user', body: z.object({ sessionId: z.string().min(1).max(200) }), response: OkResponse },
  /** The payment provider's webhook. No bearer: its signature over the raw body is the credential. */
  billingWebhook: { method: 'POST', path: '/v1/billing/webhook', auth: 'none', response: OkResponse }
} as const satisfies Record<string, CloudRoute>
export type CloudRouteName = keyof typeof CLOUD_ROUTES

/** The signed download link (outside /v1: the signature is the credential, valid SIGNED_LINK_TTL_S). */
export const SIGNED_FILE_PATH = '/files/:id'
/** The browser page where a person approves a device login (French UI). */
export const DEVICE_VERIFY_PATH = '/device'

/** PKCE S256: base64url(SHA-256(verifier)), without padding. `sha256` is injected so this file stays platform-free. */
export function pkceChallenge(verifier: string, sha256: (s: string) => Uint8Array): string {
  const bytes = sha256(verifier)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ---- admin (§4.2 `/admin/*`, platform admins only): price grids, margins, granted credits, P&L, support, audit ----
/** How one item is priced: a percent margin over our real cost, or a fixed number of credits per unit (§4.4). */
export const ItemPricing = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('percent'), marginPct: z.number().min(0).max(500) }),
  z.object({ mode: z.literal('fixed'), creditsPerUnit: z.number().positive().max(1_000_000) })
])
export type ItemPricing = z.infer<typeof ItemPricing>

export const PriceItem = z.object({
  item: z.string().regex(/^[a-z][a-z0-9.-]{1,60}$/),
  usage: Usage,
  unit: z.string().min(1).max(30),
  /** What the provider bills us per unit, in US dollars. */
  providerCostUsd: z.number().min(0),
  /** The best-usage reference price per unit in euros (what an expert would pay going direct); null = unknown. */
  referenceEur: z.number().min(0).nullable(),
  pricing: ItemPricing
})
export type PriceItem = z.infer<typeof PriceItem>

export const PriceGridInput = z.object({
  /** Value of one credit in euros (default 0.01). */
  creditValueEur: z.number().positive().max(100),
  /** Manual dollar → euro rate. */
  usdToEur: z.number().positive().max(10),
  /** Share of fixed costs (storage, server) added to the provider cost, in percent. */
  overheadPct: z.number().min(0).max(500),
  note: z.string().max(500).nullable().default(null),
  items: z.array(PriceItem).min(1).max(200)
})
export type PriceGridInput = z.infer<typeof PriceGridInput>
export const PriceGrid = PriceGridInput.extend({ version: z.number().int(), createdAt: z.string(), createdBy: z.string() })
export type PriceGrid = z.infer<typeof PriceGrid>
/** What publishing answers: the new grid, plus the items whose margin is outside their tier (a warning, never a refusal). */
export const PublishPricesResponse = PriceGrid.extend({
  warnings: z.array(z.object({ item: z.string(), marginPct: z.number(), tierPct: z.number() }))
})
export type PublishPricesResponse = z.infer<typeof PublishPricesResponse>
export const PricesResponse = z.object({
  current: PriceGrid,
  versions: z.array(z.object({ version: z.number().int(), createdAt: z.string(), note: z.string().nullable() }))
})

export const GrantRequest = z.object({
  teamId: z.string().min(1).max(100),
  credits: z.number().int().positive().max(100_000_000),
  idempotencyKey: z.string().min(8).max(200),
  note: z.string().max(500).nullable().default(null)
})
export const AdjustRequest = GrantRequest.extend({
  credits: z.number().int().min(-100_000_000).max(100_000_000).refine((n) => n !== 0, 'non-zero')
})
export const WalletMoveResponse = z.object({
  entryId: z.string(),
  replayed: z.boolean(),
  balance: z.number().int(),
  available: z.number().int()
})

export const TeamsResponse = z.object({
  teams: z.array(
    z.object({ id: z.string(), name: z.string(), internal: z.boolean(), balance: z.number().int(), members: z.number().int() })
  )
})

export const PnlQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Demo jobs never count in the P&L unless asked (PLAN-V2 §8.4). */
  includeDemo: z.enum(['0', '1']).default('0')
})
export const PnlRow = z.object({
  day: z.string(),
  provider: z.string(),
  jobs: z.number().int(),
  creditsSold: z.number().int(),
  revenueEur: z.number(),
  costEur: z.number(),
  marginEur: z.number(),
  /** Jobs priced under our real cost (reference cap or fixed price too low). */
  lossJobs: z.number().int()
})
export const PnlResponse = z.object({ rows: z.array(PnlRow), internalExcluded: z.boolean() })

/** The founder console's real figures. */
export const AdminOverviewResponse = z.object({
  accounts: z.number().int(),
  teams: z.number().int(),
  plans: z.array(z.object({ plan: z.string(), active: z.number().int() })),
  mrrCents: z.number().int(),
  monthRevenueCents: z.object({ subscription: z.number().int(), pack: z.number().int(), topup: z.number().int() }),
  machines: z.object({ running: z.number().int(), hibernated: z.number().int(), monthlyCostEur: z.number(), demo: z.boolean() }),
  creditsThisMonth: z.object({ granted: z.number().int(), spent: z.number().int() }),
  paymentsProvider: z.enum(['stripe', 'fake']),
  /** Providers that need the founder's hand (production-10: HeyGen's MCP sign-in whose refresh failed). */
  providerAlerts: z.array(z.object({ provider: z.string(), message: z.string(), raisedAt: z.string() })).default([])
})
export const AdminMachinesResponse = z.object({
  provider: z.enum(['hetzner', 'fake']),
  machines: z.array(
    z.object({
      id: z.string(),
      teamId: z.string(),
      teamName: z.string(),
      plan: z.string(),
      serverType: z.string(),
      location: z.string(),
      status: z.enum(['creating', 'running', 'hibernating', 'hibernated', 'resuming', 'deleted', 'error']),
      ipv4: z.string().nullable(),
      demo: z.boolean(),
      error: z.string().nullable(),
      createdAt: z.string()
    })
  )
})
/** `revoke`: the machine's credential stops working (it enrols again with a new token from the admin tool). */
export const AdminMachineActionRequest = z.object({ action: z.enum(['hibernate', 'resume', 'delete', 'revoke']) })


export const SupportListResponse = z.object({
  requests: z.array(
    z.object({ id: z.string(), accountId: z.string(), subject: z.string(), body: z.string(), createdAt: z.string() })
  )
})

export const AuditResponse = z.object({
  entries: z.array(
    z.object({ id: z.number().int(), at: z.string(), actor: z.string(), action: z.string(), target: z.string().nullable() })
  )
})

export const CLOUD_ADMIN_ROUTES = {
  adminPrices: { method: 'GET', path: '/v1/admin/prices', auth: 'platformAdmin', response: PricesResponse },
  adminSetPrices: { method: 'POST', path: '/v1/admin/prices', auth: 'platformAdmin', body: PriceGridInput, response: PublishPricesResponse },
  adminTeams: { method: 'GET', path: '/v1/admin/teams', auth: 'platformAdmin', response: TeamsResponse },
  adminGrant: { method: 'POST', path: '/v1/admin/grants', auth: 'platformAdmin', body: GrantRequest, response: WalletMoveResponse },
  adminAdjust: { method: 'POST', path: '/v1/admin/adjust', auth: 'platformAdmin', body: AdjustRequest, response: WalletMoveResponse },
  adminPnl: { method: 'GET', path: '/v1/admin/pnl', auth: 'platformAdmin', query: PnlQuery, response: PnlResponse },
  adminSupport: { method: 'GET', path: '/v1/admin/support', auth: 'platformAdmin', response: SupportListResponse },
  adminAudit: { method: 'GET', path: '/v1/admin/audit', auth: 'platformAdmin', response: AuditResponse },
  adminOverview: { method: 'GET', path: '/v1/admin/overview', auth: 'platformAdmin', response: AdminOverviewResponse },
  adminMachines: { method: 'GET', path: '/v1/admin/machines', auth: 'platformAdmin', response: AdminMachinesResponse },
  adminMachineAction: { method: 'POST', path: '/v1/admin/machines/:id/action', auth: 'platformAdmin', body: AdminMachineActionRequest, response: OkResponse },
  adminBlueprints: { method: 'GET', path: '/v1/admin/blueprints', auth: 'platformAdmin', response: AdminBlueprintsResponse },
  adminPublishBlueprint: { method: 'POST', path: '/v1/admin/blueprints', auth: 'platformAdmin', body: PublishBlueprintRequest, response: z.object({ version: z.number().int() }) }
} as const satisfies Record<string, CloudRoute>

/** Every JSON route of the Cloud, user and admin; the server registers exactly these (plus SIGNED_FILE_PATH, DEVICE_VERIFY_PATH). */
export const ALL_CLOUD_ROUTES = { ...CLOUD_ROUTES, ...CLOUD_ADMIN_ROUTES } as const
export type AnyCloudRouteName = keyof typeof ALL_CLOUD_ROUTES
