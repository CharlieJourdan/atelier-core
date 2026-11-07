# 0045. Clip-heavy styles for less: motion only where it is seen, pairs on one action, short shots per second

Date: 2026-11-01 · chantier vrais-tests (Part C) · Charlie: « descendre au plus bas et ne pas perdre en qualité ».

## Context
Charlie's Headcast-made reference is 64 % clips (a cut every 3.3 s); remade on `avatar@1`'s engines its pieces cost 0.98–1.15 $ a
finished minute, clips being 93 % of the B-roll spend.
Of its 159 B-roll shots, 58 show nothing that moves; the forced pairing of production-10 (`clipPairs` « tous ») crossed subject
changes; a third of the moving shots are 3 s or less, where a per-second engine at the exact length is cheaper than a 4 s minimum.

## Decision
`avatar@1`'s defaults (options, each with its Δ cost in the estimate):
1. **« Clips seulement où ça bouge »** (`clip.make` `motionOnly`, director `clipMotionOnly`): a clip shot whose scene shows no
   person, hands, water, smoke or action (`director-needs-motion.ts`) becomes a still with a slow camera move; the mix's clip
   share is a ceiling, the clips land on the shots that move.
2. **Two shots per clip on one continuous action only** (`pairSameAction`, « Clips en deux plans » « selon la qualité »): the
   subjects must match; « la moitié » / « tous » keep the forced pairing as a cheaper, visibly worse choice.
3. **« Plans courts »**: a single shot of 3 s or less without a face goes first to Grok Imagine 1.5 Lite, billed per second at its
   exact length (`shortEngine`), with the drift check (the eyes when present, else a scene-change hash guard) and one regeneration.
4. The director keeps a shot size the scene pass writes; the voice keeps pauses to 0.3 s.

## Consequences
- Charlie (01/11): the default mix stays Headcast's measured 26 / 21 / 53 on its `hook-heavy` curve (never the reference's 64 %
  clips); on it a 12-minute video is 0.50 $/min at the measured prices (the production-10 ladder: 0.57 $ presenter cut without
  pairs, 0.50 $ with half the clips paired across subjects).
- The estimator counts them (`COST_DEFAULTS` motionShare 101/159, sameActionPairShare 34/101, shortShareOfSingles 22/67,
  shortCallRatio); the default 26 / 21 / 53 profile is 0.53 $/min (forced pairs were 0.46 $ with the cross-subject cut);
  Charlie's clip-heavy style about 0.75 $/min (it was 1.26 $ with a clip on every B-roll shot). The production-10 ladder still holds
  with the new options off.
- The base cap is the dearest minute of 3 to 30 min × 12 (2 950 credits): a short video is all hook.
- The deterministic drift guard is weak by measure (camera moves look like drift); the real check is the eyes.
