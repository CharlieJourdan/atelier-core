# 0075. A budget is a setting of the mix; the curve is made for the video's length

Date: 2026-11-02. Status: accepted. Decided by: Charlie (via the coordinator: « un utilisateur peut dire : vidéos de 30 minutes, beaucoup
plus de stills et de clips vers la fin, ou une vidéo de 2 h à moins de 20 $ ») + Claude (avatar-layouts).

## Context
A mix has shares and a curve of start-based rows. Two things were missing: the curve cannot be written for « the last 45 seconds »
or for a video whose length is not known when the pipeline is made; and a measured curve whose mix is not its own average is
silently rescaled by `curveRows` (rounds 1 and 2 of Marcel's passage: the hook's presenter target stayed 45 % instead of the
measured 36 %). The price per minute of the references' curve is ≈ 0.51 $ (a 13-minute Marcel video), and a long video costs
whatever its curve says.

## Decision
1. `mix.budget` (`maxCredits` or `maxCreditsPerMinute`, `saveFirst` end | body | even, `protect`, `floors`, part lengths, `prices`)
   is a setting of the mix. At the director's run and in its forecast the curve is made for the video's real length
   (`nodes/director-budget.ts`): the measured curve as it is when it fits (an empty budget means exactly that and is never
   rescaled), else clips → stills, then presenter → stills, from the end of the video backwards, the hook protected until last.
2. The cost model is the director's own forecast of each part at unit prices calibrated on the Cloud's real quote (presenter
   1.29 credits a second, clips 1.96, a picture 0.57, voice 0.6 a minute); it is a guide, the live quote is what is paid, and it
   agrees with it within 4 % on the measured curve.
3. The agent and the creation flow propose within a budget: `proposeBudgets` (measured, balanced, lean, with what each changes per
   part), `proposeForStyle({ budget })` writes it on every variant, `setMix` carries it, the pipeline estimate sees it. The owner
   adjusts per part; nothing is a rule of the engine.
4. The presenter's full-frame hook ends at `fullUntilS` (the last full-frame shot of the references), not at the first split.

## Consequences
- A measured curve in a recipe should be written with `budget: {}` (or a cap), not only as `mix.curve`: otherwise the quote and the
  run use the rescaled one. Marcel's recipe v3 gets `budget: { maxCreditsPerMinute: 55 }`.
- The app refuses videos over 30 minutes (`MAX_MINUTES` in five places, a product limit): a 2-hour budget is proven by the
  model, not by a Cloud quote, until Charlie raises it.
