# 0108 — The cloning engine measures the frame format, the things held in first person and the cast; paid rounds wait for a look

Date: 2026-11-05 · Chantier: moteur-pov-2 · Spec: `docs/METHODE-REVERSE-PIPELINE.md` · After 0106, 0107, 0109

## Context
After decision 0106, Le Monde en POV's free demo passed the engine's own gate judge but an independent blind judge still said
« not the same channel » (layout 40–50, a plateau). Its opening handles a lottery ticket and a phone in almost every shot, which
the demo's template script (« Que sait-on vraiment de ce sujet… », invented years) could never show; its cast is thin black
silhouettes with a light rim; its held things carry details. Separately, a vertical 9:16 Short reference was rendered 16:9: nothing
measured the reference's frame. During the proof, the clone also stopped on a drawn hero taken for an « avatar presenter », on a
judge answer the parser could not read, and twice created a paid run in the seconds before an outside watcher stopped the brain.

## Decision
1. **The frame is measured and is a blocking check.** `analysis/frame.ts`: ffprobe's display size of the file (a ±90° rotation swaps
   the sides), or a Shorts link when no file was served (`from: 'link'`). A vertical video's 0.5 s frames are drawn upright. P4 writes
   `editing.aspect` with each size as evidence; `recipe.aspect` renders in it; `render.assemble` `aspect` measures the delivered film
   (`review/blocking-aspect.ts`, defect `wrong_aspect`, blocking): a wrong frame is fitted once inside the right frame (black bars,
   never cropped, so no caption, text or legend the other checks passed is cut) and measured again; still wrong, the film is refused
   whatever `blocking` says. Only a MEASURED format is enforced: an unmeasured one sets nothing (other channels render as before).
2. **Measured, never guessed (P2/P4).** `sourcing.heldObjects` (thing + what is on it + its share of first-person time, from the
   first-person shots' descriptions and on-screen text, in the engine's own vocabulary `heldNamed`/`heldDetail`);
   `sourcing.povOpeningShare` (the first `OPENING_S` = 120 s apart); `sourcing.figures` (the global look's fixed vocabulary: body,
   rim, faces, who wears a colour); `script.addressMode` counted on the words heard (tu/vous/je/nous; unclear says nothing). All are
   anchored to the corpus spread like every measured field.
3. **A reproduced passage follows its own video** (spec P6: same subject and structure): the script's object pattern, the drawn
   director's things, first-person share and shot mix (places, faces, data, phone screens) come from the passage's own shots
   (`withPassageObjects`, `shotMixOf`); without first-person shots the channel's pattern stays. Face close-ups were a never-measured
   20 % default.
4. **Bricks** (`POV_VERSION` 8, reusable by every drawn channel): silhouette cast (thin trunk, a hoodie with sleeves on the one dressed
   figure, a thin rim, small dot eyes and a mouth, varied poses and spots); held ticket (five numbers, two stars, price, serial,
   barcode); phone screens (results with a match badge and earlier draws, an incoming call, a lock screen with labelled notifications);
   two things side by side (`beside`); a short arm rising from the bottom edge; rooms that differ per shot (window, spotlight cones,
   clock, frame, shelf); a plain yellow corner time card; a two-tone question card; full-width flows; no clip-art money props; title
   cards only for questions. The demo script tells a « you » story (places, reactions, time jumps, questions, rare amounts) built on
   the measured things. `NodeDef.fakeVersion` enters a demo run's fingerprint so a changed demo implementation is made again (real
   runs and other nodes keep their caches).
5. **Stops that were not the clone's fault are gone.** A drawn character is not a presenter: the second look covers every presenter kind
   and may answer « drawn »; only that answer removes the presenter (a channel with drawn figures in its cards and a presenter no
   look described, like Finary, keeps him; that video is set aside by its check, never made presenter-less). One video whose analysis
   fails its check is set aside (saved, decided, out of the synthesis) while 60 % of the corpus stays. The judge's answer is read on
   its last JSON object that parses (a model that rewrote a broken answer); verdicts, axes and thresholds are unchanged.
6. **« Show me the free demo before you pay »** (`brief.reviewBeforePaid`, intake state or `clone.resume` options; brain-run sets it
   unless `--no-review`): once the free gate passes and before any paid run is created, the clone pauses on that demo
   (`review-pause.json`, its sha256; a missing film stops the clone instead). Only an explicit approval (`clone.resume` with
   `approveDemo`, brain-run `--approve-demo`) opens the paid rounds (`review-approved.json`); a plain resume or a budget change
   pauses on it again, `clone.answer` is refused there, and a later demo asks again.
7. **Nothing was loosened.** No judge prompt, threshold, axis or blocking rule changed.

## Consequences
- Tests: `clone-pov2-aspect.test.ts`, `clone-pov2-aspect-check.test.ts`, `clone-pov2-objects.test.ts`, `clone-pov2-judge.test.ts`,
  `clone-pov2-review-pause.test.ts`, new cases in `clone-analysis.test.ts`. Two existing expectations moved on purpose (said in their
  commits): the chain card counts one arrow per item (its last leaves the frame), the drawn director's variety is 4 kinds (no bare
  phone card on a first-person channel).
- Real proof: a folder outside the repo. The engine's gate passed every demo; the independent
  blind judge still says « no » after 7 rounds, every axis rising (characters 45→62, layout 35→58, props 45→60, illustration 60→65,
  palette 72, text 45→60). Left: 3/4-view acting figures, streets in perspective, a palette per place (sunset suburbs), denser props.
- The app's intake screen does not yet offer the « show me the free demo before you pay » choice (the field exists).
