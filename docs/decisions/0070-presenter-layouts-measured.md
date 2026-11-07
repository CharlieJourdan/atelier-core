# 0070. The presenter's layout follows the reference shot by shot, as a setting of the pipeline

Date: 2026-11-02. Status: accepted. Decided by: Charlie (« il ne doit pas toujours être en demi-écran ou en petite incrustation : parfois
il est en plein écran, comme la référence ») + Claude (avatar-layouts).

## Context
Marcel's real 3-minute passage showed the presenter only in split screen and inset (record 0063). The two references show, measured
on their 427 shots: full frame only in the hook; the presenter always on the LEFT of a
split; the inset always bottom left, 16:9, 37 % of the width, white border; an inset every 70–90 s and never two within 47 s; an
appearance of 1–3 shots. Our director alternated the split's side and drew a 24 % square bottom right. The kind of sentence
(question, item, story…) does NOT predict split against inset in these two videos.

## Decision
1. The layout is a setting: `director.plan.presenterLayouts` gains `presenterSide`, `inset` (corner, width, margins, border),
   `insetGapS` and `triggers` (layout weights per kind of moment). All optional: without them the older rule stays.
2. The planner works on appearances (consecutive presenter slots), not slots: the first takes the layout furthest below its share,
   an inset is held back until `insetGapS` after the last one and continues as a split.
3. A pip shot carries its inset (`Shot.inset`); the render draws it. A pipeline without one keeps the small square.
4. `avatar@1` carries the measured defaults (side left, the inset, 45 s, `intro → split`); Marcel's channel pipeline sets its own
   (reference 2: hook full until 77 s, 78 / 22 %, 50 s). The Japanese Method style sets none and is unchanged.
5. `triggers` ships nearly empty on purpose: the measure found one reliable kind (« who I am » → split). A style whose reference
   shows a trigger writes it.

## Consequences
- A passage cut from the middle of a video has no full frame (the references have none there); a video with a hook has it until `fromS`.
- Small hooks outside the director: `formats/editplan.ts` (`Shot.inset`), `render/final.ts` and `render-assemble.ts` (the inset's
  geometry); announced to motion-montage, who owns the render.
