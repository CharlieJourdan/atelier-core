# 0101. MiniMax only for the voices of Charlie's three avatar channels, enforced by the Cloud
Date: 2026-11-04. Status: accepted. Decided by: Charlie (chantier voix-minimax).

## Context
The standing rule is « voices: ai33 Pro only ». Charlie made ONE exception: the voices of his own three avatar channels
(@exemple-chauffage, @exemple-kundendienst, @exemple-compagnon) are cloned carefully on MiniMax and validated by ear before use.
A rule that lives only in a brief gets broken by the next chantier, so it is written into the engine.

## Decision
1. `src/shared/voice-exception.ts` holds the allow-list: per channel, the only clone NAME a MiniMax clone job may carry and
   the MiniMax voice ids a synthesis may name. `minimaxRefusal(usage, input)` is the single check.
2. The Cloud applies it when a REAL MiniMax adapter (`voice:minimax-28-hd`, or the usage's configured provider `minimax`) would
   serve a job: at the quote (`routes-user.ts`) and again at job creation (`jobs.ts`). Anything else (another clone, any voice
   design, a synthesis with another voice id) is refused with code `forbidden` and a French message; nothing is called, nothing
   is held. A job served by the fake (demo) is not blocked: it calls no provider.
3. Adding a channel or a clone id is Charlie's decision, recorded here (never a chantier's own choice). Redoing a clone for a
   listed channel means a new voice id added to its `voiceIds` after Charlie validated it by ear.
4. Cloned ids: Marcel `clone-0000000000000001`, Klaus `clone-0000000000000002` (example ids). Gaston is not cloned yet: MiniMax answered
   « insufficient voice slot » (code 2052); a slot must be freed on the MiniMax account first (Charlie's call).

## Consequences
- Every other MiniMax use is refused in production: the earlier test clone (Charlie's reference voice),
  and the MiniMax fallbacks / « Haute qualité » option of `avatar@1` and the other bases, now fail on a real Cloud (their ai33
  voice is unaffected). If Charlie wants MiniMax elsewhere, he adds it to the list here.
- The avatar-base chantier plugs the two (soon three) clone ids in as a setting; it must name those ids exactly.
- Test: `cloud/tests/cloud-voice-minimax-exception.test.ts`. `brain-run call` accepts `@file` for its JSON arguments (an audio
  sample does not fit a command line).
- Measured closeness (speaker embedding on a held-out sentence, real voice vs clone; ceiling = the real voice against another
  sentence of itself): Marcel MiniMax 0.83 / ai33 0.75 / ceiling 0.86; Klaus 0.85 / 0.77 / 0.91. Charlie decides by ear:
  a folder outside the repo.
