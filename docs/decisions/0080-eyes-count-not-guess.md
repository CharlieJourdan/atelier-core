# 0080. The eyes count what a model only guesses

Date: 2026-11-03. Status: accepted. Decided by: Claude (chantier yeux-precision), from issues #92 and #93.

## Context
Le Monde en POV: the eyes (Gemini) returned 135 words a minute and 4.5 s shots; counted on the video it is 219 and 2.7 s (record
0077). The score of a faithful clone was punished and the studio summary repeated the wrong numbers. Separately, an analysis
refused once answered « conflict » on every retry (its idempotency key was reused with a new quote).

## Decision
- Shot length and cut rate are COUNTED from ffmpeg's per-frame scene score (320 px, 24 fps, score above 0.08, 0.3 s refractory gap;
  ffmpeg's usual 0.3 misses soft cuts). Words a minute are counted from real word times: faster-whisper on the audio when installed,
  else the video's own captions; pauses over 2 s are not speech.
- They replace the model's numbers after the Cloud's reading (`CloudChannelIntel.refine`), for real readings only. A video that
  cannot be fetched keeps the model's numbers; nothing fails. The model's prompt also asks it to count over a 30 s stretch.
- The analysis key carries the day; on a taken key the client tries the key's next generations (25 at most).

## Consequences
The study's numbers and the app's now agree (same method). The download needs yt-dlp and ffmpeg on the user's machine; without
them the old behaviour stays. Not covered: the pipeline name taken from the model's description.
