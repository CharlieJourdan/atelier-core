# 0051. A user never edits a pipeline by hand: options, inputs and the agent; bricks and engines behind a dev flag

Date: 2026-11-01. Status: accepted. Decided by: Charlie (« je vois même pas ce qu'il peut faire à la main… ça rajouterait trop
de complexité, trop de cassures… c'est mieux de passer par l'agent ») + Claude (pipeline-ui).

## Context
After record 0048 the editor still let a user build a pipeline from scratch (« Construire à la main », « Nouvelle
pipeline ») and, for such a pipeline, add, remove and set its bricks under « Avancé ». Charlie's notes already said a new
pipeline comes from a style or an existing pipeline, never assembled by hand.

## Decision
1. **What a user changes:** the pipeline's settings (its header: name, type, format, length, cap, checkpoints; its options,
   main and « Avancé »), its inputs per channel (« Chaînes qui utilisent cette pipeline ») and « Parler à l'agent », which
   changes the pipeline only through its tools and shows each change as a diff before saving it. A new pipeline comes from
   « Créer une pipeline » (the agent) or « Ajouter à mes pipelines » on a base.
2. **What is gone from the user's screens:** « Construire à la main » on Production's start, « Nouvelle pipeline » in the
   editor (it opens the first of the user's pipelines, or offers « Créer une pipeline »), the stages and bricks with their
   settings, the engine and fallback pickers, the styles, and our internal options (record 0048).
3. **Kept for the founder and developers** behind the dev flag `ATELIER_PIPELINE_DEV=1` (read by main at each `app.info`,
   `pipelineDev`; the renderer's `usePipelineDev`): a « Développeur » block in the editor with the internal options, the
   stages and bricks (every setting) and the engines and styles, plus « Construire à la main » and « Nouvelle pipeline ». The
   flag is never set in the beta; the code (`RecipeStages`, `BrickEngines`, `BrickSettings`, `newRecipe`) stays.
4. Importing a pipeline file stays under « Avancé » (it adds a pipeline, it does not edit one).

## Consequences
- A pipeline built by hand before this (no base) shows its header, estimate, graph and the agent, with « Cette pipeline se change
  en parlant à l'agent ».
- Clicking a step of the graph opens « Avancé » (its options); with the flag, the brick itself in the « Développeur » block.
- e2e: `production-recipes` runs with the flag (`launchAtelier({ pipelineDev: true })`); `pipeline-ui` checks the user's editor
  has no stage, brick, engine or « Développeur » block and no « Construire à la main ».
