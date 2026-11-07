# 0001. Clean room
Date: 2026-10-20 (lot P1). Status: accepted. Decided by: Charlie.

## Context
Atelier v1 drove a third-party video engine, and its first feature map was written by observing a commercial app.
Atelier will be sold, so no part of it may derive from either.

## Decision
- No code, names, assets, branding, regexes, prompts, log formats or style files from the third-party engine or the
  observed app. Never open the engine's source.
- What we need from their behaviour is described in our own words (`docs/ENGINE-SPEC.md`).
- `node scripts/cleanroom-check.mjs` scans source, scripts, tests, docs and root files. It runs inside `npm test` and
  on packaged apps (`--asar`). Only a short explicit list of archived docs may still name the old engine
  (`HISTORICAL_ALLOW`), never its internals.

## Consequences
- Every chantier runs the check before merging. A new doc never gets an allowlist entry.
- A new provider or technology is written from public documentation only.
