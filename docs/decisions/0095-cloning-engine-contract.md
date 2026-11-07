# 0095 — The cloning engine runs on a typed contract: phases P0–P10 with exit checks, a Style Definition, bricks only from bases

Date: 2026-11-04 · Chantier: moteur-contrat · Spec: `docs/METHODE-REVERSE-PIPELINE.md`

## Context
The night of 2026-11-03 failed for one structural cause: « Créer une pipeline » picked the nearest base pipeline
(avatar@1, documentary@2…) and kept its default options; what the analysis measured never reached the production
(Finary came out as an avatar, Yarnhub's alternative copied Markets of the Past, Marcel and The Japanese Method lost
their presenter and their shots). Five chantiers must rebuild the engine in parallel without writing the same files.

## Decision
1. **Artefacts are typed and versioned** (zod, `src/shared/clone/`, one file each): brief, corpus, video-analysis,
   synthesis, feasibility, style-definition, pipeline-plan, round, example + report. Every number about the reference
   carries evidence (timestamps, frame paths). Saved per clone under `<data>/clones/<id>/p<N>-*.json`.
2. **The product of cloning is a Style Definition** whose every leaf is `Sourced`: `measured` (with evidence), `user`
   (with what he said) or `default`. A `default` is the definition's own (`definition-defaults.ts`), never a base
   pipeline's option default.
3. **One file per phase** (`src/main/production/clone/p0-intake.ts` … `p10-report.ts`): `runPN` + a pure exit check that
   refuses incomplete output (P2: a video read partly without saying so; P4: a field marked `default` although measured,
   a third party's own presenter; P7: a comparison not saved on disk, a score without its defects; P9: an example the
   blind judge did not call « same channel »). The orchestrator runs them, re-checks saved artefacts on resume, quotes
   before spending, stops under 15 GB of disk, logs every decision.
4. **Bricks from bases, style from the definition, in code** (`plan-rules.ts`): a plan takes only bricks from base
   pipelines; every setting is computed from definition fields through `SETTING_MAP` and cites them; a setting equal to a
   base default passes only when its fields were measured / said, or are the definition's own untouched default.
5. **Every external service is injected** (`services.ts`: channel, eyes, synthesiser, bricks, presenters, voices, runs,
   frames, curves, review, judge, improver, cloud, disk), so P0→P10 runs on fakes (`fakes/`) and in tests.
6. The contract files are frozen for that
   wave and changed only by the assembler.

## Consequences
- `src/main/production/creation/` stays until the assembler switches the screen; nothing else uses the new module yet.
- An improvement found while cloning goes into a definition field, a brick, a rule or a prompt (P8 `Change.cause`), so
  the next user gets it first time.
- Adding a style setting = one `SETTING_MAP` line reading a definition field; a setting that cannot cite a field is
  refused.
