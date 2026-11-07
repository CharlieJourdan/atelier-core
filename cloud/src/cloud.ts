// Wires the Cloud's services together. Tests build it in memory with a manual clock and an injected master key; the
// dev server and the admin CLI build it on the data folder.
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Accounts, UNVERIFIED_MESSAGE } from './accounts.ts'
import { Billing } from './billing/service.ts'
import { Blueprints } from './blueprints.ts'
import { FinanceSettings } from './finance-settings.ts'
import { FakePayments, StripePayments, type PaymentProvider } from './billing/payments.ts'
import { Machines, machineProvider } from './machines/service.ts'
import { Support } from './admin.ts'
import { Audit } from './audit.ts'
import { FakeMailer } from './mail/fake.ts'
import { EmailFlows } from './mail/flows.ts'
import { TeamNotices } from './mail/notices.ts'
import { SpendWatch } from './spend-watch.ts'
import { ResendMailer } from './mail/resend.ts'
import { MailService } from './mail/service.ts'
import { EmailTokens } from './mail/tokens.ts'
import type { Mailer } from './mail/types.ts'
import type { PlanId } from './machines/plans.ts'
import { CloudError } from './errors.ts'
import { Auth } from './auth.ts'
import { systemClock, type Clock } from './clock.ts'
import { openCloudDb, type CloudDb } from './db/index.ts'
import { DEFAULT_PUBLIC_URL, Jobs } from './jobs.ts'
import { Pricing } from './pricing.ts'
import { RelayAudit } from './relay/audit.ts'
import { RelayHub, type RelayLimits } from './relay/hub.ts'
import { runpodAdapter, type RunpodSettings } from './runpod/adapter.ts'
import { RunpodClient } from './runpod/client.ts'
import { RunpodWebhooks } from './runpod/webhooks.ts'
import { ProviderRegistry } from './providers/registry.ts'
import type { ProviderAdapter } from './providers/types.ts'
import { openBlobStore, type StorageSettings } from './blobs/index.ts'
import type { BlobStore } from './blobs/types.ts'
import { Invites } from './invites.ts'
import { TeamBackups } from './backups.ts'
import { Kits } from './kits.ts'
import { Releases } from './releases.ts'
import { Storage } from './storage.ts'
import type { Usage } from '../../src/shared/cloud-api.ts'
import { Vault, type KeySource } from './vault.ts'
import { ProviderAlerts } from './provider-alerts.ts'
import { TestTeams } from './test-teams.ts'
import { Wallet } from './wallet.ts'

export interface CloudOptions {
  /** ':memory:' for tests; else the data folder holding cloud.db, signing.key and teams/. */
  dbPath: string
  filesDir: string
  /** Where team files live: the local folder (default) or an S3-compatible bucket (refuses to start without its keys). */
  storage?: StorageSettings
  /** Tests: a ready file store (the fake S3 server's), instead of one built from `storage`. */
  blobStore?: BlobStore
  /** Tests: the fetch the object store uses. */
  storageFetch?: typeof fetch
  /** How long publication kits are kept: days by default and per plan. */
  kits?: { retentionDays?: number; byPlan?: Partial<Record<string, number>>; quotaByPlan?: Partial<Record<string, number>>; maxUploadingKits?: number }
  /** App releases (updates pushed to the testers): the biggest file accepted (default 400 MB; tests shrink it). */
  releases?: { maxFileBytes?: number }
  signingKey: Buffer
  clock?: Clock
  keySource: KeySource | null
  paidCalls: boolean
  env?: NodeJS.ProcessEnv
  realAdapters?: readonly ProviderAdapter[]
  /** Usage → the id of the real adapter the configuration picks (see ProviderRegistry). */
  providers?: Partial<Record<Usage, string>>
  /** Engine ids whose real adapter may serve a job that names them (config.json `realEngines`, decision 0029). */
  engines?: readonly string[]
  /** The founder's HeyGen plan (config.json `heygen.plan`): its monthly fee is published apart on the HeyGen MCP engine. */
  heygenPlan?: 'pro' | 'business'
  fakes?: Partial<Record<Usage, ProviderAdapter>>
  maxCreditsPerJob?: number
  /** Jobs one team may have queued or running at once (default DEFAULT_MAX_OPEN_JOBS_PER_TEAM, decision 0076). */
  maxOpenJobsPerTeam?: number
  retryDelayMs?: number
  /** The longest one provider call may take (Jobs `maxJobMs`; tests make it short). */
  maxJobMs?: (usage: Usage) => number
  /** Jobs running at once, all together (default 8) and per provider (default 4; see jobs.ts). */
  maxConcurrentJobs?: number
  maxJobsPerProvider?: number
  /** The Cloud's public base URL, for signed links and callbacks handed to remote executors (default
   *  http://127.0.0.1:8787). A function is read each time a job builds a URL (a server listening on port 0). */
  publicUrl?: string | (() => string)
  /** When set, `submitGpuJob` runs on RunPod (the fake RunPod in v2) instead of its in-process fake. */
  runpod?: RunpodSettings
  /** `stripe` uses Stripe when its two secrets are in the vault; otherwise (and by default) the simulated payment. */
  payments?: 'fake' | 'stripe'
  /** Tests: the payment provider to use. */
  paymentProvider?: PaymentProvider
  /** Support SSH public keys put on every team computer. */
  machineSshKeys?: readonly string[]
  /** https URL of the app's code (.tar.gz) a new team computer installs (cloud-init); none = copied by hand. */
  machineAppBundleUrl?: string
  /** The brain relay's limits (timeouts, sizes, rates); tests shorten them. */
  relay?: Partial<RelayLimits>
  /** E-mails: `fake` (default) keeps them in the database (`mail list`); `resend` needs RESEND_API_KEY in the vault, a
   *  `from` address on a domain verified in Resend and the website's address (`siteUrl`) the links point to. */
  mail?: { kind: 'fake' | 'resend'; from?: string; siteUrl?: string }
  /** Tests: the mailer to use instead of the configured one. */
  mailer?: Mailer
}

export interface Cloud {
  db: CloudDb
  clock: Clock
  audit: Audit
  accounts: Accounts
  auth: Auth
  /** Test teams and their headless brains' keys (record 0066). */
  testTeams: TestTeams
  wallet: Wallet
  pricing: Pricing
  vault: Vault
  storage: Storage
  /** The videos' publication kits (texts + files kept for the team to download). */
  kits: Kits
  /** The team computers' encrypted backups (kept 14 days, the newest always). */
  backups: TeamBackups
  /** The app's releases and their update feed (electron-updater's generic provider). */
  releases: Releases
  registry: ProviderRegistry
  /** The founder's HeyGen plan (its fee is published apart on `GET /v1/engines`). */
  heygenPlan: 'pro' | 'business'
  /** Providers that need the founder's hand (HeyGen's MCP sign-in): shown in the founder console. */
  providerAlerts: ProviderAlerts
  /** Unusual spend: alerts and tells, never blocks (decision 0076). */
  spendWatch: SpendWatch
  jobs: Jobs
  /** RunPod callbacks: signatures and the adapters waiting for them. */
  webhooks: RunpodWebhooks
  support: Support
  billing: Billing
  blueprints: Blueprints
  /** The founder's money settings: the price multiplier, the $ → € rate, the fixed costs (decision 0040). */
  finance: FinanceSettings
  /** The payment provider billing uses (Stripe, or the simulated payment). */
  payments: PaymentProvider
  /** E-mails: the queue that sends them, the account flows (verify, reset), and the fake mailer's outbox (null with Resend). */
  mail: MailService
  emailFlows: EmailFlows
  outbox: FakeMailer | null
  /** Team invitations by e-mail (single-use links). */
  invites: Invites
  /** The team computers (built on first use: the real provider reads its token from the vault then). */
  machines: () => Machines
  /** The team computers' brain relay (in memory) and its audit of who called which method. */
  relay: RelayHub
  relayAudit: RelayAudit
  close(): Promise<void>
}

export function createCloud(o: CloudOptions): Cloud {
  const db = openCloudDb(o.dbPath)
  try {
    return buildCloud(o, db)
  } catch (err) {
    // refusing to start (a missing key, a bad setting) must not leave the database open
    db.close()
    throw err
  }
}

function buildCloud(o: CloudOptions, db: CloudDb): Cloud {
  const clock = o.clock ?? systemClock
  // The vault is built after the audit log, which masks with it: the closure reads it once both exist.
  let vault: Vault | null = null
  const audit = new Audit(db, clock, (s) => (vault ? vault.mask(s) : s))
  vault = new Vault(db, clock, audit, o.keySource)
  const accounts = new Accounts(db, clock, audit)
  const wallet = new Wallet(db, clock, audit)
  const pricing = new Pricing(db, clock, audit)
  const blobs = o.blobStore ?? openBlobStore({ settings: o.storage, filesDir: o.filesDir, vault, fetchImpl: o.storageFetch, now: () => new Date(clock.now()) })
  const storage = new Storage(db, clock, blobs, o.signingKey)
  const kits = new Kits({
    db,
    clock,
    audit,
    blobs,
    storage,
    ...(o.kits?.retentionDays ? { retentionDays: o.kits.retentionDays } : {}),
    ...(o.kits?.byPlan ? { retentionByPlan: o.kits.byPlan } : {}),
    ...(o.kits?.quotaByPlan ? { quotaByPlan: o.kits.quotaByPlan } : {}),
    ...(o.kits?.maxUploadingKits ? { maxUploadingKits: o.kits.maxUploadingKits } : {})
  })
  const backups = new TeamBackups({ db, clock, audit, blobs })
  const releases = new Releases({ db, clock, audit, blobs, ...(o.releases?.maxFileBytes ? { maxFileBytes: o.releases.maxFileBytes } : {}) })
  const webhooks = new RunpodWebhooks(o.signingKey)
  let fakes = o.fakes
  if (o.runpod) {
    const rp = o.runpod
    const gpu = runpodAdapter({
      client: new RunpodClient({ baseUrl: rp.baseUrl, apiKey: rp.apiKey, ...(rp.fetchImpl ? { fetchImpl: rp.fetchImpl } : {}) }),
      endpoints: rp.endpoints,
      kind: 'fake',
      fileRoot: rp.fileRoot,
      pollMs: rp.pollMs,
      waiters: webhooks
    })
    fakes = { submitGpuJob: gpu, ...o.fakes }
  }
  const registry = new ProviderRegistry({ paidCalls: o.paidCalls, vault, real: o.realAdapters, ...(o.providers ? { select: o.providers } : {}), ...(o.engines ? { engines: o.engines } : {}), fakes, env: o.env })
  const publicUrl = o.publicUrl
  const readPublicUrl = typeof publicUrl === 'function' ? publicUrl : () => publicUrl ?? DEFAULT_PUBLIC_URL
  const providerAlerts = new ProviderAlerts(db, clock, (s) => vault.mask(s))
  const jobs = new Jobs({
    db,
    clock,
    wallet,
    pricing,
    storage,
    registry,
    vault,
    alerts: providerAlerts,
    maxCreditsPerJob: o.maxCreditsPerJob,
    retryDelayMs: o.retryDelayMs ?? 1000,
    ...(o.maxJobMs ? { maxJobMs: o.maxJobMs } : {}),
    ...(o.maxConcurrentJobs !== undefined ? { maxConcurrent: o.maxConcurrentJobs } : {}),
    ...(o.maxJobsPerProvider !== undefined ? { maxPerProvider: o.maxJobsPerProvider } : {}),
    ...(o.maxOpenJobsPerTeam !== undefined ? { maxOpenPerTeam: o.maxOpenJobsPerTeam } : {}),
    publicUrl: readPublicUrl,
    callbackPath: (jobId) => webhooks.callbackPath(jobId),
    onSpent: (teamId) => {
      void billing.autoRecharge(teamId).catch(() => undefined)
      // never blocks: an unusual day tells the founder and the team (decision 0076)
      try {
        spendWatch.check(teamId)
      } catch {
        // a failed check never touches the job
      }
    }
  })
  let machines: Machines | null = null
  const machinesOf = (): Machines => (machines ??= new Machines({ db, clock, audit, provider: machineProvider({ paidCalls: o.paidCalls, vault }), cloudUrl: readPublicUrl(), sshKeys: o.machineSshKeys ?? [], ...(o.machineAppBundleUrl ? { appBundleUrl: o.machineAppBundleUrl } : {}) }))
  const mailer = chooseMailer(o, db, clock, vault)
  const mail = new MailService({ db, clock, audit, mailer, siteUrl: o.mail?.siteUrl ?? 'http://localhost:5190' })
  const notices = new TeamNotices(accounts, mail)
  const spendWatch = new SpendWatch({ db, clock, audit, alerts: providerAlerts, tell: (teamId, credits, usual, day) => notices.unusualSpend(teamId, credits, usual, day) })
  if (o.payments === 'stripe' && !o.paymentProvider && !(vault.has('STRIPE_SECRET_KEY') && vault.has('STRIPE_WEBHOOK_SECRET'))) {
    // never fall back to the simulated payment when real payments were asked for: it would hand out free plans
    throw new Error('payments is "stripe" but STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is missing from the vault')
  }
  const payments: PaymentProvider =
    o.paymentProvider ??
    (o.payments === 'stripe'
      ? new StripePayments({ secretKey: vault.readForAdapter('STRIPE_SECRET_KEY', 'stripe'), webhookSecret: vault.readForAdapter('STRIPE_WEBHOOK_SECRET', 'stripe') })
      : new FakePayments())
  // Computers are created for a paid plan once someone who pays for the team has a confirmed address, and the team is told.
  const provisionTeam = async (teamId: string, plan: PlanId): Promise<void> => {
    if (!accounts.billingContacts(teamId).some((a) => a.emailVerified)) throw new CloudError('forbidden', UNVERIFIED_MESSAGE)
    const made = await machinesOf().provision(teamId, plan, 'billing')
    notices.machinesReady(teamId, plan, made.filter((m) => m.status === 'running').map((m) => m.id))
  }
  const billing: Billing = new Billing({
    db,
    clock,
    audit,
    wallet,
    payments,
    onSubscribed: (teamId, plan) => provisionTeam(teamId, plan),
    notify: (n) => notices.billing(n),
    onCanceled: async (teamId) => {
      for (const m of machinesOf().list(teamId)) if (m.status === 'running') await machinesOf().hibernate(m.id, 'billing')
    }
  })
  // the relay re-reads the machine's credential from the database before handing it a call: a revocation by the admin
  // tool (another process) cuts the live relay too
  const relay = new RelayHub(clock, o.relay, (machineId) => machinesOf().credentials.has(machineId))
  const auth = new Auth(db, clock, audit, accounts)
  // an address was just confirmed: a plan paid before gets its computers now
  const emailFlows = new EmailFlows({
    db,
    clock,
    audit,
    accounts,
    auth,
    tokens: new EmailTokens(db, clock),
    mail,
    onVerified: (accountId) => {
      for (const teamId of accounts.teamsOf(accountId)) {
        const sub = billing.status(teamId).subscription
        if (sub && sub.status !== 'canceled') billing.later(teamId, () => provisionTeam(teamId, sub.plan))
      }
    }
  })
  return {
    db,
    clock,
    audit,
    accounts,
    auth,
    testTeams: new TestTeams({ db, clock, audit, accounts, auth, wallet }),
    wallet,
    pricing,
    vault,
    storage,
    kits,
    backups,
    releases,
    registry,
    heygenPlan: o.heygenPlan ?? 'pro',
    providerAlerts,
    spendWatch,
    jobs,
    webhooks,
    support: new Support(db, clock),
    billing,
    blueprints: new Blueprints(db, clock, audit),
    finance: new FinanceSettings(db, clock, audit),
    payments,
    mail,
    emailFlows,
    outbox: mailer instanceof FakeMailer ? mailer : null,
    invites: new Invites({ db, clock, audit, accounts, auth, mail }),
    machines: machinesOf,
    relay,
    relayAudit: new RelayAudit(db, clock),
    async close() {
      relay.close()
      await jobs.stop()
      db.close()
    }
  }
}

/** The configured mailer. Real e-mail is never a silent fallback: "resend" without its key, sender or site address refuses to start. */
export function chooseMailer(o: CloudOptions, db: CloudDb, clock: Clock, vault: Vault): Mailer {
  if (o.mailer) return o.mailer
  if (o.mail?.kind !== 'resend') return new FakeMailer(db, clock)
  if (!vault.has('RESEND_API_KEY')) throw new Error('mail is "resend" but RESEND_API_KEY is missing from the vault')
  if (!o.mail.from) throw new Error('mail is "resend" but mail.from is not set (a sender on a domain verified in Resend)')
  if (!o.mail.siteUrl) throw new Error('mail is "resend" but the website address is unknown (set mail.siteUrl or siteOrigins in config.json)')
  return new ResendMailer({ apiKey: vault.readForAdapter('RESEND_API_KEY', 'resend'), from: o.mail.from })
}

/** The data folder's link-signing key, created on first use (32 random bytes, mode 0600). */
export function signingKeyFor(dataDir: string): Buffer {
  const path = join(dataDir, 'signing.key')
  if (!existsSync(path)) writeFileSync(path, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' })
  return Buffer.from(readFileSync(path, 'utf8').trim(), 'hex')
}
