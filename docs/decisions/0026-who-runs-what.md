# 0026. Who runs each step, what it costs with or without Claude Code, and where renders run
Date: 2026-10-31. Status: accepted. Decided by: the spec-avatar chantier, on Charlie's request of 10-31 (« il va
falloir que ce soit à toi de faire le choix »). Extends 0013; confirms 0012 and 0015. Spec:
`docs/specs/production-model.md` §9, `docs/specs/pipeline-avatar.md` §10.

## Context
Charlie: script, director and editing are free on the user's Claude Code but may cost a lot on an API; the app must say
what each step costs depending on whether Claude Code is connected, and propose connecting it. He also asks whether
renders should run on rented GPUs, on a small per-user virtual PC, or per render.

## Decision
- **Script, director, checks, metadata** run on any LLM backend (0013): free on « mon abonnement », about 0,05 € per
  finished minute on « crédits Atelier » (Sonnet 5.5 / Haiku 5.5, 2026-10-30 prices).
- **Advanced editing and agent-made motion** (an agent loop) are offered when Claude Code is connected; on credits they
  are available only by explicit choice with the price shown (≈ 0,8–2,5 € per 10-minute video, our estimate to measure).
- Every quote shows the saving of connecting Claude Code.
- **Rendering**: assembly is CPU work on shared machines billed by the second (≈ 0,3 cent per finished minute), never
  on GPUs, never on the user's computer; an owned render server only past ≈ 4 000 videos a month. The small team
  computer (≈ 6 € a month) runs the agents and Claude Code, not renders. Rented GPUs only for open avatar / video
  models, after the benchmark (0015: ≤ 20 $).

## Consequences
- The estimator (0023) takes the team's backend as an input. production-6 (director) and production-9 (editing) wire
  the backend choice; production-14 (economy) prices the credits path.
