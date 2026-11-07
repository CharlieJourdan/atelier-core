# 0056. Production's home is the Lab; base pipelines are « Pipelines prêtes »; every pipeline has a code, sharing it is off in the beta

Date: 2026-11-01. Status: accepted. Decided by: Charlie (notes of 2026-11-01) + Claude (production-lab).

## Context
Charlie's notes of 2026-11-01: Production's start screen « Démarrer » showed too
much; he wants a home that is not called « Démarrer » (« tu peux l'appeler Lab »), with the big « Créer une pipeline » on top
and « Nouvelle vidéo » beside it (moved from the app's top bar); « Mes pipelines » on the left side, each a small rectangle with
its progress graph, its videos in production, its average price and its channels; the base pipelines renamed and a little more
visible, with an example video, the average time and cost, three actions (« ajouter à mes pipelines » — as is or « modifier »,
recommended —, « utiliser », and see it), « Voir toutes les pipelines » and categories on top; Atlas beside the Pipeline and
Projet parts but not on the Lab; long or short form on every pipeline; and « chaque pipeline aura un code… on ne doit pas
pouvoir, pour le moment, exporter… tu peux commencer à la développer ».

## Decision
1. **The Lab** (`production/apercu`, also `production/nouvelle`; tab « Lab ») replaces the start screen: « Créer une pipeline »
   (the big button) and « Nouvelle vidéo » (it opens Projets' new-video form; it left the shell's top bar) on top; « Mes
   pipelines » as a 300 px side column (a scrolling band on a narrow window); « Pipelines prêtes » in the main column. No
   Atlas on the Lab. Building by hand (dev flag, decision 0051) and the file import (codes flag) sit under « Avancé », shown
   only when a flag is on.
2. **« Pipelines prêtes »** is the user's name of the base pipelines (code keeps `BASE_PIPELINES`, `recipes.bases`). Their
   category is the family of their id (`avatar@1` → Avatar; `voiceover@1` → Voix off), so a new base adds itself to a
   category; orders « Les plus utilisées » (copies in the team, the default), « Les moins chères », « Les plus rapides ». A
   card shows the name, an example slot (a drawn poster until each base has its 1–2 min example), the average render time,
   the average cost of a video in credits (euros in its tooltip) and Long / Short; then « Utiliser cette pipeline » (my copy,
   made if I have none, then the new video's form on it), « Ajouter à mes pipelines » (a choice: « Modifier avec l'agent »,
   recommended — the copy opens on « Parler à l'agent » —, or « Ajouter telle quelle ») and « Voir » (blurb, example, specs,
   what can be set). The full page is `production/pretes` (« Voir toutes les pipelines »).
3. **My pipeline's card**: name, Long / Short, a small graph of the stages its bricks cover (filled up to the furthest video in
   production, the current stage breathing), its videos in production (projects whose run is queued, running or waiting), the
   average credits per video with the render time, its channels. `RecipeSummary` gains `base`, `form`, `minutes`, `stages`
   and `code` (read from the latest version; no migration).
4. **Long / short** is `pipelineForm(doc)`: a 9:16 video or the `short` type is a short. Long format is first everywhere
   (Charlie 01/11, late: « long format first »): « Pipelines prêtes » filters on Long by default (Short beside it), « Mes
   pipelines » lists long ones before shorts, « Créer une pipeline » has Long chosen and Short marked « bientôt » until the
   short-form chantier; every card shows its tag. The name « Lab » is confirmed; the price model does not change (beta at
   cost, record 0040): the Lab only shows the same estimate as credits per video.
5. **« Créer une pipeline »** is a dialog with three starts: videos I like (`production/style`), one of my channels
   (`production/agent`), a code (locked « Bientôt » while codes are off). The full agent conversation replaces this later.
6. **Atlas beside the Pipeline and Projets pages** (`WithAtlas`): a 300 px panel with his conversation on a window ≥ 1500 px
   (real mode only: presentation mode's conversation is invented, and Production shows no invented data), a small square in
   the corner otherwise; both hidden while the shell's agent panel is open.
7. **Pipeline codes** (`src/main/production/recipes/codes.ts`): a version's code is 40 bits of SHA-256 over its canonical JSON
   in Crockford base 32 (`7K2Q-9XPM`), so one document always has one code. Sharing gives `ATL1.<code>.<deflated JSON,
   base64url>`: the code carries the whole pipeline and needs no server; importing checks the fingerprint, then validates the
   document like any save (note « Depuis le code … ») and opens it on the agent. **Off in the beta**: `ATELIER_PIPELINE_CODES=1`
   (`app.info.pipelineCodes`) turns on `recipes.share` / `recipes.fromCode` (refused otherwise, in main), the code and
   « Partager » on the pipeline page, « Depuis un code », and the file export / import buttons (the `recipes.export` /
   `recipes.import` IPC stays for tests and tools).
8. Prices on the Lab are credits per video (100 credits = 1 €), beside the average render time; no provider, model or plan.

## Consequences
- Later chantiers: the agent conversation of « Créer une pipeline » (a task you come back to, with a duration estimate), the
  new-video flow, the voices / avatars library, channel connection, the short form, real example videos per ready pipeline,
  and a usage count across users for « Les plus utilisées » (today: copies in this team).
- A shared code carries the pipeline's bricks with their engines: before codes leave the flag, decide what a code may carry
  (engines, a channel's fixed inputs such as a sponsor text).
- e2e: `production-lab.spec.ts`; the specs that clicked « Utiliser » on a base click
  « Ajouter à mes pipelines → Ajouter telle quelle », and the create ways sit in the dialog.
