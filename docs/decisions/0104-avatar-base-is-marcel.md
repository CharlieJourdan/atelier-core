# 0104. The avatar base is Marcel's measured style; the character, the voice and the set are the channel's; Charlie's avatar channels are its variants

Date: 2026-11-04. Status: accepted. Decided by: Charlie (« fais du style de Marcel LA chaîne avatar de base ; le personnage, la voix
et le décor deviennent des réglages ; mes 3 chaînes avatar en variantes ») + Claude (avatar-base-marcel).

## Context
Marcel's hand-made clone (avatar-layouts round 3, recipe « structure mesurée v3 ») is the best avatar pipeline Atelier has: the
presenter's layouts measured per part, the curve given to the director unscaled, ≈ 0.51 $ a finished minute on 13 minutes. avatar@1
still carries the older Headcast defaults. Charlie's three avatar channels (Marcel, Klaus vom Kundendienst, Gaston le Compagnon) were
measured on their own videos: they are one format — same layouts, geometry, card,
presenter share — with a longer full-frame hook for Klaus and Gaston and slightly different inset spacing.

## Decision
1. A new base `avatar@2` « Chaîne avatar » is the v3 recipe without Marcel: measured layouts and curve, the curve's own average as
   the mix and as the option `clipShare`, no music, the same options as avatar@1. avatar@1 stays for the
   pipelines made from it (a base version is registered beside the old one).
2. The character, the voice and the set are never base settings: a run uses the channel's default presenter (its portrait and
   HeyGen look; the set is what the portrait shows) and its default voice. The voice engine is the option « Qualité de la voix »
   (ai33 now, MiniMax HD once the channel has its clone: one setting, no code). The budget stays `mix.budget` (record 0075).
3. A variant (`AVATAR_VARIANTS`, `variantDoc`) is a handful of measured settings over the base: language, locale and the trade's
   objects, the hook's length (`fromS`, `fullUntilS`) and `insetGapS` when the channel's videos differ, the voice quality, and the
   character / set / voice descriptions the channel's presenter and voice must match. A variant fixes nothing that is the channel's.
4. Marcel is unchanged but for one thing: his variant compiles to the same nodes and parameters as the v3 recipe (test), except
   the clip pairs. v3's « half » made one clip serve two neighbouring shots on DIFFERENT subjects (Marcel 0:36.8 « filters drying »
   then 0:42.9 « hand closing the cover » from one generation); the blocking checks (record 0102) refused the first real renders
   for it as a duplicate picture — a real error, not a likeness detail. avatar@2 pairs only on one continuous action (`clipPairs:
   auto`), approved by the coordinator on 2026-11-05; the 13-minute quote goes from 863 to 900 credits (≈ 0.62 $ a finished minute max).
5. The first real renders also showed the final voice check (0102) refusing natural pauses: Whisper starts a word inside the pause
   after the previous one, so the previous word's fading release looked like the word's own sound before a hole (11 « cuts » on the
   three voices; 10 after a comma or a full stop). `voiceDefects` now treats a hole as the pause between two words only where the
   TEXT has one (the previous word ends a clause, not an abbreviation or an ordinal), the sound before it is that word's release
   (it leaves the word's level within 100 ms of the recognised start and decays over ≥ 40 ms, never falling 15 dB or rising 3 dB in a
   frame), the hole sits at the room tone (≤ 12 dB under it, no digital silence) and lasts no longer than the voice's own `maxPauseS`
   (+ 40 ms). Every constant is measured on the eleven pauses; every other hole keeps the 0102 rule. Fixtures in French and German:
   the measured comma pauses pass, real cuts (digital silence, a word stopping at its level, short fades, a plateau then a cliff,
   with or without a comma) fail; the residual is a test. Three independent reviews (two rejected earlier versions). Klaus's
   example script got the comma its two clauses take (« ab, und »): without it the text has no pause and the check still refuses.

## Consequences
- A new avatar channel of the same format is a variant, not a new clone: measure its layouts, character, set and voice; give
  its channel a presenter and a voice. « Créer une pipeline » can start from `avatar@2` (record 0112, chantier H).
- Klaus's and Gaston's presenters are frames of their own videos and their voices ai33 clones of 90 s of their own speech (Charlie's
  own channels, coordinator's OK of 2026-11-04), on the test copy only; their MiniMax clones plug in by « Qualité de la voix ».
