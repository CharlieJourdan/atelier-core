# 0093. The avatar quote carries what real runs bill; the ladder keeps the made-once count

Date: 2026-11-04. Status: accepted. Decided by: Claude (agents-suite), issue #108.

## Context
The two real 3-minute avatar@1 runs of production-equipe billed 285 and 260 credits for a 228 quote (× 1.25 and × 1.14): clips × 1.35 / × 1.23, pictures × 1.46 / × 1.29, presenter and voice within 8 %. The short hook-heavy opening makes the director cut more, shorter shots than the reference's; each generated clip is billed whole and each starts from a picture.

## Decision
1. `COST_DEFAULTS.measured` (clip seconds × 1.29, pictures × 1.33, measured at 3 minutes) is applied by the director's forecast (the run quote) and by the estimator's `avg` / `max`, never its `min` (the made-once table of the production-10 ladder stays true).
2. The excess fades with the video's length (`measuredFactor`): the beta Cloud's real quote of a 16.6-minute script (878 credits) still agrees within 8 %.
3. avatar@1's cap follows the estimator's max: 4 900 → 5 400.
4. Also in this chantier: the channel's standards and script style reach every script writer (`channelStyle`, #107); a voice imported from a channel video clones on ai33 only (#109); Atlas follows the channel of the task's video, resumed sessions start with a « STATE NOW » block, and `qc.check` of a run lists the sound from the QC report (#110).

## Consequences
Calibrated on one configuration (two runs); more real runs refine the two factors. Quote vs capture on those runs: 273 vs 272 mean.
