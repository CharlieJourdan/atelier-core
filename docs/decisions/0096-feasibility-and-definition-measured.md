# 0096 — P3 and P4 are measured: shares from shot screen time, every analysable field in the definition, look-alikes from words

Date: 2026-11-04 · Chantier: moteur-definition (B) · Spec: `docs/METHODE-REVERSE-PIPELINE.md` §2 P3–P4 · Contract: 0095

## Context
The contract (0095) wrote P4 from the synthesis constants only (about 20 fields) and P3 from the fakes' origin shares. A
clone at v1-level richness needs every field the whole-video analysis can measure (outline, hook window and cadence,
presenter windows, configurations and layout curve, motion types and their landing, shot curve, footage lengths, stills
vs footage, music changes, SFX, captions…), and a feasibility map that cannot be guessed.

## Decision
1. **P3 elements are measured from the shots**: every shot of every corpus video belongs to ONE element (presenter, 3D,
   filmed, found stills, gameplay, found footage, screen, generated, drawn, motion cards); its share is its pooled screen
   time. Each gets an engine brick that exists in `productionRegistry()` (else « impossible »), a human-input slot (a
   third party's filmed presenter or filmed footage; `userSupplies` from the brief), or « impossible » with the missing
   technology and an ESTIMATED cost said as such. Shares are cross-checked against the analyses' origin shares and the
   presenter's presence; the channel's measured universe (titles, tone, outline, palette, fonts) is saved and every
   alternative must use only its colours (`src/main/production/clone/definition/elements.ts`, `alternatives.ts`).
2. **P4 writes every measured field**: `definition/derive.ts` measures ~55–60 fields from the analyses (corpus median for
   numbers, a value at least 60 % of the corpus agrees on otherwise); the synthesis wins where it names the same field.
   The list is saved in the definition (`analysisMeasures`) so the check refuses a field turned back to `default` or
   changed outside an improvement round even where the orchestrator does not pass the analyses.
3. **Presenter and voice**: his own channel → his own presenter and voice clones, never a look-alike; another channel →
   a look-alike placeholder of the SAME TYPE (age, gender, hair, wardrobe, set, lighting, framing; identity taken field
   by field) with one picture per MEASURED angle, made from words only (no frame of the third party ever goes to an
   image model; descriptors pointing at a person or a picture are refused), marked placeholder on screen; a catalogue
   voice of the same kind in the brief's language, never a `clone_` voice. Filmed footage of a third party is stood in
   by FOUND footage of the same kind, never generated (Charlie's standing rule).
4. Fields added to the definition (additive, own defaults): `script.outline`, `script.illustratedShare`,
   `voice.language`, `presenter.talkSecondsPerMinute`, `presenter.windowMeanS`, `presenter.placeholder`,
   `motion.coverageByPart`, `editing.illustrationLeadS`, `sourcing.foundStillsShare`, `sourcing.kindShares`,
   `captions.syncOffsetS`, `analysisMeasures`.

## Consequences
- Proof on the five acceptance channels (fixtures built from the research docs' measures, `definition/fixtures/`):
  Finary « reproducible with human inputs » (filmed presenter 58 % → slot + look-alike with 3 angles, motion design in its
  palette), Marcel « reproducible » with his own presenter and voice and his full / half / inset curve, The Japanese
  Method → French with a look-alike of the same type and his 4 angles and a French voice, Le Monde en POV « reproducible »
  from bricks, Yarnhub « not reproducible » (3D 90 %) with three alternatives faithful to Yarnhub. Outputs in
  a folder outside the repo.
- Chantier C must map the new fields in `SETTING_MAP`; the assembler wires the real services (`definition/bricks.ts`,
  `definition/people.ts`: ports to ChannelPresenters `portrait` / `angles`, ChannelVoices / ChannelPresenters `styleFor`,
  the Cloud voice catalogue) and should pass the analyses to `checkP3` / `checkP4` (optional last argument).
