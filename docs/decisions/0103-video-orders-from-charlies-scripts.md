# 0103 — Charlie orders videos from his own scripts: code makes, checks, fixes once, and tells him

Date: 2026-11-04 · Chantier: equipe-3-chaines · Builds on 0050 (the channel's promo), 0086 (edit review), 0090 (team alone),
0097 (blind judge), 0102 (blocking checks)

## Context
Charlie wants to tell the team « lance-moi 3 vidéos, une par chaîne, avec ces scripts » for his three avatar channels, mark in
each script where the channel's own promo goes, have no step wait for an answer, be told when each video is finished, and get a
final quality pass that fixes a real error BEFORE he is told. The team had no way to make a video outside the planner's weekly
slots, a pasted script lost any bracketed note (`cleanScript`), the promo was placed by a setting only (after the hook, at the
end, on a mention), a run stopped at its pipeline's checkpoints, and a finished run was only a line in the channel's room.

## Decision
1. **An order is code, not a turn** (`src/main/orchestra/orders/`, migration 041 `video_orders`). Atlas's tool `videos.order`
   hands it over; the code then makes each video on its channel's pipeline (a copy « · script importé » when the pipeline writes
   its own script), quotes it and refuses it — said — over its per-video cap or the channel's budget left, launches it, passes the
   run's own checkpoints (Charlie's order is his yes for those videos), and follows it with a watchdog (an end missed by a restart,
   an interrupted or vanished run).
2. **His scripts are read from his own message**, never retyped by the model: each script under a line naming its channel
   (`orders/parse.ts`); a script the model passes must be found whole in that message.
3. **The marker is the promo's place** (`src/engine/text/ad-marker.ts`): `[PUB]`, `[WERBUNG]`, `[AD]`, `[promo]`… is never
   spoken, cuts the paragraph and, as script meta `adMarker`, makes `script.sponsor` put the channel's promo mention exactly there
   over any placement setting (his own words right after it when they already name the offer). The promo card covers its whole
   slot and keeps moving once landed (a slow 9 % push in): a held card was a frozen picture, measured on all three first demos.
   Its two fixed lines follow the video's language when the channel kept the French defaults.
4. **The final pass reuses, never re-measures** (`orders/final-pass.ts`): the render's own review report (its blocking checks of
   0102 inside every render, read with `isBlocking`), the remarks
   of the edit review, and the cloning engine's blind judge against one of the channel's own videos (a setting per channel,
   `orders.setReference`; never called on a demo; a judge that cannot answer never stops the order).
5. **One fix, within the cap**: a real error remakes the step it comes from on the SAME video (`ProductionRuns.remake`: a new seed
   for the voice, the pictures or the render; the rest from the video's cache), quoted on that cache against what is left of the
   cap (refused and said otherwise); any other failure is relaunched once.
6. **Told once, everywhere**: inbox « Vidéo prête · <chaîne> · <titre> » (or « Vidéo non livrée » with the errors left) with the
   file, the checks, the judge's verdict and the remarks; a line in the channel's room and in Atlas's conversation; a desktop
   toast read through `orders.list` (local brain or linked team computer). `brain-run order` is the sessions' way to run one.

## Consequences
- Proof on a test copy (0 $): Atlas ordered three videos alone from one message; Klaus's German script came out word for word with
  its promo at `[WERBUNG]`; the pass found real errors, fixed once, and told Charlie (3 × « non livrée » on the first demo: the
  promo hold, fixed; then Klaus « prête », Marcel and Gaston « non livrée » on demo pictures and the demo voice only).
- Not yet: the real order (avatar base variants of Klaus and Gaston being made, test wallet at 395 credits with the clips
  reservation bug); an order screen in the app
  (the chat with Atlas is the screen today).
- Truths moved on purpose: 3 IPC methods (`orders.*`), Atlas's technologies (+ `videos.order`, `videos.orders`).
