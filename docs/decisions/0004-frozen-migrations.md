# 0004. Migrations on `proto` are frozen
Date: 2026-10-25. Status: accepted. Decided by: Charlie, when the beta got real data.

## Context
The beta has real accounts and data. Both migration runners apply every number above the highest one already
applied, so a renumbered or lower migration would be silently skipped.

## Decision
- A migration that is on `proto` (app `src/main/db/migrations/`, Cloud `cloud/src/db/migrations/`) is never
  renumbered, edited or removed.
- A branch whose number collides takes the next free number before it merges. The Cloud refuses gaps.

## Consequences
- A bad migration is fixed by a new one. Comments inside old migrations stay as they are, even when they cite a doc
  that moved.
