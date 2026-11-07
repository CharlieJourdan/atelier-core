# 0111. The motion studio: premium 2D motion design and Blender-like 3D as one three.js card, from the measured style

Date: 2026-11-06. Status: accepted. Decided by: Claude (chantier motion-studio), on Charlie's order (« our motion design is too poor for
many channels: Finary's motion, 3D looks »; two X threads on building a motion-design studio with Opus 5.5 and Blender-like 3D).

## Context
The motion kit (records 0073, 0082) draws flat HTML/CSS cards and ffmpeg camera moves. It cannot draw what makes Finary's data scenes
look premium (glowing gradient numbers, glossy blocks with reflections, a frosted-glass vault turning in rim light) nor any 3D place
(Cornerstone's city timelapses, Yarnhub's game-engine cinematics). The threads (read through the public fxtwitter mirror) agree on one method: a program, not a video — `seek(t)` paints frame t, a headless browser
photographs it, ffmpeg encodes; closed-form springs; a reference frame or video measured first; a critic that looks at its own frames
and fixes the three worst defects; Blender (through MCP) for lit 3D sets.

| Option | Licence | Speed a minute (720p, the build PC) | Server | Verdict |
|---|---|---|---|---|
| three.js 0.186 in our page (already a dependency) | MIT | CPU SwiftShader 2.5–9.5 min, GPU 1.4–1.8 min | headless Chromium, CPU or GPU | **adopted** |
| Blender headless (bpy, Cycles/EEVEE) | GPL-3 (the program; renders are ours) | not installed here; EEVEE needs a GPU, Cycles CPU is minutes a frame | yes, as a separate binary | later, out of process, for photoreal sets only |
| Remotion / HyperFrames / Motion Canvas | see record 0073 | — | — | no (same architecture as ours, licence or second runtime) |
| Lottie / Rive | MIT runtimes | — | — | no: hand-authored assets |
| Poly Haven HDRIs / textures | CC0 | — | — | allowed when a scene needs them (none bundled yet) |

## Decision
1. **One card `studio`** (formats/studio.ts, a documentary card: opaque, the base shot) drawn by three.js inside our motion page
   (motion/studio.ts + studio-runtime.ts + studio-build.ts): a pure function of t (closed-form springs, a seeded random, a frame key
   written from the spec alone so a still stretch is photographed once), the same fast capture and encoder as every card.
2. **Items, not templates**: text and counters as real glyph outlines (our own TrueType reader, motion/studio-font.ts, OFL fonts of
   `resources/fonts`, flat or extruded), bars, rounded glossy/glass blocks with labels and icons, branching gradient curves, dot grids,
   hero objects (vault, coin, ingot…), a terrain with a river, an island and trees, a town that grows house by house (villas) and a wall
   that rings it; each arrives (rise, pop, zoom, drop, grow, draw) and glides through later places; a camera through keys (glide,
   spring, linear); a screen layer for titles over 3D.
3. **The look is the channel's measured motion style** (`studioLookOf`: palette, fonts, texture, easing words of the analysis'
   `motion.elements`), overridden by what frames measure; **the director calls recipes** (`studioSpec` with a beat: a total that
   splits, a total equal to a stack, an entity and its traits, a hero object, a timelapse). The `data` family of motion-fit now
   lists `studio`.
4. Blender stays a possible later brick for photoreal sets, out of process, never bundled with the app.

## Proof (motion-studio, 2026-11-06; videos in a folder outside the repo)
Three passages rebuilt from their measures, judged blind (fresh judges, A/B order drawn, two rounds): Finary data 3:11–3:24 **7/10,
« rather yes »** (r3: 6/10); Finary vault 6:09–6:22 **6/10, « rather yes », the judge took ours for the original (75 %)**; Cornerstone
Paris 0:56–1:06 **4/10, « rather no »** (layout, year counter and captions match; the 3D world is procedural and simpler: flat water,
boxy villas, no aqueduct bridge, no textures). No paid call.

## Consequences
- `CARD_TEMPLATES` gains `studio` (readers that switch on card templates handle it: the director's hold table excludes it).
- A detailed 3D world (Cornerstone, Yarnhub) is approached, not reproduced: say so in the analysis' verdict (« 3D simplifiée »);
  the next steps are textures (CC0), real building footprints, and Blender for the hero shots.
