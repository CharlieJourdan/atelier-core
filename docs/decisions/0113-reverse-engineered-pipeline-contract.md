# 0113 — The engine's product is a reverse-engineered pipeline; the loop never waits for a person except for money

Date: 2026-11-06 · Chantier: reverse-pipeline · Spec: `docs/METHODE-REVERSE-PIPELINE.md` · After 0095–0109

## Context
Charlie (2026-11-06): the previous days kept producing videos instead of reverse-engineering pipelines, without one clear
objective, and kept waiting for approvals. The P0→P10 cloning engine served, but its output was a *clone run* (a report with
a flat technology list, no settings with evidence, no judge answer), the actions translate / adapt / bend did not exist as
transformations, the loop paused for a free-demo approval and for « which style? », and the analysis measured the distribution
over time of the presenter only — every other source class was a whole-video average.

## Decision
1. **One backend contract** `src/shared/reverse/pipeline.ts` (zod). Input `ReverseRequest`: links (channel or video), action
   `copy | translate | adapt | bend | mix`, optional instructions, test budget, what the user supplies (default nothing:
   placeholders). Output `ReversePipeline` (`atelier.reverse-pipeline/1`): the bricks graph (nodes = engine technologies with
   their settings, edges from the compiled recipe), every setting with `source` (measured only when every cited definition field
   is measured) and its evidence, the distributions over time, human inputs with placeholders, not-possible parts with reasons,
   technology and alternatives faithful to that channel, feasibility from measured screen time, cost and making time per minute
   (`measured` only when a proof ran), the proof (frame pairs, blind judge answer, scores with defects, rounds, cost), the recipe.
2. **One API surface** `reverse.start | status | result | transform | list | prove` (`src/main/production/clone/reverse/`), headless
   through `node scripts/brain-run.mjs reverse …`. The P0→P10 engine stays the inside; `clone.*` stays for the app's screen.
   `result` is rebuilt from the saved artefacts and saved as `reverse-pipeline.json` when done.
3. **Transforms take a pipeline and return a new one**: a new clone folder with the analysis artefacts copied (nothing re-read or
   re-paid), a new definition version, P5 re-run; `derivedFrom` set; not proven until `reverse.prove` resumes it from P6.
4. **Distribution over time for every element** (`analysis/distributions.ts`): screen-time share per part and per tenth of the
   video for the presenter, each media origin, stills vs moving, generated stills vs clips, motion design and on-screen text, by
   overlap (no start-part bias); shot length, words per minute and illustration per part. Pooled across the corpus (median per
   part and tenth, a `curve` agreement), carried into `sourcing.distributions`, `editing.shotByPart`, `voice.wpmByPart`,
   `script.illustratesByPart`; the director's mix curve is built from them (old presenter-only curve only when absent), and
   `director.plan` gets `paceRows` (shot-length factor along the video).
5. **Autonomous loop**: no human pause inside the loop except money beyond the test budget (and accounts / keys). The free-demo
   approval (`reviewBeforePaid`, `approveDemo`) is removed — the free style gate stays and improves itself; a channel with several
   styles takes the one the user's words name, else the dominant one, logged with why; intake questions with a safe default no
   longer block. A video whose analysis throws is set aside, not the whole P2.
6. **Honesty fixes**: unmeasured cut types never become a constant; failed label batches make the log partial; Gemini readings
   count illustration as unmeasured; no music bed level without music; improver proposals are `user` with a note unless they
   cite a measure; brick-cause changes are recorded « to fix (not applied) »; cost rounds are skipped with a reason while no
   compiler can pick cheaper engines; the judge hears both films' music; the P9 example order is random.
7. Dead code from superseded attempts deleted (`compare/proof/*`, `analysis/proof.ts`, `analysis/summary.ts`, unused exports).

## Consequences
- The prebuilt pipelines Charlie wants later (an avatar one, …) are `ReversePipeline`s the engine starts from, each setting
  re-checked against the channel's measurements (decision 0112's ready bases are the mechanism).
- `voice.wpmByPart` and `script.illustratesByPart` are stated in the plan; no brick consumes them per part yet.
- Duplicated analysis passes (two vision passes per shot, two whisper runs, up to three downloads) are debt.

## Addendum — rules the first real runs added (2026-11-06)
- A channel with several styles is reverse-engineered on the picked style only: its videos alone feed P3–P6. A best-performing
  video weighs 1.5 in the pick (a trailer or a one-off reaction among the latest must not outvote the format the audience watches).
- A platform refusal (bot check, rate limit) is passing: the video is left out (said) and retried on resume; with too few videos
  read the analysis waits — a channel's pipeline is never built from one of its videos. Never circumvent the refusal (cookies).
- No Cloud = no proof: a paid round and a free demo stop resumably; a demo whose found stand-ins cannot be searched is never judged.
- A 3D / game-engine character is never a presenter; a count stays whole.
