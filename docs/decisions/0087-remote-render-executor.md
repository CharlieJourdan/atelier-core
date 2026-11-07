# 0087. Heavy renders go through one queue per team computer, to serverless workers by links, the VPS as fallback

Date: 2026-11-03. Status: accepted (implements 0084, accepted by Charlie on 2026-11-03). Decided by: Claude (vps-rendu).

## Context
The 4 vCPU / 8 GB team VPS of 0084 was simulated in Docker. Real productions of the app ran in it on stand-in engines.
- One production at a time passes. Measured: 18-40 s and 2.1-4.4 GB per one-minute film; heavy engine demos 199-258 s and
  6.1-7.8 GB, with no process killed.
- Whisper on the processor loaded large-v3 first: 145 s and the box's whole 8 GB for a short.
- Ten productions at once, rendered unqueued in the box: 14 processes killed for memory and 3 films lost.
- With the renders sent to separate workers, the box stays under 1 GB while a film is assembled. It made 9 of 10 films in 117 s.
- The Cloud's per-account limits (300 requests, 20 media searches a minute) stop ten productions of one team before any render
  does.

## Decision
1. **One renderer per team computer** wraps the `local` executor of every run (`createRemoteRenderer`). It handles
   `render.assemble`, `motion.render` and `words.align`; every other node is untouched.
2. **Remote first, by links only.** A remote render is a job made of the worker protocol's node, its input files as presigned
   GET links, 64 PUT slots and a result slot (`src/shared/render-job.ts`). The worker image (`deploy/render-worker`,
   `scripts/render-job.ts`) gets one value, `ATELIER_JOB_URL`. No provider key and no Cloud token ever reach the worker.
3. **Providers in order: Scaleway Jobs, Modal, RunPod.** One that is down, fails or passes its timeout hands over to the next.
   The adapters (`cloud/src/render/starters.ts`) are written from the public docs and read their keys from the vault
   (`RENDER_SECRETS`). They are never called without those keys and `paidCalls` on.
4. **The VPS as the last fallback, queued.**
   - At most `defaultLocalRenders(memory)` heavy renders at once on the machine (1 on 8 GB, 2 on 16 GB, at most 4), using the
     container's limit when there is one. This is now the default even with no provider.
   - The other renders wait their turn; production never blocks.
   - A node's own refusal (a permanent error from the worker) is final, and a cancel never falls back.
5. **Whisper without a graphics card uses `small`.** The program never loads the GPU model on a machine without CUDA.
   large-v3 stays the model on a GPU (0084: a RunPod GPU later).
6. **Each heavy render is recorded** (`RenderJobRecord`: where, seconds waited, seconds billed, euros at `RENDER_PRICES`).
7. **Temporary files beside shared caches carry a random tag.** One process runs several productions, and the process id alone
   collided.

## Consequences
- Proofs:
  - `tests/unit/remote-render.test.ts`: the fake provider end to end, fallback, timeout, refusal, cancel, queues, prices;
  - `cloud/tests/cloud-render-starters.test.ts`: the three adapters on recorded fetches; `render try` refuses without
    paidCalls, keys or a bucket;
  - `tests/unit/words-align.test.ts`: the CPU model;
  - `node scripts/vps-sim.mjs` (Docker) reproduces every number of the research.
- `npm run cloud -- render status | render try` runs ONE real remote render of a captured job on the Cloud's R2 bucket.
  `deploy/render-worker/README.md` lists the accounts and keys.
- Not done:
  - the app → Cloud route that submits remote renders for a team (the Cloud owns the tokens, 0084);
  - the chunked render;
  - the Cloud limits for ten productions of one team;
  - documentary@2's archive searches under concurrency.
