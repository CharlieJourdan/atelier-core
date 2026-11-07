# 0037. The run quote agrees with the estimate, and the video's cap follows its length
Date: 2026-11-01. Status: accepted. Decided by: the devis-avatar session, within decisions 0015 (quote + cap) and 0023
(one price book for the estimate and the quote).

## Context
A project on the base pipeline « Avatar » (`avatar@1`) was refused at every length: « Le devis (≈ 6 600 crédits) dépasse le
plafond de la vidéo (1 500 crédits) ». Three causes, found by quoting `avatar@1` node by node against the pure estimator
(`src/engine/technologies/cost.ts`):
1. `idea.support` estimated `supportMax × watchMinutes × 60` seconds of **video generation** whatever the project listed, and
   priced them at the clip engine's price (2,4 credits a second). The eyes bill the minutes they watch (`analyseVideo`,
   grid line `analysis.minutes`), and only for the videos listed.
2. The presenter (`avatar.speak`) and the clips (`clip.make`) read the director's list (`avatarSeconds`, `videoSeconds`,
   `items`) from the metadata of an artefact that does not exist yet when a run starts, so they were quoted 0 and the
   pictures by a rough default. The quote was wrong in both directions.
3. The cap was one constant (1 500) for every length.
A fourth, found on the way: a project could not carry the input `supportVideos` at all (the run's input check accepted
lowercase ids only), so no support video could ever be given.

## Decision
1. **The eyes are priced by the minutes watched.** New estimate unit `watch_min` (Cloud usage `analyseVideo`, local grid line
   5 % margin like `analysis.minutes`). `idea.support` bills `min(videos listed, supportMax) × watchMinutes`: nothing when no
   video is listed (an upper bound otherwise: a shorter video costs less). The node reads the text of the pipeline input
   (`EstimateCtx.inputs[port].value`).
2. **A node can forecast its outputs' metadata** (`NodeDef.forecast`, pure, from its params and the video's length). The
   estimator (`estimatePipeline`) hands the forecast to the nodes downstream while the real artefact is unknown (a cached run
   still wins). `director.plan` forecasts its list (`director-forecast.ts`) from the pipeline's mix with the very numbers of
   the cost estimator (`technologies/cost-defaults.ts`: shot lengths, handles, regeneration, clips per generation), so the
   quote of a run and the estimate of its pipeline agree: at 30 s, 3 min and 12 min the quote is within 6 % of the estimate's
   average (it counts what is made once; the average adds the 5 % regenerations) and each line (presenter, clips, pictures,
   voice) within 8 %. A per-call clip engine is priced per shot-length second (`nodeUnitPrices`), so a generation costs its
   calls whatever the shots it serves.
3. **The cap is for the pipeline's own length and follows the project's** (`capForMinutes`, `recipe.ts`): pro rata to the
   project's minutes, never below `CAP_FIXED_CREDITS` (150: what does not grow with length, the support reading, the
   thumbnails) or the owner's own number when it is smaller; no cap stays no cap. A recipe's cap is therefore « for a video
   as long as this pipeline's format »; the user sets it in the editor as before.
4. **The base's cap is the estimator's max for its own length**, rounded up to 50: `avatar@1` now says 1 800 (the max is
   1 759 on the Cloud's default grid: the dearest engine of each brick and 15 % regenerations). A video that stays within the
   pipeline's own engines is never refused; a test fails when the grid or the estimator moves the max past the cap.
   On the offline placeholder grid (about twice as dear, no engines read) a 12-minute video with three support videos quotes
   ≈ 1 530 and still passes.

## Consequences
- Charlie can make and launch a project on « Avatar » at any length; a run of 12 minutes quotes ≈ 750 credits on the Cloud's
  default grid (cap 1 800), 30 seconds ≈ 35 (cap 150).
- The two changes of vocabulary are small hooks: `ESTIMATE_UNITS` gains `watch_min` (admin price list, `UNIT_USAGE`), and
  `EstimateCtx` gains the pipeline input's `value`. No migration.
- Not changed: after the director has planned, the clips node estimates from the real list (`videoSeconds` as billed by the
  director, up to 10 s a generation), which prices a per-call engine above the estimator when two shots share a generation.
  It only matters for the hold of a run restarted after its director ran.
