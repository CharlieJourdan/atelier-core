# 0049. Pictures never repeat within 20 s; one lossy encode; presenter in 1080p, read as BT.709; no music by default

Date: 2026-11-01. Status: accepted. Decided by: Charlie (his verdict on the first real 60 s hook) + Claude (avatar-qualite).

## Context
Charlie on the app's first real hook (run « video-4 », 01/11): « les 3 derniers plans c'est quasiment les mêmes », the white wall
corner again and again, then painted (« vraiment ignoble »); « la musique derrière : non »; « la qualité est moins bien, le
présentateur est en 720p ». Findings:
- the scene pass gave a « recurring » description of the wall corner, written at the head of 5 of the 10 pictures (and the first
  one passed as a reference image); it gave 9 directives for 10 shots, and the fill reused a directive on two shots in a row;
- HeyGen's plan server makes real 1080p (a 720p round trip changes it by 43 dB), softer than the reference's presenter (face
  detail 6.1 against 7.1); our chain then encoded it three times (CRF 12, CRF 12, CRF 18): 5.8; and read its untagged video as
  BT.601 (skin red −5/255). The engines' default resolution was 720p, so the HeyGen API and the other fallbacks were asked 720p;
- the reference's B-roll is softer than ours (1.9–2.3 against 3.3–9.3): its clips hold no detail above 720p (a 720p round trip
  changes them by 49–52 dB, often even a 540p one), only its presenter and stills do; ours are the same (Veo 720p, GPT stills,
  HeyGen 1080p). Charlie (01/11): match Headcast, never a dearer default.

## Decision
1. **No subject twice within 20 s** (`REPEAT_WINDOW_S`, `director-variety.ts`), unless one continuing action (a clip shared by two
   shots). The director's plan check refuses a scene-pass plan where two pictures within 20 s share their subject or have alike
   scenes (word overlap ≥ 0.5, framing words and words most prompts share set aside); the deterministic directives' repeats are
   only listed (they describe no scene).
2. **One directive per picture.** The fill gives a directive to one picture only; a shot left without a fresh one takes another
   angle of the guide on its sentence's words. The scene pass is told how many pictures each sentence gets (a fill without
   directives) and, when some still run short, ONE more call (`topUpPass`) asks for new directives there with what is on screen
   around them.
3. **A shot-planning guide** in the scene pass's rules: show the exact words, rotate the angle (hands at work, the object named,
   the place, the result, a person reacting), alternate close and wide. A « recurring » description only for a distinctive object
   or character, never a wall, corner, floor or room, and written at most once per 20 s per object.
4. **Before the render**, two real pictures within 20 s whose difference hashes are under 18 bits of 64 apart and whose 16×9
   colours differ by less than 50 on average stop it (the wall corners were 3–14 bits and 5–44 apart, different scenes 23 bits
   or more), with the way out: change one shot's directive in the timeline.
5. **One lossy encode**: every intermediate (presenter cut, clip piece, segment, join) is lossless H.264 (`-qp 0`), the final pass
   (CRF 18, medium) the only compression. Cost: about 55 Mbit/s of temporary files at 1080p30.
6. **The presenter**: `avatar.speak` asks 1080p by default, each engine its best up to it at no more than its default price
   (`resolutionFor`: HeyGen plan and API, Kling 1080p; Hedra, Pruna and the 720p-only engines 720p); an
   untagged presenter video is read as BT.709; every cut gets a mild luma sharpen (`unsharp=5:5:0.35`, face detail 7.4).
7. **No music by default** in `avatar@1` (the base stores « Musique » = « Aucune »; the brick stays in the document, the option
   brings it back); its before / after preview is pipeline-ui's (record 0048).

## Consequences
- The real hook's recorded answer replayed on the new code, and a real Opus pass with the new rules, both give a 60 s plan with no
  repeated subject (`tests/unit/director-variety.test.ts`).
- No paid default moved up. Veo 1080p (+0.85 $/min) and GPT Image medium (+0.09 $/min) stay options, off; HeyGen is 1080p already.
- Bigger temporary files while a film is made; the final file is about 6.3 Mbit/s (reference 6.9).
- Not done: the render stays at 30 fps while HeyGen and the reference are 25 fps (one presenter frame in five is doubled).
