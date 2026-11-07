# 0077. « Créer une pipeline » has seven ways in, takes an inspiration per axis, reads a channel's numbers before its videos, and adapts its proposals to the case

Date: 2026-11-02. Status: accepted. Decided by: Charlie (02/11, through the coordinator: « envoyer une chaîne ou une vidéo à cloner,
qu'elle soit clonée de A à Z… des propositions avec leurs options et différences… pas 36 propositions, quelques-unes pertinentes,
moins quand c'est ma propre chaîne… si la chaîne mélange des formats, prendre celui qui fait le plus de vues… dire clairement quand les
vidéos ne sont pas ouf… le motion design de X, le montage de Y, le type de contenu de Z, les scripts de W ») + Claude
(parcours-utilisateur).

## Context
Record 0064 gave « Créer une pipeline » differentiators and a target language, behind one form (words, links, a language, an « own
channel » box). Run as a brand-new user on a fresh profile signed in to the test team (record 0066), the form had no way to say
« le montage de cette chaîne, le contenu de celle-là », no mix of two channels, no rework of an existing pipeline; the owner's own
channel got no proposal at all; a channel was always measured on its two most viewed long videos, even a Shorts channel; nothing
said whether the reference was worth copying; and when the beta's eyes refused their key (HTTP 403) or the beta answered a
demonstration channel (no YouTube key), the path either stopped (« Aucune vidéo n'a pu être mesurée : Gemini analysis: HTTP 403 »),
or showed the demonstration's numbers (« 12 345 abonnés ») as the channel's.

## Decision
1. **Seven ways in** (`StudyPath`): clone, import my channel (`own`), translate (a language is required), a little different (two
   `differ` proposals ticked from the start), mix two channels, create from scratch with inspirations, rework one of my pipelines.
   The Lab's dialog lists them and opens the style screen on the chosen form; the form shows only that path's fields.
2. **Inspirations per axis** (`engine/technologies/inspirations.ts`, pure): `content` picks the base and the pictures (the usual
   proposal from that reference); `editing` sets shot lengths, the curve, cut timing, layouts and captions when the reference burns
   them; `motion` sets the share of cards and the labels per minute (cards only on a base that draws them: otherwise the gap is
   said, never faked); `script` sets the voice's pace. Each change is applied on its own and kept only if the pipeline still checks.
   Each link is measured once whatever the axes it serves; a mix of two channels is the same with two links.
3. **A channel's numbers first** (`style-agent/insight.ts`): from `channelData` (latest videos, length, views, subscribers): the
   formats (short ≤ 3 min, long ≥ 8 min), a channel that mixes them (≥ 2 formats of ≥ 25 % each) is measured on its best-viewed
   format (the owner can pick another), and a verdict: median views under 1 000, or under 2 % of ≥ 10 000 subscribers, is `weak`
   and said plainly (« les vidéos de cette chaîne ne sont pas ouf… je te propose une pipeline meilleure »), kindly for the owner's
   own channel. A demonstration answer is never shown as the channel's numbers.
4. **Proposals adapt to the case** (`differentiators.ts`): each has an effect (`differ`, `improve`, `cheaper`) and a family (motion,
   pictures, rhythm, text, voice, economy, channel); a few, one per family first, five at most; the owner's own channel two at most,
   never a `differ` one (this replaces « none » of record 0064); a weak channel's improvements come first and are marked
   recommended. Logical per genre: no AI picture on a documentary or a story short, no presenter where none is; caption types
   (classic, highlight) and the voice's pace (ai33, the channel's own voice) are proposals. Every proposal shows its « avant /
   après »: the saved loops when they exist, else a sketch drawn from the pipeline itself (30 s of shots by source, shot length,
   voice pace, captions as they read).
5. **The agent asks**: its one model call also returns the question it asks the owner on how to differ, fitted to the case, and the
   ids of the code's proposals that match the owner's words (marked « Recommandé »; an unknown id never passes); internal ids
   (`documentary@1`) are replaced by their French names. Unread references make the code's pipeline provisional: the agent
   describes the base it chooses, never its mix, and never quotes demonstration numbers.
6. **Never a dead end**: eyes that cannot watch, or a channel the Cloud cannot read, leave a study made from the channel's numbers,
   the owner's words, or at least the channel's name (the content axis's first), with one plain note on what to do. Problems never
   name a provider, a key or an HTTP code. Accented handles (« @lemondedécrypté-p5l ») are channel links.
7. **How long**: the study says how long its analysis took, a 20-second sample and one video of the pipeline's length.
8. **Ingredients** (03/11, Charlie: « pour chaque ingrédient, importer les miens, l'agent les trouve, générer, cloner… sans me
   connaître »; `engine/technologies/ingredients.ts`): pictures, script, voice, presenter, branding, music, motion and editing, each
   offered as mine / found / generated / cloned / none, read from what the pipeline can do (its mix, declared options, bricks,
   inputs) — never a table per genre. An option is offered only if the pipeline applies AND compiles with it; one the references
   never show is marked and last, except the owner's own media (never « far »). Each option says what the owner brings and its effect
   on the price of a minute and the render time; the price comes first with the few choices that move it most. Choices
   (`style.choose`) reach every variant and the adopted pipeline's first message.
9. **Changing a pipeline by talking** (pipeline agent): a batch is tried exactly as it would be saved (an invented value such as
   `cardTheme: red` is refused at once and said plainly, never shown then refused on « Accepter »); the price under the agent's
   words is the code's; each brick lists its settable settings (the agent knew no voice speed). Checked live V1 → V2 → V3 → V4.
10. **Honest numbers on screen** (the coordinator's review, 03/11): a likeness estimated from settings is never above 80 (the
   Markets clone measured shot by shot is ≈ 74) and reads « 70–80 / 100, à vérifier sur un exemple »; a price lever says what it
   means and the price of a minute it gives (« Ta propre voix : la voix ne coûte plus rien → 0,00 € la minute »); a pipeline is
   named in French from its channel, else the owner's words, else its genre, then « Shorts » or « format long » (never the eyes'
   English description of a video).

## Consequences
- The study's state is JSON (migration 034): the new fields need no migration; older studies read as `clone`.
- Rework saves the picked proposals as a new version of the same pipeline (`recipes.edit`), never a copy.
- Not yet: real per-axis likeness (the score reads the content axis only), saved before/after loops for caption presets, voice
  pace and mix changes (the drawn sketch stands in), a voice-design screen, and the eyes' replay of a refused analysis (the same
  video stays refused on the beta: `cloud/intel.ts` keys an analysis without its day).
