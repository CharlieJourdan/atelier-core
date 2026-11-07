# 0106 — The cloning engine measures and builds the bricks its first proofs lacked (letterbox, first-person hand, depth, generated look, fonts, presenter share)

Date: 2026-11-04 · Chantier: moteur-briques (G) · Spec: `docs/METHODE-REVERSE-PIPELINE.md` · After 0095–0102

## Context
The first real proofs of the cloning engine (decision 0100) honestly ended « not yet the same channel » for an independent blind
judge. The causes were bricks, not settings: Le Monde en POV keeps black bars on every frame, shoots its drawn places with depth of
field and shows a lot of first-person shots (the viewer's own arm holding a ticket, a phone, a card); its cards use their own type.
Finary illustrates with generated cinematic scenes, shows its presenter most of the time, sets its titles in a serif italic. None of
that was measured, so no definition field carried it and no brick could draw it; P8 then « improved » fields no brick reads.

## Decision
1. **Measured, never guessed (P2).** `analysis/letterbox.ts`: one ffmpeg `cropdetect` pass over the 0.5 s frames P2 already draws;
   a frame is barred when both bars are there, equal and the picture between them is not black; the video's letterbox = the median
   picture aspect when ≥ 50 % of readable frames carry it (Le Monde en POV: 2.0:1 measured, where a model had written « 2.39 »). The
   per-shot look gets two columns: `pov` (hand: the viewer's own hand in the foreground) and `depth` (deep / flat); the global look
   names fonts in a fixed vocabulary (shape, weight, case, decoration, role) and writes the generated pictures' look as an
   image-prompt line. A shot the shot log saw as the presenter and the look called « filmed, off » counts as the presenter on screen
   (Finary's other angles: presence was measured 40 % instead of ~55 %). Older answers without the new columns stay valid.
2. **Definition fields (added, with defaults):** `editing.letterbox`, `sourcing.povShare`, `sourcing.depthShare`,
   `sourcing.generatedLook`; P4 derives them from the analyses with evidence (`definition/derive.ts`).
3. **Bricks (reusable by every clone):**
   - `render.assemble` `letterbox` (aspect): two black bars drawn in the final pass, over every picture layer and under the captions;
   - `director.pov` `depth` (`deep`: the place behind defocused, a vignette, a fine grain), `handShare` (first-person `hand` shots:
     a ticket, phone, card, paper, note or bill held up over the defocused place, the sleeve in the hero's colour) and `type` (the
     cards' face, capitals, the titles' accent and a rule under them) — new POV kind `hand` (`motion/pov-hand.ts`);
   - `motion.render` styled cards: a `titleFace` apart from the figures' face, a new `serif-italic` face (Instrument Serif), a
     `titleRule`;
   - `visuals.fulfil` `look`: every generated picture carries the reference's measured look line, only where the reference generates
     (≥ 2 % of its screen time); found media stay found.
   - the presenter's mix share is his measured time on screen (never less than the « presenter » shots), the lift taken out of
     « filmed » first; the look-alike's angle pictures are matched to the spec's angles by framing (not by index).
4. **P8 changes only what a brick reads.** `compare/improver.ts` lists to the model, and accepts, only fields some `SETTING_MAP` rule
   reads; a curve gap on a field no brick reads becomes a `brick` defect (the engine must learn to read it) instead of a definition
   change that would re-render the same film.
5. **`--clean-data` frees a stopped brain's leftovers.** On a STOPPED brain's folder (its `brain-run.pid` names a dead process)
   every re-creatable file goes (F had to delete 7.4 GB by hand); a running brain, or a folder with no pid file (the desktop
   app's), keeps the one-hour spare. A spare of 0 also ignores file times a hair ahead of the clock.
6. **The channel's fonts and palette agree across videos.** The synthesis compares canonical items (`analysis/canon.ts`): a font
   becomes `<shape> <role>` plus `capitals` / `underlined`; colours closer than 56 in RGB form one cluster named by its medoid (a
   colour a video really uses, which P3 accepts). Before, free descriptions and exact hex codes never agreed and both came out empty.
7. **The free demo's drawn director follows the measured shares** (scene / face / data / ui / hand, the kind furthest below its
   share next), so the gate judges the definition, not a fixed demo rhythm.
8. **Resuming keeps improving.** A clone stopped on its budget, resumed with more money, goes on with the P8 loop from that round
   (it no longer jumps to the example) — only when P8 would have continued with money: not on a plateau, and not a rollback P8
   already applied.
9. **Stops that were not the clone's fault are gone.** A run of the clone's own video left by an earlier attempt (the brain stopped
   mid-round, restarted and resumed it, nobody watches it) is cancelled and its spend booked before the next round. A presenter
   the shot passes saw but the global look (a sample of the whole video) did not describe is looked at again on up to six of his
   own shot frames, instead of refusing the video.
10. **The free gate judges the style, not the demo's marks** (amends 0102 with the coordinator's OK). Three POV demos were refused
    on « captions » because of the « DÉMO » mark and the demo script's template card words, which no definition change can fix.
    The gate now judges a copy of its demo rendered without the mark (`render.assemble` `watermark: off`; only the assembly
    re-runs, in `gate-vNN/judge/`), and its judge prompt says card words may be placeholders: on-screen text is judged by type,
    placement, size, font, colour and timing. Everything kept or shown for the user (the demo film, its frames, the
    side-by-sides) is the marked render; `watermark: off` is ignored in a real run (a real film with a demo part keeps its mark).
    P7 and P9 judge real renders on their real wording, and the code-measured blocking checks
    (wrong text, unsaid date or figure) are unchanged; no other axis or threshold moved.
11. **The free verdict comes before the money check.** The gate now runs before the affordability check: a budget too short for a
    paid round still learns whether the style is right, then stops before paying with « needs X $, Y $ left » — as long as the
    gate's own model calls (judge, improver: `GATE_CALLS_USD` 0.06 $) fit in the money left; with less, it stops on the budget first.
12. **The improver stays anchored to the measurements** (`compare/anchor.ts`, wrapped around every improver call in the
    orchestrator, so P8 rounds and refused gate demos alike): a definition change to a field the corpus measures (a number, or a
    record of shares) is held within that field's spread over the corpus videos (each measured alone), widened by the synthesis's
    own tolerance (25 %, at least 0.02 for a share); per-part curves are held in their definition shape (`[{part, share}]`,
    `[{part, perMinute}]`, `[{part, shares}]`); a share the corpus never measured is held near nothing (≤ 0.02); a change that
    then moves nothing is dropped; every hold is logged as a p8
    decision « held to the measurements ». Only a new analysis moves a measured field further. (POV's gate had pushed the
    first-person share from 0.048 to 0.35; the corpus measures 0–0.123.)
13. **The POV demo shows the channel's kinds of shots.** The free demo's drawn director furnishes each place (props that belong
    there), peoples it (2–3 figures, crowds where people gather), tags some places with a small corner label, turns a spoken
    question into a two-line title card and shows chains (`icons` `chain`: dark boxes with a thin gold outline joined by arrows,
    also offered to the real director). Deep shots carry a warm bloom and dust drifting up; on a deep channel only the close-ups
    defocus the place (a held thing, a phone, a number over the room), wide scenes stay sharp, as the reference's. POV cards typed
    in the measured serif italic load it. The POV cards' drawing version
    (`POV_VERSION`) enters their cache key, so a drawing change is redrawn.

## Consequences
- Stills of the bricks drawn by the real page service: `scripts/briques-stills.ts`. Tests: `clone-briques*.test.ts`,
  `headless-clean-data.test.ts`.
- Real proofs (a folder outside the repo). Le Monde en POV: the free demos went from layout 40 to the
  engine judge's pass on the measured definition, but an independent blind judge still says « no » (layout 40–45). What is
  left is the subject: the reference's opening handles a ticket and a phone in almost every shot (42 % first-person in v1's first
  minute, 0–20 % in the other videos), which a template demo script cannot show; nothing was paid for a round. Finary: stopped
  honestly before any paid round. The demo engines replace exactly what makes its style (generated scenes, a filmed presenter)
  with keyword slides and a drawn figure, so no definition can pass the free gate. Free found-media stand-ins in the demo are
  their own chantier (`p10-arret-honnete.md` in its clone folder).
- What a clone can still not do is listed in `docs/ETAT.md` (a true rounded face like the reference's would need a vendored font; number
  cards laid on generated scenes; the identity check between look-alike angles keeps OpenCV's bar).
