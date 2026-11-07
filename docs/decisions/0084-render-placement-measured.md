# 0084. Where each step runs, measured: a 4/8 team VPS per user, renders on serverless CPU, Whisper on a rented GPU

Date: 2026-11-03. Status: accepted by Charlie on 2026-11-03 (architecture; providers confirmed before any order). Decided by: Claude (infra-rendu), on
Charlie's question (where each part runs, on what, at what cost; nothing on the user's computer). Confirms 0012 and 0015 with measurements; refines 0026's team-computer size.

## Context
Measured on the beta PC on 2026-11-03 with free demos:
- The render (motion frames, assembly, captions, x264, QC) is CPU-only (GPU idle) and needs 350-510 core-seconds per
  finished minute, 6-7 GB RAM at its peak. That is ≈ 190 s of wall per finished minute on 4 small cores.
- Whisper large-v3 takes 15 s per minute of audio on a GPU and more than 16× the audio on 4 CPU cores.
- Real videos spend most of their time waiting for providers (≈ 95 of 144 minutes for a 13-minute video), not rendering.

Prices on 2026-11-03:
- Hetzner Cloud is still unorderable (notice open since 2026-06-26).
- OVH VPS-2 (4/8) costs 7.21 € and Contabo (4/8) ≈ 5.50 €.
- Scaleway Serverless Jobs costs €0.00001 per vCPU-second; Modal costs $0.0000131 per physical-core-second.
- RunPod serverless 24 GB costs $0.00019 per second.

## Decision
- **Team computer:** one always-on Linux VPS per user, **4 vCPU / 8 GB**. 2 / 4 GB is too tight with Claude Code and a
  browser. Providers, in order: OVH VPS-2, Contabo Cloud VPS 4, Hetzner CX33 when it can be ordered again. It is created at
  subscription time, never when a video waits. It runs the agents, the user's own Claude Code login and a browser.
- **Renders** run as serverless CPU jobs that the Cloud submits: Scaleway Jobs (Paris) first, Modal second, the team VPS
  itself as the last fallback, so production never blocks. Cost ≈ 0.01 € per finished minute, included in the plan. No GPU
  for renders.
- **Whisper large-v3** (`words.align`, the eyes' counting) runs on a RunPod serverless GPU (24 GB, flex), ≈ 0.006 $ per
  minute. Fallbacks: Whisper `small` on the VPS CPU, then the voice's own word times.
- **Testers before the serverless executor exists:** an 8-vCPU VPS that renders itself (≈ 11-16 €) is acceptable.
- **Owned render servers** (two AX42-class, N+1) only past ≈ 100 active users; serverless stays the overflow.
- **No hardware to buy**, for users or for Charlie.
- The Cloud holds every compute token, gives jobs per-job R2 links only, and meters job seconds (server-authoritative money).
- The user's Claude subscription on the rented VPS keeps 0013's conditions:
  - Commercial Terms accepted;
  - unmodified binary;
  - sign-in through Anthropic's own flow;
  - one VPS per user;
  - we bill the VPS, never Claude usage.
  Written confirmation from Anthropic comes before selling.

## Consequences
- `cloud/src/machines`:
  - add OVH and Contabo providers next to Hetzner;
  - `plans.ts` starts at a 4/8 machine on every plan (today CX33, which is right; 0015's « CX23 » is superseded).
- A remote render executor (job bundle → serverless → R2) and a chunked render are the next infra chantiers. GPU Whisper
  goes through `submitGpuJob`.
- First real measurements to make (< 0.50 €): one hour on an OVH VPS-2 and a Scaleway job, to replace the +30 % vCPU guess.
