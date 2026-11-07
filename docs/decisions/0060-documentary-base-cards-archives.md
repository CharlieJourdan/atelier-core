# 0060. The documentary base: cards are shots, archives are searched on this computer, the look is measured

Date: 2026-11-02. Status: accepted. Decided by: Charlie (01/11: « essaie de reproduire… Markets of the Past… développe ce qu'il
faut pour recréer ce style… du montage, du motion design pour la partie qui fait les cartes ») + Claude (style-markets), within
records 0021 (brick → engine → style), 0042 (reproducing a style), 0050 (our motion bricks), 0055 (measured settings).

## Context
The second base pipeline after `voiceover@1` reproduces a history channel's long format (measured on its videos): a narrator over archives (≈ 70 % of the time: footage, paintings,
photographs as prints on a board, documents on graph paper with a red mark) and motion-design cards (≈ 20 %: dark satellite
maps, data cards, timelines), cross-fades on ≈ 40 % of the changes, dark music, no presenter, no captions. Our motion cards were
overlays only (record 0050's promo was the one opaque card), the only picture search was the Cloud's stock (one provider), the
transitions and the grade were fixed by code.

## Decision
1. **A documentary card is a shot, not an overlay.** Four templates (`formats/cards.ts`: `archive`, `map`, `bars`, `timeline`)
   are drawn opaque by `motion.render` (H.264) and laid on the BASE track; `render.assemble` plays them like clips (never graded,
   a dissolve leaves them from their last frame). An `archive` card frames the shot's own picture (its item stays in the list).
2. **The director asks for cards in words; code times them.** With `cards` on (a `director.plan` setting), the scene pass may
   answer `motion.map|bars|timeline` directives with the card's props and `on` words, and an archive `frame`; `director-cards.ts`
   places each card from its anchor to the end of its held sentences, within the mix's `motion` share, its parts on their words.
3. **Maps are ours, from public-domain data.** NASA Blue Marble (bundled 5400 px, and NASA GIBS crops of the camera's box,
   cached) and Natural Earth borders (`resources/maps`, 2.6 MB); countries by ISO code or English / French name.
4. **Archives are searched locally, free, with a licence per item** (`engine/archive`: Wikimedia Commons, Internet Archive, NASA,
   the Met; public domain, CC0, CC BY, CC BY-SA only; the Library of Congress refuses scripts). `visuals.fulfil`'s `archives`
   setting asks them first, then the Cloud's stock, then a generated period still. The credit line goes into the images record.
5. **The look is the pipeline's settings** (record 0055): `documentary@1` carries `DOCUMENTARY_PROFILE` (shots 3.8 s in the hook,
   5.5 s after, 40 % cross-fades, 20 % cards, 176 words a minute) and derives its settings from it: `transitions: 'sentence'`,
   `cards`, `illustration: 'documentary-archive'`, `grade: 'archive'` (render), `overlays: false` (motion), the `archive-real`
   image style, music from the library. Other bases are unchanged.
6. **A style, never a person**: the channel's narrator is never cloned (a designed voice); its pictures are not reused (our own
   archive search for our own words); real people of the past appear only in their found archives, never in a made picture.

## Consequences
- The style agent proposes `documentary@1` for references without a presenter whose pictures are mostly archives and cards
  (`baseForReferences`, `DOCUMENTARY_SHARE` 0.35, or an archive look), and for the words « documentaire », « archives »…
- A card costs browser time (≈ 0.1–0.3 s a frame): a 30-minute documentary has ≈ 8 minutes of cards; drawing a static card's
  hold as one frame is a later optimisation. Without a browser the cards fall back to their picture (or the neighbour's).
- Not yet: archive FOOTAGE (Internet Archive films in the old-television frame), historical borders (modern borders shaded today),
  several prints on one board, the eyes measuring cards and archives on references (the Gemini schema).
