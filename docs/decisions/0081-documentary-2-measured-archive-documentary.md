# 0081. `documentary@2`: the archive documentary measured on whole videos, its media chosen by looking

Date: 2026-11-03. Status: accepted. Decided by: Claude (documentary-2), within Charlie's review of clone-markets-2 (02/11: « the pictures
are right, the structure is poor »: the same three patterns on loop, too many sound effects, buggy texts, no variety, the old-TV frame
everywhere, stills never zoomed, a score nobody can read) and his standing orders (found media only, cheapest and fastest, settings).

## Context
clone-markets-2 reached 74 / 100 with a tool outside the app; the app's own `documentary@1` stayed at 18 / 100 (generated stills, loose
archive results, no film, no prints board, a « DÉMO » mark over a real film). The clone had measured three minutes and looped them.

## Decision
1. **Measure whole videos.** Five whole videos of the channel's current format (≈ 150 min, 1 808 shots) are classed shot by shot into a
   catalogue of presentation patterns: film in an old-TV frame or full frame, one print centred /
   large / on a side with texts, two to four prints, cream or slate boards, full-frame stills, tilted satellite maps, bar cards, documents
   zoomed and underlined, texts over the films. The channel's older videos (AI stills, subtitles) are left out of the profile.
2. **A base `documentary@2`** beside `documentary@1` (kept as it was). Its director has its own grammar (`grammar: 'documentary-2'`): a scene
   pass says per sentence what the archives can show and which said words may be written (read field by field: one wrong field never
   drops a scene); every on-screen text is checked against the narration for free; a deterministic **sequencer** picks the pattern of each
   stretch from the measured profile (shares per part, maps / charts / documents only when the words give one and never closer than their
   measured gaps, no non-film pattern twice in a row, film montages capped, boards rotating their layouts and turning to cream in runs).
   The profile is the cloned reference's numbers, a setting (`doc2-profile.ts`), never an engine limit.
3. **Media are found, chosen by looking** (`visuals.fulfil` `archivePick: 'look'`): archive films (Wikimedia Commons, Internet Archive, and
   Europeana / NARA through the Cloud's media route when it holds their keys) and photographs are searched with a ladder of queries plus a
   broad period query; Claude picks on contact sheets; a pile of period reels is looked at once and Claude names the moments that fit each
   sentence; only those seconds are cut. A film item with no film shows its own chosen photograph with a slow push, then a neighbour reel
   further on; a photo with none, a frame of the nearest reel. Nothing is generated; a board never shows one picture twice.
4. **Render**: archive film 4:3 in the old-TV mask with its blurred sides, black and white with stretched levels (`grade: 'archive-film'`);
   a film-less film shot is a still with a push, never a frozen frame. New overlay `doc-tags` (typed date, big figure, name strip, red bar,
   chapter title) and `prints` layouts / side texts / colour prints; bars kept inside their room (the overlapping bars Charlie captured).
5. **No sound effect** in the faithful clone (the reference has none). Proposals stay options apart: the « dossier » skin (`docSkin`), parchment
   maps (`docMapLook`); the style agent proposes them as differentiators.
6. **No « DÉMO » mark over a real film** because one picture was a demo answer: a real run is marked only when its voice is a demo (the
   other demo parts are said in the log). Turning a demo picture into a gap was tried and dropped: the dev Cloud's fake providers answer
   demo files by design, and real-run tests rely on them.
7. Archive references now get `documentary@2` from the style agent and `style-propose`.

## Consequences
- Cost ≈ the voice (≈ 0.01 $ a minute) plus a thumbnail; Claude on the subscription for the scene pass, the picks and the reel looks.
  Making time ≈ 4–5 min a finished minute on the build PC, most of it the media search and the reel looks (measured in the report).
- Free film archives are thin for precise subjects: the reel pile and the photograph fallbacks cover them; the reference's own stock-library
  shots need a licence (proposal) or the owner's footage.
- Not done: real document scans with a found line box, film inside a print, colour kept by era, the hook's script pattern in `script.write`.
