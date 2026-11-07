# 0082. The documentary director writes the motion kit's cards, and its camera is measured on the reference

Date: 2026-11-03. Status: accepted. Decided by: Claude (director-motion), on Charlie's order (« the zooms are still not right »; the clones
must get the reference's motion level with no hand work).

## Context
documentary@2 (record 0081) drew the motion kit (record 0073) only in part: one camera move per family chosen by a coin (boards drifting
3 %, stills pushing 16 % eased or panning, films a stepped scale push, maps ×4), no route, no fact box, no scan, no film inside a print.

## Decision
1. **The camera is a measured setting of the style** (`doc2-profile.ts` `camera`, `doc2-map.ts`), from optical-flow tracking of 1 059 shots
   of three whole videos: stills 9 % at one even speed (`Motion.ease: 'linear'`), films 0.9 %
   a second from the first frame (a sub-pixel camera, also under the old-TV frame), boards hold unless their layout's share gives them a
   soft S zoom (`prints.move: 'settle'`) or the first print's glide to its place (`prints.reflow`), maps an eased move settled at 55 %
   (×1.9 when a part's first map arrives, ×1.3 after, a fifth pulling back).
2. **The director writes the kit's cards when the words give them and the reference uses them**: map camera paths (a route followed,
   places visited on their words), routes along `via`, regions that spread, fact boxes (kept only when said); document cards on a real
   scan whose key line Claude finds at draw time (else the typed page); chart kinds limited to the profile's (`chartKinds`); factors said
   aloud as kinetic type on their word; a film inside a print; colour kept for present-day or colour items.
3. **No pattern three times in a row**, film included: a third film stretch is shown as a board or a still of the same words (one
   stretch's own clips stay one montage).
4. **A style picks the graphics' look**: `motion.render` `look` is a recipe / channel setting.
5. The hook's script pattern and the chapter music cue (under the voice when its pauses are short) are base settings of `documentary@2`.

## Consequences
- Every measure is a profile field; another archive channel measures its own (the newer videos of the same channel hold their boards).
- A paid run asks one fast Claude look per scanned document (subscription), nothing else new.
- `prints` boards may frame a `stock.video` item (only with a `film` print): plan readers that assumed pictures only on cards must allow it.
