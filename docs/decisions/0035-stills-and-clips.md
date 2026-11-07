# 0035. Stills and clips: the style composes the prompt, clips come from their still, engines fall back per item
Date: 2026-11-01. Status: accepted. Decided by: the production-8 session, within decisions 0014, 0021, 0022 and 0031 (Charlie
asked the chantier to settle open points with sensible defaults and record them).

## Context
production-8 makes the AI stills and clips of `avatar@1` (`docs/specs/production-model.md` §2.5, §3, §4;
`docs/specs/pipeline-avatar.md` §2.6, §2.7, §3; ENGINE-SPEC §23): the style as the « carrosserie », people and brand
rules, « the presenter plays the action » (6 of the 18 reference channels), recurring objects that keep their look, two
shots per clip in eco, clip quality checks, per-item fallback. Code: `src/engine/nodes/visuals-look.ts`, `visuals-stills.ts`,
`visuals-engines.ts`, `visuals-checks.ts`, `visuals-fulfil.ts`, `clip-make.ts`, `director-clips.ts`,
`src/engine/technologies/catalog-visuals.ts`, `src/shared/visual-engines.ts`.

## Decision
1. **Two bricks.** `visuals.fulfil@1` stays the stills brick (`image.make`: found or generated stills; its old
   text-to-video path is kept for pipelines without a clip brick). A new brick and node `clip.make@1` (family `clip`) makes
   the clips FROM the stills (image to video). With it, the stills brick makes only the start still of a generated-video
   item (`stillsOnly`, given through `contributes`). `avatar@1` gains the clip brick (15 bricks); the option « Qualité des
   clips » adds it (idempotent) to an older pipeline made from the base.
2. **The style composes the prompt.** The director now writes each picture's parts on its item (`shot: { size, scene }`,
   the scene with a recurring object's fixed description at its head). With a brick style the prompt is
   `<size> of <scene>, <rule phrases>. <style suffix>`; the director's own suffix gives way to the style's; the negatives
   (the style's, else « readable text, watermark ») travel in their own field. Same item, two styles: two prompts, the same
   call shape. A style reaches the node only when the compiler is given its document (`CompileOptions.styles`, new manifest
   hook `styleParams`); projects pass their pinned versions. Without look, settings or parts, the prompt is the director's,
   as before (old pipelines keep their pictures and cache keys).
3. **People and brands by code.** The options set `people` / `brands` on the director AND the stills brick; the setting wins
   over the style. `nobody`: every comma clause naming a person or a part of one (hands, face…) is dropped, from the scene and
   from the style's suffix (« hand-held » is not a hand), the item's key terms stand in when nothing is left, and « people,
   hands, faces, silhouettes » go to the negatives. `not-presenter`: « the presenter » becomes « a person ». `presenter-as-actor`:
   on a scene that shows someone, the presenter's portrait rides as a reference and the prompt says the person is the one in
   it; a still life gets no portrait. `brands: none`: « plain unbranded packaging » + logos in the negatives.
4. **References.** In priority order: the presenter's portrait, the room (a style whose references say `room-shots`, on a
   wide shot or a scene of a room), each recurring object's FIRST picture. Recurring objects are named on items by the
   director (`recurring`); their first pictures are made first, their later pictures after. An item with references goes
   first to the engines of its list that read references (`IMAGE_ENGINE_CAN`: GPT Image 4, Nano Banana 3, FLUX 0); the
   others still serve it, without them. Reference files: brick settings `presenterPortrait`, `roomImage` (channel-settable
   paths); mapping the channel's presenter asset to them is production-7's.
5. **Failures.** Stills: a refusal is rewritten ONCE in plainer words on the same engine (never shopped, ENGINE-SPEC §23),
   then degraded to a found still on the item's key terms, else a hold of the nearest picture (not cached); a `transient`
   failure goes to the next engine of the item's list. Clips: refused, failed or past the timeout (15 min, setting
   `timeoutMin`) → next engine, then no clip: the render shows the still with a slow push (`CLIP_MISSING_MOTION`, a small hook
   in `render/segments.ts`), listed in the clips meta. Money, a missing service or a bad request stop the node as before.
6. **Two shots per clip.** Eco sets `shotsPerGeneration: 2`; the clip brick asks the mix director for
   `clipShotsPerGeneration: 2`. After the budget pass, the director pairs each generated-video shot with the next one in time
   when both fit one generation (≤ 8 s, Veo's longest) and the second starts within 12 s of the first's end. The second item
   points at the first (`sameAs`), shows the same scene, costs 0; `checkSharedClips` guards the list. The clip is asked for
   both lengths end to end; the first shot gets its beginning full frame (wide), the second a 1.35× crop of the rest (tight).
   Billed once. The estimator reads the brick's setting (the cost presets now set the brick instead of assuming it).
7. **Checks.** Deterministic, free, on every Cloud still and clip: blank (grey standard deviation < 6 on a 32×18 thumbnail)
   and, for stills, near-duplicate of a picture already kept in the video (difference hash, < 5 bits). The eyes are an
   optional engine service `vision` (text drawn, extra fingers, a person when nobody, a clip whose object changes), used when
   the brick's `vision` setting is on and the host has it; no host has it yet. One regeneration on the same engine (« a
   different composition » after a duplicate, « no writing anywhere » after text); a second failure keeps the picture and
   lists the failure in the record. Drawn demo pictures are not checked.
8. **Quality options** (`avatar@1`, pipeline-avatar §2.6–§2.7, §6). Images: éco GPT Image 2.5 low → medium; standard medium →
   low; premium Nano Banana 2 → medium. Clips: éco Veo 3.1 Lite on the reseller's slow queue → Vertex → MiniMax H3-Lite, two
   shots per clip; standard Veo 3.1 Lite fast queue → slow queue → Vertex; premium Veo 3.1 Fast → Lite fast queue → Vertex.
   On the 2026-10-31 public prices (estimator, 12-min video, default mix 26 / 21 / 53): Δ per minute images +0,08 $
   (standard) / +0,71 $ (premium); clips +0,41 $ / +0,95 $ against éco (whose two shots per clip halve the clip line).
9. **Cloud contract.** `generateImage` gains `engine`, `negative`, `referenceArtefactIds` (≤ 4); `generateVideo` gains
   `engine`, `negative`, `imageArtefactId` (the start still). The engine client uploads the files first (by content). A job
   naming an engine is served by the adapter whose id IS that engine id when `realEngines` lists it, else by the fake, which
   prices it at the engine's registry line. The Cloud still BILLS the usage's grid line (video by the second): one grid line
   per engine (a clip billed per call) is production-10's, before any real clip is sold.

## Consequences
- production-7: map the channel's presenter portrait (and room) to the stills brick's `presenterPortrait` / `roomImage`.
- production-9: the record says which clip is the tight half of a shared generation (`part`); a split shot's picture is a
  normal still.
- production-10: real keys per engine, one grid line per engine, the `vision` host (the eyes on stills and clip frames),
  and the « to confirm » list of `docs/PROVIDERS.md` §6 for the image and clip adapters.
- A clip style (`clip` family) has no seed yet: its look reads `rules`' first sentence as the motion line until clip styles
  get a field of their own.
