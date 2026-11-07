# 0058. The presenter's curve and runs are measured per channel

Date: 2026-11-01. Status: accepted. Decided by: Charlie (through the coordinator: reference 1 has 41 % of presenter in its
first minute, reference 2 31 %) + Claude (avatar-qualite part 5).

## Context
`avatar@1` applies the `hook-heavy` curve to every channel: about 54 % of presenter in the first 30 s and 30 % in the next
30 s of a short video. That is reference 1 (Headcast, 56 % then 27 %), not reference 2 (33 % then 28 %), and not any other
channel. Record 0055 made the requirements a pipeline's measured settings; the curve was still one named shape per pipeline,
and the eyes did not read where the presenter is (Gemini returned shot types, not spans).

## Decision
1. **The eyes read the presenter's spans**: the analysis asks for every span where a presenter talks to the camera, with its
   layout (`full`, `split`, `inset`), in the watched minutes (`AnalysisResult.presenter`, optional: an older analysis has
   none). Same call, same price.
2. **The app measures them with record 0055's method** (`measureEditing`): the presenter's share in each window (0–30, 30–60,
   60–120, 120–300, 300–600 s, then the rest; split and inset counted, a window counted when half of it is seen) and the
   longest full-frame run. They are the video's `presenterCurve` and `presenterRunMaxS` (`measure.ts`).
3. **A channel's pipeline takes the median of its videos** (`withMeasuredPresenter`, in `pipelineForProfile`, so the agent's
   proposals and « Créer une pipeline » both get it): the curve becomes the pipeline's own curve fitted to its mix with the
   measured presenter share in each window (`curveFromProfile`), and the run the director's `presenterRunMaxS`. A short video
   takes the first rows of that 12-minute curve (production-17). Measured on the references, the fitted curve keeps each
   window within 2 points (reference 2: 34 % then 29 %, 31 % in the first minute).
4. **Unmeasured, the pipeline's default stays**: `avatar@1` keeps `hook-heavy` and its 8.5 s runs (record 0055).
5. Run 6's shot 13 (« Ça tient tant que le coin reste »: a white bedroom, then hands in its clip): the check had scored it 5,
   remade it once and scored it 6. It stayed under the bar because the remake put the director's « wide shot » back in front of
   the judge's « close to the corner »; and the clip added hands because avatar@1's clip motion named them. A remade picture
   now takes the framing its new prompt names (`framingOf`), and avatar@1's clips move only what is already in the picture
   (« nobody and nothing enters the frame, no hands appear »). The bar stays 8: it caught the picture.

## Consequences
- A channel analysed before this record has no spans: its pipeline keeps the default until its videos are analysed again.
- The fit % does not compare the curve; the likeness score still compares its family (`hook-heavy` / `flat`), and
  `compareProfiles` names the windows that differ.
