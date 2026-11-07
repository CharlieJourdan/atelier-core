# 0098 — The cloning engine's analysis measures the whole video; the eyes only name what is on screen

Date: 2026-11-04 · Chantier: moteur-analyse (A) · Spec: `docs/METHODE-REVERSE-PIPELINE.md` §2 P1–P2 · Contract: 0095

## Context
P2 must turn a reference into numbers a Style Definition can be built from (presenter census, layouts per part, voice,
motion, editing, sound, script), every number with its evidence, the whole video, and say plainly what it could not
read. The eyes of decision 0085 give a whole-video shot log (cuts, words per shot, labels) but no frames, no sound, no
presenter layout, no word timings; a model's reading of a link can also be partial while saying « complete » (seen on
Le Monde en POV: 226 s read of an 825 s video).

## Decision
1. **Numbers are measured, never asked of a model.** From the downloaded file: shot lengths, curve, holds, cut-on-phrase
   share (scene detection), pace and pauses (faster-whisper large-v3 word timings, an error when no recogniser runs),
   loudness (EBU R128), the music bed under the voice (median momentary loudness in the voice's pauses minus during
   words), the voice's pitch (autocorrelation → timbre), on-screen text landing against its spoken word.
2. **A vision model only names what it sees**, one row per counted shot on contact sheets (presenter layout full / half /
   inset / off, framing, view, picture origin found / filmed / generated / drawn / 3D / motion / presenter / screen,
   motion element), plus one global look (identity as a TYPE, palette, fonts, grade) and one script reading (parts,
   structure, hook, promise, payoff, CTA, devices). The same prompts serve Haiku in the app and a subagent in a proof.
   Presenter angles are his talking set-ups (origin `presenter`), not the acted scenes he also appears in.
3. **Whole or said.** A link reading that does not cover the downloaded file (or whose cuts are the model's) is read
   again locally from the file; a log whose shots stop early leaves a gap; a refused download keeps the link's log with
   frames, sound and timings marked unread. What cannot be measured without a listening model (music genre, SFX, music
   changes, real vs synthetic voice) is listed in `unmeasured`, never filled.
4. **A style is a format, not a mix of origins.** The synthesis groups videos by form (long / short) and what carries
   them (filmed conversation, 3D, drawn, screen recording, else explainer); a style holding ≥ 60 % of the corpus is
   chosen, the others are variants kept apart; otherwise the user is asked (`ASK_USER`). Constants are values ≥ 60 % of
   the chosen style's videos agree on (numbers within ±25 % of the median), shaped as the Style Definition field they
   feed.
5. **P1 picks the main format** (long form unless fewer than 5 long videos), latest 3 + top 2 filled to 5, plus one
   video of the other format as a style variant; a mix reads every reference. P2 checks the disk floor and a quote before
   each video and verifies frames on disk with dense frames on the hook and each part change.

## Consequences
- Proof (2026-11-04): Finary 6, The Japanese Method 5, Le Monde en POV 5, Yarnhub 6 videos analysed and checked by
  `checkP2`, artefacts and a French one-page summary per channel in a folder outside the repo;
  YouTube started refusing downloads from the build PC mid-run: 5 analyses are partial and say so.
- An analysis costs nothing when the download works (local measures, labels on the subscription); the model's reading
  of a link (≈ 0.01 $ for 4 min) is the fallback the engine still re-checks.
- Requests to the assembler (fakes write their frames, `ASK_USER` as a pause, `eyes.quoteUsd`, the whisper Python for
  `WholeWatcher`) are in the chantier's report.
