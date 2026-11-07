# 0061. A pipeline made from other references takes their requirements, not its base's

Date: 2026-11-02. Status: accepted. Decided by: Claude (style-japanese), on record 0055.

## Context
« Créer une pipeline » starts every avatar style from `avatar@1`, whose requirements are Headcast's (record 0055: grey overcast
light, steady clips, the French literal grammar, presenter runs ≤ 8.5 s). On The Japanese Method (warm daylight, a hand-held
phone, a presenter who talks 2–5 % of the time but acts in a third of the pictures) a study kept all of them, and proposed
« Voix off » because the presenter talks under 3 %.

## Decision
1. **A presenter who acts in at least 15 % of the pictures makes a presenter channel**, however little it talks (`ACTING_SHARE`).
2. **The references' measured light and camera decide**: when they differ from the base's profile, the base's grammar
   (`illustration`, `presenterOnTalk`) and clip motion are removed, and the references' own come instead (`presenter-vlog`, the
   hand-held motion), or nothing.
3. **An acting presenter in the references sets « Le présentateur joue l'action »**; their labels a minute and presenter runs
   become the director's settings.
4. **The eyes are asked for these measures** (presenter to camera and acting, pictures, shot, light, camera, labels, pace, offer);
   a measure out of range drops the measures, never the analysis.
5. **The measured profile stays with the pipeline it made** (its first message, or its version note).

## Consequences
- A pipeline from any references starts from its own look; `avatar@1` as shipped keeps Headcast's.
- Live on the beta only once its Cloud is redeployed and Gemini is a real engine there (today the eyes are its demonstration).
