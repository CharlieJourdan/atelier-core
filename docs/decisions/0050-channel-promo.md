# 0050. The channel's own promo: the sponsor asset with `type : promo`, drawn by our motion bricks, reused and placed by channel settings

Date: 2026-11-01. Status: accepted. Decided by: Charlie (notes of 2026-11-01: « la promo est un input de la chaîne ») + Claude
(promo-motion).

## Context
Charlie's channel promotes its own offer (« Le Cahier d'Gaston », exemple-compagnon.fr) with a motion-design card: in his reference
video it runs from 84.60 s to 94.32 s (9.72 s; the spoken passage around it, 84.8–98.5 s, is about 14 s). He wants it rebuilt
« pièce par pièce » with our own motion technology (practice for pipelines made from a style), and made an input of the channel
that the agent can generate per video, keep identical, adapt, or replace with a clip he already made, placed on a part of the
script (often after the hook, sometimes at the end, sometimes not at all), asking when it does not know.

## Decision
1. **One asset, two kinds.** The channel's sponsor asset (production-9, decision 0036) gains `kind: 'promo'` (`type : promo`):
   the same slot logic (a mention in the script, a window on its words, a layer over the film), its own card (`PromoCard`) and
   settings. A channel has a sponsor or its own promo in that asset, not both at once (one slot per video, as the reference).
2. **Our motion bricks draw it** (`screen: 'motion'`, the default of a promo without a clip): a full-frame page of our motion
   runtime with new reusable presets (blur entrances, a logo reveal, a slow push in, a clicking pointer, fitting to n lines), the
   reference's measured timings, OFL fonts closest to the reference (Oswald, Source Serif 4), an opaque H.264 clip. A clip the owner
   made (`média : …`) is laid as it is.
3. **Reuse** (`mode`): `same` = one clip for every video (cached by content: drawn once per machine); `adapt` = the card's text
   written for the video (by the script's model, else a line naming the video's subject); `per_video` = a card made for the video
   (its title as headline, the layout varied). Unknown → `same` until answered.
4. **Placement** (`place`): `after_hook` = the paragraph break nearest to `moment` (default 1:25, the reference's); `end` = before
   the closing paragraph; `mention` = the passage of the script that already names the site or the product (the script unchanged);
   `none` = no promo. Unknown → after the hook until answered. No reminder for a promo.
5. **The agent asks** one short French question per unknown setting when it proposes a pipeline for the channel (« Ta promo, on la
   place où ? », « Ta promo, d'une vidéo à l'autre ? »); the answer is written into the channel's asset at once.

## Consequences
- The promo is free (local motion render, about 0.3 s a frame at 1080p) and the same clip is reused across a channel's videos.
- The picture assets of Charlie's promo (the book) are cut out of his own reference frames; nothing third-party is copied.
- Not yet: a 9:16 promo layout for shorts; the agent generating the card itself from a site URL (it needs a screenshot capture);
  a sponsor and a promo in the same video; the Production screens showing the promo's settings (the asset is text for now).
