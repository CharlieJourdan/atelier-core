# 0102 — Real errors are blocking checks measured by code; a free demo is judged before anything is paid

Date: 2026-11-04 · Chantier: controles-bloquants · Builds on 0086 (edit review), 0097 (blind judge), 0100 (engine in the app)

## Context
The first real clones were delivered with errors that make a video unusable: the voice broken inside words (Le Monde en POV:
6, at 0:28, 1:57, 2:36, 3:02, 3:08, 3:44; the Japanese example: 13; Marcel: 11; Finary: 16), repeated pictures, frozen
pictures, dates and figures on screen the voice never says, maps without legends. The edit review (0086) found several of
them but only REPORTED them: the clone still said « cloned ». Charlie's rule (2026-11-04): two kinds of defects are handled
differently. Real errors must never reach a final render, and are measured by code, not judged by a model. « Not similar
enough » is not an error: it stays the improvement loop's job (P7/P8). And money: a style is checked on a free render before
any paid example.

## Decision
1. **Real errors block** (`src/engine/review/blocking.ts`): `audio_dropout` (voice cut inside a word), `word_cut` (the film
   ends during a word), `sound_hole` (the mix silent longer than 1.5 s), `timing_drift` (word times off the voice: captions
   and shots off), `music_loud` (bed less than 14 dB under the voice), `frozen`, `held`, `film_short`, `black`, `duplicate`,
   `text_unsaid`, `text_form`, `text_language`, `map_legend`. Each is measured by code: the voice's energy against the word
   times, ffmpeg `freezedetect` / `blackdetect`, 32×18 thumbnails of the film's own frames, the texts against the said
   numbers. Not blocking: what a model judges (`off_subject`) and style choices (`hook_slow`, `text_late`, `audio_click`).
   Limits are settings (`SOUND_LIMITS`, `FILM_LIMITS`, `REVIEW_LIMITS`), never hard engine limits on other styles.
2. **Repair, then refuse.** The render's review loop repairs what it can (drop a repeated shot into a neighbour, a camera
   on a held picture, a wrong text off, and now the music bed lowered in the final mix — `musicDb`, only the final pass
   re-runs) and renders again; a film with a real error left is refused: `render.assemble` throws `verify_failed` with the
   errors and their times (`blocking: 'refuse'`, the default; the report is saved as `review-refused.json`). A test render
   that must still be compared asks `blocking: 'report'` (the clone's P6 rounds and free demos; a `review: 'report'` render;
   the test benches whose stand-in engines repeat one sample clip); the P9 example refuses, and a refused example ends the
   clone as « example-refused » (saved, so a resume does not pay for it again). A silence up to the voice's own longest pause
   (`voice.trim`'s `maxPauseS` + 0.5 s) is not a hole. Repeated pictures on the film are compared only for the pictures the
   render compares itself (not demo drawings) and never across two shots of one continuing clip.
3. **The voice is repaired where it breaks.** The sound missing inside a word cannot be rebuilt by the render, so
   `voice.tts` checks every take it receives (the provider's word times, else the local recogniser's — ai33 sends none) and
   asks again, once by default (`holeRetries`), for a chunk with a break, keeping the take with the fewest. One extra chunk
   (~900 characters) is paid only when a break is measured (the quote does not count retakes). A break counts only when the
   sound comes back BEFORE the next word starts: recognised times stretch a word over the pause after it, and the old rule
   took those pauses for cuts (re-measured: Le Monde en POV 6 → 2 real cuts, the Japanese example 13 → 2).
4. **The music level is measured on the stems** (voice file and bed) under the words. The old measure on the mix's pauses
   counted the bed's designed lifts as « too loud »: on Le Monde en POV it said 7 dB, the stems say 13.5 dB.
5. **Free demo first** (`src/main/production/clone/style-gate.ts`): before a paid P6 round and before P9, the engine renders
   a free demo of the current definition (`demo` service: the app producer with `projects.run({ real: false })`, its own
   video `engine-demo.json`, watched with a 0 $ cap) and the blind judge compares it with the reference. Money is spent only
   when every axis a demo can show (layout, cadence, motion — the channel-styled cards are drawn for real —, captions)
   scores 70 or more; the script (a template), the stand-in pictures and their palette, identity, voice and sound are faked by
   demo engines and judged on paid renders. A refused demo is improved for free
   (the improver's definition changes from the demo's comparison, a new demo), 3 demos at most, then the clone stops with
   « example-refused » without paying. Gates are saved per definition version (`gate-vNN.json`).

## Consequences
- A film made by Atelier with a voice cut, a black or repeated picture, a wrong text or a loud bed is never delivered: the
  run fails with the list, the user sees why. Pipelines whose voice breaks cost one extra chunk; one that still breaks after
  the retake is refused rather than shown.
- `scripts/blocking-proof.ts --artefacts <video-N/artefacts> [--chunks <voice-chunks>]` re-measures any real run (free).
- A clone with a wrong style spends only the judge's cents on demos, never a paid round.
- Follow-ups: a « regenerate the voice » repair from the render itself (today the take check in `voice.tts` is the only
  voice repair); dates checked against the script's sources (only « said near its time » is checked today).
