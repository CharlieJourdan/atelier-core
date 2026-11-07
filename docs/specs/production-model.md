# Production model: bricks, engines, styles, pipelines

Status: spec, 2026-10-31, written by the « spec-avatar » chantier. Read with `docs/specs/pipeline-avatar.md` (the
first pipeline, step by step) (the reference channels are measured there).
Decisions it creates: records 0021 to 0026. It builds on 0010–0016 and changes them only where those records say.

Sources: Charlie's words of 2026-10-24 to 10-31 (his production prompt of 10-31 and his notes); the competitor benchmark (Headcast, measured on Charlie's own
videos); our own provider research; the engine as built (`docs/ENGINE-SPEC.md`). Clean room (decision 0001): nothing here comes
from the third-party engine's code, names, prompts or numbers; where a number is needed its source is given.

## 0. What Charlie wants, in eight lines
1. **As many bricks as possible**, each split into sub-parts, able to make **any** YouTube video (avatar first, then
   documentary, shorts, 3D / motion, reactions, face cam, tutorials).
2. **Three layers**: a brick (what it does) runs on an engine (provider + model, replaceable, with fallbacks) and wears
   a style (the « carrosserie »: prompts, rules, post-processing, versioned). One engine, many looks.
3. **Neither Headcast nor n8n.** Not one fixed pipeline with a few inputs; not blocks wired one by one. The agent
   analyses the channel and proposes a pipeline with options; the user switches options on or off and talks to the
   agent to change it.
4. **Every pipeline shows** a cost per minute (min / average / max), a fit % against a channel's own videos, a read-only
   graph from the idea to the final video, its approval gates and its inputs, pre-filled from the channel.
5. **Base pipelines** are skeletons not tied to a channel: avatar first, later documentary, 3D, 2D, voice-over channel.
6. **Quality is a choice per option** (engine and style per brick), never one global « max / min » switch; each choice
   shows what it changes in price and look.
7. **Simple for beginners**: a few settings and options, then « Générer » or « Laisser tourner ».
8. **Says who runs what and what it costs**, with or without the user's Claude Code connected.

## 1. Vocabulary (French label · code name)
| Word | Meaning |
|---|---|
| **Brique** · brick | A capability: « générer une image », « faire parler le présentateur », « couper les blancs ». Has inputs and outputs (§5), a cost model, and one or more engines. A brick may be a group of **sub-bricks** (§2). In code a brick is a **technology** (decision 0010): a manifest in code over engine nodes. |
| **Moteur** · engine | A provider + model + technical settings that does a brick's work: `clip:veo31-lite-relaxed`, `voice:elevenlabs-v2`. Lives in the Cloud (adapter, usage, price line). Has a cost unit, a placement, a health state and a fallback order (§3). |
| **Style** · style | What makes an engine's output look right for a video type: prompt rules, prompt suffixes, references, people and brand policies, negative rules, post-processing, shot grammar. Versioned data (`phone-real@3`), independent of the engine (§4). The « carrosserie ». |
| **Pipeline** · recipe | Ordered bricks for one video type, with a mix, options, inputs, gates, a format and a cap (§6). Code keeps the name `recipe` (`atelier.recette/…`); the UI says « pipeline » (decision 0022). |
| **Pipeline de base** · base pipeline | A skeleton shipped with the app, tied to no channel (avatar first). Used as it is or copied (§6.6). |
| **Option** · option | A named switch or choice on a pipeline (« Montage : simple / avancé », « Chapitres à l'écran »), each with its effect on bricks, mix, cost and look (§6.3). |
| **Mix** · mix | The share of screen time per kind of picture (presenter, AI clip, AI image, stock, archive, motion…) and how it moves along the video (§6.2). |
| **Porte** · gate | A point where a run stops for approval: idea, script, voice, plan, visuals, presenter, final video, thumbnail (§6.5). |
| **Entrée** · input | What a run needs: from the project (idea, brief, language, support videos, a script or a voice to import) or from the channel (presenter, voice, style profile, sponsor, words per minute) (§6.4). |
| **Projet** · project | ONE video: a pinned pipeline version + its inputs + per-video adjustments (decision 0011, unchanged). |
| **Actifs de chaîne** · channel assets | Things a channel owns and pipelines read: presenter(s), voice(s), style profile, sponsor product, reference channels, idea stock (decision 0025). |
| **Plan de montage** · timeline | The per-shot plan the director produces, editable shot by shot (§7). |

## 2. The brick catalogue
Bricks are grouped by the seven stages of decision 0011 (Idée, Script, Voix, Réalisateur, Éléments, Montage, Contrôle
et paquet). « Exists » = a technology or node already on `proto`; « new » = a later chantier writes it. Every brick
works without an avatar (0010). The ids are brick names; the code adds `@version`.

### 2.1 Idée
| Brick | Sub-bricks | Does | State |
|---|---|---|---|
| `idea.brief` | — | Takes a title + a short brief + a language (the project's idea) and passes them on. | new (thin) |
| `idea.support` | `subject`, `structure` | Reads « support videos » (transcript, outline, hook) and tags each as a source for the **subject** or the **structure**. | new |
| `idea.research` | — | Researches the topic (existing `research.topic`). | exists |
| `idea.stock` | — | The channel's idea stock (agents fill it later, track Agents). Not built now. | later |

### 2.2 Script
| Brick | Sub-bricks | Does | State |
|---|---|---|---|
| `script.write` | `outline`, `draft`, `fit`, `polish` | Writes the script from the idea, the support videos, the channel's own best scripts and competitors' structures, timed to the channel's words per minute. | exists (to extend) |
| `script.import` | — | Takes the user's script as is (existing `script.pasted`). | exists |
| `script.translate` | — | Translates a script (a reference channel in English → French). | exists |
| `script.factcheck` | — | Checks claims, returns exact replacements, applied only where the quoted text is unique. | new |
| `script.sponsor` | — | Writes the sponsor's mention into the script where the channel's placement rule says (§2.6 of the avatar pipeline). | new |

### 2.3 Voix
| Brick | Sub-bricks | Does | State |
|---|---|---|---|
| `voice.make` | `design`, `clone`, `import` | Creates the channel's voice: designs one from a description, clones a sample, or imports a provider voice id. Belongs to the channel (0025). | new |
| `voice.speak` | — | Text to speech with the channel's voice (existing `voice.tts`). | exists |
| `voice.own` | — | The user's own recording (existing `voice.own`). | exists |
| `voice.trim` | — | Shortens silences so the narration flows, before any timing is taken. | exists in part (pace tightening, ENGINE-SPEC R19.5) |
| `voice.align` | — | Word timings `{w, start, end, sentence}` from the provider, else forced alignment (ENGINE-SPEC §19.3). | exists |

### 2.4 Réalisateur
| Brick | Sub-bricks | Does | State |
|---|---|---|---|
| `director.plan` | `scenes`, `anchor`, `fill`, `budget`, `check` | The LLM « film director »: for each sentence, what to show; code times everything from the words (§7). | exists (to extend: mix, presenter placement, timeline) |
| `director.presenter` | — | Places the presenter on the timeline from the mix (short shots or longer stretches, layouts). | exists in part (`director-avatar`) |
| `director.textcheck` | — | Checks every on-screen text against the script. | exists (ENGINE-SPEC §21.9) |

### 2.5 Éléments
| Brick | Sub-bricks | Does | State |
|---|---|---|---|
| `presenter.make` | `portrait`, `clone`, `angles`, `register` | Creates the presenter: generates a portrait from a description, or takes it from the channel's own videos, makes extra camera angles (multi-shot), registers it with the engine when the engine needs it. Belongs to the channel (0025). | new |
| `presenter.talk` | `batch`, `cut` | Makes the presenter speak the voice: one generation over all presenter stretches of a video, then cut on word times (avatar pipeline §5). | exists in part (`avatar.speak`) |
| `image.make` | `generate`, `edit` | Generates a still from the director's prompt and the style; `edit` keeps a reference (the presenter's face or room). | exists in part (inside `visuals.fulfil`) |
| `image.find` | `stock`, `archive`, `web` | Finds a still in a licensed source (stock, public archives). | exists in part (stock) |
| `clip.make` | `from-image`, `from-text` | Generates a short video from a still (usually one `image.make` result) or from text. | exists in part |
| `clip.find` | `stock`, `archive`, `youtube` | Finds footage. `youtube` reads only (finding moments); **re-using** other channels' footage needs its own decision (0014 watch-out). | stock exists; others new |
| `clip.user` | — | The user's own footage (existing `footage.input`). | exists |
| `motion.make` | `template`, `agent` | Motion graphics: from coded templates (existing `motion.render`), or written by an agent for this video (needs the team computer with Claude Code, §9). | template exists; agent exists as custom bricks |
| `music.pick` | `library`, `generate` | Background music, mixed under the voice. | exists (library) |

### 2.6 Montage
| Brick | Sub-bricks | Does | State |
|---|---|---|---|
| `edit.assemble` | `simple`, `advanced` | **Simple**: code places the shots on the voice, cuts, slow moves on stills (Headcast-like). **Advanced**: an agent adds an overlay layer (callouts, highlights, kinetic text, picture-in-picture builds) on the team computer (§9). | simple built in `render.assemble` (production-9, record 0036); advanced: backlog |
| `edit.layout` | `full`, `split`, `pip` | How the presenter sits on screen (full screen, half screen beside a picture, small inset). | built (`render.assemble`, production-9) |
| `edit.captions` | — | Word-timed captions, burnt in or as SRT/VTT. | exists |
| `edit.chapters` | — | Chapter marks on screen (Charlie, 10-31: « les chapitres en haut à droite qui pop »), built on the chapter-card template of ENGINE-SPEC §25; position and look are style settings. | built (`edit.chapters@1`, a drawn mark: record 0036) |
| `edit.sponsor` | `slot`, `qr` | The sponsor's clip or card on the exact sentences that mention it, with an optional QR code. | built (`edit.sponsor@1`, record 0036) |
| `render.master` | — | Final mix and encode (existing `render.assemble` final pass, ENGINE-SPEC §28). | exists |

### 2.7 Contrôle et paquet
| Brick | Does | State |
|---|---|---|
| `qc.check` | Checks the video (frozen frames, black frames, sync, lengths). | exists |
| `thumbnail.make` | Thumbnails in the channel's style. | exists |
| `package.youtube` | Title, description, chapters, tags (never uploads: CLAUDE.md). | exists |

### 2.8 For other video types (catalogue only; built in their own chantiers)
`clip.find.youtube` (reaction source), `face.cam` (a YouTuber's own camera, = `clip.user` + layouts), `gameplay`
(existing `background.clips`), `render.3d` (later; the team computer would run it), `reframe.short` (16:9 → 9:16),
`voice.dialogue` (several voices, exists). A new video type is a new base pipeline made of these bricks plus the
missing ones, never a fork of the avatar pipeline.

## 3. Engines
R3.1 **An engine is a Cloud thing.** One engine = one Cloud adapter + one usage + its price line(s) + a fake (decision
0003, 0010). Its id is `<brick-family>:<provider>-<model>[-variant]` (`presenter:heygen-avatar4`,
`clip:veo31-lite-relaxed`, `image:gpt-image-25-low`). The app and agents see engines through the registry the Cloud
publishes: id, label, brick family, unit (per second, per clip, per image, per 1 000 characters, per token), unit
price in credits, placement (API / rented GPU / team computer / local), limits (max seconds per call, aspect ratios,
languages), what it needs (a registration step, a reference image), health (`ok`, `slow`, `down`) and status
(`draft`, `validated`).
R3.2 **Engines never collide.** Two engines of one family share the brick's input/output contract (§5) and differ only
in their adapter. A brick never contains provider code; an adapter never contains style text. Adding MiniMax H3 on a
rented GPU beside Veo through a reseller is two adapters of `clip`, nothing else changes.
R3.3 **A pipeline picks an engine per brick** (or an option picks it, §6.3), plus an ordered **fallback list** of
compatible engines. The run tries them in order on transient failure or `down` health; the quote always prices the
chosen engine and shows the worst fallback as the max (§8).
R3.4 **Consistency classes.** Some engines must not change in the middle of a video: the voice (ENGINE-SPEC R19.7: a
fallback voice only for the whole narration and only if the user picked it), the presenter (a face registered on one
engine looks different on another). Their fallback applies to the **whole video** before it starts, never mid-run;
stills and clips may fall back per item.
R3.5 **Placement** is part of the engine: a hosted API (most), a GPU job on a rented GPU (open models, `submitGpuJob`),
the team computer (agent work, Chromium, ffmpeg in the beta), or local deterministic code (alignment, assembly). The
pipeline never depends on where an engine runs (0012).
R3.6 **Adding an engine** = a Cloud chantier: adapter written from the provider's public docs, fake, price line, the
list of what to confirm on the first real call (`docs/PROVIDERS.md` §6), and its compatibility with the brick's
styles (an engine may declare a style field it cannot honour, e.g. no reference image).

## 4. Styles (the « carrosserie »)
R4.1 **A style is versioned data**, not code (decision 0021). It is attached to a brick family (image, clip,
presenter, director, script, edit), never to an engine: the same `phone-real@3` drives GPT Image or Seedream; the
adapter translates what its model understands. A project pins the style versions it ran with (R5.7).
R4.2 **Fields** (all optional except `id`, `family`, `version`):
| Field | What it holds |
|---|---|
| `rules` | How the director or the writer must think for this look (plain text, in English; shown in the editor). |
| `promptSuffix` | Text appended to every generation prompt (look, lens, light, era, « no readable text »). |
| `negative` | What must never appear (extra fingers, written text, logos when brands are off, objects changing look between shots). |
| `references` | Reference images: the presenter's portrait, the room, a palette image; and when each is attached. |
| `people` | Who may appear in the pictures: `anyone`, `not-presenter` (other people, never the presenter), `presenter-as-actor` (the presenter does the action shown: Charlie's « le personnage qui fait la peinture soit notre personnage »), `nobody` (objects only, not even hands). |
| `brands` | `real` (products as in real life) or `none` (plain packaging, no logo). |
| `shotGrammar` | The kinds of pictures this look uses and how they alternate, taken from the reference frames (for the avatar look: hands doing the task, the room, the product, the problem itself; research §3), with shot sizes varied across neighbours (ENGINE-SPEC §23). |
| `postProcess` | Optional per-channel grade or film texture (ENGINE-SPEC §28.1 grade, §28.2 texture), chosen while tuning against the channel's frames. |
| `examples` | Validated prompt → result pairs (few-shot), added as the style is tuned. |
| `instructions` | The channel's own strict rules (era, place, what to show or avoid), when the style is a channel's copy. |
R4.3 **Who writes styles.** The founder ships base styles; the agent derives a channel copy from the channel's style
profile (the « eyes ») and tunes it (§10.3). Styles export and import like pipelines (one JSON file). They are content,
like the motion custom bricks of ENGINE-SPEC §25.2: they never contain code.
R4.4 **Base styles** shipped with the avatar pipeline (names are ours): `phone-real` (the phone-camera look seen on
Charlie's Headcast videos, research §3: natural light, ordinary rooms, the presenter's room), `clean-stock` (neutral stock-like stills for stock-heavy channels),
`archive-real` (period photos and footage look), `presenter-studio` (the presenter's portrait and angles). Later:
`doc-cinematic`, `illustrated-2d`, `paper-cards` (graphics), `3d-clay`.
R4.5 **Tuning a style without fine-tuning**: gather references (the channel's and competitors' frames), write rules
and suffixes, generate a small test batch per engine, score it (human or the eyes), keep the best pairs as `examples`,
bump the version.

## 5. Brick contract (inputs, outputs, formats)
Every brick declares, in its manifest (0010, ENGINE-SPEC §42): inputs and outputs as slots, settings (zod, defaults),
the engine family it uses and the style family it reads, its cost model (§8), its cache key (provider model id + inputs'
fingerprints + settings + style version: never pay twice for the same step), and its failure behaviour. Shared formats:
| Format | Shape | Made by |
|---|---|---|
| `json.words` | `[{ w, start, end, sentence, paragraph }]`, seconds, the script's spelling (ENGINE-SPEC §19) | `voice.align` |
| `json.beats` | timed beats covering the whole voice, with sentence indexes, tags, key terms (ENGINE-SPEC §20) | beat split |
| `json.directives` | what the LLM director returns: `[{ sentence, anchor, kind, subject, prompt or query, layout?, text?, why }]`, **never a time** (§7.2) | `director.plan` scene pass |
| `json.editplan` + `json.genlist` | the timed plan in frames and what must be generated or found, priced (ENGINE-SPEC §21.6) | `director.plan` |
| `atelier.timeline/1` | the user-facing, editable view of the plan (§7.3) | `director.plan`, then the editor |
| `media.*` | images, clips, presenter clips, music, the final video | element and edit bricks |

## 6. Pipelines
### 6.1 The document
A pipeline (code: `atelier.recette/2`, decision 0022) adds to `atelier.recette/1`:
```jsonc
{
  "$schema": "atelier.recette/2",
  "name": "Avatar — mix",                       // what the user sees
  "base": "avatar@1",                           // the base pipeline it was made from (null: built by hand)
  "videoType": "avatar-long",
  "format": { "aspect": "16:9", "minutes": 12 },
  "language": null,                             // null: the project's or the channel's
  "mix": { "presenter": 0.26, "clipAi": 0.21, "imageAi": 0.53, "curve": "hook-heavy" },   // §6.2
  "options": { "editing": "simple", "chapters": false, "captions": false, "presenterInBroll": "not-presenter",
               "presenterShots": "single", "sponsor": "auto", "factcheck": false, "quality.images": "eco" },  // §6.3
  "inputs": { "presenter": "channel", "voice": "channel", "style": "channel", "sponsor": "channel" },        // §6.4
  "checkpoints": null,                          // §6.5
  "capCredits": 1500,
  "bricks": [ { "tech": "script.write@2", "settings": {}, "engine": null, "fallbacks": [], "style": null } ]
}
```
A brick entry gains `engine` (null: the option or the brick's default decides), `fallbacks` and `style`
(`phone-real@3`, null: the channel's or the base's). Version 1 documents load as version 2 with defaults
(`mix` from the bricks' settings, no options).

### 6.2 The mix
R6.1 `mix` gives the target share of **screen time** per picture kind: `presenter`, `clipAi`, `imageAi`, `stock`,
`archive`, `userFootage`, `motion`. Shares add to 1 (the editor rescales the others when one moves).
R6.2 `curve` says how the shares move along the video: `flat`; `hook-heavy` (the opening is presenter and moving
pictures only, stills grow towards the end: what Headcast's measured videos do, avatar pipeline §4); or explicit
points `[{ fromS, shares }]`. When the user changes a share, the curve is **rescaled**, keeping its shape.
R6.3 Shot lengths per kind (`shotLengthS`) sit beside the mix; defaults come from the base pipeline and the channel's
measured profile. The director uses mix + curve + lengths as targets, the budget pass as limits (ENGINE-SPEC §21.2).

### 6.3 Options
R6.4 An option is declared by the base pipeline (and later by any pipeline) as
`{ id, label, kind: 'switch' | 'choice', choices[], default, effects }`, where `effects` is a list of **edit operations**
(§10.2) applied when the option takes that value: switch a brick on or off, set a setting, change the mix, pick an
engine or a style. The editor and the agent show each option with what it changes: **Δ cost per minute** (from §8),
the look (one example frame or clip per choice, from the base pipeline's examples), and the time it adds.
R6.5 Options are the **only** place quality is chosen (Charlie: « plusieurs options en termes de qualité ») and they
are per subject (images, clips, presenter, editing), never one global switch (0011 stands).
R6.6 Options of the avatar base pipeline (defaults in `pipeline-avatar.md` §3): editing simple / advanced; chapters
on screen; captions; music; presenter single shot / multi-shot (angles); presenter in B-roll (who appears);
brands real / none; sponsor slot and QR; fact-check; script by the agent / imported; quality per element (eco /
standard / premium = an engine choice each); clip share slider (0 to 50 %).
R6.7 **Alternatives / switches between variants** (Charlie: « avec un système de switch, soit random ou pas »: some
videos with stock, others without) are **later** (backlog). The document keeps room for them: a future
`variants: [{ name, weight, options }]` field.

### 6.4 Inputs
R6.8 Each input has a **source**: `project` (asked per video), `channel` (read from the channel's assets, decision
0025), or `fixed` (set in the pipeline). The pipeline lists what it needs; the editor pre-fills every `channel` input
when the pipeline is assigned to a channel (Charlie: « les inputs dont on aura besoin seront déjà pré-sélectionnés »).
R6.9 A project **without a channel** (a one-off test video) asks for the channel inputs itself: import a presenter
(portrait or short video, with the consent step of 0025), pick or clone a voice, pick a style.
R6.10 Project inputs for an avatar video: title (the idea), a short brief, language, optional support videos tagged
« sujet » or « structure », optional imported script, optional imported voice-over. The channel brings: presenter(s),
voice, style profile (words per minute, mix, shot lengths, look), sponsor product, reference channels, custom
instructions.

### 6.5 Gates
R6.11 Gates stay the checkpoints of 0011 / 0016 (`topic`, `script`, `voice`, `director`, `visuals`, `avatar`, `final`,
`thumbnail`), set per channel, overridable per pipeline. Default: topic + thumbnail. The pipeline editor shows them as
switches on the graph (§11).
R6.12 Script choice at pipeline creation and onboarding (Charlie): « l'agent écrit » (gate on or off) or « j'importe
mes scripts » (the `script.import` brick, no gate needed).
R6.13 The agent passes only the gates the channel leaves to it (0011). Every gate card shows what has been spent and
the quote for what follows (ENGINE-SPEC R11.5).

### 6.6 Base pipelines
R6.14 A base pipeline is a pipeline document shipped with the app with `base: null`, tied to no channel, plus its
options, its examples per option choice and its default styles. Avatar ships first (`avatar@1`, see
`pipeline-avatar.md`), then (each its own spec section and chantier): documentary (no presenter, archives + AI images
+ motion), voice-over channel (stock + AI images, no presenter), 2D illustrated, 3D / motion, shorts, reaction, face cam,
tutorial. A base ships only when it runs end to end (0011). The voice-over base `voiceover@1` (no presenter: `avatar@1`'s bricks
without the presenter's, its options without the presenter's, a flat 20 % clips / 80 % stills mix) ships with production-15
(§10.3); `npm run engine:style-demo` runs it end to end on fakes.
R6.15 Assigning: a pipeline serves one or more channels; a channel picks one pipeline per video type (0011). The
pipeline view lists its channels.

## 7. The director and the timeline (our data model)
### 7.1 Principle
« Illustrer ce qui est dit au moment où c'est dit. » The LLM decides **what** to show and **on which words**; code
decides **when**, from the real word timings. The LLM never writes a time.

### 7.2 What the LLM returns (`json.directives`)
For each sentence (numbered, given with its text and the running presenter/clip/image budget of its stretch):
`{ sentence: n, anchor: "1 to 6 words copied from the sentence", kind, subject, prompt | query, layout?, text?, why }`.
`kind` is one of the picture kinds of the mix (`presenter`, `clipAi`, `imageAi`, `stock`, `archive`, `userFootage`,
`motion.<template>`, `label`, `sponsor`). Code then: finds the anchor in `json.words` (fuzzy, numbers in digits or
words), drops what it cannot find, times each shot from its anchor, fills gaps by the mix and the curve, enforces the
caps and the budget, then checks on-screen texts (ENGINE-SPEC §21.2–21.9, which already work this way).

### 7.3 The timeline (`atelier.timeline/1`)
The editable view the user and the agent see after the director, derived from `editplan` + `genlist`:
```jsonc
{ "$schema": "atelier.timeline/1", "fps": 30, "durationS": 742.4,
  "shots": [
    { "id": "s1", "kind": "presenter", "layout": "full", "sentence": 1, "anchor": "la vieille astuce",
      "startS": 0.00, "endS": 4.12, "source": { "item": "g1" }, "status": "ready" },
    { "id": "s2", "kind": "clipAi", "sentence": 2, "anchor": "un gant de four", "startS": 4.12, "endS": 7.80,
      "prompt": "…", "style": "phone-real@3", "people": "presenter-as-actor", "source": { "item": "g2" },
      "status": "ready", "costCredits": 7 } ],
  "overlays": [ { "id": "o1", "kind": "sponsor", "startS": 81.2, "endS": 96.0, "anchor": "le lien est en dessous" } ],
  "chapters": [ { "n": 1, "title": "…", "startS": 32.5 } ] }
```
R7.1 Times are seconds rounded to the frame grid (the engine keeps frames internally).
R7.2 Per shot the user or the agent may: rewrite the prompt and regenerate, animate a still into a clip, replace the
source with an uploaded file, change the layout, delete it (its neighbours stretch). Each action is priced before it
runs and settles against the project's quote (0015: quote + 10 %).
R7.3 Regeneration limits per project protect the wallet (default: the cap; the quote shows them).

## 8. Cost model: cost per minute, min / average / max
R8.1 **Formula** (per finished minute, `T` = 60 s, shares from the mix after the curve):
```
presenterGenS = T·presenter · (1 + handle)                 # handle: margin generated around each stretch (avatar §5)
clipShots     = T·clipAi / shotLen.clip ; clipGens = clipShots / shotsPerGeneration
imagesShown   = T·imageAi / shotLen.image
imagesGen     = imagesShown + clipGens·(clip engine needs a start image ? 1 : 0)
found         = stock, archive: usually 0 credits (licence cost when the source charges)
llmMin        = script + director + checks, per the team's LLM backend (§9): 0 on « mon abonnement »
voiceMin      = TTS price per minute of narration (characters per minute × unit)
renderMin     = render on shared machines (0012) ≈ 0
motionMin     = templates: 0 ; agent-made: §9
costMin = presenterGenS·P(presenter) + clipGens·P(clip) + imagesGen·P(image) + voiceMin + llmMin + motionMin + renderMin
```
R8.2 **Average** = the formula with the pipeline's engines, mix, lengths and the measured regeneration rate (default
5 % of generated items until measured). **Min** = the same with no regeneration and the curve's cheapest legal
reading. **Max** = the worst fallback engine of each brick + 15 % regeneration + the cap on clip share. The quote shows
all three per minute and per video, and per brick (« où va l'argent »).
R8.3 **Prices come from the Cloud grid** (0015: real cost × margin, never above the provider's public price). The
estimator never hard-codes a price; it reads the grid, so a price update moves every estimate.
R8.4 **What Atelier charges** is the grid price; **what it costs Atelier** is the real cost. Both appear in the founder
console; the user sees credits and € per minute.
R8.5 The estimator is pure code (no LLM, no network), so the agent can compare dozens of variants for free.

## 9. Who runs what, and what it costs (Claude Code connected or not)
Decision 0026. LLM work runs on the team's backend (0013): « mon abonnement Claude » (the user's Claude Code on the
team computer), « crédits Atelier » (Atelier's API key, billed per token) or « ma clé API ». Agent work (an agent that
writes code or HTML for this video) needs the team computer and Claude Code.
| Task | Model (0013) | Volume for a 10-min video (estimate) | On « mon abonnement » | On « crédits Atelier » (2026-10-30 API prices, re-check) |
|---|---|---|---|---|
| Script (outline, draft, fit, polish) | Sonnet 5.5 | ≈ 40 k tokens in, 12 k out | 0 € extra (uses quota) | ≈ 0,20 € |
| Fact-check (optional) | Sonnet 5.5 + web search | ≈ 120 k in, 4 k out + searches | 0 € | ≈ 0,30 € + search fees |
| Director (scenes + text check) | Sonnet 5.5 | ≈ 60 k in (cached rules), 20 k out | 0 € | ≈ 0,30 € |
| Metadata, thumbnail text, small passes | Haiku 5.5 | ≈ 20 k in, 4 k out | 0 € | < 0,01 € |
| Advanced editing (overlay layer) | Sonnet 5.5 agent on the team computer | ≈ 300–600 k in (half cached), 40–80 k out (an agent loop) | 0 € | ≈ 0,8–1,5 € |
| Motion design written for this video | Sonnet 5.5 agent | ≈ 400–900 k in (half cached), 60–120 k out | 0 € | ≈ 1,2–2,5 € |
Token volumes are our own estimates (prompt sizes × passes), to measure on the first real runs; prices: Sonnet 5.5
2 $ / 10 $ per million in / out, Haiku 5.5 0,10 $ / 0,50 $, cache read ×0,05 (decision 0013, platform.claude.com
pricing, 2026-10-30).
R9.1 **Rule:** script, director and checks run on any backend (cheap enough on credits). **Advanced editing and
agent-made motion are offered only when Claude Code is connected**, or on credits with the price shown and an explicit
choice (« ça coûte ≈ 1,50 € de plus par vidéo ; gratuit si tu connectes ton Claude Code »). The quote shows the saving
of connecting Claude Code on every pipeline.
R9.2 **Rendering**: decision 0012 / 0015 stand (§14 of `pipeline-avatar.md` gives the numbers again for Charlie's
question). No GPU for assembly; rented GPUs only for open avatar or video models; a small team computer per team for
the agents; renders on demand on shared machines billed by the second.

## 10. The agent proposes and edits pipelines
### 10.1 Proposing (« Faire préparer une pipeline par l'agent »)
1. **Understand the target**: an existing channel (its videos, best performers, the eyes' style profile), a channel to
   launch (reference channels Charlie or the user gives), or a concept only (a description and examples).
2. **Measure** the references with the eyes: presenter share and layouts, shot length, picture kinds, motion, captions,
   words per minute, length, sponsor placement, script structure (the dimensions of the reference-channel study).
3. **Pick a base pipeline** and set mix, options, engines and styles to match; compute cost (§8) and fit (§12).
4. **Propose two or three variants** with price and fit side by side (e.g. « fidèle », « économique », « premium »),
   one recommended. The user picks one, or talks to change it.
5. **Ask only what the references do not say** (an onboarding-style question per open dimension: « Tes vidéos
   montrent-elles le produit ? »).

### 10.2 Editing by talking (edit operations)
R10.1 The agent never rewrites a pipeline as free text. It applies **edit operations**, each validated against the
schema and the registry, and shown to the user as a diff with Δ cost and Δ fit:
`setMix`, `setCurve`, `setOption`, `setEngine`, `setFallbacks`, `setStyle`, `addBrick`, `removeBrick`, `moveBrick`,
`setSetting`, `setGate`, `setInput`, `setCap`, `rename`.
R10.2 A batch of operations becomes a new pipeline version once the owner accepts it (0011: versions are immutable).
Options (§6.3) are just named batches of the same operations.
R10.3 The same operations are the agent tools (MCP, `src/main/orchestra/technologies.ts`), so the UI, the chat and the
agents share one path.

### 10.3 Reproduce a style and compare (production-15, record 0042)
Charlie (01/11): « on envoie des chaînes YouTube et il essaie de répliquer le style, ensuite il montre des exemples, ça
coûte un peu de crédits, mais ensuite il y a un score de rapprochabilité… ensuite essaie de simplifier ». Built as
« Reproduire un style » (Production › Faire préparer une pipeline par l'agent › Reproduire un style):
1. **Links.** The owner pastes 1 to 5 public YouTube links (videos, or channels whose two most viewed long videos stand
   for them). The eyes watch the first 5 minutes of each (read-only: `channelData`, `analyseVideo`; never a write to
   YouTube). Their answer may carry **editing measures** (`AnalysisResult.measures`: presenter screen share over the video
   and the first 30 s, layouts, picture shares AI still / AI clip / stock / archive / motion, mean shot, look family
   photoreal / illustrated / stock / 3D / archive, captions none / sentences / words / keywords, labels per minute, words
   per minute, the first offer with its second, length and card); without them the heuristics of production-11 read the
   same video. Without Atelier Cloud the eyes' demonstration stands in, marked « démonstration ».
2. **The closest pipeline, from the bricks.** The base the references ask for (`avatar@1` when a presenter is seen,
   `voiceover@1` « sans présentateur » under a 3 % median presenter share), then the agent's usual variants (§10.1:
   fidèle, économique, premium), plus the references' curve (when they agree) and the presenter's layouts. Each variant
   shows its price per minute and its **free likeness estimate** (what the pipeline would make, scored against the
   references: config only, no render). One optional model call (route `pipeline_architect`) words the style and writes
   the sample's narration; every number is the code's.
3. **A sample, priced.** « Voir un exemple » quotes the sample first: the variant cut down (imported two-sentence
   narration on the references' subject, about 15–20 s; no support videos, sponsor, chapters, check, thumbnails or package;
   no owner gate; the whole video's average mix on a flat curve, since 18 s of a hook-heavy curve would show only the
   opening). The quote is the estimator's (a few credits) plus the run's own worst-case hold, given back unspent. Only the
   click on that very quote runs it, as a normal run (its quote, cap = the hold shown, cache, ledger); a changed pipeline,
   narration or channel needs a new quote. Team agents can quote, never run.
4. **Likeness score.** The sample's edit plan is measured exactly (presenter frames and layouts, picture kinds, shots,
   labels, the narration's words over the film's length; its curve, captions and look from the pipeline until the eyes
   read the sample's frames) and scored against the references on six dimensions: mix and curve 25, presenter 20, shot
   length 15, look 15, pace 15, text on screen 10 (ours, to tune). One score out of 100 and the three biggest gaps, each
   with the edit operations that close it best (the references' own profile, their layouts, curve and look, every option
   choice, and « make up for the render »: ask more presenter, longer shots or a faster voice by the gap measured), its Δ
   score (predicted: the sample's measures moved by what the edit changes in the predicted profile) and Δ cost per minute.
   « Corriger » applies it; the sample is then « à refaire » with the predicted score until « Refaire l'exemple ».
5. **Simple.** Links → 2–3 proposals (price per minute, estimate) → « Voir un exemple » → score and gaps → « Utiliser cette
   pipeline » (production-12's adoption). « Avancé » keeps bricks, engines and styles.
6. **Consent.** A style is reproduced, never a person: the presenter and the voice are the channel's own, or designed to a
   similar type and tone; cloning stays for the owner's channel with the consent tick (production-5, -7). Said on the screen.

The other bases a reference may ask for (designed, not built; each ships only when it runs end to end, 0011):
- **Documentary** (`documentaire@1`): no presenter; archive footage and stills with slow moves, AI stills for what no
  archive shows, motion maps and dates; needs an archive search brick (Wikimedia / public archives through `searchStock`
  with `kind: archive`), a « year / place » lower-third brick and the look family `archive` in the eyes and a style
  (`archive-film`: grain, grade); mix kinds `archive` and `motion` already exist.
- **3D / motion** (`motion@1`): no presenter; every shot a rendered or generated 3D scene or a motion-design card; needs a
  motion brick that makes shots from the brick library (production's HTML bricks) or a 3D-clip engine family, the look
  family `3d`, and the director filling `motion` shares (today it leaves them to the bricks).
- **2D illustrated** (`illustre@1`): no presenter or a drawn character; AI illustrations in one consistent drawn style with
  light animation; needs an image style family « illustration » with a character reference (the recurring-object rule of
  production-6), the look family `illustrated`, and a cut-out / puppet motion for the character.
The likeness score already compares these families; until a base exists, a reference of that look keeps its look gap open
with « no setting of the pipeline closes it ».

## 11. The graph view (read-only)
R11.1 A read-only graph from the inputs to the final video, n8n-like but drawn by the app, never wired by hand:
columns = the seven stages; nodes = bricks; edges = slots; parallel branches drawn side by side (presenter, images,
clips, music start after the director together).
R11.2 Each node shows: the brick's French label, its engine (and fallbacks on hover), its style, its cost per minute
(avg) and its share of the total, its gate (a lock icon), and its state during a run (waiting, running, done, failed,
cost spent).
R11.3 Options switched off grey their nodes; the branch a switch removes is drawn dashed.
R11.4 It is generated from the compiled pipeline (`atelier.pipeline/1` + the recipe document), so it can never disagree
with what runs. Clicking a node opens its settings in the editor; nothing is edited in the graph itself.

## 12. Fit %
R12.1 Fit compares a channel's **measured profile** (the eyes over its last and best videos) with the pipeline's
**predicted profile** (what the pipeline would make, from its mix, options and styles), dimension by dimension:
| Dimension | Measured as | Weight (default) |
|---|---|---|
| Presenter share and layouts | share of screen time, layouts used | 20 |
| Picture kinds | shares of AI clip / AI image / stock / archive / motion | 20 |
| Rhythm | median shot length, cuts per minute | 15 |
| Script | words per minute, length, structure (hook, chapters, CTA) | 15 |
| Look | style family match (eyes' description vs the style) | 10 |
| Text on screen | captions, labels, chapter marks | 10 |
| Sponsor | present, where, how long | 10 |
R12.2 Each dimension scores 0–1 (1 = within the channel's own spread across its videos); fit % = weighted mean. The
view lists the three biggest gaps with the option that would close each, and its cost.
R12.3 Fit is shown only when the channel has at least three measured videos; otherwise « pas assez de vidéos pour
mesurer ». Weights are ours, to tune with Charlie on real channels.

## 13. Simple for the user
R13.1 Four entry points, one screen each: « Je n'ai pas d'idée » (the agent proposes niches later, track Chaînes),
« J'ai une idée de chaîne » (concept → agent proposes), « J'ai déjà des pipelines » (pick one), « Je veux une chaîne
dans telle niche » (references → agent proposes).
R13.2 A beginner sees: the pipeline's name, its look (example frames), its price per minute, five to eight options
with plain words, the inputs to fill, and two buttons « Générer une vidéo » / « Laisser tourner la chaîne ». Engines,
styles and edit operations sit under « Avancé ».

## 14. How this reconciles with production-2
| production-2 (on `proto`) | Here | Record |
|---|---|---|
| Technology = coded brick (0010), 18 of them | **Kept** as the code form of a brick; bricks gain sub-bricks (a technology may expose several sub-bricks as settings, or one technology per sub-brick when they are used apart). | 0021 |
| Providers hidden behind Cloud usages (0010, 0014) | **Changed**: engines become visible and choosable per brick (still in the Cloud), with fallbacks and health. | 0021 |
| Settings per technology, channel, project | **Kept**; plus **styles** as versioned data per brick family. | 0021 |
| Recipe `atelier.recette/1` (bricks, format, cap, checkpoints) | **Changed** to `/2`: mix + curve, options, inputs with sources, engine / fallbacks / style per brick, `base`. UI word « pipeline ». | 0022 |
| Pre-built recipes (0011) | **Renamed** « pipelines de base »; ship with options and examples. | 0022 |
| No quality switch (0011) | **Kept** as « no global switch »; quality lives in per-subject options with Δ cost shown. | 0022 |
| Checkpoints (0011, 0016) | **Kept**. | — |
| Quote before each project, cap, +10 % (0015) | **Kept**; plus min / avg / max per minute and per brick, fit %, graph. | 0023 |
| Agent drafts recipes (0011) | **Changed**: through edit operations, with variants, and later reproduce-and-compare. | 0024 |
| Avatars list (fake `AVATARS`) | **Replaced** by channel assets: presenters, voices, sponsor, with consent. | 0025 |
| LLM routing (0013) | **Kept**; adds what each task costs on each backend and which tasks need Claude Code. | 0026 |
| Compute placement (0012, 0015) | **Kept** (re-checked against Charlie's question of 10-31). | 0026 |
| Slots, compiler, `@slot` wiring (0016) | **Kept**; the compiler applies options (edit operations) before compiling. | 0022 |
| Projects, one run per project (0016) | **Kept**. | — |

## 15. Out of scope here
The script database (backlog), pipeline alternatives / random switches (backlog), the other base pipelines (backlog,
one spec each), the idea stock and niche finding (track Agents / Chaînes), real provider choice (record « providers,
final », with Charlie's keys), economy screens (production-14).
