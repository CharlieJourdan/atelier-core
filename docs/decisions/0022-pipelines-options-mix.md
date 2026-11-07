# 0022. Pipelines (« recettes » in code) gain a mix, options, inputs with sources, and base pipelines
Date: 2026-10-31. Status: accepted. Decided by: Charlie (10-31), written by the spec-avatar chantier. Amends 0011.
Spec: `docs/specs/production-model.md` §6, `docs/specs/pipeline-avatar.md` §3–§4.

## Context
Charlie (10-31) rejects both Headcast (one fixed pipeline, a few inputs, no control of the avatar / clip / image
percentages or of the editing) and an n8n of blocks wired by hand. He wants pipelines the agent proposes, with options
to switch on or off (simple cut vs motion design, chapter tabs…), quality options that change price and/or look,
inputs pre-filled from the channel, base pipelines tied to no channel, a pipeline assignable to several channels. He
calls them « pipelines ». 0011 had recipes with ordered bricks, a format, a cap and checkpoints, and no quality switch.

## Decision
- The user-facing word is **« pipeline »**; code keeps `recipe` and the document becomes `atelier.recette/2` (version 1
  documents load with defaults). « Recette pré-construite » becomes **« pipeline de base »**.
- A pipeline adds: a **mix** (screen-time shares per picture kind) and a **curve** (how they move along the video,
  rescaled when a share moves); **options** (named switches / choices whose effects are edit operations, shown with
  Δ cost and an example of the look); **inputs** with a source (project, channel, fixed); per brick an **engine**,
  **fallbacks** and a **style**; `base` (the base pipeline it came from).
- **Quality lives in options**, per subject (images, clips, presenter, editing), each with its price; still no single
  global « qualité max / usage max » switch (0011 stands on that point).
- Alternatives / random switches between variants of one pipeline: **later** (backlog), room kept in the document.
- The compiler applies options before compiling (0016's slots and gates are unchanged).

## Consequences
- production-3 adds the `/2` schema, a migration for the new fields, and the avatar base pipeline on fakes.
- The editor shows options first; bricks, engines and styles under « Avancé ».
