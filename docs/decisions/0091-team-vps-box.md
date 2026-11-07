# 0091. The team VPS is tested as a customer gets it: brain in the box, Claude Code in the image, CPU pools from the quota

Date: 2026-11-04. Status: accepted. Decided by: Claude (vps-essai). Builds on 0084
and 0087.

## Context
The headless brain ran inside the simulated 4 vCPU / 8 GB VPS (Docker), signed in to the test team through the beta Cloud's
public address.
- The real documentary stopped at its script: the box had no Claude subscription (0038), and its owner signs in himself (0013).
- Free demo runs measured the box. The documentary's render filled the 8 GB: 20 processes killed, the film lost. Node's
  `os.cpus()` lists the host's 28 cores inside a 4-CPU container, so 14 ffmpeg ran at once.
- A brain killed mid-render left its ffmpeg as zombies under the keeper, which runs as PID 1.

## Decision
1. **CPU pools follow `availableParallelism()`** (the cgroup quota), never `os.cpus().length`. This holds in the engine and in
   anything that sizes a pool by cores (`src/engine/render/workers.ts`). Serverless workers and quota VPSs show the host's cores.
2. **The team VPS image carries the unmodified Claude Code CLI** (`deploy/team-vps/Dockerfile`, on top of the render-worker
   image). The owner signs in inside the box (`vps-brain login` prints the command); Atelier never handles the credential.
3. **The box's PID 1 is an init**: `docker run --init` here, systemd on a real VPS. The keeper is never PID 1 alone.
4. **A session tests the team VPS with `scripts/vps-brain.mjs` + `scripts/brain-run.mjs`**. The brain's data sits on a volume
   (the VPS's own disk). `brain-run` checks the brain's folder as the box sees it (`brainData`). Free demo runs use
   `brain-run run --demo`, which is refused if the quote debits anything.

## Consequences
- Without the owner's Claude sign-in, a customer's VPS makes no real video (script and director are locked). Onboarding must
  put « connect your Claude » before the first production. The sign-in happens in a terminal on the VPS (remote screen or
  `docker exec`).
- A 3-min demo documentary renders in 22 min at 400 % CPU on the box, 5.9 GB peak, 0 OOM. The remote worker (0087) is what
  frees the VPS.
- The real paid runs and the paid kill test are waiting for Charlie's one-time `/login` in the box.
