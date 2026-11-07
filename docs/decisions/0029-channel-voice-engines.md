# 0029. The channel voice: one engine per narration, engine-named jobs, consent in the contract, trim before timing
Date: 2026-11-01. Status: accepted. Decided by: the production-5 session, within decisions 0003, 0021, 0025 and 0027
(Charlie asked the chantier to settle what the spec leaves open with sensible defaults). Spec:
`docs/specs/production-model.md` §2.3, §3; `docs/specs/pipeline-avatar.md` §2.3.

## Context
production-5 makes the voice brick real: the channel voice asset (`voice.make`: design, clone, import), four voice
engines (ElevenLabs Multilingual v2, MiniMax Speech 2.8 HD, Fish Audio S2, ai33.pro), `voice.speak` with whole-video
fallbacks, `voice.trim`, `voice.align`, and the blind listening test. Until now the Cloud chose ONE provider per usage
(config `providers.synthesize`), so an engine picked in a pipeline changed the quote, not the voice.

## Decision
1. **A voice job names its engine.** `synthesize`, `cloneVoice` and the new `designVoice` take an optional `engine`
   (`voice:…`). The Cloud serves it with the real adapter whose id IS the engine id, only with paidCalls on, the engine
   listed in `config.json` `realEngines` (empty by default) and its key in the vault; otherwise with the usage's fake.
   A job without an engine is served as before (`providers.synthesize`). An unknown engine is refused at the quote.
   Billing still prices the usage's grid line (`voice.chars`, `voice.clone`, `voice.design`): per-engine grid lines are
   production-11's.
2. **One engine per narration** (R3.4, R19.7). `voice.tts` takes its pin (`engine`, `fallbacks`) and the channel voice's
   id on each engine (`voices`, from the run style). The fallbacks are tried in order only while NO piece of the narration
   exists on the engine speaking it (a fresh chunk or one from the chunk cache); after that a failure stays a failure, with
   « Réessaie, ou change de voix pour toute la vidéo ». A fallback without a clone of the channel voice, or for a
   several-voices script, is skipped. The engine is part of the chunk cache key only when the pipeline names one.
3. **Consent is part of the contract** (0025). `cloneVoice` refuses an input without `consent: true`; the app refuses a
   clone without the tick and stores who, when and what with the voice. Cloning from the channel's own videos needs the
   statement « this channel is mine »; that voice is `proposed` until the owner accepts it. A designed voice is ours
   (statement `designed`). An imported provider voice id carries no consent (the person brings the id).
4. **The voice belongs to the channel** (migration 030: `channel_voices`, `channel_voice_clones`). One voice, one clone per
   engine, the source sample kept (`<userData>/voices/<id>/`). A new voice is cloned by default on avatar@1's engines
   (`voice:elevenlabs-v2`, `voice:minimax-28-hd`); a designed voice is cloned on another engine from one minute of text it
   speaks first (Charlie's flow: made on ElevenLabs, cloned on a cheaper engine). The channel's runs speak with its default
   active voice (style `voice` and `voices`).
5. **`voice.trim` sits inside `voice.tts`, before timing.** `maxPauseS` (0.6 from the technology; absent in a node = off,
   so old pipelines and fingerprints do not move) shortens each longer pause by cutting its middle on a 10 ms grid; provider
   word times move by exactly what was cut before them. It is not a separate node: the narration and its times are one
   artefact pair, and a separate node would time the words twice.
6. **Alignment**: provider times when given (ElevenLabs characters, MiniMax subtitles), else the local aligner. Fish and
   ai33 are read without timings (their timing routes are streaming or undocumented): the engine aligns, bar 90 %.
7. **The blind test** writes the same 30-second French text by the voice on each engine as A, B, C… in a seeded shuffle,
   a sheet and the key apart (`cle.json`). Demo clones speak in tones (`npm run voice:blind-test`).
8. **ai33.pro is now « OpenSpeaker »** (api.openspeaker.ai): its credits per character are not published, so its cost is
   read from each task's `credit_cost` at USD 5 per million credits; its engine line keeps a placeholder until Charlie reads
   the dashboard. Its own terms say an answer may come from its own model and outputs may train it: Charlie decides.

## Consequences
- The base pipeline avatar@1 now speaks on its pinned engine with its fallback for the whole video, and trims its pauses.
- A Cloud deploy needs no migration (the `voice.design` grid line is a late item). Older apps cloning through a new Cloud
  are refused until they send the consent tick (the app of this version does).
- Real calls stay off: every adapter is written from public docs and never called; `docs/PROVIDERS.md` §6 lists what to
  confirm on the first call (production-10).
