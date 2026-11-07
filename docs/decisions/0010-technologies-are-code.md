# 0010. A technology is a coded brick, shared by every channel
Date: 2026-10-30. Status: accepted. Decided by: Charlie (production-1).

## Context
0008 asks for « technologies » (script, director, thumbnails, voice, avatar…) shared across channels and video types,
and easy to add. Three ways were offered: a data sheet filled in a panel (no code), code only, or importing code from
the panel. Charlie chose **code only**: every new technology is written in a Claude Code session and ships with the
app or the Cloud. He also said that a video is built either by hand from bricks or, as recommended, by the production
agent that arranges the bricks.

## Decision
- **A technology is a brick written in code.** It wraps one or more engine nodes (`src/engine/nodes/`, contract in
  `docs/ENGINE-SPEC.md` §2) with a manifest in code:
  - `id@version` (integer version, like node types, R2.1) and a French label;
  - `kind`: script, director, voice, avatar, image, video, thumbnail, music, captions, motion, render, qc, package…;
  - the node(s) it runs and how its params map to them;
  - its params (zod) with defaults, and which of them can be **overridden per channel and per video type**;
  - the Cloud usage(s) it spends (`synthesize`, `talkingAvatar`…) and so its price line(s);
  - the agent tool(s) it exposes (`src/main/orchestra/technologies.ts`);
  - who may use it (everyone, a plan, admin only, beta) and its status (draft / validated).
- **Where they live:** in the repository. The catalogue the app, the agents and the panel read is generated from the
  code registry (one source, like `productionRegistry()`). No technology is stored as data and none is imported at
  run time.
- **Adding or updating one** = a Claude Code session (a chantier or a small brief) and a release. The panel never
  creates technologies; it shows them and holds their settings per channel and per video type. « Pas restreint »
  (digest §7, 10-30) holds in use: once shipped, a technology is usable in any recipe, by the user and the agents.
  Charlie answered this question in production-1 (« Toujours par du code »), after his 10-30 wish for « un panel
  simple à ajouter »: his direct answer wins.
- **Later, not now** (digest §1, 10-24): users importing their own tools as code, with a GPU / small-PC credit
  surcharge (« ça, on ne le met pas pour l'instant »).
- **Providers stay behind the Cloud** (0003): a technology names a usage; which provider serves it is the Cloud's
  configuration. A new provider or model = a Cloud adapter (code), a fake, a price line.
- **Versioning:** a new version is registered beside the old one; a project pins the exact versions it was built with
  (R5.7) and keeps running them; moving a project to a new version is an explicit action (by the user or the agent).
- **Shared, never avatar-only:** every technology must work in a video without an avatar; avatar technologies are
  bricks like the others.
- The existing custom motion bricks (agent-written templates in a sandbox, `docs/ENGINE-SPEC.md` §25.2) stay as they
  are: they are content for the motion technology, not new technologies.

## Consequences
- Safe by construction: no foreign code ever runs on a user's machine; every technology has tests on fakes.
- New AI models arrive at the speed of a coding session, not of a form. Accepted by Charlie.
- production-2 builds the registry from code and a panel that lists technologies and edits their per-channel and
  per-video-type settings; production-3 and -4 write the first technologies.
