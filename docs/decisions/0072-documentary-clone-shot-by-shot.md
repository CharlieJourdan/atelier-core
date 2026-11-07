# 0072. The documentary is cloned shot by shot on the reference's own media: prints boards, archive film, no generated picture

Date: 2026-11-02. Status: accepted. Decided by: Charlie (02/11: « pas du tout 75 / 100 », a real clone measured against a real video,
no generated pictures where the reference has archives) + Claude (clone-markets-2).

## Context
`documentary@1` (record 0060) was built from a summary of four passages of Markets of the Past. Its first real samples, and a real
run of our own Switzerland script (r0, 8 credits), scored ≈ 18 / 100 against the reference measured frame by frame: generated
« period » stills, colour modern pictures found by loose queries, flat maps, one print per board, empty data cards, and a « DÉMO » mark
over a real film. Measured on 359 frames of « The Real Reason Hitler Never Invaded Switzerland » (0:00–3:00), the reference is 51 %
archive film in an old-TV frame, 39 % boards of 1–7 prints with labels on their words, 10 % oblique satellite maps; no generated
picture, no data card in these minutes; every archive in black and white; hard cuts; effects on every graphic event; music that
changes at the chapter turn.

## Decision
1. **A documentary clone is measured against the reference's own media.** Its archives are searched where the reference took them
   (frame matching found 8 of 16 film shots identical, all public domain: « Why We Fight », « Landsgemeinde Altdorf 1927 »); what is
   not found under a clean licence is listed as a gap, never generated.
2. **The prints board is a card of its own** (`prints`, formats/cards.ts, motion/doc-prints.ts): 1–8 prints dropped on their words at
   the reference's measured sizes, labels typed letter by letter, torn name strips, black serif boxes, red bars; surfaces slate,
   cream paper and kraft (the « dossier » differentiator, with rubber stamps). A plan's shot names the board's other pictures in
   `alsoItems`.
3. **The next documentary base (`documentary@2`) follows the measured profile**: film 51 / prints 39 / maps 10 % in the hook, hard
   cuts, labels on their words, black-and-white archives, no generated picture (a gap is flagged instead), music cue change at the
   chapter turn; it needs the archive-film base shot (motion-montage) and the film search bricks (technos-medias, record 0069).
4. **What exists is found, never generated, in every pipeline** (Charlie, 02/11): a stock or archive item asks the public archives,
   then the Cloud's found-media chain (Pixabay, then the keyless banks); nothing found is a gap flagged in the images record and
   meta, shown as its neighbour's picture; a demo stock answer in a real run counts as nothing found.
5. Until then the clone renderer ((a script kept outside git)) is the measuring tool
   that proves each brick before it is built.

## Consequences
- The genre costs ≈ 0.01 $ a finished minute in cash (the voice); its cost is time: media search (≈ 45 min of agent time per
  3 minutes today) and map rendering (≈ 4 min per tilted map).
- `documentary@1` stays as it is on proto (its options and tests unchanged) until `documentary@2` replaces it.
