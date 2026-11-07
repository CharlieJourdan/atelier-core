# 0042. Reproducing a style: measured references, a priced sample run only on the owner's click, a likeness score with gaps
Date: 2026-11-01. Status: accepted. Decided by: Charlie (01/11, « on envoie des chaînes YouTube et il essaie de répliquer le
style… un score de rapprochabilité ») + the production-15 session, within decisions 0011 (feasibility score and test video
later), 0023 (fit %), 0024 / 0032 (the agent proposes by edit operations), 0037 (run quote and cap), 0038 (models in the beta).

## Context
Production-12 proposes variants of `avatar@1` from the eyes' measures, with a config-only fit % that needs three measured
videos and cannot read the presenter's time, layouts, look or pace. Charlie wants to paste YouTube channels, see the
closest pipeline, pay a few credits for an example, and get a likeness score, simply.

## Decision
1. **References** are 1 to 5 public links; the eyes watch the first 5 minutes of each video (a channel: its two most viewed
   long videos). Their answer gains optional **editing measures** (`AnalysisResult.measures`, src/shared/video-analysis.ts),
   read exactly when present, else the production-11 heuristics. Without Atelier Cloud the demonstration eyes stand in,
   marked so.
2. **The base follows the references**: `avatar@1` with a presenter, the new **`voiceover@1`** (« sans présentateur ») under a
   3 % median presenter share. Documentary, 3D and 2D bases are specified (production-model §10.3), not built.
3. **Two scores, not one.** The **likeness estimate** (config only, free, from one reference video) is what the proposal
   shows; the **likeness score** is measured on a sample. Six dimensions and weights: mix and curve 25, presenter 20, shots
   15, look 15, pace 15, text 10 (ours, to tune with Charlie). The fit % of 0023 stays as it is (the channel's own videos).
4. **A sample is a normal run, quoted twice and run once.** The owner sees the estimator's price (a few credits) and the
   run's worst-case hold; only the click on that very quote (an id tied to the variant, the sample pipeline, the narration
   and the channel) runs it; the run's cap is the hold shown, so a run quoted above it does not start. Team agents get
   `style.study`, `style.read`, `style.quote` (role Architecte pipeline), never the run.
5. **Gaps are edit operations.** Each of the three biggest gaps carries the operations that close it best, its predicted
   Δ score and its Δ cost per minute; « make up for the render » closers ask for more when the render under-delivered what
   the pipeline already asks. A predicted score is labelled as predicted until « Refaire l'exemple ».
6. **A style, never a person** (production-5, -7): said on the screen; nothing here clones a face or a voice.

## Consequences
- Migration 034 (`style_studies`, one JSON state per study), IPC `style.*` (10), screen `production/style`.
- The Gemini prompt and JSON schema of the eyes (cloud/src/providers/gemini-schema.ts) do not ask for the measures yet:
  until they do, real references are read with the heuristics (follow-up).
- The look of a sample is its style's until the eyes read the sample's frames (no image-reading usage in the Cloud yet).
- The run's own quote of a sample (worst case) can be far above the estimator's price (899 vs 44 credits for an avatar
  sample on the fake grid): shown as the hold, given back unspent; to reconcile with 0037 (follow-up).
