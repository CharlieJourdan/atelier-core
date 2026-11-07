# 0021. Three layers: brick (capability) → engine (provider + model, replaceable) → style (versioned data)
Date: 2026-10-31. Status: accepted. Decided by: Charlie (production prompt of 2026-10-31), written by the spec-avatar
chantier. Spec: `docs/specs/production-model.md` §1–§5.

## Context
Charlie (10-31): « le plus de briques possible », each split into sub-parts (image and video generation first), able to
make any YouTube video; « le moteur … va avoir un contexte, un peu comme une différente carrosserie »; engines
« pourront être remplacés et ils ne devront pas rentrer en collision » (Veo through a reseller beside MiniMax H3 on a
rented GPU). Headcast lacks engine choice per brick, a gap its users asked for. Until now (0010, 0014) a technology named
a Cloud usage and the provider behind it was hidden configuration; there was no « style » object.

## Decision
- **Brick** = a capability with an input/output contract; in code it stays a **technology** (0010: code only, versioned,
  shared). A brick may have sub-bricks (e.g. `voice.make` = design / clone / import).
- **Engine** = provider + model + technical settings, still in the Cloud (adapter + usage + price line + fake, 0003),
  but now **visible and choosable per brick** in a pipeline, with an ordered list of compatible fallbacks and a health
  state. Engines of one family share the brick's contract, so they never collide. Voice and presenter are consistency
  classes: their fallback applies to a whole video, never mid-run.
- **Style** = versioned **data** attached to a brick family (not to an engine): rules, prompt suffix, negatives,
  references, people and brand policies, shot grammar, post-processing, examples. Shipped by the founder, copied and
  tuned per channel by the agent, exported as JSON. Styles contain no code (like the motion custom bricks).
- Projects pin brick, engine and style versions (R5.7).

## Consequences
- A new model is a Cloud adapter; a new look is a style; neither touches pipelines.
- The registry the app reads gains engines (from the Cloud) and styles (from the store). production-3 builds both.
- 0014's « no provider is final » holds: engines are candidates until the « providers, final » record.
