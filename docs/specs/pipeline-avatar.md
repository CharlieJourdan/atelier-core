# Base pipeline « Avatar » (`avatar@1`): step by step

Status: spec, 2026-10-31, « spec-avatar » chantier. The model (bricks, engines, styles, options, cost, fit, graph) is
`docs/specs/production-model.md`.
Every price here is a **public price read on 2026-10-30 / 10-31, to recheck before coding** (sources in §9); the
estimator reads prices from the Cloud grid, never from this file.

## 0. What it makes, and the benchmark
An AI presenter (a photo made to speak) explains something useful to an older audience (how to fix, cook, save money,
avoid a mistake), with pictures that illustrate each sentence: AI stills, short AI clips, sometimes stock or archive
footage, and often a product (the channel's sponsor). Length 8–20 minutes, 16:9 first (9:16 later through the same
bricks).

**Competitor benchmark: Headcast**, measured on three videos Charlie made with it (French ×2, German ×1, 12.7 to 15.1
minutes), plus measurements of the same kind in Charlie's research:
| Measure | Value | How |
|---|---|---|
| Shots per minute | 13.1 – 16.2 | scene-change detection on Charlie's three files (ffmpeg, threshold 0.25) |
| Mean / median shot | 3.7 – 4.6 s / 3.4 – 4.3 s | same |
| Screen time | presenter ≈ 26 %, AI clips ≈ 21 %, AI stills ≈ 52 % | Charlie's research, read from Headcast's editor on three videos |
| Along the video | opening 30 s: presenter and clips only; stills grow to ≈ 70 % by the end; presenter stays ≈ 25 % | same |
| Presenter layouts | full screen; half screen (presenter left, picture right); small inset bottom left over a picture | frames of Charlie's videos |
| Presenter framing | one single framing for the whole video (one photo) | frames |
| Text on screen | no captions; a full-screen sponsor card with a QR code and a web address (≈ 1:20 in the first French video) | frames |
| Words per minute | French ≈ 176, German ≈ 140 (§2.3) | faster-whisper `small` on Charlie's files, word timestamps |
| Generated presenter time | ≈ 24 s per finished minute shown as ≈ 16 s (≈ 50 % generated then cut) | Charlie's research |
| Re-use | none: every picture generated for the video | Charlie's research |
| Price to the customer | 0,87 $/min (99 $ for 114 min) down to 0,66 $/min (1 299 $ for 1 955 min) | Headcast's public pricing |

What we do better (Charlie's list and Headcast users' requests): free mix and curve, engine choice per brick, presenter
only or no presenter, real archives and stock, consistent objects across shots, motion design and advanced editing as
options, several presenter angles, a quote with min / avg / max before every video, and the agent that proposes and
adapts the pipeline.

## 1. The steps
```
Idée ──► Script ──► Voix ──► Réalisateur ──┬─► Présentateur (une génération, puis découpe) ─┐
 (titre, brief,   (cible en mots,  (parler, couper   (phrases → plans, ├─► Images (générer / éditer)                       ├─► Montage ─► Contrôle ─► Vidéo
  langue, vidéos   import possible) les blancs,       ancrés sur des    ├─► Clips (image → vidéo)                          │   (simple / avancé, sous-titres,
  d'appui)                          minuter)          mots exacts)      ├─► (option) Archives / stock, Motion              │    chapitres, sponsor + QR, mix)
                                                                        └─► Musique ───────────────────────────────────────┘
```
Voice and presenter assets are made **once per channel** (§2.3 a, §2.5 a), not per video.

## 2. Step by step
Each step: what it does · inputs → outputs · settings (default) · engines (default → fallbacks) · failure.

### 2.1 Idée (`idea.brief`, `idea.support`)
- **Inputs:** title (the idea), brief (a few lines), language; optional support videos, each tagged « sujet » (what to
  talk about) or « structure » (how to build it: hook, parts, ending). **Output:** `text.brief` + `json.support`
  (per video: transcript summary, outline, hook, length; never the transcript itself in the script prompt).
- **Settings:** `language` (channel's), `supportMax` (3).
- **Engines:** transcript through the eyes (Cloud `analyseVideo`) or the YouTube read connector; summary by Haiku 5.5.
- **Failure:** a support video that cannot be read is dropped with a note; the idea alone is enough to continue.
- Gate `topic` (default on).

### 2.2 Script (`script.write` or `script.import`, then `script.sponsor`, optional `script.factcheck`)
- **Inputs:** brief, support (subject / structure), the channel's profile (its best videos' structures, tone, words per
  minute), competitors' structures (reference channels), the sponsor (if any), global script skills (Charlie's, to be
  added as files in `resources/skills/script/`). **Output:** `text.script` (spoken text only), `json.outline` (parts,
  hook, chapter titles, sponsor sentences).
- **Length:** target words = minutes × the channel's words per minute (measured by the eyes on its videos; default by
  language below); ENGINE-SPEC §17.1 (targeting) and §17.2 (writing in parts) apply.
  Measured on Charlie's Headcast files: French ≈ 176 words per minute, German ≈ 140 (table in §2.3). Measured on the 18
  reference channels (research §2): French 174–211, English 156–200, German 154–185, Portuguese and Italian 142–147,
  Polish 124–136. Defaults until a channel is measured: French 180, English 180, German 155, Italian / Portuguese 145,
  Polish 130: per language, the median of the channels' averages (Headcast included for French and German), rounded
  to 5. Spanish 160 is not measured, our estimate. The channel's own
  measure always wins.
- **Structure (avatar default, from the 18 reference channels, `avatar-channels-2026-10.md`):** one of the two shapes
  those channels repeat, chosen per channel: a **numbered list** (« 5 choses », « 10 erreurs », « 15 astuces ») or a
  **mistake → why → the old way** arc; the persona's authority line (years in the trade, the grandmother's method, the
  « Japanese way ») early; concrete amounts, prices and savings; a cold open (ENGINE-SPEC R17.5); the product pitch
  where the channel's placement rule says. The agent adapts it to the channel's own structure.
- **Settings:** `minutes` (pipeline format), `wpm` (channel), `tone` (channel), `numberedParts` (auto), `sponsor`
  (`auto` = the channel's placement rule), `factcheck` (off; option), `importScript` (off; option).
- **Engines:** LLM per the team backend (0013): Sonnet 5.5 (write), Haiku 5.5 (fit, cleanup). Fallback: the other
  backend the team allows; a limit reached on « mon abonnement » waits rather than paying (0013).
- **Failure:** length outside the acceptance band of ENGINE-SPEC R17.2 → its rewrite or tightening pass; a refusal or a
  part that stays short after its retries stops the run at the script gate with the reason (R17.6: a truncated script
  is never voiced). Fact-check corrections come back as (quoted text → replacement) and apply only when the quoted text
  is found once; the original script is kept beside the corrected one.
- Gate `script` (option; default off when the agent writes, absent when the user imports).

### 2.3 Voix
**a. Channel voice (once, `voice.make`)**: `design` (describe a voice → ElevenLabs voice design → listen → keep),
`clone` (30–60 s of clean speech: the user's upload, or isolated from the channel's own videos on import with the
consent step) or `import` (a provider voice id). Keep the source sample so the voice can be re-cloned on another
engine. Charlie's flow: create on ElevenLabs, then clone the result on a cheaper engine; both voices stay attached to the
channel; a blind listening test (French first) decides which one runs.
**b. Per video (`voice.speak` → `voice.trim` → `voice.align`)**
- **Inputs:** `text.script`, the channel voice, language. **Outputs:** `audio.voice`, `json.words`.
- **Trim:** silences longer than `maxPauseS` (0.6 s, our choice from the measure below: keeps a natural breath, removes
  dead air) are shortened to it, never cutting into a word; done before timing so every later time is real.
- **Align:** provider timings when given (characters → words), else forced alignment with a local recogniser
  (ENGINE-SPEC §19.3); quality bar ≥ 90 % of script words matched.
- **Settings:** `speed` (1.0), `expressiveness` (channel), `maxPauseS` (0.6), `pronunciations` (channel list).
- **Engines (French):** `voice:elevenlabs-v2` (0,08 $ / 1 000 characters ≈ 0,07 $/min) → `voice:minimax-28-hd`
  (≈ 0,09 $/min) ; cheap: `voice:fish-s2` (≈ 0,015 $/min) and `voice:ai33` (ai33.pro, the cheaper engine Charlie chose himself in his
  prompt of 10-31 to clone voices made on ElevenLabs; price to read on its public site and dashboard). Consistency class (model §3 R3.4): the voice never changes mid-video.
- **Failure:** chunk retries (ENGINE-SPEC §19.2); provider down → the run waits and asks « Réessayer » / « Changer de
  voix » for the whole narration; alignment under the bar → `weak` flag, later steps widen tolerances, QC reports it.
- Gate `voice` (off by default).

| Charlie's Headcast files (faster-whisper `small`, elisions counted as one word) | Words | Speech span | Words per minute | Pauses > 0.45 s (total) | Longest pause |
|---|---|---|---|---|---|
| French 1 (12.7 min) | 2 241 | 12.7 min | 177 | 116 (63 s) | 1.1 s |
| French 2 (13.2 min) | 2 332 | 13.2 min | 176 | 169 (94 s) | 0.9 s |
| German (15.1 min) | 2 113 | 15.1 min | 140 | 206 (118 s) | 1.1 s |
Reading: the narration is dense (no pause above ≈ 1 s) but keeps short breaths between sentences; `maxPauseS` 0.6 s is
our default (one breath kept, dead air removed).

### 2.4 Réalisateur (`director.plan`, `director.presenter`, `director.textcheck`)
- **Inputs:** `json.words`, `json.beats`, `json.outline`, the mix and curve (§4), shot lengths, the options (layouts,
  who appears, brands, chapters, sponsor), the styles, the reference channels' measured profile, the unit prices (to
  price the plan). **Outputs:** `json.directives` (from the LLM: sentence, anchor words, kind, subject, prompt or query,
  layout), `json.editplan` + `json.genlist` (timed, priced), `atelier.timeline/1`.
- **Behaviour:** model §7 and ENGINE-SPEC §21. For the avatar pipeline:
  1. **Presenter placement** first, by code from the mix: `placement: short` (one shot per sentence or two, 2–6 s,
     the Headcast-like rhythm) or `placement: stretches` (fewer, longer presenter stretches, for channels where the
     presenter talks longer; their length comes from the channel's measured presenter shots, research §2, and is set
     with the channel, never a preset number). The opening sentences are presenter (the hook);
     the presenter never appears for under `minShotS` (1.5 s, ENGINE-SPEC §21.7).
  2. **Scene pass (LLM)** for every other sentence: what to show, as a still, a clip, found footage or a motion card,
     respecting the curve's shares for that part of the video, the style's shot grammar and the people / brand rules.
     Prompts describe one concrete subject, the shot size, and the action when there is one (« une main gantée sort un
     plat du four »).
  3. Anchor timing, fill, caps, budget and text check by code (ENGINE-SPEC §21.2–21.9).
- **Settings:** `placement` (`short`), `curve` (`hook-heavy`), `shotLengthS` (presenter 4.0, clip 3.7, still 3.4: the
  Headcast medians; the channel's measure wins), `clipShotsPerGeneration` (1; 2 in eco: one 8 s clip gives two shots of
  the same scene, wide then tight), `layouts` (`full`, `split`, `pip`), `people`, `brands`.
- **Engines:** Sonnet 5.5 (scene pass), Haiku 5.5 (text check), code for the rest.
- **Failure:** an anchor not found → shot dropped (logged); a plan that fails the checker twice → permanent error at
  the `director` gate with the findings; a plan over budget → downgraded by least value per credit (clips → stills →
  found), never the hook's first shot.
- Gate `director` (off by default); the gate card shows the timeline and its price before any generation.

### 2.5 Présentateur
**a. Channel presenter (once, `presenter.make`)**
- **Create:** a portrait from a description (the art direction made with the user: age, role, outfit, room, light),
  framed like the reference channels' presenters (one person facing the camera, upper body, a real-looking room that
  fits the persona behind them, one recurring outfit that becomes the channel's signature, as every reference channel
  keeps one); or **clone** from
  the channel's own videos (frames picked by the eyes: sharp, frontal, natural expression), with the consent step
  (decision 0025). Optional clean-up with an image edit that keeps the face.
- **Angles (option multi-shot):** 3–6 extra framings of the same person in the same room (wide, medium, close), made
  with an image-edit engine using the portrait as reference, kept only if a face-similarity check passes (threshold set
  by our own test on our presenters). Which angle each layout uses is a `presenter-studio` style setting, set from the
  reference channels' multi-angle frames (research §2). Cheaper variant, free: **re-crops** of the single framing
  (wide, medium, tight) cut from the one presenter generation. One reference channel gets about 5 framings from one
  camera this way. Most reference channels keep one angle (research §2).
- **Register:** some engines need the face registered once (a « look »); stored per engine on the presenter.
- **Outputs:** presenter asset `{ portrait, angles[], voiceRef, registrations{engine→id}, consent }`.

**b. Per video (`presenter.talk`): one generation, then cut**
- **Inputs:** the presenter shots of the timeline, `audio.voice`, `json.words`, the presenter asset. **Output:**
  presenter clips per shot.
- **Behaviour (our method):**
  1. Take every presenter shot's audio with a small handle on each side (`handleS` 0.2, ENGINE-SPEC §23), join them
     into one audio file, in order, with a short silence between stretches.
  2. Generate the talking video **once** on that file (several calls only when the engine's maximum length per call is
     shorter; then split at stretch boundaries).
  3. Cut each shot back out on its own word times. The lips stay in sync because the audio is the same.
  4. Edit: cut on word boundaries only; a presenter shot shorter than `minShotS` is merged with its neighbour or given
     to a picture; two presenter shots in a row without a picture between them are one shot; the voice runs under the
     cutaways (L-cuts), so the cut is invisible.
  Saving vs generating each shot with generous margins: Headcast generates ≈ 24 s per finished minute for ≈ 16 s
  shown; this method generates ≈ 16 s × (1 + 2 × 0.2 / 4) ≈ 17.5 s (−27 %).
- **Settings:** `engine`, `resolution` (720p), `expressiveness` (the engine's default; set per persona after the
  production-10 test renders), `motion` (a short line from the presenter
  style's rules, written by us per persona and tuned on test renders; empty when the engine takes none), `handleS`
  (0.2), `layout` per shot (from the director).
- **Engines** (prices §9): `presenter:heygen-avatar4` (API, 0,05 $/s) · `presenter:hedra-c3` (0,025 $/s 540p,
  0,05 $/s 720p) · `presenter:kling-avatar2-std` (fal, 0,056 $/s) · `presenter:infinitetalk-fast` (hosted, 0,015 $/s) ·
  `presenter:infinitetalk-gpu` (open model on a rented GPU, ≈ 0,005 $/s estimated, benchmark needed: 0015 allows 20 $).
  HeyGen's plan credits through its public remote MCP server (docs.heygen.com « HeyGen Remote MCP server »; ≈ 0,013 $/s)
  only with HeyGen's written OK (0014: their terms forbid white-labelling). Default by preset (§6). Consistency class: one engine per video (the face looks different
  on another engine).
- **Files sent to providers:** from our own storage with short signed links, never a public anonymous host.
- **Failure:** retry with backoff; engine down → the next engine for the **whole** video before it starts, else the run
  waits; one shot that fails after retries becomes a picture (the voice continues); « crédits insuffisants » pauses the
  run, never silently drops the presenter.
- Gate `avatar` (off by default).

### 2.6 Images (`image.make`, optional `image.find`)
- **Inputs:** genlist items of kind `imageAi` (and the start frames of clips), the style, references (presenter portrait
  for `presenter-as-actor`, the room for consistency), people / brand rules. **Output:** `media.image[]` 1920×1080.
- **Behaviour:** ENGINE-SPEC §23 (prompt design, consistency, parallel generation, checks, refusal handling). Objects
  that recur (a dish, a tool) get one fixed description reused in every prompt that shows them, and the first image as
  reference when the engine accepts one (Headcast users' main complaint).
- **Settings:** `quality` (option: eco / standard / premium = engine choice), `people` (`not-presenter`), `brands`
  (`real`), `postProcess` (style).
- **Engines:** `image:gpt-image-25-low` (0,0059 $) → `image:gpt-image-25-medium` (0,0132 $) ; `image:flux-schnell`
  (0,003 $) for clean styles; `image:nano-banana-2` (0,067 $) premium; edit with reference: the same model's edit
  endpoint. Fallback per item to the next engine of the list (stills are not a consistency class).
- **Failure:** refusal → one plainer rewrite → degrade to a found still or a hold; checks fail (text in image, blank,
  duplicate) → one regeneration.
- Gate `visuals` (off by default) shows a contact sheet before clips are made.

### 2.7 Clips (`clip.make`)
- **Inputs:** genlist items of kind `clipAi`, their start images (from §2.6), style. **Output:** `media.clip[]`
  (3–8 s, re-timed to 30 fps).
- **Behaviour:** image → video with gentle, physically plausible motion, nothing new appearing; one generation may
  serve two shots (`clipShotsPerGeneration` 2: wide part then tight crop), halving the clip cost at some loss of
  variety.
- **Engines:** `clip:veo31-lite-relaxed` (reseller queue, 0,075 $ per clip up to 8 s, slow at peak) →
  `clip:veo31-lite-vertex` (official, 0,03 $/s without audio) ; `clip:veo31-lite` fast queue (0,15 $ per clip) ;
  `clip:minimax-h3-lite` (0,025–0,04 $/s) ; `clip:wan22` (fal, 0,04 $/s at 480p) ; premium `clip:veo31-fast`
  (0,30 $ per clip). Per item fallback. Per-clip timeout (15 min) before falling back.
- **Failure:** refusal / timeout → next engine → the still with a slow camera move (never a black slot).

### 2.8 Found footage (option, `clip.find`, `image.find`; later chantier)
Stock (Pexels, Pixabay: free, licence per item), public archives (Internet Archive, Wikimedia Commons: licence per
item checked and stored), the user's own footage. `clip.find.youtube` reads only (finding moments in public videos);
using other channels' footage in our videos needs its own decision with Charlie (copyright, YouTube reused-content
policy). Default off in the avatar base; on in the `archives-mix` preset.

### 2.9 Motion (option, `motion.make`)
`template`: the engine's coded templates (chapter card, list, figure, quote, compare) at 0 credits. `agent`: an agent
writes cards for this video on the team computer (model §9: free with Claude Code, ≈ 1,2–2,5 € per video on credits).
Default off.

### 2.10 Music (`music.pick`)
Library music (licensed, 0 credits) by mood, cut to length, under the voice with automatic lowering while the voice
speaks (ENGINE-SPEC §26, §28.5); option off for channels whose references have none. Generated music (ElevenLabs Music,
0,15 $/min) only as an option.

### 2.11 Montage (`edit.assemble`, `edit.layout`)
- **Simple (default, all code):** shots on the voice in timeline order, straight cuts, slow camera moves on stills
  (alternating directions), presenter clips composited per segment and layout (full, half screen, inset; ENGINE-SPEC
  §28.1), voice + music master (§28.5). Segments are cached (ENGINE-SPEC R7.6), so changing a presenter layout
  re-renders only the segments it touches.
- **Advanced (option):** an agent on the team computer adds an overlay layer on top of the simple edit: highlighted
  words, arrows and circles on the picture, product callouts, kinetic text, split-screen builds (the look of the more
  edited reference channels). Its output is a list of overlay items rendered by our motion renderer, never free ffmpeg
  commands. Price: model §9.
- **Failure:** ENGINE-SPEC §28 (segment retries, never a black slot).

### 2.12 Captions and chapters (`edit.captions`, `edit.chapters`)
Captions from `json.words` (burnt in: off by default, the references mostly have none; SRT/VTT always exported).
Chapters: when on, a chapter mark appears when a numbered part starts (Charlie, 10-31: « les chapitres en haut à droite
qui pop »; default top right, position and look are style settings), built on the chapter-card template of
ENGINE-SPEC §25; chapter titles from `json.outline`. The reference channels that number their items on screen (7 of
15 measured, research §2) do it as a lower third, a bottom band or a slab, with « trick n », « mistake n » or
« no. n ». The style offers those positions, and the agent proposes the option « on » for a numbered-list channel.

### 2.13 Sponsor slot and QR (`script.sponsor`, `edit.sponsor`)
- **Channel input:** product (name, one-line pitch, link), media (a clip ≤ 90 s or an image), placement rule (where:
  after the hook / middle / before the end; how many mentions; how long), optional QR (link, position, size).
- **Script:** `script.sponsor` writes the mentions where the rule says, in the presenter's voice; a price is spoken
  only if the channel's references say it aloud (research §1).
- **Screen:** the slot is anchored on the exact sentences of the mention (found in `json.words`); the clip plays over
  them (cut to the passage; if too short, its last frame holds) or the card shows; the QR sits at the set position.
- **Default** (until the channel's references are measured; the placement rule stays a channel setting): one mention
  right after the hook (≈ 70–150 s), 20–30 s long, with a full-screen card + QR, and one reminder before the closing
  (≤ 15 s); no spoken price. Where and how many come from the 18 reference channels (research §2, §4 point 10). The
  most common placement is right after the hook, at 1:10–2:30, in 7 of the 14 channels that sell. The other 7 place it
  at 5–7.5 min or near the middle. Measured first mentions last 12–48 s, once 75–80 s. The 20–30 s length and the
  ≤ 15 s reminder are our estimates, chosen for a short, typical mention. Of those 14 channels, 6 show a card, 4 add a
  reminder near the end and 3 speak a price. Headcast places its card around 1:20–1:30 and again near the end.

### 2.14 Contrôle et paquet
`qc.check` (frozen or black frames, presenter lip-sync drift on word times, durations, loudness), `thumbnail.make`
(channel style; gate `thumbnail` on by default), `package.youtube` (title, description with the sponsor link first when
there is one, chapters, tags). Never uploads (CLAUDE.md).

## 3. Options of `avatar@1` (defaults)
| Option | Choices (default first) | What it changes | Δ cost per minute (avg, §6 base « mix ») |
|---|---|---|---|
| Montage | simple · avancé | adds the overlay agent | 0 with Claude Code; ≈ +0,10 €/min on credits |
| Chapitres à l'écran | non · oui | `edit.chapters` on | 0 |
| Sous-titres incrustés | non · oui | `edit.captions` burn-in | 0 |
| Musique | bibliothèque · aucune · générée | `music.pick` | 0 · 0 · +0,15 $ |
| Présentateur | un seul plan · recadrages · plusieurs plans | re-crops of the one generation (a tight crop needs the presenter rendered at 1080p: our estimate) · angles + framing per layout | 0 · 1080p presenter price · one-off ≈ 0,40 $ per presenter (6 edits) |
| Qui apparaît dans les images | autres personnes · le présentateur joue l'action · personne · tout le monde | style `people`; « joue l'action » uses image edit with the portrait | « joue l'action »: ≈ +0,05 $ |
| Marques | réelles · aucune | style `brands` | 0 |
| Sponsor + QR | si la chaîne en a un · non | `script.sponsor`, `edit.sponsor` | 0 |
| Vérification des faits | non · oui | `script.factcheck` | 0 with Claude Code; ≈ +0,03 €/min on credits |
| Script | écrit par l'agent · importé | `script.write` / `script.import` | — |
| Part de clips | 21 % (slider 0–50 %) | mix + curve rescaled | ≈ ±0,06 $ per 5 points |
| Qualité des images | éco · standard · premium | image engine | 0 · +0,09 $ · +0,78 $ |
| Qualité des clips | éco · standard · premium | clip engine | 0 · +0,26 $ · +0,77 $ |
| Qualité du présentateur | per engine of §2.5 | presenter engine | see §6 |
| Génération du présentateur | une fois, puis coupée · continue | `avatar.speak` `generation` (continuous bridges cutaways < 9.5 s) | 0 · +0,085 $ (HeyGen plan) |
| Clips en deux plans | selon la qualité · aucun · la moitié · tous | `clip.make` `pairShare` 0 / 0,5 / 1 | aucun → la moitié −0,08 $, → tous −0,16 $ |

## 4. Default mix and curve (`hook-heavy`, from the Headcast measure)
| Part of the video | Presenter | AI clips | AI stills |
|---|---|---|---|
| 0–30 s | 50 % | 50 % | 0 % |
| 30 s – 2 min | 28 % | 60 % | 12 % |
| 2 – 5 min | 25 % | 35 % | 40 % |
| 5 – 10 min | 26 % | 14 % | 60 % |
| 10 min – end | 24 % | 3 % | 73 % |
Overall ≈ 26 / 21 / 53. Moving a share rescales the rows keeping the shape (model R6.2): the opening stays without
stills and stills grow towards the end. The channel's measured profile replaces it when the channel has one.

## 5. Volumes per finished minute (base « mix »)
Presenter ≈ 17.2 s generated (26 % of 60 s × 1.1 handles); clips ≈ 3.4 generations (12.6 s / 3.7 s); stills ≈ 12.8
(9.4 shown + 3.4 clip start frames); voice 1 minute (≈ 900 characters in French at 176 words per minute: the estimator's figure, record 0030); LLM ≈ 0 on
« mon abonnement ».

## 6. Presets and cost per minute (production-10 grid: Charlie's providers of 2026-11-01, US $, real cost)

**vrais-tests update (record 0045):** the table below is the production-10 ladder, measured with the options « Clips seulement où ça
bouge » and « Plans courts » off. `avatar@1`'s defaults now pair two shots per clip only on one continuous action, send short single
shots to Grok Imagine 1.5 Lite per second and make the clip shots that show nothing moving stills: **0.53 $/min** on this profile
(the forced pairs of 0.46 $ cut across subjects), about 0.75 $/min on Charlie's clip-heavy reference (64 % clips), 0.65–0.83 $ on the
two remade pieces.
Prices: the Cloud's engines registry (`cloud/src/providers/engines.ts`), read on the providers' public pages on 2026-10-31 /
11-01 (§9), to recheck before each real run. The estimator reproduces this table within 0.01 $ (`tests/unit/cost-ladder.test.ts`).
The table counts no regeneration (the estimator's **min**); its avg adds 5 % on what is generated, its max takes the dearest
fallback of each chain and 15 %. LLM on « mon abonnement » (0 $). 1 $ = 0.92 €.

**Engines (principal first, then fallbacks).** Presenter: HeyGen Avatar IV Photo Look on Charlie's HeyGen plan through its MCP
server (`presenter:heygen-mcp`, 16 credits a minute at the 0.05 $ top-up credit = 0.0133 $/s, 1080p) → HeyGen API
(`presenter:heygen-avatar4`, 0.05 $/s) → Pruna P-Video Avatar on WaveSpeed (0.025 $/s at 720p) → Kling AI Avatar standard on
Kie.ai (0.04 $/s) → InfiniteTalk on RunPod (≈ 0.005 $/s, estimate). Clips: Veo 3.1 Lite « relaxed » on UnificAlly (0.075 $ a
clip ≤ 8 s, 720p; 15 minutes at most per clip, then the next engine) → Vertex AI Veo 3.1 Lite without audio (0.03 $/s) → Kie.ai
Veo 3.1 Lite (0.15 $ a clip at 720p). Stills: GPT Image 2.5 low on OpenAI (0.0059 $) → the same on fal (0.006 $) → Kie.ai (0.03 $);
with the presenter acting in a still, the edit endpoint with the portrait as reference. Voice: ai33.pro (0.0067 $ / 1 000
characters: PLACEHOLDER, Charlie's 0.006 $ a minute to read on the dashboard) → MiniMax speech-2.8-hd (0.10 $). Word timings
from the provider, else the engine's own alignment. Music: none for now (generated music stays off). Files a provider fetches:
links bound to the running job, signed, 30 minutes, served by the Cloud itself over its public https address (the beta), or
presigned links of a Cloudflare R2 bucket later; never a public anonymous host.

**Profile** 26 % presenter / 21 % clips / 53 % stills, per finished minute: 23.9 s of presenter generated « continuous » (17.5 s
« once then cut »), 3.9 clip shots (3.2 s each, Charlie's count; `avatar@1`'s director makes 3.7 s clip shots, 3.4 a minute,
so its own estimate is ≈ 0.04 $ lower on clips), 13.2 stills (9.3 shown + one start still per clip generation), voice
≈ 900 characters.

| Rung (options of `avatar@1`) | Presenter | Clip generations | Stills | **$ / min** |
|---|---|---|---|---|
| Base: « Génération du présentateur » = continue, « Clips en deux plans » = aucun | 23.9 s × 0.0133 = 0.32 | 3.9 × 0.075 = 0.29 | 13.2 × 0.0059 = 0.08 | **0.70** |
| + presenter once then cut (« une fois, puis coupée », the default) | 17.5 s = 0.23 | 0.29 | 0.08 | **0.62** |
| + half the clips give two shots (« la moitié ») | 0.23 | 2.9 = 0.22 | 12.2 = 0.07 | **0.54** |
| + all the clips give two shots (« tous »; « Qualité des clips » éco does it by default) | 0.23 | 1.95 = 0.15 | 11.3 = 0.07 | **0.46** |

Voice ≈ 0.006 $ on every rung. Costs going up: stills in medium (« Qualité des images » standard) **+0.10 $**; Veo Lite without
the relaxed queue (« Qualité des clips » standard) **+0.29 $**; the HeyGen API instead of the plan (« Qualité du présentateur »
standard) **+0.64 $**. Everything on the fallbacks at once (HeyGen API, Vertex, fal, MiniMax): ≈ 1.50 $ / min; a fallback serves
only while the principal is down.

**Fixed cost, apart:** the founder's HeyGen plan (config.json `heygen.plan`): Pro 49 $ a month for 1 000 credits (≈ 62 minutes of
presenter, about 0.049 $ a credit) or Business 149 $ a month for 1 500 credits (≈ 94 minutes) with top-ups at 0.05 $ a credit. The estimate shows it on its own line (« En plus, chaque mois »),
never inside the price per minute.

**How the rungs are made.** « Continuous »: the presenter is also generated under the cutaways shorter than 9.5 s between two
of its shots (`avatar.speak` setting `generation`, batch `bridgeS`): ≈ 24 s a minute on the 12-minute fixture. « Once then
cut »: only the shots, 0.2 s handles and a 0.1 s silence between stretches (§2.5 b). Two shots per clip: one generation shows
the wide part then a tight crop (§2.7); `clip.make` setting `pairShare` 0.5 pairs one clip shot in two, spread along the video.

The previous presets of 2026-10-31 (`avatar-eco` 0.41 $, `avatar-mix` on the HeyGen API 1.32 $, on an open model 0.51 $,
`avatar-premium` 2.20 $, `archives-mix` 0.35 $) assumed ElevenLabs or Fish voices and no plan engine; they are history
(git log of this file).

## 7. Failure handling (summary)
| What fails | What happens |
|---|---|
| Script refused / too short | one rewrite, then stop at the script gate with the reason |
| Voice provider down | wait, then ask « Réessayer » / « Changer de voix » (whole narration) |
| Alignment weak | continue with wider tolerances; QC reports it |
| Director anchor not found | drop that shot (logged); the gap is filled by the mix |
| Director checker fails twice | stop at the director gate with the findings |
| Presenter engine down before start | next engine of the list for the whole video, else wait |
| One presenter shot fails | that shot becomes a picture; the voice continues |
| Image refused / bad | rewrite once, then a found still or a hold |
| Clip refused / timeout | next engine, then the still with a camera move |
| Out of credits | pause « crédits insuffisants », never a silent downgrade; resume pays only what is missing |
| Spend reaches quote + 10 % | stop and ask (0015) |
| Render segment fails | 3 retries, then a hold of the neighbour shot, flagged for QC |

## 8. What to confirm on the first real calls (production-10)
1. HeyGen: API price per second for photo avatars; maximum length per call; whether plan credits through the assistant
   connector may serve a SaaS (written OK); white-label terms.
2. ai33.pro (Charlie's choice of 10-31): real prices, French and German clone quality, terms.
3. Veo through the reseller: real queue delay by hour; output rights; Vertex as the official fallback.
4. GPT Image 2.5 low vs medium: side-by-side against Headcast stills (Charlie judges).
5. The open avatar model: seconds of compute per second of video on a 4090 / L40S, lip-sync quality in French
   (benchmark ≤ 20 $, run by Charlie).
6. Every vendor's resale terms (0014 watch-outs).

## 9. Price sources (read 2026-10-30, 10-31 and 11-01; to recheck before each real run)
| Engine | Price | Source |
|---|---|---|
| HeyGen Avatar IV photo avatar (API) | 3 $/min = 0,05 $/s | help.heygen.com « HeyGen API pricing explained » |
| HeyGen plan credits (Photo look 16 credits/min, top-up 0,05 $/credit) | ≈ 0,013 $/s | heygen.com/pricing, help.heygen.com credits article, flexprice index (Charlie's research, 10-31) |
| Hedra Character-3 | 0,025 / 0,05 / 0,0625 $/s (540p / 720p / 1080p) | hedra.com/pricing (MEDIA-PROVIDERS) |
| Kling AI Avatar v2 standard (fal) | 0,0562 $/s | fal.ai model page (MEDIA-PROVIDERS) |
| InfiniteTalk fast / standard (WaveSpeed) | 0,015 / 0,03 $/s | wavespeed.ai model pages (Charlie's research, 10-31) |
| InfiniteTalk on RunPod | ≈ 0,005 $/s, **estimate**: 4090 community 0,34 $/h, assumed ≈ 25 s of compute per second of 720p video, ×2 for loading and retries | runpod.io/pricing (MEDIA-PROVIDERS); speed unverified, benchmark |
| Veo 3.1 Lite relaxed / fast queue (reseller) | 0,075 / 0,15 $ per clip ≤ 8 s | unifically.com Veo 3.1 page (Charlie's research, 10-31) |
| Veo 3.1 Lite on Vertex, no audio | 0,03 $/s | Google Cloud Vertex pricing (Charlie's research, 10-31) |
| Veo 3.1 Fast (reseller) | 0,30 $ per clip 720p | unifically.com (Charlie's research) |
| MiniMax H3-Lite | 0,025–0,04 $/s | MEDIA-PROVIDERS |
| GPT Image 2.5 low / medium | 0,0059 / 0,0132 $ per 1K image | tokencost / OpenAI pricing (Charlie's research, 10-31) |
| FLUX.1 schnell | 0,003 $/MP | MEDIA-PROVIDERS |
| Nano Banana 2 | 0,067 $ per 1K image | MEDIA-PROVIDERS |
| ElevenLabs Multilingual v2 | 0,08 $ / 1 000 characters | elevenlabs.io/pricing/api (MEDIA-PROVIDERS) |
| MiniMax speech-2.8-hd | 0,10 $ / 1 000 characters | platform.minimax.io pricing (MEDIA-PROVIDERS) |
| Fish Audio s2 | 15 $ / 1 M bytes | docs.fish.audio pricing (MEDIA-PROVIDERS) |
| HeyGen Avatar IV Photo Look on the web plan (MCP) | 16 credits/min × 0,05 $ = 0,0133 $/s; Pro 49 $/month for 1 000 credits, Business 149 $/month for 1 500, credits | help.heygen.com « How to use credits », heygen.com/pricing (read 2026-11-01) |
| HeyGen API Avatar IV photo avatar | 0,05 $/s (Enterprise page); a self-serve figure of 0,0385 $/s is unverified | developers.heygen.com/docs/enterprise-pricing (2026-11-01) |
| Pruna P-Video Avatar (WaveSpeed) | 0,025 / 0,045 $/s at 720p / 1080p | wavespeed.ai/models/pruna-ai/p-video/avatar (2026-11-01) |
| InfiniteTalk standard (WaveSpeed) | 0,03 / 0,06 $/s at 480p / 720p | wavespeed.ai/models/wavespeed-ai/infinitetalk (2026-11-01) |
| Kling AI Avatar standard (Kie.ai) | 8 credits ≈ 0,04 $/s, 720p | kie.ai/kling-ai-avatar (2026-11-01) |
| Veo 3.1 Lite / Fast (Kie.ai) | 0,15 / 0,30 $ a clip at 720p (0,175 / 0,325 at 1080p) | kie.ai/veo-3-1 (2026-11-01) |
| Veo 3.1 on UnificAlly | Lite relaxed 0,075 (1080p 0,10), Lite 0,15, Fast 0,30 (1080p 0,325) $ a clip, any length 4–8 s | unifically.com/blogs/veo-3.1 (2026-11-01) |
| GPT Image 2.5 on fal | 0,0060 / 0,0133 / 0,0528 $ (1024², low / medium / high) | fal.ai/gpt-image-2.5 (2026-11-01) |
| GPT Image 2.5 on Kie.ai | 0,03 $ a 1K picture | kie.ai/gpt-image-2-5 (2026-11-01) |
| MiniMax voice design | 3 $ a designed voice, on its first use | platform.minimax.io pricing (2026-11-01) |
| ai33.pro (OpenSpeaker) | 1 M credits for 5 $; credits per character not published | openspeaker.ai/pricing (2026-11-01) |
| Claude API (Sonnet 5.5 / Haiku 5.5) | 2 $ / 10 $ and 0,10 $ / 0,50 $ per M tokens | platform.claude.com pricing (decision 0013) |

## 10. Rendering: Charlie's question of 10-31, answered with numbers
Charlie asked: rent GPUs for renders, give every subscriber a small virtual PC that renders, or pay per render — which
is the most profitable?
- **Assembly is CPU work** (ffmpeg): ≈ 4–9 minutes of an 8- to 4-core machine for a 10-minute video. A GPU does not make it meaningfully cheaper; renting one for assembly costs more.
- **Per render on shared machines billed by the second**: ≈ 0,03 $ for a 10-minute video (≈ 0,3 cent per finished
  minute), in parallel, so a user's video does not wait behind their own team computer. Charlie's example (a 20 € a
  month VM vs 20–40 cents per render) is far above our real per-render cost: per-render wins until ≈ 4 000 videos a
  month, when an owned render server (≈ 100 € a month) becomes cheaper (0015).
- **The small team computer** (≈ 6 € a month) stays, for what must run as the user: the agents, Claude Code on the
  user's own subscription (0013), a browser, the advanced editing and motion agents. It does not render.
- **Rented GPUs** only for open avatar / video models, by the second, after the benchmark.
Decision 0012 / 0015 therefore stand; record 0026 restates them with these numbers.
