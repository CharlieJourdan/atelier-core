# 0053. Two pictures alike never stop a run: dealt with at the stills stage, a warning at the render

Date: 2026-11-01. Status: accepted. Decided by: the coordinator (run 6 stopped at its render) + Claude (avatar-qualite part 3).

## Context
Run 6 (the real hook on record 0052's code) made every asset, then its render stopped: « les plans de 0:43 et 0:48 montrent
presque la même image… change la consigne d'un des deux plans ». An automatic run must never stop and ask a human for this.
The two stills were a wide bedroom and a close mould corner: different pictures. Record 0049's 9×8 difference hash (18 bits)
took them for one (13 bits apart). The correlation of 32×18 grey thumbnails separates them cleanly: the same corner made twice
in run 4 0.95–0.97, every two different pictures of runs 4 and 6 0.54 at most, run 6's pair 0.33.

## Decision
1. **« Alike » is `likeness`**, the correlation of two 32×18 grey thumbnails; alike from 0.85 (`NEAR_LIKENESS`). It judges the
   framing, so a deliberate « same subject, another angle » pair (record 0052) is not alike when its angle really differs.
2. **At the stills stage** (`visuals-distinct.ts`, after the illustration check, before any clip): the later of two generated
   stills within 20 s that are alike is made again once with a contrasting framing (a close one wide, anything else an extreme
   close-up of a detail); the one that looks less like its neighbours is kept, the first coming back from its cache. Items carry
   their shot's start (`GenItem.context.atS`); the two shots of one clip are never compared.
3. **The render only warns** on alike pictures (`shotWarnings`, logged); it still refuses a film made of missing pictures
   (record 0047: the same picture over 8 s across shots, more than a quarter of the shots borrowing).

## Consequences
- A rerun of run 6's project resumes at its render: every node before it has the same inputs and parameters, so every paid
  asset is reused; on its real stills the highest likeness within 20 s is 0.51, so nothing is made again and nothing is said.
- A still remade for this costs one picture (about 0.006 $), even when the first one is kept.
