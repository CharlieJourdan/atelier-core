# 0048. What a user sees of a pipeline: no provider, our internal choices hidden, render time beside the price, options shown before / after

Date: 2026-11-01. Status: accepted. Decided by: Charlie (notes of 2026-11-01) + Claude (pipeline-ui).

## Context
Charlie's notes of 2026-11-01: « on vend le présentateur, la voix… on ne dit pas nos modèles derrière, sinon l'utilisateur va
directement aller le construire lui-même »; no « + forfait par mois » line; internal choices such as « génération du
présentateur : une fois puis coupée / continue » are ours; « quand il est marqué chapitre à l'écran, je ne sais pas à quoi ça
ressemble… mettre différence avant / après »; « il faut aussi mettre l'estimation du temps de rendu moyen… l'importer dans les
technologies ». The pipeline views named every engine (graph, « Où va l'argent », the agent's diff, « Avancé »'s engine pickers,
the previews' gallery) and HeyGen's monthly plan.

## Decision
1. **No provider, model or provider plan in a user-facing pipeline view** (start, base and own cards, editor, estimate, graph,
   « Créer une pipeline », the agent's proposals). What makes a step is said in plain words (« Présentateur Atelier », « Voix
   Atelier », « L'équipe d'agents », « Sur ton ordinateur »). The data still carries the engines (the views, the API): the code,
   the Technologies page (`production/ressources`, ⌘K) and the founder console keep them. `tests/fixtures/provider-names.ts` is
   the list checked against the rendered views (unit render and e2e DOM).
2. **Options have a place** (`src/shared/option-previews.ts`): main (script, chapters, captions, presenter's shots, sponsor,
   music), « Avancé » (quality ×3, clip share, who is in the pictures, brands, fact-check, editing; any new option lands here),
   internal (presenter generation, clip pairs, motion-only clips, short clips; their brick settings too): never shown, the
   pipeline keeps their values. Engine pickers and bricks are gone from the editor of a base pipeline; a pipeline built by hand
   keeps its stages under « Avancé », without engines or internal settings (amended by 0051: no hand editing at all for a user).
3. **A duration model beside the cost model.** Engine timings live in data (`src/shared/render-times.ts`: seconds per call,
   calls at once, longest piece per call; measured where a run measured them — Veo relaxed 73 s, HeyGen 99 s, GPT Image 12 s —
   estimates elsewhere, a family default for an unmeasured engine). `src/main/production/estimates/duration.ts` times the cost
   model's volumes in the run's order: writing (one task after the other), voice, presenter and pictures at once (a clip after
   its still), edit and render. Shown as « Temps de rendu moyen » for the pipeline's length and 1 / 5 / 10 / 20 min, and on
   every card. Known without prices.
4. **Before / after previews of the main options** that change the picture or the sound (chapters, captions, presenter's
   re-crops, sponsor card, music): `npm run previews:options` renders `avatar@1` with the engine on the fakes, once with all of
   them on and once per option changed, and keeps a 3-second loop of each at the moment the option shows (the presenter's: where
   the two films differ most), in `resources/option-previews` (≈ 0.3 MB, packaged). Free to look at (`previews.options`).
5. **Production hides the beta tools tab** for now (route kept, ⌘K).

## Consequences
- An agent's change of engine shows as « Façon de fabriquer : l'actuelle → une autre, choisie par l'agent ».
- The timings are a first model: each real run should refine `render-times.ts` (the writing and voice figures are estimates).
- The previews are drawn on the fakes (« DÉMO »); real previews can replace them later with the same keys.
