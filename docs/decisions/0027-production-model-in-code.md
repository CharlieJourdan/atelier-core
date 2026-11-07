# 0027. The production model in code: style document name, options resolved at compile, pins beside the pipeline
Date: 2026-11-01. Status: accepted. Decided by: the production-3 session, within decisions 0021, 0022 and 0024 (the
spec left these points open; Charlie asked the chantier to settle them with sensible defaults).

## Context
production-3 lays engines, styles, `atelier.recette/2`, options, edit operations and the base pipeline `avatar@1` in
code (spec `docs/specs/production-model.md` §3–§6, §10.2). Five points the spec did not settle came up.

## Decision
1. **Style document name.** A brick style is `atelier.brickstyle/1` (`src/shared/brick-styles.ts`), not
   `atelier.style/1`: that name already holds the channel style sheet the nodes read as `$style.x`
   (`src/shared/analysis.ts`), a different object. UI word: « style ». IPC module `brickStyles.*` (the channel sheet keeps
   `styles.*`). Styles are stored per name with immutable numbered versions (migration 029); the base styles
   (`phone-real`, `clean-stock`, `presenter-studio`) are seeded on first read, never changed afterwards.
2. **Options resolve at compile, explicit choices win.** The document stores only option values; the compiler turns
   them into edit operations (`options.ts`) and applies them in « option » mode before compiling: a brick whose engine
   or fallbacks the document sets keeps that pin whole, a style or a setting the document already sets is kept (the
   spec's « null: the option decides »), adding a brick that is there or removing one that is not does nothing, an
   option left at its default (not in `options`) adds or removes no brick (a brick removed by hand stays removed), and
   `setMix` from an option (the clip-share slider) always applies: on a base copy, change the clip share with
   `setOption clipShare`, not `setMix`. `setGate` on a pipeline that uses the channel's checkpoints is refused until it
   sets its own list (`setGate` with `checkpoints`), so the channel's gates are never dropped silently. An option or a choice whose bricks are not built yet is
   declared with `soon: '<chantier>'` and only its default can be chosen.
3. **Engines registry route.** The Cloud serves engines on `GET /v1/engines` (`ENGINES_ROUTE` in
   `src/shared/cloud-engines.ts`, registered beside `CLOUD_ROUTES` with the same `route()` helper), because the Cloud
   imports shared files with their `.ts` extension and the app without: a self-contained file avoids touching
   `cloud-api.ts`. The engine id names its family (`presenter:hedra-c3`), so the family check needs no network; the list
   of known ids is checked only when the Cloud's registry is at hand. Fake engines are `draft`, prices provisional
   (public prices of 2026-10-30/31, to recheck). `priceCredits` is an ESTIMATE (the engine's own provider cost with
   its usage's margin) until the grid has one line per engine (production-11): billing still prices the usage's grid
   line (fixed mode, reference cap, 1-credit minimum). `served` reflects the usage's adapter, not the engine's.
4. **Pins beside the pipeline.** `compileRecipe` returns `pins` (per brick: engine, fallbacks, fallback scope `video` for
   voice and presenter, `item` otherwise, style) and does not write them into node params yet; the project stores them
   (`projects.pins_json`, styles resolved to `name@version`). Each brick chantier (production-4 to -9) passes its pin to
   its node when the node learns to use an engine and a style.
5. **The mix reaches the director through `fromMix`.** A technology may derive recipe-layer settings from the
   pipeline's mix (the director's `videoShare` and `stockShare` today); the brick's own settings win. The curve
   (`hook-heavy`, rescaled to keep its shape, `curveRows`) is computed and tested but read by the director only from
   production-6.

## Consequences
- A `/1` recipe still loads and compiles as before (its mix comes from its director's shares, which it keeps).
- Base pipelines live in code (`src/engine/technologies/bases/`), like technologies; a team's pipeline made from one
  carries `base: "avatar@1"` and the options it declares.
- Until the brick chantiers land, choosing an engine or a style changes the quote and the pins, not the fake render.
