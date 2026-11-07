# 0064. A cloned channel is made the owner's own by picked differentiators, and a pipeline is translated, not rebuilt

Date: 2026-11-02. Status: accepted. Decided by: Charlie (02/11, through the coordinator: « je veux simuler une traduction de
chaîne… le montage reste similaire, mais en éléments différenciants, sur le motion design on peut essayer un autre style mais
toujours le même principe… des propositions, mais logiques ») + Claude (clonage-traduction).

## Context
« Créer une pipeline » (record 0052) builds the pipeline closest to the reference videos. Copying a channel as it is makes a
lookalike; Charlie wants a translated channel that keeps the editing but is visibly his. Some changes are absurd for a genre
(AI clips on an archive documentary), and an owner cloning his own channel wants nothing changed.

## Decision
1. **Differentiators** (`engine/technologies/differentiators.ts`): after the proposals, the agent offers 3 to 5 changes drawn
   from the pipeline's genre only — a documentary: the « parchemin » card style, 100 % archives, more cards, faster cuts; an
   avatar or voice-over pipeline: fewer clips, more clips only when the references show clips, presenter angles, captions,
   music. Each is checked (applies, compiles), priced per minute before → after, timed, scored for likeness before → after, and
   shows its « avant / après » when one ships. Nothing is applied until the owner ticks it; ticked ones apply to every variant.
   Two or more reference channels add « Plus proche de … » per channel. The owner's own channel (`own`) gets none unless asked.
   Demonstration references never name a pipeline or a « Plus proche de » proposal.
2. **Card style is an option, not a new base**: `documentary@1` option `cardStyle` (dark | parchment) sets `director.plan`
   `cardTheme`; the parchment drawings (`motion/doc-parchment.ts`, `map-parchment.ts`) keep the same cards, places and timing,
   and the dark style stays byte-identical. It is a main option with its « avant / après ».
3. **Translating** is a copy of the pipeline in another language (`recipes.translate`, « Traduire » on the pipeline page, or the
   target language in « Créer une pipeline »): same bricks and settings, `doc.language` changed, named « … (FR) ». The run passes
   the language to the script, the voice, the director (cards labelled in the video's language and its units) and
   `motion.render`, which translates the archive captions in one LLM call. The voice is designed in that language; never a clone
   of the source channel's narrator.
4. `motion.render@1` takes `parallel` (1–4, recipe-overridable); `documentary@1` draws 4 cards at once (a 12-minute video has
   ≈ 120).

## Consequences
- A differentiator is data (edit ops), so the pipeline agent and the owner see the same change, its price and its likeness.
- Adding a genre means adding its candidates; the « logical » rule lives in one function, tested.
- Not yet: a voice-design screen (the translated pipeline uses the channel's voice settings), a « mix » proposal blending two
  channels' measures beyond « Plus proche de », and localised units checked on a real run.
