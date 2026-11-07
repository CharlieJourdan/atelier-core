# 0036. Simple editing: the render is the montage, editing bricks hand layers, sponsor on the mention's words, our own QR code
Date: 2026-11-01. Status: accepted. Decided by: the production-9 session, within decisions 0012, 0022, 0025 and 0026 (Charlie
asked the chantier to settle open points with sensible defaults and record them).

## Context
production-9 is editing for `avatar@1` (`docs/specs/production-model.md` §2.6, §7.3; `docs/specs/pipeline-avatar.md` §2.10–§2.14,
§3; ENGINE-SPEC §26–§28). Charlie: the simple editing is « juste du code pour aligner les éléments les uns à la suite des
autres », voice under, maybe captions; the advanced editing (an agent) is an option for later. Left to settle: the brick names,
how chapter marks and the sponsor reach the render, the split layout, the QR code, the sponsor asset, the timeline actions.
Code: `src/engine/nodes/edit-sponsor.ts`, `edit-chapters.ts`, `sponsor-slots.ts`, `render-assemble.ts`, `src/engine/render/`,
`src/engine/media/qr.ts`, `marks.ts`, `src/engine/formats/layers.ts`, `timeline-edit.ts`, `src/main/production/sponsors/`.

## Decision
1. **Names.** The spec's `edit.assemble` (simple), `edit.layout` and `render.master` stay ONE brick, `render.assemble@1`
   (as production-7 kept `avatar.speak@1` for `presenter.talk`): shots on the voice in timeline order, straight cuts, slow
   moves on stills alternating direction, the presenter full / split / inset, voice + music master. `edit.captions` is
   `captions.make@1`, `music.pick` is `sound.music@1`. New bricks: `edit.chapters@1` and `edit.sponsor@1` (stage montage).
2. **Layers.** Editing bricks never touch ffmpeg graphs of the render: they hand timed layers (`atelier` value of a
   `media.graphic[]`: file, role, seconds, optional box, still or video, entry fade / pop / cut). The final pass lays them over
   the insets and under the captions, sponsor first, chapter marks over it. Base segments stay cached (R7.6): a layer never
   re-renders a segment.
3. **Split.** A `split` presenter shot is one base segment: the presenter's clip cover-cropped to its half, the picture beside
   it (its still with a slow push, or its clip) on the other half, a thin dark line between; side from the director
   (alternating). Without the presenter's clip the picture fills the frame. Changing a layout changes only that shot's segment
   key. The still under an inset gets its slow move too (it was frozen: QC caught it).
4. **Chapter marks.** Drawn by ffmpeg (a PNG), not by a §25 browser template: the mark is small and static, and the render
   machine then needs no browser. One mark per chapter after the opening (a chapter at frame 0 is the opening), shown 4 s with a
   « pop » (grows from 60 % in 0.18 s). Defaults: top right, pill, the number alone. Position (top right, top left, lower
   third, bottom band), look (pill, slab), a word before the number (« Astuce 2 ») and the accent are brick settings and the
   `edit` style's new `chapters` block (a style dressing the brick wins, decision 0035). The fake outline now honours an
   explicit number of chapters at any length (`script.write@2` setting `chapters`); « auto » keeps chapters from 6 minutes.
5. **Sponsor slot.** Each mention of `json.outline.sponsor` is found in the voice's words by its sentences' anchors; the slot
   runs from just before its first word to the start of the sentence after it (the same window the director puts on the
   timeline). It shows our card (kicker « Partenaire », name, pitch, link, over the picture darkened to ~95 %) or the
   sponsor's own media (`écran : média`): a clip plays from the first word, cut at the end or held on its last frame
   (never looped, its sound dropped), a picture held; a missing file falls back to the card with a warning; a clip over 90 s is
   refused. The QR code sits at its position (bottom right by default; top right, bottom left, top left, centre right) and
   size (28 % of the height), whole pixels per module, for the whole slot; the reminder gets the same slot.
6. **QR code.** Our own encoder of the public standard (byte mode, level M, versions 1–10, up to 213 bytes, mask by penalty),
   no dependency; ffmpeg's `quirc` reads it back in the demo and the tests. A longer link is refused, never cut.
7. **Sponsor asset.** One per channel (migration 033 `channel_sponsors`: the text the owner typed, checked by the engine's
   `parseSponsor`), IPC `channelSponsor.get` / `channelSponsor.set`. A run of the channel whose pipeline reads `sponsor` and was
   given none takes it, stored in the run's inputs (« Refaire pareil » keeps it). The sponsor's text gains `média`, `écran`,
   `qr`, `position du qr`, `taille du qr`, `lien du qr`. No screen yet: the channel assets (voice, presenter, sponsor) get
   their screen together later.
8. **Captions.** SRT and WebVTT always (the package copies both); burnt in only with the option (default off, the references
   mostly have none).
9. **Options of `avatar@1`.** « Chapitres à l'écran » is live (adds/removes `edit.chapters`); « Sponsor + QR » adds/removes both
   `script.sponsor` and `edit.sponsor` (`edit.sponsor` is in the base: 16 bricks, 17 with chapters); « Montage avancé » stays
   « soon » (`montage-avance`, backlog: the overlay agent of production-model §2.6, free on Claude Code, priced on credits,
   decision 0026); « Musique générée » is « soon » for production-10 (a paid provider).
10. **Timeline actions** (R7.2) are engine functions, priced before they run, each saying which segments it touches: layout
   full ↔ split ↔ inset (beside / under picture = the shot's own, else the nearest picture), delete (the previous shot
   stretches, else the next; an unused item leaves the list), regenerate with a new prompt (a new item id, so new files and
   cache keys). Replacing a source with an uploaded file and animating a still need the stills brick to take a user's file;
   wiring the actions to the editor screen and re-running the render from an edited plan come with the editor chantier.

## Consequences
- The proof `npm run engine:avatar-base-demo` renders the full avatar pipeline (1 min 30) on fakes: three layouts, the
  sponsor card whose QR decodes to the link, a chapter mark, SRT + VTT, music.
- New nodes 26 (was 24); `avatar@1` 16 bricks by default.
- Open: the agent-made advanced editing; the sponsor's own clip arrives as a local file (the Cloud's signed-link storage of
  decision 0025 is production-10's); the channel-assets screen.
