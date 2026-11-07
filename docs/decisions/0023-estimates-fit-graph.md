# 0023. Every pipeline shows cost per minute (min / avg / max), a fit % to a channel, and a read-only graph
Date: 2026-10-31. Status: accepted. Decided by: Charlie (10-31), written by the spec-avatar chantier. Extends 0015.
Spec: `docs/specs/production-model.md` §8, §11, §12.

## Context
Charlie: « quand on a une pipeline, on a une estimation de combien ça nous coûte … du minimum, du maximum et de la
moyenne »; « un pourcentage indiquant à quel point ça colle » to an imported channel's videos; « un graphique un peu à
la N8N des différentes parties jusqu'à la vidéo finale ». 0015 has a quote per project and caps.

## Decision
- **Cost estimator**: pure code from the mix, shot lengths, options and the Cloud price grid; average with the measured
  regeneration rate (5 % until measured), min without regeneration, max with each brick's last fallback + 15 %; per
  minute, per video and per brick; the LLM line depends on the team's backend (0026). Never a hard-coded price.
- **Fit %**: the channel's measured profile (the eyes over ≥ 3 videos) against the pipeline's predicted profile on seven
  weighted dimensions (presenter, picture kinds, rhythm, script, look, text on screen, sponsor), with the three biggest
  gaps and the option that closes each.
- **Graph**: generated from the compiled pipeline, read-only, stages as columns, bricks with engine / style / cost /
  gate, parallel branches, options off greyed. Never edited by hand.

## Consequences
- Chantiers production-11 (estimator + fit) and production-13 (graph). The quote of 0015 reuses the estimator.
