# 0079. 2D motion-design stories: the `pov@1` base, every frame drawn by our engine

Date: 2026-11-03. Status: accepted. Decided by: Claude (clone-monde-pov, a clone of Le Monde en POV), within Charlie's standing
orders (clone shot by shot, cheapest and fastest, use the media the reference really uses, settings not barriers, ai33 voices).

## Context
Le Monde en POV (FR, 7 videos) tells second-person « what if » money stories over flat 2D vector motion
design: a stick-figure hero in places at dusk, his face in close-up when he reacts, navy data cards whose numbers count, tick or
strike; no presenter, no captions, no footage, no photograph, no generated picture. Atelier had no drawn character, no drawn place
and no base for this; « Créer une pipeline » proposed a documentary or a presenter for it.

## Decision
1. **The picture is code-drawn, never generated nor found**: a `pov` card (formats/pov.ts, motion/pov-*.ts) draws every shot — a set
   with its cast and props, a face close-up, or a data / UI card — in one measured look (palettes dusk, night, blue, day). A drawn film
   has no picture brick; `render.assemble` accepts a film whose every shot is a card.
2. **A director of its own** (`director.pov@1`): Claude chooses the shots from the POV vocabulary, the measured rhythm and the
   channel's signature devices; code times every part on its word and keeps the measured limits (no shot under 1 s, a still split by a
   reaction past 4.5 s, a card never empty, a push on a still place past 3 s, a whip per ≈ 80 s). The prompt asks a shot count per
   stretch: the model alone cut faster than asked.
3. **The base `pov@1`** « Histoire POV (animation 2D) »: 215 words a minute, music bed −15 dB never lifted, the `pov2d` edit kit with
   its effects on card events, a captions file but none on screen. Every number is a measured setting.
4. **« Créer une pipeline »** picks it from the words (POV, dessin animé, animation 2D, et si…) or from references whose look is
   illustrated — a cartoon hero acting in the pictures is not a presenter.

## Consequences
- A POV video costs its voice (≈ 0.007 $ a minute) and its director's calls; ≈ 3–4 minutes of making per minute. Likeness 76 / 100
  on the cloned passage.
- Not done: a drawing for every object a story names, character animation, 3D cutaways, recorded effects mapped to POV events, the
  eyes' reading of fast narration (they measure 135 wpm and 4.5 s shots on this channel, the truth is 219 and 2.7 s).
