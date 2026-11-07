# 0110 — rea-video: its method, not its code; the palette guard and the « how it was made » recipe

Date: 2026-11-06 · Chantier: rea-video · Spec: `docs/METHODE-REVERSE-PIPELINE.md` (P2, P3) · After 0085 (the eyes read the whole video)

## Context
A contact sent Charlie github.com/JuneYaooo/rea-video: « reverse-engineer any video, shot by shot: filmed, AI-generated or
coded, how the captions, cuts and audio were made, how to remake it ». Charlie asked whether it should become the base of our
analysis. It is Apache-2.0 (integrable as code, with its notice), Python + OpenCV + onnxruntime, downloads three model files
(UVR vocal separation, YuNet faces, an OCR model) and calls only an OpenAI-compatible vision endpoint the user configures
(none by default). It was run for real, offline, on Le Monde en POV (whole, 10 min 39) and on the first 6 minutes of a Finary
video and of Markets of the Past, and scored with our `eyes.watchVideo` logs against 120 probes judged by eye.

## Decision
- **Not adopted as a base, not vendored.** Without a vision model it is far below our eyes on YouTube documentaries (Le Monde
  en POV 6/24 against 17/24, Finary 8/24 against 19/24, Markets 2/24 against 16/24; it calls flat drawings, real news and
  archive film « AI video » or « 3D »); with a vision reviewer (Claude Haiku on the subscription, its own « agent review »
  path) it equals the eyes on POV (17/24) but stays below on Finary (16/24, 8 false « AI ») and Markets (2/24: its fusion
  never overrules its own two first candidates). It is ≈ 8× slower
  (200 s of computing a minute of video against 25 s) and tuned on Chinese short-form videos (platform transcodes, phone
  footage, sticker detection). Its model calls send a video clip per shot plus the WHOLE video as base64 to the endpoint:
  Atelier Cloud has no such route (Gemini only reads public links, `POST /v1/media/watch`), so its vision step was given to
  Claude on the user's subscription (0 $ billed), like our own labeller. No new provider is needed.
- **Its method is re-implemented where it beats us** (credited in `VENDOR.md`):
  - the **palette guard**: `src/engine/watch/forensics.ts` measures each shot's palette (4-bit colours covering 95 % of the
    pixels) on one small ffmpeg pass; `analysis/forensic-guard.ts` re-routes a shot the look calls « generated » whose
    picture is made of ≤ 48 flat colours to `drawn` (or `motion` for cards and maps). Image-model pictures measured 50–180.
    Texture tests were tried and dropped: Le Monde en POV adds film grain to flat drawings. The palette never touches a
    found shot (black-and-white archives also have few colours);
  - a clearer **drawn vs generated** rule in the shot-log and look prompts (flat fills, clean outlines, a character redrawn
    identically, halftone cut-outs → drawn or motion; fine texture and small deformations → generated);
  - the **« how it was made » recipe** (`definition/how-made.ts`): every analysed shot gets one production method (14
    methods) and every method, layer and sound a route — the engine brick, a human input slot, or « impossible » — taken from
    P3's element rules, so the recipe and the feasibility map never disagree. P3 saves it as `Feasibility.howMade`.
- **Not taken now**, with the reason in the research note: its music tempo, key and section changes (POV measured 156.6 BPM
  for a ≈ 95 BPM bed, 20 « sections » in one continuous track), its signal-level SFX list (its own measured precision ≈ 0.2),
  its OCR caption timeline (needs an OCR engine in the app; our model already reads the text verbatim), its live-action
  lighting / camera-rig analysis (our references have no filmed presenter in these videos).

## Consequences
On the 120 probes the guard halves the eyes' false « AI » calls (6 → 3) and re-routes 15 of the 37 « generated » shots of
the two whole videos to motion.render (Finary's cut-out collages, two POV scenes); a ≈ 5 s ffmpeg pass per 10 minutes is
added to P2. POV's gradient-sky drawings (palette 60–125) overlap image-model pictures: the prompt rule, not the palette,
must catch them. A Cloud route for inline frames (Gemini on images) would be needed to run rea-video's own VLM mode; it is not
built (no need: the subscription does it for free).
