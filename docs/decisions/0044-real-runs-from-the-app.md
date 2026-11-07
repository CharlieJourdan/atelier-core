# 0044. Real runs from the app: « Moteur réel » per run, the Cloud's jobs are the wallet

Date: 2026-11-01. Status: accepted. Decided by: Charlie (brief of production-16) + Claude.

## Context
The real tests (record 0043) proved the providers through the Cloud's CLI, but every production run of the app was still a
demo: `ProductionRuns` ran with `demo: true` and never received the production host (`createProductionHost`, written for lot
P7), so a run of `avatar@1` spent nothing and rendered fakes, even with real engines and keys in the Cloud.

## Decision
1. **Real is per run, never a global mode.** A run goes real only when it is started with `real: true`: the owner's click
   (« Moteur réel (bêta) » in the launch panel, off by default, one line of explanation, the quote and the Cloud balance shown
   first) or an agent's `production.start` with `real: true` once Charlie approved it in that task (`ask_human`); automations
   and agents without approval make demo runs. A run cannot go real while the app (or the brain) is signed out.
2. **The Cloud's jobs are the wallet of a real run.** No run-level hold: before the run, its quote (the Cloud's published
   prices) is checked against the Cloud wallet; before each paid node, the `CreditSpender` checks the video's cap and the
   wallet; each Cloud job holds its quote, captures on success and releases on failure or cancel (cloud/src/jobs.ts). The
   local Z1 wallet (`demo: false` without the Cloud) stays for its tests only.
3. **Nodes run here, paid items go to the Cloud.** A real run's nodes run in the app's process like a demo run's, with their
   real code; the engine's Cloud client is made per node, so every job is recorded with the node that made it
   (`video_run_jobs`, migration 035). The local worker process (lot P5) is not used by app runs yet.
4. **The Cloud says which engine ran.** `Job.provider` (optional in the contract) is the adapter id; the run view shows, under
   each brick, its engines, real or the Cloud's demo, and their credits; a node's and a run's cost are the sums of their
   succeeded jobs (a job replayed by a retry is one row).
5. **The director and the script keep decision 0038**: they run on Claude (the script on the subscription, the director on
   the subscription or the API key), never on Cloud credits.
6. **Channel assets**: voice clone and design already went through the Cloud (production-5). A real run's presenter
   registrations (engine → id) are kept on the channel's default presenter and passed as the avatar id by its next runs.
   The sponsor clip is read where the render runs (the app or the brain): it never goes to a provider.

## Consequences
- The headless brain gets the same path (same core), so the team computer can make real runs; its RPC takes
  `projects.quote(id, { real })` and `projects.run(id, { real })`.
- No real engine returns a registration yet: HeyGen MCP re-uploads the portrait as a HeyGen asset on every call. Returning
  that asset id as `registration` (and reusing it) is a follow-up in `cloud/src/providers/heygen-mcp.ts`.
- With no director backend (no subscription, no API key) a real run still stops at the thumbnail and packaging steps, as a
  demo run with Claude would; the imported script and the director's scene pass fall back without a model.
