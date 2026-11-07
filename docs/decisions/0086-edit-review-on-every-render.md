# 0086. Every render is reviewed shot by shot before anyone sees it, and fixes what it can itself

Date: 2026-11-03. Status: accepted. Decided by: Claude (qualite-montage), on Charlie's second review of the Markets clone (« the style
is right, the editing is poor »: pictures random against the words, images that pop and stay too long, the same image twice, a cut in the
voice, motion that freezes, maps without a legend, dates written as phrases, a hook that waits, random music).

## Context
documentary@2 r3 (record 0082) copied the reference's look but nobody checked what a viewer sees: whether each shot illustrates its
sentence, on time, without dead time. `qc.check` only measured black, silence, freezes and loudness.

## Decision
1. **An edit review in the engine** (`src/engine/review/`), run by `render.assemble` on every render of every pipeline (technology setting
   `editReview: 'repair'` by default, `editReviewRounds` 2, `editReviewLook` on; drawn pipelines too). Shot by shot against the words and
   their times it finds: off-subject pictures (Claude, fast tier, one frame per shot with its sentence), the same picture again within a
   minute, a picture or board held 5 s with nothing moving, frozen stretches measured on the film, a film shorter than its shot, a hook
   shot over 4.5 s in the first 12 s, a date written as a phrase, a figure nobody says near it, a text far from its word or in another
   language, a shaded map with no legend, a hole or a click in the voice, music under 14 dB below the voice.
2. **The render fixes what it can on its own plan** and renders again (only the touched segments; cached by spec), at most
   `editReviewRounds` times: drop a shot into a neighbour (or share its time between both) without growing any shot past 6.5 s (a film
   7.5 s, the hook 4.5 s), move a boundary off a frozen film tail, give a held picture or board the reference's 9 % camera, take a wrong
   text off. The report rides on the video's meta (`review`, `reviewedPlan`); `qc.check` lists what is left as a warning (`edit`), never
   a stop. `scripts/edit-review.ts` runs the same review on a film already made.
3. **The root causes are the director's** (documentary@2): dates written as dates (« Spring 1940 », « End of 1942 ») on their year;
   the hook's first 20 s cut every ≈ 4 s; boards never held still past 4.5 s; maps whose camera creeps to the end, whose regions always
   say whose land, with labelled lines (« THE ALPS »); divided explanations (one labelled print per reason); stricter picture choice (no
   generic soldiers / snow / ruins, no cropped body, no watermark); `voice.trim` cuts slivers (a ≤ 80 ms burst alone between silences:
   the « None » cut at 1:52); **no music by default** (the library holds no track of the reference's kind: the reference's kind or none).

## Consequences
- A paid run asks one fast Claude call per ten picture shots per round (subscription), nothing else; ≈ 1 min of review per 3 min of film.
- Off-subject pictures in a cluster cannot be fixed by the render (no neighbour may take their time): they are reported. The next step
  is upstream: the review's verdicts sent back to the picture choice (a re-pick, or an in-style card when nothing fits).
- Truths moved on purpose: `qc.check` has an `edit` check, long boards settle, maps keep creeping, documentary@2 has no music by default.
