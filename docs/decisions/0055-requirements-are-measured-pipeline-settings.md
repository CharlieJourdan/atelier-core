# 0055. The requirements are a pipeline's measured settings, never the engine's limits

Date: 2026-11-01. Status: accepted. Decided by: Charlie (« c'est pour apporter un niveau d'exigence plutôt que mettre des
barrières pour plus tard, et c'est vraiment propre à cette pipeline, la pipeline de base ») + Claude (avatar-qualite).

## Context
Parts 1–4 of avatar-qualite raised the avatar videos to Charlie's Headcast references with rules: a presenter run of at most
8.5 s, a picture cut 0.1 s before the word that names it, no subject twice within 20 s, no text labels, grey overcast light, a
steady phone camera in the clips, the literal grammar of the references, an illustration check with a bar of 8/10 and an
alike-pictures check over 20 s. Several were constants of the engine (`MAX_PRESENTER_RUN_S`, the grammar lines in the scene
prompt, the clips' default motion, the 20 s window), so every pipeline got them: a motion-design or 3D pipeline built later
would have been held to Headcast's editing. And a failing check could still stop a run (the illustration check rethrew a dead
sign-in).

## Decision
1. **Every requirement is a setting of a brick, off by default in the engine.** `director.plan`: `presenterRunMaxS`,
   `presenterOnTalk`, `cutLeadS`, `repeatWindowS`, `labelsPerMin`, `illustration` (a grammar preset, today
   `reference-literal`); `visuals.fulfil`: `illustrationBar`, `alikeWindowS`; `clip.make`: `clipMotion`. Unset, the director
   places the presenter and the pictures as before, the checks do not run and the clips keep the generic gentle motion.
2. **A pipeline carries its « profil mesuré »** (`ReferenceProfile`): what its reference videos measure (presenter runs, cut
   lead, literal share, labels a minute, light, camera) and the choices made on them (repeat window, check bars). `avatar@1`'s
   is `AVATAR_PROFILE` (Charlie's two Headcast videos, 427 shots), and its settings are derived from it
   (`settingsFromProfile`), never typed by hand.
3. **The method is reusable**: `measureEditing` (shots + word timings → profile), `settingsFromProfile` (profile → brick
   settings), `compareProfiles` (render vs reference → gaps in plain French). « Créer une pipeline »'s style step derives the
   same settings from its own references' measures (`styleOps`); a reference that does not show what its words say never gets
   the literal grammar.
4. **A check never stops a run.** The illustration check and the alike-pictures check log a warning and leave the pictures as
   they are when they fail (dead sign-in included); only a cancel stops them. The render warns on alike pictures (0053).

## Consequences
- Another base (voiceover, 3D, documentary…) gets none of avatar@1's requirements; a pipeline from other references gets its
  own values, or none.
- The director's tests run without the settings and are as strict as before part 4; avatar@1's are tested through its compiled
  recipe and the recorded real pass (`part4Pass`).
- Still a stop, outside this decision: the render refuses a shot whose picture is missing (`shotProblems`), since it would
  otherwise show a black frame.
