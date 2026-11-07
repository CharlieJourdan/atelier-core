# 0097 — P6–P8: every round is compared on measured curves and by a blind judge, and P8 fixes the cause

Date: 2026-11-04 · Status: accepted · Chantier: moteur-comparaison (D) · Spec: `docs/METHODE-REVERSE-PIPELINE.md` §2 P6–P8, §3

## Context
The night of 2026-11-03 compared nothing. The contract (0095) gave P6–P8 their types and exit checks; D had to make them
real: reproduce a passage on the engines, compare it honestly, and improve the engine (not one pipeline) until it stops
improving, then make it cheaper.

## Decision
1. **Same instruments on both sides.** The reference passage is cut once and measured with the same ffmpeg instruments as
   our render (cuts, loudness, dominant colours; pace from words); layouts, presence and motion density come from the
   P2 analysis and from the run's own edit plan. What cannot be measured on ours is saved as « not measured on ours »
   (distance 1), never invented. `compare/curves.ts`, `measure.ts`.
2. **Matched frames** at the same fraction of the passage: two in the hook, one after each part change, ≥ 6 in all; one
   side-by-side image per pair and a contact sheet per round. `compare/frames.ts`.
3. **The blind judge** is a separate model call with no context: two anonymous strips (A/B, order from the round number,
   the key saved, never sent), what was heard as measures + words; « same channel? » with why, every axis 0–100 with the
   differences seen — a score below 100 without them is refused. Its answer is saved before it is parsed, so a resume
   never pays twice. `compare/judge.ts`.
4. **The cause finder** (`compare/improver.ts`): for each curve off beyond its gap, (a) the definition says something
   else than the reference measured → a `definition` change; (b) the definition already says it and the brick missed it
   → a `rule`: an **engine-wide calibration factor** for that brick and field (`<data>/clones/calibration.json`, bounded
   0.5–2, written once per clone round), used by every later clone; (c) not calibratable → a `brick` defect recorded for
   the engine. Axes curves cannot see (script, illustration, captions…) go to a model pass that may only change existing,
   non-user definition fields with schema-valid values; the judge's A/B are turned back into « the reference » / « ours »
   before it reads them.
5. **The loop** (`p8-improve.ts`): an axis moves only beyond `JUDGE_NOISE` = 5 points (the same settings re-rendered
   moved axes by up to 15 on the real rounds); stop after two rounds improving nothing, on the budget, the round cap or
   nothing to fix; a round that regresses overall rolls back the previous round's changes and a rolled-back change is
   never tried again; after the quality plateau, cost rounds lower `cost.usdPerMinute` (30 % a step, at most 2) and are
   rolled back as soon as an axis drops. $/min and making time/min are saved every round.
6. **Real runs** only through `scripts/brain-run.mjs` (`compare/proof/brain-producer.ts`); the runner applies calibration
   to the recipe and saves the production in its round folder before returning (no double payment on resume).

## Consequences
- Real proof on Le Monde en POV (« Trillionnaire », passage 0–120 s), 5 rounds for 0.066 $ (≈ 0.006 $/min, ≈ 2.7 min of
  making per minute): round 1 « not the same channel » (722 / 1000: cuts 18/min vs 24, sparse cards, a didactic
  script), calibration of the director's shot length (×0.782) → round 2 « same channel » (845, cadence 72 → 88); rounds
  3–5 stay at 812–823, inside the judge's noise: the plateau. Evidence in a folder outside the repo.
- Not proven on real runs: re-rendering only what changed (each round is a new project, so the engine reused no node —
  the cache keys and the re-run list are proven on fakes); cost rounds (proven on fakes; C's compiler must map
  `cost.usdPerMinute` to engine choices first).
- Requests for C and the assembler are in the hand-over note (calibration in the compiler, `improver.cost`,
  `frames.matched` returning the contact sheet, a rollback that ends the loop surviving a crash before `adopt`).
