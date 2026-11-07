# 0073. Motion and editing toolkit: built on our own renderer and ffmpeg, measured kits per style, a fast capture

Date: 2026-11-02. Status: accepted. Decided by: Claude (chantier motion-montage), on Charlie's order of 2026-11-02 (« notre motion
design et notre montage sont pauvres »; clone many channel styles; rich, reusable, measured, cheap).

## Context
The documentary samples were stills with little motion, and the two styles looked alike. The engine had: seven overlay templates and
four documentary cards drawn by a headless browser (a frame is a function of time, `runtime.ts`), still moves push / pull / drift,
cuts, dissolves and dips, five grades, and a music bed without effects. Drawing a minute of cards took **529 s** on the code PC (each
frame a full PNG screenshot: ≈ 400 ms for a photographic map). Four ways to get more were weighed:

| | Licence | Speed a minute | CSP / clean room | Server (future SaaS) | Verdict |
|---|---|---|---|---|---|
| Our renderer (Chromium + `atelierRenderAt(t)` + ffmpeg) | ours | 529 s → see below after this chantier | ours, strict CSP, no CDN | headless Chromium + ffmpeg on CPU | **keep and extend** |
| HyperFrames (HeyGen) | Apache-2.0 (its GSAP has its own licence) | same architecture (seek a page per frame, Chrome capture, ffmpeg) | a second runtime and toolchain (bun, its own Chrome) | yes | study only: its `beginFrame` capture is Linux-only; its blocks are ideas we can rebuild |
| Motion Canvas / Revideo | MIT | not measured (Motion Canvas is editor-first; Revideo's headless renderer now points to a hosted offer) | generator code in its own runtime | Revideo yes | no |
| Remotion 4.0.540 (tested for real, same 25 s sequence) | free up to 3 people; from 4 a company licence (Automators: $0.01 a render, $100 a month minimum; Creators $25 a seat; v5 counts contractors and makes telemetry mandatory), read 2026-11-02 | 95–355 s a minute (render only 57–204) vs ours 83–133 s on the same sequence, same machine under load; files 40 % larger; same sharpness and colours | React + webpack bundle per run (3–6 s), downloads its own Chrome (131 MB) | yes, paid as above | allowed by Charlie while Atelier is small, **not adopted**: no gain in speed or quality, a licence that turns paid as the company grows; if ever needed, out of process behind a port |
| Lottie / Rive | MIT runtimes, but motion is authored in After Effects / the Rive editor | fast to play | assets made by hand by a designer | yes | no for generated films; possible later for hand-made channel bricks |
| ffmpeg alone | LGPL / GPL builds we already need | fastest | ours | yes | **yes for every camera move, transition and mix**; not for typography and data cards |

## Decision
1. **Two engines, one kit.** Pictures that move as a whole (camera on stills and maps, punch-ins, 2.5D parallax, transitions) are
   ffmpeg filters (`render/camera.ts`, `render/transitions.ts`): sub-pixel, eased, CPU, cached per segment. Designed graphics
   (kinetic type, documents that highlight, charts, maps' vectors) stay browser pages of ours. The one library imported is MapLibre
   GL JS for the 3D map (point 7).
2. **Everything is a setting of a style** (`formats/edit-kit.ts`, node `edit.fx@1`): the shot-length distribution (hook and body),
   transition weights per boundary kind, stills' moves by weight and speed, punch-ins a minute on the voice's accents, and the sound
   effects per transition, card, reveal, punch and chapter, capped a minute. Three kits are **measured on real references**
   (`documentary` = Markets of the Past, `avatar` = The Japanese Method, `pov2d` = Le Monde en POV). A style starts from one and changes any field. No kit = the plan is unchanged.
3. **Sound effects are synthesised until the library is filled** (`media/sfx.ts`: whoosh, soft whoosh, paper, click, tick, pop,
   impact, stamp, riser; deterministic), and `resources/sfx/library.json` is the slot technos-medias fills with CC0 recordings; an
   effect's peak lands on its event. `edit.fx` lays them into the music bed so `render.assemble` is unchanged.
4. **The fast capture is the default of `motion.render`** (`motion/fast.ts`, param `fast`): opaque cards photographed as JPEG through
   the page's DevTools session, a frame whose page state did not change is not photographed again, several pages per graphic. GPU
   rasterisation of the browser is opt-in (`ATELIER_BROWSER_GPU=1`): ≈ 25 % faster here but on Windows several pages at once sometimes
   fail to give a frame. A server without GPU runs the same path.
5. **A map's world is drawn once** (`motion/map-move.ts`): a moving map renders its world large at a fixed camera (photographed only
   when something in it changes) and its HUD apart, and ffmpeg moves the camera through any number of keys (frame a region, centre a
   place, follow a route while it draws).
6. **The 3D map is MapLibre GL JS 6.14 (BSD-3)** (`map3d`, ENGINE-SPEC §25.4), measured first on the reference
   (tilted ≈ 50°, flat ground with the relief in the imagery, a 4–6 s eased push). MapLibre
   has terrain, hillshade, extrusion, pitch / bearing and projection of labels in one library and runs inside our page; deck.gl (MIT)
   has no terrain of its own, three.js (MIT) no map, CesiumJS (Apache-2.0) is heavy and wants a network globe. Data: NASA GIBS
   imagery (public domain), AWS Terrain Tiles (free, attribution), Natural Earth. Likeness on the reference's shot after 4 rounds:
   colour error 10.6, SSIM 0.625. Raised relief needs a GPU; a server draws the relief flat.

7. **Reference techniques, tested side by side** (motion-montage, 2026-11-02):

| Method | Measure | Verdict |
|---|---|---|
| Graphics as pages photographed frame by frame | ours already; the reference takes JPEG q 94 frames like our fast draw | fused (fast draw) |
| Motion blur of 3 sub-frames | visible on fast moves; ×2.6 time on fast kinetic type, ×1.1 on a chart (still frames are not taken again) | **integrated**: `motion.render` `motionBlur` (1–4), a style setting |
| Push-in with `perspective` (not `zoompan`) | on one painting, 5 s: frame-to-frame change spread 0.014 (perspective) vs 0.72 (zoompan jitter) | ours since P4; kept |
| Depth pop on a still (subject grows 9 %, background pulls back 1.06 → 1) | renders on any still; real depth needs a cut-out | **integrated**: `parallax` + `pop`, `mask` slot |
| « Phone » treatment of generated stills; light grade (contrast 1.05, saturation 0.96, gamma 1.02) | ffmpeg chain | **integrated**: grades `phone`, `natural` |
| Room on the voice (RT 0.6 s, −14 dB) | STI 0.99, Whisper error rate unchanged (0.04), +0.1 LU, a tail 20 dB higher after each word | **integrated**: `render.assemble` `room` (optional) |
| Music −11 dB ducked 7 dB more while speaking | bed breathes +3.7 dB in every short pause (ours −0.5 dB); same lift in long gaps | skipped: ours kept; the bed level is the register's |
| tanh soft clip | distorts the whole voice (SDR 24.6 dB) for 0.8 dB of peak | skipped |
| Two-pass loudnorm −14 LUFS | equals one gain on a normal film, turns dynamic on a 12 LU film (range squeezed to 8.4) | skipped: one gain kept (§28.5) |
| Hard cuts only | a setting of the kit (`transitions`) | fused |

## Second round: Charlie's review of the showcase (2026-11-02)
Charlie liked the contract followed mark by mark and the price curve, and rejected the rest. What changed, as kit settings (they apply to
every style that uses `edit.fx`):
- **No sound effect by default.** `sfx.perMinute` is 0 unless the style measured effects on its references (`pov2d` only). Effects
  are real recordings (CC0 / CC BY, `resources/sfx/`), never the same file twice in a row, slightly varied; synthesis only on purpose.
- **No in-and-out zoom.** A punch-in holds to the cut (no `holdS` in the kit) and lands only near a still's end (`maxAfterS`).
- **No still held with nothing happening.** Over `maxHoldS` a still is cut on a word into a closer framing of the same picture.
- **Moves with intent.** Whole-shot moves glide at an even speed (`Motion.ease: 'glide'`) and go towards the subject (`focus`).
- **Transitions with a reason**, fewer (`purposeful`, `perMinute`): a match needs the same picture, a whip or push a run of quick
  stills, a zoom a card or a detail, a flash a chapter or a paragraph.
- **Numbers said aloud on their word** (`numbers`, `edit/numbers.ts`): « multiplié par vingt » → « ×20 ».
- **Map routes drawn along the way** (`via`, `drawS`): a curve through the waypoints that draws itself with a head the camera follows.
- **The look comes from the video's style** (`motion.render` `look`): a period subject gets ink on paper, a serif, engraved fills.
- `edit.fx` now runs before `motion.render` (the numbers are overlays it draws).

## Consequences
- The documentary style (clone-markets-2) and the next clones pick these as settings; the director's own cuts are kept (the kit
  does not re-cut a plan; `planCuts` is there for pipelines that cut from words).
- New transitions widen the edit plan's `transitionIn` enum (`flash`, `whip`, `push`, `zoom`, `match`) and add `transitionDir`,
  `punches` and camera `keys` / `parallax`: readers that switch on these must handle the new values (the render does).
- Parallax without a cut-out uses a soft ellipse on the subject (a plausible 2.5D, not a true depth); a cut-out mask (`mask`) gives the
  real thing when technos-medias brings one.
- Not built: character animation (pose swaps, idle loops, reaction faces), 3D cutaways and stamp storms of the 2D-animation channels;
  they belong to `clone-monde-pov`.
