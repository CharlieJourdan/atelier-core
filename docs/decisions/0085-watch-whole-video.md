# 0085. The eyes read the whole video, by legitimate ways only

Date: 2026-11-03. Status: accepted. Decided by: Claude (chantier regarder-videos), from Charlie's second review.

## Context
Clones copied the look but not the cadence, structure and hook: references were read on sampled passages (the first 5 or 15
minutes by Gemini, or a few windows by hand). YouTube refuses downloads from the build PC at times. Charlie: no work-around of
YouTube's checks, no dependency on the YouTube Data API's quota.

## Decision
- One capability, `eyes.watchVideo` (`src/main/eyes/whole.ts`, engine `src/engine/watch/`, log `src/shared/shot-log.ts`): a
  structured shot log of the WHOLE video (time, length, kind, what is shown, verbatim text, the words under the shot, whether it
  illustrates them, camera move), the hook shot by shot, the cadence curve, cached per video in `userData/watch-cache`.
- Ways, in order: a file the user supplied → a normal download when the platform serves it (fixed yt-dlp arguments with
  `--ignore-config`: no cookies, login, impersonation, PO token or player option; a refusal is accepted) → Google's model reading
  the public link through Atelier Cloud (ranges of 4 min, the first minute at 2 frames/s, priced before each range, stopped at a
  budget). Nothing else.
- Local reading counts the cuts (ffmpeg scene score, decision 0080), takes word times (faster-whisper when installed, found with
  `ATELIER_WHISPER_PYTHON`, else the video's own caption track), and names shots on contact sheets with Claude at Haiku level (route
  role `video_watcher`, tier fast, the user's subscription). The model never sets a time; it may only mark a « cut » that is a
  caption change, which is merged. The log keeps both counts.
- Every analysis that uses a video (the eyes, « Créer une pipeline », the agents' look) uses the whole log when it can and says in
  plain French when it saw only the first minutes. A partial log is never presented as the whole.
- The Cloud route `POST /v1/media/watch` gains `dense` and `fps` (backward compatible: an older Cloud ignores them and the log lists
  the missing fields).

## Consequences
≈ 0 $ billed and 17–25 s a minute for a long video read locally (API-price equivalent ≈ 0.005 $ a minute); ≈ 0.003–0.005 $ a minute
and 3–9 s a minute by Gemini on the link. The dense Gemini mode needs the beta Cloud to be deployed. Scene detection and the model
disagree on fast footage (counts kept side by side); a frame-level calibration per genre is a follow-up.
