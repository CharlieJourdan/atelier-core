# 0046. A real job is charged its real cost; a demo answer in a real run is free

Date: 2026-11-01. Status: accepted. Decided by: Charlie (brief of production-17) + Claude.

## Context
The first real run from the app (production-16, 2026-11-01) worked, but the beta ledger showed the captures did not follow the
real cost while credits are sold at cost (decision 0040): a Veo clip captured its whole hold (29 credits for 0,07 €), ai33 a grid
line far off (148 credits for ≈ 0 €), HeyGen 6 credits for 0,04 €. The thumbnails brick ran on the Cloud's demo (`fake-image`)
and was charged 6 credits; the clip brick showed 0 credits while the Cloud had captured 29 (the brick had given the slow clip up,
the Cloud finished it later).

## Decision
1. **While the price multiplier is set, a real job captures its real cost**: the provider's `costUsd` × the founder's dated
   $ → € rate × the quote's multiplier (1 for an internal team), rounded up to whole credits, at least 1, never above the job's
   hold; the rest goes back. The overhead of the grid is not added (it is real cost, not a price).
2. **The old rule stays where the real cost is not known**: an adapter that says `costUnknown` (ai33 without `credit_cost`), a
   demo job (its fake's figure is only what a real one would bill), and a quote on the grid's own margins (multiplier `null`)
   are charged their measure on the grid, else the hold.
3. **Adapters read the cost from the provider whenever they can**: ai33 `credit_cost`, OpenAI images `usage.output_tokens`
   (30 $ a million), unifically its dry run, HeyGen MCP the plan credits at 0,05 $ (16 a minute of video).
4. **A demo answer in a real run is never charged** while the Cloud's paid calls are on: a job created with `real: true`
   (every job of an app run with « Moteur réel ») that the Cloud can only serve in demo holds and captures nothing. With paid calls
   off the whole Cloud is a demo and its test credits pay for it, as before.
5. **The run view follows the Cloud's captures**: a finished real run's jobs still open in the app are asked again to the Cloud
   when the view reads the run, and recorded like any other.

## Consequences
- The beta's real spend in credits matches the founder console's cost column, job by job (rounding: at most 1 credit a job).
- A provider whose answer stops giving its cost falls back to the grid silently: the founder console's P&L shows the gap.
- OpenAI's input tokens are not priced (no published rate for the model): a few hundred tokens a prompt.
