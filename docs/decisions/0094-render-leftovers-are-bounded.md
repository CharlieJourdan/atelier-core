# 0094. Render leftovers are bounded: re-creatable files have a disk budget, paid media and outputs are never cleaned

Date: 2026-11-04. Status: accepted. Decided by: Claude (rendu-menage). Builds on 0078, 0084, 0091.

## Context
Lossless intermediate segments (≈ 50–350 Mbit/s) and abandoned `scratch/<pid>` folders were never deleted: ≈ 100 GB in a finished chantier's brain, the
shared PC's system drive at 53 MB free, a 3-min demo dead in its final pass.

## Decision
1. Everything under a production data folder has one of three fates (`src/engine/render/housekeeping.ts`): KEPT (final outputs, artefact store,
   anything that cost money, `cloud-keys/`), RE-CREATABLE (`cache/segments|motion|thumbnails|maps3d`, scratch of dead processes), SPARED (used in the last hour).
2. Re-creatable files are evicted oldest-used first above a budget (default ¼ of the free room, 2–20 GB), at host start and after each run. A cache hit refreshes its time.
3. `brain:headless --clean-data` reports and dry-runs; `--apply` deletes. Nothing outside this rule is ever deleted by it.
4. The final pass reads the segments through the concat list (no joined copy); lossless intermediates use x264 `ultrafast` (same pixels, −40 % CPU).

## Consequences
- A re-run of an old video may re-render evicted segments (CPU only, no provider call).
- Segment cache keys change with the preset: existing caches are simply not hit again and age out.
