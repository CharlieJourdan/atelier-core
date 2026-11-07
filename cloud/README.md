# Atelier Cloud (local, v2)

The service that holds the provider keys, the credit wallet and the jobs (PLAN-V2-PRODUCTION §4). In v2 it runs on
H1 or the Mac, on the loopback only, with a fake provider for every usage. The app talks to it from its main process
(lot P5); from the Mac it reaches H1's Cloud through the SSH tunnel.

Fastify + `node:sqlite`, TypeScript run by Node's own type stripping (no build step; imports carry `.ts`). The HTTP
contract is `src/shared/cloud-api.ts`, shared with the app.

## Commands (from the repository root)

```
npm run cloud:dev                          # 127.0.0.1:8787, data in $ATELIER_CLOUD_DATA or ~/.atelier-cloud
npm run cloud -- key init /abs/path/master.key      # new master key (0600), outside the repo
npm run cloud -- vault set MINIMAX_API_KEY          # value typed without echo, never in argv (also ELEVENLABS_API_KEY, GEMINI_API_KEY)
npm run cloud -- providers status                   # which usage is real or demo, and why
npm run cloud -- providers try synthesize --voice ID --out FILE   # ONE small real call (paidCalls on + key); see docs/PROVIDERS.md
npm run cloud -- vault list                         # names and dates only
npm run cloud -- admin user add --email you@example.com --name Charlie --platform-admin --internal
npm run cloud -- admin grant --team team_… --credits 1000
npm run cloud -- admin test-team create --name "Tests Atelier" --credits 5000 --key-file /abs/path/test-brain.token
                                                    # a test team for our headless brains (record 0066): its member has no
                                                    # password; the key goes to the file (0600, never printed, never overwritten)
npm run cloud -- admin test-team list | key --team team_… --key-file PATH | revoke --team team_…
npm run cloud -- admin price show | set ITEM --margin 10 | set ITEM --fixed 25 | credit-value 0.01
npm run cloud -- admin pnl --from 2026-10-01 --to 2026-10-31 [--demo]
npm run cloud -- mail list [--to ADDRESS] | mail show ID   # the e-mails the fake mailer kept (verification and reset links)
npm run cloud -- admin user verify --email ADDRESS        # confirm an address by hand (support)
npm run smoke:cloud                        # the end-to-end smoke (free, fakes only)
```

Environment: `ATELIER_CLOUD_DATA` (data folder), `ATELIER_CLOUD_MASTER_KEY_FILE` (absolute path, 0600 on macOS),
`ATELIER_CLOUD_KEYCHAIN=1` (macOS: key from the Keychain, service `atelier-cloud`, account `master-key`),
`ATELIER_CLOUD_PORT`, `ATELIER_CLOUD_LOG` (pino level), `ATELIER_CLOUD_MAX_JOBS` (jobs running at once, default 8) and
`ATELIER_CLOUD_MAX_JOBS_PER_PROVIDER` (default 4; HeyGen's MCP plan 3), also `maxConcurrentJobs` / `maxJobsPerProvider` in config.json.

`<data>/config.json` (all optional): `{"paidCalls": "off", "host": "127.0.0.1", "port": 8787, "maxCreditsPerJob": 100000,
"requestsPerMinute": 300, "retryDelayMs": 1000}`. `paidCalls` stays off unless it says `"on"`; even then a usage is real
only with a real adapter (none in this version) and its key in the vault, and never in a test run.

Files live in the data folder by default. `"storage": {"kind": "s3", "endpoint": "https://<account>.r2.cloudflarestorage.com", "bucket": "...", "region": "auto"}`
puts them in an S3-compatible bucket (Cloudflare R2; vault: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; the Cloud refuses to start
without them). Downloads are presigned links to the bucket. `"kits": {"retentionDays": 90, "byPlan": {"starter": 30}}` sets how long
publication kits (`src/kits.ts`, contract `src/shared/cloud-kit.ts`) are kept. See docs/DEPLOY.md section 6 bis.

## Layout

```
src/main.ts           the dev server          src/cli.ts        the admin tool
src/cloud.ts          wiring                  src/config.ts     config.json, data folder
src/db/               SQLite + own migrations src/http/         Fastify app, contract routes, /device page, /files
src/auth.ts           device login, PKCE, tokens, devices
src/accounts.ts       accounts, teams, members, caps
src/wallet.ts         grant/hold/capture/release/adjust      src/pricing.ts   grids, formula, quotes
src/vault.ts          AES-256-GCM vault       src/keysource.ts  master key: file, Keychain, injected
src/jobs.ts           jobs, retries, cancel, events          src/storage.ts   team files, signed links
src/blobs/            file stores: local folder, S3/R2 (own SigV4, multipart, presigned links)    src/kits.ts   publication kits
src/providers/        interface, one fake per usage, real adapters (minimax, elevenlabs, gemini), registry + paidCalls guard
src/admin.ts          P&L, support            src/audit.ts      audit log
src/mail/             e-mails: fake (outbox table) and Resend mailers, FR/EN templates, verification + reset flows, billing notices
tests/                vitest (run by `npm test`)
```
