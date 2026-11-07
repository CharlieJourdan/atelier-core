# 0092 — A default real voice per language, and quotes that count what a retest reuses

## Context
The first real run of a brand-new user stopped three ways (issues #114, #115, #95): a refused still or a clip planned without a clip
engine failed the whole visuals node; a retest was quoted again for work its cache would reuse (so `brain-run --max-usd` refused or
had to be set high); a new channel had only demonstration voices, and ai33 answered 400 to `demo-claire`.

## Decision
- **Per shot, never per run.** `visuals.fulfil` degrades one shot whose clip or image every engine refused: a stock photo on its subject,
  else the neighbour's picture (`degraded: « clip refusé → plan voisin »`, the render's « borrowed » check and the review see it). A
  pipeline with no `clip.make` brick tells its director (`screen.clips = false`, set by the compiler) so it plans no generated clip.
- **Quotes reuse the cache.** A node may declare `reuse: { kind, key }` (fingerprints of the inputs its item cache depends on). When it
  has run for real it writes how many paid units its cache holds for that key (`workspace.cache('reuse')`); the quote subtracts them.
  Today: `avatar.speak` (presenter seconds, key = voice fingerprint + avatar + engine). The voice is already quoted 0 when its node is
  cached; analysis is not part of a pipeline quote. Under-quoting is safe: `brain-run` still cancels past `--max-usd`.
- **A default real voice per language**, from the ai33 Pro catalogue (standing order of 2026-11-02: ai33 Pro only, no voice-quality
  work). `src/shared/default-voices.ts`: French → George (warm storyteller, a gentler register than a deep voice for French and the
  Romance languages), English → Brian (deep, steady, neutral narrator); es/it/pt → George, de → Brian; any other language → English.
  The Cloud catalogue lists them (`default: true`, `demo: false`); a `demo-*` voice sent to a real provider is swapped for the default
  of its language (`cloud/src/voices.ts`); the creation agent imports it on a channel with no voice (`placeholder-voice.ts`) and says so.

## Consequences
- The two ids are ElevenLabs' published premade ids (ai33 resells that model). **Not confirmed against a live ai33 catalogue** (no key
  here, no paid call): Charlie confirms with one small `npm run cloud -- providers try synthesize --voice <id> --engine voice:ai33`.
- Clip quotes and image quotes are not yet reused item by item (their keys depend on the pictures upstream).
