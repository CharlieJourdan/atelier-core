# 0011. Recipes (shared, by stage), one project per video, built mainly by the agents
Date: 2026-10-30. Status: accepted. Decided by: Charlie (production-1, and his words of 2026-10-24 to 10-30).

## Context
0008 keeps « projects made of bricks » and removes the pipelines that do not run. 0010 makes every brick
(technology) code. Charlie's words (the digest of what he said):
- the stages: « une partie director. Il va dire : « Ici, je mets ça » » (10-24); on 10-30: import of an idea (a sheet
  or videos to draw from), script, voice, director, find or generate the parts, editing;
- the agents build: « c'est surtout les agents qui vont s'en servir pour build les pipelines adaptés aux besoins et
  aux chaînes » (10-30);
- pre-built ones: « des pipelines pré-construites pour plusieurs types de vidéo que l'on pourra prendre comme tel
  (par exemple les avatars, on mettra son avatar) et ensuite … customiser » (10-30); « des workflows déjà faits de
  base … documentaire, avatar et AI channel » (10-24);
- shared across channels: « les pipelines de production sont indépendants des chaînes » (10-24); in this session he
  chose « une recette par chaîne et par type de vidéo, validée une fois »;
- gates: « à part validé les miniatures et les sujets » (10-26); « certaines chaînes voudront tout valider étape par
  étape » (10-24); in this session: « ça va dépendre de ce qu'on va mettre en paramètre et dans l'onboarding »;
- no quality selector: « On fait de l'efficience, en fait. » (10-24);
- share: « un fichier JSON » to send pipelines (10-24); the admin edits pipelines « sans toucher au code » (10-24).

## Decision
- **Every recipe follows the same stages**; within a stage, bricks are interchangeable (Charlie's « bac à sable »):
  1. **Idée** — a brief sheet (what the video is about) or reference videos to draw from;
  2. **Script**;
  3. **Voix** — a chosen voice, a cloned one, or the user's own recording;
  4. **Réalisateur** — what goes where (edit plan and generation list);
  5. **Éléments** — find or generate the parts: stock and archive footage, images, AI video, avatar, motion design,
     the user's own clips;
  6. **Montage** — assembly, captions, music, render;
  7. **Contrôle et paquet** — QC, thumbnails, title, description, kit.
  A capability may take several bricks: avatar = create an avatar or clone it from a video, plus the voice chosen or
  cloned, plus the avatar video generation.
- **Recipe** (« recette »): the ordered bricks (technology `id@version` + settings) for ONE video type (avatar long
  16:9, short 9:16, documentary…), plus the format (aspect, minutes), a per-video credit cap and the checkpoints.
  It belongs to the team, not to one channel: the same recipe can serve several channels, and the UI shows which.
  A channel picks one recipe per video type it makes. Versioned (a save = a new immutable version). No « qualité max /
  usage max » switch: each brick carries its own choice (e.g. avatar 720p or 540p), and the director works for the
  best result under the cap. Settings resolve: technology defaults < recipe < channel (voice, avatar, style profile
  from the eyes) < project.
- **Project** (« projet ») = ONE video: a pinned recipe version + the idea and inputs (brief, reference videos,
  script pasted, footage…) + per-video adjustments; attached to a channel or to none. It compiles to
  `atelier.pipeline/1` (`docs/ENGINE-SPEC.md` §5) and runs through the existing `ProductionRuns`; the run pins the
  exact pipeline, technologies and style (R5.7).
- **Three ways to build**, same objects:
  1. **Recommended: the production agent.** For a channel and a video type it drafts the recipe from the channel's
     style profile and the reference channels, usually from a pre-built recipe; the owner validates it once. For each
     video it creates the project and may adjust it for the topic, within the cap. The agents are the main users of
     the sandbox.
  2. **Pre-built recipes**, one per common video type (avatar first, then documentary, short…), shipped with the app
     and made only of real technologies: used as they are (avatar: the user only sets their avatar) or copied and
     customised (swap stock footage for AI video, add motion design to a plain cut…). A pre-built recipe ships only
     when it runs end to end. The founder publishes and updates them without code (Blueprints, console).
  3. **By hand:** the user picks and orders bricks and settings in the editor.
- **Not restricted** (Charlie, relayed 2026-10-30: « pas restreint »): the owner validates a channel's recipe once,
  when the channel is set up, never per video; the user can edit a recipe at any time; the agent may adjust the
  recipe for a given topic within the channel's budget and caps; every technology in the registry (0010) is usable
  in any recipe as soon as it ships.
- **Checkpoints are a setting** per channel (copied into its recipes, overridable per recipe), set in the channel
  settings and later by onboarding. Possible stops: idea/topic, script, voice, director plan, visuals, avatar, final
  video, thumbnail. **Default: topic + thumbnail**; any channel can ask for more, up to every stage.
- **Start screen:** no demo data. A channel without a recipe offers « Faire préparer une recette par l'agent »
  (recommended), the pre-built recipes that really run, and « Construire moi-même ».
- **Export / import:** a recipe is one validated JSON file (`.atelier-recette.json`), so it can be shared.
- **Agents:** the production agent drafts and edits recipes (proposals the owner validates), creates projects,
  requests quotes, runs them and passes the checkpoints the channel leaves to it, always under the caps (0015).

## Consequences
- Same quality and a predictable quote from one video to the next; the agent works once per video type, not per video.
- The engine's `budget.default` / `modes` (`qualite_max`, `usage_max`) are no longer exposed: recipes compile with
  one fixed mode; the field stays in `atelier.pipeline/1` for compatibility.
- Later, not now: a feasibility score and a test video when a recipe is drafted for a channel (Charlie, 10-24).
