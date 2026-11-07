# 0047. Render quality: one real compression, gentle re-crops, no subject twice in a row

Date: 2026-11-01. Status: accepted. Decided by: the coordinator (Charlie found the first real app video « pas incroyable »)
+ Claude (production-17).

## Context
The first real video from the app (production-16) was 2.8 Mbit/s at 1080p30 (Charlie's reference: 6.9), its presenter looked
soft and tight, a white dot sat at its top left, and a wall still was followed by a clip of the same wall. Findings: every shot
was compressed three times (presenter cut CRF 18, segment CRF 16, final CRF 21 veryfast); the tight framing and the dot come
from HeyGen and the portrait (a light in the barn roof, top left of the portrait; HeyGen crops the portrait tighter), not from
our render, which shows the default presenter unscaled; the two wall shots came from the scene pass's « recurring object »
description written at the head of both prompts.

## Decision
1. **One real compression.** Every intermediate video is CRF 12 (`INTERMEDIATE_ENCODER`, segments.ts); the final pass is CRF 18,
   preset medium, high profile, yuv420p, +faststart by default (`render.assemble`). Scaling is lanczos everywhere a shot is resized.
2. **Re-crops of a presenter generation at most 1.15×** (`MAX_RECROP`): close 1.15×, medium 1.075×. The default (« un seul plan »)
   shows the generation as it is.
3. **Never the same subject twice in a row** unless one continuing action: a picture right after one that showed the same
   recurring object keeps only its own prompt (its action), the scene pass is told so.
4. **« Nettoyer le portrait »** (`channelPresenters.clean`): GPT Image 2.5 medium remakes the portrait sharper, same face, outfit
   and room; kept only when the face-similarity check passes, the original kept beside it, the registrations reset (the HeyGen
   look is registered again from the clean portrait). Not for a retired presenter; a clone keeps its « own channel » consent.
5. **Captions are burnt only with the pipeline's option** (« Sous-titres », off by default in `avatar@1`, like the reference);
   the run style's `burn` is only the fallback of pipelines that do not set it.

6. **A short video is the first minutes of a long one** (part 4, after the real 60 s hook): the curve is fitted on at least
   12 min (`CURVE_FIT_S`) and a shorter video keeps that long video's first rows. Fitted on 60 s alone, the clip-heavy hook
   pushed the next 30 s to stills only (0/0/100 instead of ≈ 28/60/12). Short videos are dearer a minute (more clips), so the
   `avatar@1` cap, the dearest minute of 30 s to 30 min × 12, goes from 2 950 to 4 600 credits.
7. **No film made of filler** (part 4): pictures that could not be made are filled with a neighbour's for now, but such an
   output is `provisional` (never reused: the next run remakes only those pictures, decision on the engine's store), a held
   picture is a demo only if the one it copies is (no DÉMO badge on a real run for it), and the render refuses a film where
   several consecutive B-roll shots show the same picture for more than 8 s, or more than a quarter of the B-roll shots borrow
   their picture (`render/shot-check.ts`): « relance la fabrication, seules celles-là seront refaites ».

## Consequences
- Bigger files (on the first run's real shots: 1.84 → 3.59 Mbit/s for SSIM 0.9836 → 0.9866) and a slower final pass (medium).
- Sharpness of the presenter now depends on the portrait and on HeyGen's crop: clean the portrait first; HeyGen's `fit` or a
  padded portrait may keep it wider (to try on a real call).
