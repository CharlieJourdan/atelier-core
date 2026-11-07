# 0054. The presenter's runs and the cuts as the references': ≤ 8.5 s in a row, a picture on the word that names it

Date: 2026-11-01. Status: accepted; its limits are avatar@1's settings since 0055. Decided by: Charlie (on run 6: « si c'est comparable à ce que fait Headcast, c'est bon ») +
Claude (avatar-qualite part 4).

## Context
Run 6 held the presenter 12.6 s in a row (three shots back to back, 18.9 → 31.5 s) and cut its pictures a little early: the
spray shot on « avec » before « un spray », the repaint on « même » before « repeint ». Measured on Charlie's two references
(with the Whisper word timings): their full-frame presenter runs last 3.0 to
8.6 s (reference 1: 4.9–8.6, median 7.0; reference 2: 3.0–7.0, median 4.9), never two shots back to back, always between
pictures (at least 5 s of them in the hooks); their cuts fall on a word's onset (median +0.04 s) and the word that names the
picture comes 0.10–0.14 s after the cut (median of 329 cuts), often after a short article.

## Decision
1. **A presenter run is at most 8.5 s** (avatar@1's `presenterRunMaxS`, record 0055): a shot that would extend a run of back-to-back shots past it is
   cut short or left to the pictures; one shot may last up to 8.5 s (it was 6 s). The duration tuning never extends a run past
   8.5 s, never ends a shot in the last 1.2 s of a sentence, and crosses into the next sentence only to its end.
2. **A picture lands on the word that names it** (`contentWordOf`): the first word of its sentence, from the anchor on, that shares
   a stem with the directive's subject, else the anchor's first word that carries meaning (never « avec », « même », « vous
   avez »…); the cut is 0.1 s before that word (avatar@1's `cutLeadS`). The director is told to start its anchors on that noun or verb.
3. Without those settings (the engine's default, record 0055) the director places the presenter as before, so the tests that
   hold it to the curve are unchanged; on the real hook with avatar@1's settings it is 48–54 % for 54 %.

## Consequences
- On the real hook (a free director pass, recorded in the fixture): presenter runs of 5.8, 7.9, 4.1 and 4.9 s; the spray picture
  0.11 s before « spray », the repaint 0.11 s before « repeint ».
- Rerunning project 6 would reuse its stored plan (same inputs and parameters): a new project with the same text makes the new
  plan. It remakes the presenter (≈ 35 credits on HeyGen) and the pictures whose directives changed: about run 6's 97 credits.
