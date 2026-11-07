# 0012. Where work runs: never the user's computer; renders on demand, generation in the Cloud
Date: 2026-10-30. Status: accepted. Decided by: Charlie (his words of 2026-10-24 and 10-30, production-1).

## Context
Charlie: each plan includes a small dedicated virtual PC
for the agent « un pc virtuel que l'agent va pouvoir utiliser » (10-24); heavier tasks go to cloud rendering; and his
latest word, « on va jamais utiliser l'ordinateur de l'utilisateur » (10-24, [LATEST]). For the beta, his own PC plays
the team computer (« sers-toi de ce PC comme exemple de « PC de l'équipe » »). Whether one bigger PC per plan also
renders, or a small PC with renders elsewhere, was open (§13).

Research of 2026-10-30:
- x264 1080p is cheap on CPU: about 4 min (8 vCPU) to 9 min (4 vCPU) of wall time for a 10-minute video with our
  filters (estimate ×2 over measured encode speed); a month of one user (20 long + 30 shorts) is ~90 minutes of one
  8-core machine. Rendering costs ≈ 0,03 € per finished minute on the user's own VM, ≈ 0,002 € in a shared pool.
- Hetzner Cloud prices after 2026-06-15: CX33 (4 vCPU / 8 GB) 8,99 €, CX43 (8 / 16) 16,49 €, CX53 (16 / 32) 29,99 €
  a month; **every Hetzner Cloud type shows « currently unavailable » on 2026-10-30** (status notice since 06-26).
  A dedicated AX42 (8 cores, 64 GB) is 97,30 € a month + 49 € setup and could render for ~300 users.
- A talking-avatar model (14B class) does not run usefully on a CPU VM: hosted API or rented GPU.

## Decision
- **Never on the end user's computer.** The desktop and web apps are clients; nothing heavy runs on them.
- **Assembly, motion, captions, music mix, QC run behind a `renderer` interface**: on the team computer in the beta,
  on shared machines billed per second for paying users (below); recipes never depend on where they render.
- **Beta:** the owner's PC is the team computer (as today, `scripts/beta/team-pc.ps1`; later H1, a dedicated server).
- **Paid generation (voice, images, AI video, avatar, transcription) runs through the Cloud** (0003): a provider's
  API, or a GPU job on a rented GPU (`submitGpuJob`, `cloud/src/runpod/`), behind the same usage.
- **For paying users (0015, Charlie's answer):** a very small always-on team computer per team for the agents
  (Claude Code with the user's own login, a browser), and **renders on demand on shared machines billed per
  second**, never on that small PC once the pool exists. No GPU for assembly.
- **The avatar provider waits for Charlie's case study** (0014); candidates: hosted APIs and an open model on a rented
  GPU (benchmark needed).

## Consequences
- Rendering is close to free per video; the cost of a team computer is a fixed monthly line per plan.
- Hetzner supply is the main infra risk: a second provider is needed before selling (0015).
- First infra action before selling: a one-hour benchmark of the real ffmpeg graph on a cloud VM (free on Charlie's
  PC for the beta numbers).
