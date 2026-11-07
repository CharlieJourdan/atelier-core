# 0031. The director follows the mix and the curve: what the spec left open
Date: 2026-11-01. Status: accepted. Decided by: the production-6 session, within decisions 0016, 0022 and 0026 (Charlie
asked the chantier to settle open points with sensible defaults and record them).

## Context
production-6 makes `director.plan` follow the pipeline's mix and curve (`docs/specs/production-model.md` §6.2, §7;
`docs/specs/pipeline-avatar.md` §2.4, §4): presenter placed by code, an LLM scene pass that says what to show on which
words (`json.directives`, never a time), shots timed by code from the word times, and the editable `atelier.timeline/1`.
Code: `src/engine/nodes/director-mix.ts` (placement, fill), `director-scenes.ts` (scene pass, fake), `director-run-mix.ts`
(the node's mix mode), `src/engine/formats/directives.ts` (formats, anchor matching, timeline).

## Decision
1. **Two directors in one node.** `director.plan@1` gets a param `screen` (the mix, placement, layouts, people, brands).
   With it, the mix director runs; without it, the rhythm director of ENGINE-SPEC §21 runs exactly as before (fingerprints
   of old pipelines unchanged). The technology passes `screen` when the pipeline's mix names a presenter share, a curve
   other than `flat` or shot lengths; a version 1 pipeline's mix (pictures only, flat) keeps the rhythm director. The mix
   reaches the technology through the compile context (`CompileCtx.mix`), not as a setting (it is the pipeline's, not the
   brick's).
2. **Parts = the curve's rows.** The shares are targets per row of the curve fitted to the voice's length (`curveRows`);
   the proof is ±5 points per part. Kinds the director cannot fill yet (`userFootage`, `motion`) go to AI stills with a
   diagnostic; without a presenter brick the presenter's share goes to the pictures (`setShare`). `stock` = stock video,
   `archive` = a found still.
3. **Presenter placement.** The video opens on the presenter whenever there is one. `short`: a shot starts on a sentence's
   first word when its part's presenter time is behind by at least half a shot (2–6 s, `shotLengthS.presenter`, 4 s by
   default); the picture between two presenter shots lasts at least `minShotS` (1.5 s) or there is none. Then each shot's
   end moves by a word or two so the part lands on its share (a 30-second opening cannot reach it with whole shots).
   `stretches` uses the channel's measured `presenterStretchS`; without one, `short` with a diagnostic (the spec forbids a
   preset number). The avatar brick's `segments` (hook, outro) are ignored in this mode.
4. **Pictures.** Between presenter shots, each picture starts on a directive's anchor when one is near (cuts 3 frames
   before the word, never inside one), takes the directive's kind when that kind is within one second of the part's
   largest deficit, else the kind furthest behind (the code keeps the curve whatever the LLM chose; overrides are counted
   in the diagnostics). A part that is all presenter (no picture share) uses moving pictures in the opening, else the
   mix's largest picture kind. Shots without a directive of their own illustrate the latest directive of their sentence.
5. **Layouts.** `full` by default. `split` (presenter half screen beside a picture) and `pip` only when the scene pass asks
   for it on a presenter sentence, never in the first part, at most one presenter shot in three; default allowed layouts
   `full` + `split`. A `split` shot is a base avatar shot with a typed `beside: { genItem, side }`; it counts as presenter
   screen time; until production-9 composes it, the render shows the presenter full and `visuals.fulfil` still makes the
   picture. A `pip` shot's base is the picture (its screen time), the presenter an overlay.
6. **Directives (§7.2).** Sentences are numbered from 1. The LLM may add `ref` and a `recurring` list; the code writes the
   first description given for a name (stretch order) at the head of every prompt that shows it, then drops `ref`, so
   `json.directives` keeps exactly §7.2's shape. An anchor is found fuzzily in its sentence (accents, elisions, numbers in
   digits or words, one slip in four words or more); not found → dropped and counted. A directive's `text` becomes a label
   (the §21.9 text check still applies). Prompts in English (image models), stock queries in English.
7. **People and brands.** Settings `people` and `brands` of `director.plan`, set by the options « Qui apparaît » and
   « Marques » (now live, except « le présentateur joue l'action », production-8): the rule goes into the scene pass's
   system text and is appended to every picture prompt by code. A director style's `rules` reach the prompt through
   `screen.styleRules` once the app resolves brick styles into nodes (not wired yet).
8. **Scene pass model.** Role `director`, tier `balanced` (Sonnet 5.5 by default, 0013); stretches of the opening minute
   then ~150 s, two calls at a time, answers cached per stretch prompt; a stretch whose call fails twice gets the
   deterministic directives and the gate card says « réalisation simplifiée ».
9. **Timeline.** `json.timeline` is built from the plan and the list in seconds on the frame grid; kinds are the mix's;
   status `planned`; `costCredits` per shot (a split shot adds its picture); overlays = labels, motion, a pip presenter,
   and the sponsor mentions of `json.outline.sponsor` (from the first anchor to the end of the last anchor's sentence).
   The rhythm director emits the same timeline and an empty `json.directives`.
10. **Quote.** A node run by an LLM costs 0 on « mon abonnement » and on « ma clé API » (billed on the user's key), its
    tokens in credits on « crédits Atelier » (the estimator's token volumes, `llmTaskCreditsPerMinute`); the quote line
    carries the backend. The app has no « crédits Atelier » backend yet, so the director's line is 0 today.

## Consequences
- production-7 (presenter): one avatar item per presenter shot today (`voiceRange` = the shot); generating longer stretches
  and cutting them is its call. production-8: `clipShotsPerGeneration` (eco: 2 shots per clip) and « joue l'action ».
  production-9: compose `split` (`beside`), sponsor overlay, timeline editing actions (R7.2).
- Old pipelines and the template pipelines keep the rhythm director.
