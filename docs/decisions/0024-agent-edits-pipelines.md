# 0024. The agent proposes pipelines as variants and edits them only through edit operations
Date: 2026-10-31. Status: accepted. Decided by: Charlie (10-31), written by the spec-avatar chantier. Amends 0011
(« the production agent drafts recipes »). Spec: `docs/specs/production-model.md` §10.

## Context
Charlie: the agent analyses the channel (existing, to launch, or to create) and its competitors, proposes and adapts a
pipeline; the user changes it « en parlant avec l'agent »; later the agent reproduces a reference video, compares, and
picks the best option, cost included. Users are beginners: settings, options, then « Générer » / « Laisser tourner ».

## Decision
- **Propose**: measure the references with the eyes, pick a base pipeline, set mix / options / engines / styles,
  compute cost and fit, offer 2–3 variants (faithful, cheap, premium) with one recommended; ask only what the references
  do not show.
- **Edit**: a closed set of typed operations (`setMix`, `setCurve`, `setOption`, `setEngine`, `setFallbacks`,
  `setStyle`, `addBrick`, `removeBrick`, `moveBrick`, `setSetting`, `setGate`, `setInput`, `setCap`, `rename`),
  validated, shown as a diff with Δ cost and Δ fit, saved as a new version when the owner accepts. The same operations
  are the agent's tools and the UI's actions. Never free-text rewrites of a pipeline.
- **Reproduce and compare** (later chantier, designed now): short capped test renders measured by the eyes until fit
  stops rising.

## Consequences
- production-12 builds the operations, the proposal flow and the chat path; options of 0022 are named batches of them.
