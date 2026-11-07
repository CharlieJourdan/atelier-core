# 0030. The estimator and the fit % in code: what the spec left open
Date: 2026-11-01. Status: accepted. Decided by: the production-11 session, within decisions 0015, 0023 and 0026 (Charlie
asked the chantier to settle open points with sensible defaults and record them).

## Context
production-11 builds the cost estimator of `docs/specs/production-model.md` §8–§9 and the fit % of §12
(`src/engine/technologies/cost.ts`, `fit.ts`, `fit-gaps.ts`; app side `src/main/production/estimates/`, IPC
`estimates.*`). The proof of done is that the estimator reproduces the table of `docs/specs/pipeline-avatar.md` §6 with
the 2026-10-31 prices of its §9 (±0,01 $). Several points the spec did not settle came up.

## Decision
1. **Voice volume: 900 characters per finished minute** (French at 176 words per minute). §5 rounds it to « ≈ 1 000 »,
   but the per-minute voice prices of §2.3 (ElevenLabs ≈ 0,07 $, MiniMax ≈ 0,09 $) and the §6 table use ≈ 900; with 1 000
   three cells of the table move by more than 0,01 $. The voice speed setting scales it.
2. **Regeneration applies to generated pictures only** (presenter, clips, stills, thumbnails): average +5 % (the measured
   rate once the team has one), max +15 %. The voice (its fallback serves the whole narration), the music and the LLM are
   not regenerated.
3. **Min / max.** Min = the engines as chosen, no regeneration. Max = the dearest engine of each brick's list (in every
   preset it is the last fallback, as §6 says) + 15 %. R8.2's « cheapest legal reading of the curve » and « cap on clip
   share » both read as the mix itself: a curve is rescaled to deliver the mix's shares over the video whatever its
   length (R6.2), and the clip share is the slider's value.
4. **Clip billing.** An engine billed per call makes up to `maxSecondsPerCall` per call; one billed per second is billed
   for whole seconds, at least 4 s (Veo makes 4, 6 or 8 s). A generation lasts its shots end to end (shot length × shots
   per generation). Until production-8 builds the clip brick, three settings live in the estimator's assumptions, not in
   the pipeline: shots per generation (1; `avatar-eco` uses 2), seconds per generation (`avatar-premium` asks 8 s) and
   the clip engine (default `clip:veo31-lite-relaxed` → `clip:veo31-lite-vertex`).
5. **Presenter handles** = 2 × 0,2 s ÷ the presenter shot length (4 s by default → ×1,1, the §5 figure); `archives-mix`
   uses 8-second presenter stretches (×1,05).
6. **Per minute vs per video.** Per minute counts what grows with the length; per video adds the one-offs (thumbnails:
   `count` × the image engine, 3 by default). Found footage, library music and the render cost no credits (the render is
   in the plan, 0015).
7. **Default engines** of a brick left open (`engine: null`): `DEFAULT_ENGINES` in `src/shared/cloud-engines.ts`, the
   « eco » defaults of pipeline-avatar §2 (presenter InfiniteTalk fast → Hedra, stills GPT Image low → medium, clips Veo
   Lite relaxed → Vertex, voice ElevenLabs → MiniMax, library music).
8. **LLM line.** Token volumes per task are the §9 estimates for a 10-minute video, divided by 10 per minute (script,
   director, metadata always; fact-check when its brick is there, advanced editing when its option is on; the sponsor
   mention, a short pass, is not counted). The team's backend:
   `claude-code` = « mon abonnement » (0, the credits price shown as the saving), the Anthropic key = « ma clé API »
   (priced in euros on the key, outside the credits), « crédits Atelier » = included in the totals. The credits path uses
   the model prices of Settings × the grid's money (0,92 $→€, 5 % overhead, 25 % margin, 0,01 € a credit) until
   production-14 gives the Cloud grid an LLM line.
9. **Prices come from the Cloud.** The app prices with each engine's `priceCredits` from `GET /v1/engines` (the Cloud's
   grid), read at most every 5 minutes and kept in settings (`engines.cache`) so it still estimates offline; never read →
   « prix inconnus ». Billing still prices the usage's grid line (0027 §3): one grid line per engine is production-14's.
   The run quote (0015) prices its node units with the same book (each family's default engine) when it is known, else
   the placeholder grid as before: one source of numbers.
10. **Fit scoring.** A number scores 1 within the channel's spread [min, max] across its videos and falls to 0 one
    tolerance away (the spread, or a floor: share 0,08, kind 0,10, shot 1 s, 20 words/min, 3 min, 1,5 labels/min, sponsor
    30 s / 10 s); a yes/no scores 1 when one of the channel's videos does the same. A dimension is the mean of the measures
    both sides know; fit % is the weighted mean of the dimensions both sides measure (weights of R12.1). The eyes do not
    time the presenter, the picture kinds, the layouts, the look or the words yet: until they do, the presenter share and
    « made vs found » come from the shot types they name, captions from on-screen text above 6 per minute, the sponsor
    from a call to action that names one; the rest is left out, never counted as a miss. The pipeline's words per minute
    are the rate its script is written to (the brick's `wpm`, else `wpmMeasured`, record 0028) × the voice speed. Demo analyses count, flagged
    « exemple ». « Sponsor » on « si la chaîne en a un » is present when the channel's own videos show one.
11. **Gaps.** The three dimensions losing the most weight, each with the single change that raises it most among: every
    option choice that can be picked, the channel's mix, its rhythm (shot lengths scaled to its mean shot), its look, its
    pace (voice speed) and its length; with the change of the average cost per minute. `pipelineForProfile` applies all
    of them to a base: the seed of the agent's proposal (production-12).
12. **The §6 presets are test fixtures**, not code (`tests/unit/cost-estimator.test.ts`); `presenter:heygen-plan` and
    `presenter:hedra-c3-720p` exist only there (HeyGen's plan needs its written OK; Hedra's resolution is a setting).
    Result against §6 (min / avg / max, $ per minute): eco 0,394 / 0,413 / 0,957; mix HeyGen API 1,261 / 1,320 / 1,980;
    mix open model 0,488 / 0,509 / 1,167; mix HeyGen plan 0,626 / 0,653 / 1,858; premium 2,102 / 2,204 / 3,776;
    archives 0,328 / 0,344 / 0,696 — every cell within 0,01 $ of the table.

## Consequences
- production-12 uses `estimateCost`, `optionCostDeltas`, `fitOf`, `fitGaps` and `pipelineForProfile` as the agent's
  free comparison tools; production-13 shows the per-brick lines on the graph.
- production-8 moves the clip assumptions into the clip brick; production-14 adds per-engine and LLM grid lines.
- A later eyes chantier measures screen time per kind, layouts, look, words per minute and the sponsor slot, which makes
  the presenter, kinds, script, look and sponsor dimensions exact.
