# 0099 — P5: the clone's pipeline is composed from bricks and compiled from the Style Definition, never from a base

Date: 2026-11-04 · Status: accepted · Chantier: moteur-pipeline (C) · Spec: `docs/METHODE-REVERSE-PIPELINE.md` §1, §2 P5

## Context
The night of 2026-11-03 failed because the creation picked a base pipeline (`avatar@1`, `documentary@2`…) and kept its default
look. The contract (0095) wrote the rule « bricks from bases, style from the Style Definition » for plan settings; nothing yet
turned a plan into a recipe the engine runs, and several things the analysis measures had no brick that could take them (a
channel's own card style, a presenter's measured angles).

## Decision
1. **Composition from what the channel is made of.** `pipeline/compile.ts composeBricks` picks the bricks from the definition
   (presenter kind and share, origin shares, motion elements, captions, music, transitions): a drawn channel (≥ 50 % drawn) gets
   `director.pov`, otherwise `director.plan`; pictures only when the mix has them; the generated pictures move (`clip.make`) only
   when the reference's camera moves. Plan bricks name the node (`motion.render`) and their versioned technology (`tech`).
2. **Settings only from the definition.** `plan-rules.ts SETTING_MAP` now holds brick-bound rules `<node>.<setting>` and
   `recipe.<field>` (`pipeline/settings.ts`), each a pure function of cited fields (`pipeline/values.ts`). A null value means the
   definition says nothing: the brick keeps its OWN engine default, never a base pipeline's setting.
3. **The compiled recipe carries no base.** `compilePlan` writes `base: null`, `options: {}`, and only the plan's settings into each
   brick; `recipeProblems` (in `checkP5`) refuses a recipe that does not compile against the technology registry, names a base,
   carries an option or any brick setting the plan did not compute (it names a base pipeline's value when it is one). `checkP5`
   also refuses an unknown brick and a brick still to build.
4. **Every measured field is read.** A test fails when a non-default definition field is neither in `SETTING_MAP` nor in
   `PLANNER_ONLY` (the list says who reads it: P6's script idea, P7's curves or review, P9's packaging, the engine's node rule).
5. **Bricks built (reusable by every later clone).**
   - *Channel-styled card family* (`src/engine/motion/styled.ts`, `styled-cards.ts`; hook: `motion.render` param `style`): title,
     figure, list, quote, lower third, kinetic type and chart drawn in the channel's measured palette (ground / ink / accent /
     muted), face (sans, condensed, serif, geometric; capitals), easing (incl. the overshoot « back »), texture (flat, glass
     panels, blurred colour plates, night glow, blurred page) and coverage (full-screen card or overlay). The templates' own
     look (a blue accent on a dark panel) is a base default and no longer reaches a clone: with no measured palette the motion
     brick is left out of the plan. A chart (an opaque documentary card) is always drawn full screen on the channel's ground.
   - *Multi-angle presenter* (hook: `avatar.speak` param `presenter` with the measured angles, `framing: multi`): the engine
     already switched framings per shot (never the same twice) but no recipe could hand it the angles; now the plan gives the
     look-alike placeholder's portrait and one picture per measured angle (`placeholder:<ref>/angle-<n>.png`, resolved by the run).
   - *Stand-ins for impossible elements*: a 3D share inside a drawn channel is stood in by drawn 2D scenes (`stand-in`, said in
     the plan); a mostly-3D channel keeps its 3D as `to-build` and P5 refuses (P3 already stops it as « pas reproductible »).
6. **Engine hooks (small, existing files):** `src/engine/nodes/motion-render.ts` (param `style`, its cache key, the styled page for
   the family's templates) and `src/engine/technologies/catalog-make.ts` (`motion.render` setting `style`, `avatar.speak` setting
   `presenter`, both recipe-overridable). Nothing else in an existing engine file changes.
7. **A base's value only when measured.** `recipeProblems(recipe, plan, bases, def)` refuses a brick setting equal to a base
   pipeline's brick setting unless a field it is computed from was measured, said by the user, or is the definition's own default
   (tested: Le Monde en POV's music bed −15 dB is allowed measured, refused when marked default). `edit.fx`'s drawn kit is a rule
   (`edit.fx.kit` ← measured transitions blur / smear / dip on a drawn channel), not a brick choice.
8. **Reference length measured**: hook window ÷ hook share (Marcel 12.8 min for 13 real), so layouts and the mix curve are in
   seconds of a real video.

## Consequences
- The four acceptance plans (Finary, Marcel, the Japanese Method in French, Le Monde en POV) pass `checkP5`, compile, and run end
  to end on the engine's fakes with the real local bricks; the styled card family has a real 60 s render
  (`tests/unit/clone-pipeline-proof.test.ts`, gated by `CLONE_PIPELINE_RUN_DIR`).
- Known gaps: the run must resolve `placeholder:<ref>/…` into the look-alike's pictures (assembler); the drawn-2D kit's palette
  is the nearest of its measured sets (`dusk`, `night`, `blue`, `day`), not any palette; the director has no per-part motion
  density setting (P7 measures it); `cost.usdPerMinute` → engine choices stays with P8's cost rounds.
