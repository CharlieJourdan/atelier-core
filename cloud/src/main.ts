// `npm run cloud:dev`: Atelier Cloud on 127.0.0.1:8787 (loopback only), on the data folder (ATELIER_CLOUD_DATA, else
// ~/.atelier-cloud), with the fake providers unless config.json says "paidCalls": "on" — and even then only for
// usages that config.json's "providers" sets to a real adapter (minimax, elevenlabs, gemini) AND whose key is in the
// vault. GPU jobs run on a local fake RunPod (worker processes of our engine) unless config.json says "fakeRunpod": "off".
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createCloud, signingKeyFor } from './cloud.ts'
import { dataDirFromEnv, loadConfig, mailOptions } from './config.ts'
import { HOUR_MS } from './clock.ts'
import { REPO_ROOT, keySourceFromEnv } from './keysource.ts'
import { buildServer } from './http/server.ts'
import { realProviders } from './providers/real.ts'
import { fakeRunpodOptions, startFakeRunpod, type FakeRunpod } from './runpod/fake.ts'

/** The pod is "another machine": none of the Cloud's own keys or tokens reach its environment. */
function podEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !/KEY|TOKEN|SECRET|PASSWORD|ATELIER_CLOUD/i.test(k)))
}

function workerCommand(dataDir: string): string[] {
  return [
    process.execPath,
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    '--disable-warning=ExperimentalWarning',
    '--experimental-transform-types',
    '--import',
    pathToFileURL(join(REPO_ROOT, 'scripts', 'ts-resolve.mjs')).href,
    join(REPO_ROOT, 'src', 'engine', 'worker', 'main.ts'),
    '--data',
    join(dataDir, 'runpod-worker'),
    '--resources',
    join(REPO_ROOT, 'resources')
  ]
}

async function main(): Promise<void> {
  const dataDir = dataDirFromEnv()
  const cfg = loadConfig(dataDir)
  let fake: FakeRunpod | null = null
  if (cfg.fakeRunpod === 'on') {
    mkdirSync(join(dataDir, 'runpod-worker'), { recursive: true })
    fake = await startFakeRunpod({
      workerCommand: workerCommand(dataDir),
      workDir: join(dataDir, 'runpod-fake'),
      apiKey: randomBytes(24).toString('base64url'),
      env: podEnv(process.env)
    })
  }
  // Until the server listens, the configured address; then (no publicUrl in config.json) the real one.
  let publicUrl = cfg.publicUrl ?? `http://${cfg.host === '::1' ? '[::1]' : cfg.host}:${cfg.port}`
  const real = realProviders(cfg)
  const cloud = createCloud({
    realAdapters: real.adapters,
    providers: real.select,
    engines: real.engines,
    heygenPlan: cfg.heygen.plan,
    dbPath: join(dataDir, 'cloud.db'),
    filesDir: dataDir,
    storage: cfg.storage,
    kits: cfg.kits,
    signingKey: signingKeyFor(dataDir),
    keySource: keySourceFromEnv(),
    paidCalls: cfg.paidCalls === 'on',
    maxCreditsPerJob: cfg.maxCreditsPerJob,
    retryDelayMs: cfg.retryDelayMs,
    maxConcurrentJobs: cfg.maxConcurrentJobs,
    maxJobsPerProvider: cfg.maxJobsPerProvider,
    publicUrl: () => publicUrl,
    payments: cfg.payments,
    mail: mailOptions(cfg),
    machineSshKeys: cfg.machines.sshKeys,
    ...(cfg.machines.appBundleUrl ? { machineAppBundleUrl: cfg.machines.appBundleUrl } : {}),
    relay: cfg.relay,
    ...(fake ? { runpod: fakeRunpodOptions(fake) } : {})
  })
  cloud.vault.primeMask()
  await cloud.jobs.recover()
  cloud.jobs.sweep()
  void cloud.kits.sweep().catch(() => undefined)
  void cloud.backups.sweep().catch(() => undefined)
  const sweeper = setInterval(() => {
    cloud.jobs.sweep()
    void cloud.kits.sweep().catch(() => undefined)
    void cloud.backups.sweep().catch(() => undefined)
  }, HOUR_MS)
  sweeper.unref()

  // uploads cut short by a crash or a restart leave their temporary files: none of them is still being received
  rmSync(join(dataDir, 'incoming'), { recursive: true, force: true })
  const app = buildServer(cloud, {
    requestsPerMinute: cfg.requestsPerMinute,
    media: { perMinute: cfg.mediaSearchesPerMinute },
    logger: { level: process.env.ATELIER_CLOUD_LOG ?? 'info' },
    publicHosts: cfg.publicHosts,
    // raw uploads are streamed here (same disk as the data), then moved to the file store
    uploadsDir: join(dataDir, 'incoming'),
    ...(cfg.publicUrl ? { publicUrl: cfg.publicUrl } : {}),
    ...(cfg.siteOrigins ? { siteOrigins: cfg.siteOrigins } : {})
  })
  const address = await app.listen({ host: cfg.host, port: cfg.port })
  if (!cfg.publicUrl) publicUrl = address
  const realUsages = cloud.registry.overview().filter((o) => o.status === 'real')
  const demo = cloud.registry.paidCalls
    ? `paidCalls ON — real: ${realUsages.length ? realUsages.map((o) => `${o.usage}=${o.provider}`).join(', ') : 'none (config or vault missing)'}`
    : 'paidCalls off: every provider is a demo'
  const gpu = fake ? `GPU jobs on the fake RunPod ${fake.url}` : 'GPU jobs on the in-process fake'
  process.stdout.write(`atelier-cloud listening on ${address} — data ${dataDir} — ${demo} — ${gpu}\n`)

  let closing = false
  const shutdown = async (): Promise<void> => {
    if (closing) return
    closing = true
    clearInterval(sweeper)
    await app.close()
    await cloud.close()
    await fake?.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch((err: unknown) => {
  process.stderr.write(`atelier-cloud failed to start: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
