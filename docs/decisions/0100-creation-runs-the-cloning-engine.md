# 0100 — « Créer une pipeline » runs the cloning engine P0→P10; the nearest-base creation is gone

Date: 2026-11-04 · Chantier: moteur-assemblage (F) · Spec: `docs/METHODE-REVERSE-PIPELINE.md` · Contract: 0095 (A 0098, B 0096, C 0099, D 0097)

## Context
The night of 2026-11-03 failed because the creation (`src/main/production/creation/`, decision 0089) picked the nearest
base pipeline (`verdict.ts judge()`) and ran it with the base's default options (`example.ts pipelineFor()`). Chantiers
A–E rebuilt the engine as phases P0–P10 behind injected services; nothing in the app used it yet.

## Decision
1. **One engine behind the screen.** `src/main/production/clone/engine.ts` (`CloneEngine`) is the only path of « Créer une
   pipeline »: the intake conversation (E, pure), `start` → `runClone` in the background, `progress` / `report` read only
   from the saved artefacts, `file` serves the evidence, `resume` (optionally with more budget), `answer`, `remove`. API
   `clone.*` (`src/shared/api/clone.ts`). The old creation module, its API, its types and its tests are deleted; the
   migration 040 table stays (migrations are never removed) but nothing reads it.
2. **Real services in one place** (`clone/create.ts`, `clone/app.ts`): A's eyes over the whole-video watcher with the
   local whisper (the Python is found like the recogniser finds it), B's bricks / people (his own clones by his channel's
   link; a look-alike from words on the clone's OWN workspace channel, pictures kept in `<clone>/presenter/<key>/`; a
   catalogue voice), C's compiled recipe quoted by the app's engines, D's runner and compare services, Claude through the
   routes with three roles (`clone_look` fast, `clone_judge` and `clone_improver` balanced, no conversation).
3. **The app producer** (`clone/app-producer.ts`) runs P6/P9 in process the way `brain-run.mjs` does for a session: quote
   against the money left, real run, gates approved (P7 is the review), spend cap, stall stop, run id saved before
   waiting. Every round after the first is a remake of the SAME video on the recipe's next version, so the engine's
   per-video artefact store gives back the nodes whose fingerprint did not change (D's request: re-render only what
   changed, on real runs).
4. **P7's review is complete**: D's measured defects + the engine's own render review (0086, read from the render node's
   stored report) mapped to compare axes (repeated pictures and off-subject shots → illustration, maps without legends →
   motion, dates or figures never said → script, held shots → cadence…) + music or SFX where the reference measured none.
   P8 keeps its 5-point noise threshold (D measured ±15 between two renders of the same settings).
5. **Contract repairs applied**: a P2 `ask-user:` problem pauses the clone (a question with the channel's styles on the
   progress screen) instead of refusing it; P3/P4 checks get the analyses; `eyes.quoteUsd` in the contract; the fakes write
   the frames they name and `framesOnDisk` is always on; a rollback that ended the loop survives a crash before `adopt`;
   the improver's model pass and the look-alike spend land in the clone's ledger.
6. **Hours, safely**: a clone working when the app (or the headless brain) stopped is resumed at the next start
   (`active.json`); at the end the intermediate files go (reference downloads, cut passages, 0.5 s scratch frames) and the
   artefacts, evidence frames, round renders and example stay. A reference YouTube refuses to serve can be supplied by the
   user (`<data>/clone-copies/<key>.mp4`), never fetched around the platform's protections.
7. **User simulations** drive it through `scripts/brain-run.mjs clone say | start | follow | answer | resume | report |
   list` (the brief's test budget must fit `--max-usd`; `clone.start|resume|answer` are spending methods).

8. **The engine's judge is strict** (learned on the first real proof): it judges the production, not the topic (same words,
   same pace and the same « tu » do not make the same channel), and a « yes » with a picture axis (identity, layout,
   illustration, motion, palette) under 70 counts « no », said in its verdict; a voice cut inside a word blocks the example.
   Compiled bricks run on the engines their bases set (directly or through their option defaults), never an empty engine a
   Cloud fills with a demo; a round that re-renders the very same film stops the loop instead of paying the judge for noise.

## Consequences
- Proofs from fresh brains (a folder outside the repo, 5,66 $): Le Monde en POV clone 1 « same channel » for the
  former lenient judge and « no » for an independent blind subagent (the reason for 8); clone 2 « not yet the same channel »
  after 6 rounds (0,52 $): letterbox framing, pseudo-3D/POV-hand scenes and the cards' fonts are bricks to build. Finary:
  real presenter slot + same-type look-alike with 3 angles, channel-styled cards, 5 rounds « not the same » (best 420/1000),
  stopped on its 5 $ budget: generated cinematic scenes and the presenter's share are missing. Lists in MOTEUR-PLAN.md.
- P10 proposals still have no preview service (E's request): alternatives without a frame say « Aperçu à venir ».
