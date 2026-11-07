# 0034. The presenter: made once per channel, generated once per video then cut; what the spec left open
Date: 2026-11-01. Status: accepted. Decided by: the production-7 session, within decisions 0012, 0014, 0015, 0021 and 0025
(Charlie asked the chantier to settle open points with sensible defaults and record them).

## Context
production-7 builds the presenter (`docs/specs/pipeline-avatar.md` §2.5, production-model §2.5): the channel's presenter asset
(`presenter.make`: portrait, clone, angles, register), the per-video `presenter.talk` « one generation, then cut », five
presenter engines behind fakes, and the open-model benchmark Charlie runs himself (0015: 20 $ at most). The director
(production-6, 0031) places one presenter shot per item, about 45 for 12 minutes.

## Decision
1. **Brick names.** The spec's `presenter.talk` is the technology `avatar.speak@1` in code (the brick name every pipeline, option
   and test already uses); its node `avatar.speak@1` gains optional params `talk`, `engine`, `fallbacks`, `presenter`. Absent
   `talk` = one clip per shot as before (old fingerprints unchanged); the technology always sets it, so every pipeline compiled
   from now on, and the editor's drawing, uses the new method. Code: `src/engine/presenter/` (batch, lock, talk, face).
2. **One generation, then cut** (`planBatches`). Every shot keeps `handleS` = 0.2 s of voice on each side; two shots whose gap
   costs less to generate than two handles and a silence (≤ 0.5 s) are one stretch; stretches are joined in order with a
   0.1 s silence; a new call starts only when the next stretch would pass the engine's `maxCallS`. Each shot is then cut out
   of its call at its own offset, for exactly its frames. Measured on the 12-minute French narration at the `avatar-mix` mix:
   47 shots, 4 calls, 193.6 s shown (26.4 %), 216 s generated = **17.7 s per finished minute** (spec ≈ 17.5; Headcast ≈ 24).
   One call per shot would generate about the same seconds (17.4 s/min) but bills each call rounded up to the second and makes
   47 jobs instead of 4; the batch is what keeps the face and the light identical across shots.
3. **Cuts.** A cut is the director's (R21.2, 0031): 3 frames before the next word, so the cut belongs to the boundary between
   two words and never lands later than the word nor more than those frames into the previous one. Merging too-short shots
   stays the director's job (it never places a presenter shot under 2 s); the batch only joins near shots for generation.
4. **One engine per video.** `talkWithFallback`: the pin's fallbacks are tried in order only before the video's first
   generation exists (fresh or cached); after it, a failure is reported (« Le présentateur … a échoué au milieu de la vidéo »)
   and the run waits: an engine swap mid-run is refused, the face never changes mid-video. A failed call does not turn its shots
   into pictures (one call holds many shots); the spec's per-shot picture fallback is left to production-9 (the render).
5. **Framings** (option « Présentateur »). `single`: the portrait. `recrops`: wide (full frame) / medium (80 %) / close (62 %) cut
   from the one generation, the opening wide, neighbours never alike, the engine asked for 1080p (the price line of the
   resolution). `multi`: the portrait and the presenter's angles in turn, each angle its own series of calls (the total
   generated seconds do not grow). The three choices are live (no longer `soon`).
6. **Engine limits** (`src/shared/presenter-engines.ts`): `maxCallS` HeyGen 180, Hedra 60, Kling 60, InfiniteTalk hosted 60,
   InfiniteTalk GPU 60 (colour drift past a minute); prices per resolution from pipeline-avatar §9. All provisional, to confirm
   on the first real calls (production-10, `docs/PROVIDERS.md` §6). Registration: HeyGen only; the engine returns the face's id
   (`data.registration`), the node passes it out in its meta and the presenter keeps it per engine.
7. **Angles' face check.** Local and free (`src/engine/presenter/face.ts`): the largest patch of skin is the face, its box is
   described by a normalised 16×16 luma pattern and a colour histogram; score = 0.6·correlation + 0.4·intersection.
   **Threshold 0.92**, picked on ten drawn stand-in people (portrait, wide, close): best other-person score 0.91, true angles
   median 0.94 with 75 % at or above 0.92; black and noise frames 0. The threshold is set to never keep another person: a doubtful
   true angle is dropped and made again (≈ 1 cent). Real-looking faces could not be tested offline (no real portrait in the repo,
   downloading one needs Charlie's OK): production-10 re-picks the threshold on the first generated portraits and may replace
   the local check by the eyes' identity check.
8. **The presenter asset** (`src/main/production/presenters/`, migration `channel_presenters`): portrait from an art direction
   (style `presenter-studio`), clone from the channel's own frames only with the consent `own-channel` (proposed until
   accepted), 3–6 angles kept by the face check, registrations per engine, a link to the channel voice; the channel's default
   active presenter reaches every run as `$style.presenter`. Pictures go through a port: the fake draws stand-in people; the real
   one waits for image references in the Cloud contract (production-8).
9. **The open-model benchmark** (`npm run cloud -- providers try talkingAvatar --engine presenter:infinitetalk-gpu … --bench`):
   four clips (10 s 480p, 10 s 720p, 30 s 720p, 60 s 720p), each RunPod job bounded by an execution timeout computed from the
   remaining budget, so the series can never pass 20 $; it prints « Coût maximum : X $ » before any call and writes a report
   (GPU seconds per video second, $ per minute). The worker image (`deploy/runpod/infinitetalk/`) is written from the model's
   README and never built: Charlie builds and deploys it.

## Consequences
- Every new avatar video makes its presenter in a few calls on one engine; the demos and tests prove it on fakes.
- production-10: confirm each engine's names, limits and prices; run the benchmark; re-pick the face threshold on real faces.
- production-9: compose `split`, and turn a failed presenter call's shots into pictures if the run should not wait.
- A presenter screen (create, clone with the consent tick, angles, default) is a follow-up, like the channel voice's.
