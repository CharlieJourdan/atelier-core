# 0005. Private GitHub; `proto` is the integration branch
Date: 2026-10-25. Status: accepted. Decided by: Charlie.

## Decision
- The code lives on the private repo `CharlieJourdan/atelier` (remote `origin`). Never on a public repository.
- `proto` is the integration branch. Each chantier works on its own branch and merges `--no-ff` into `proto` when its
  gates pass, then pushes `origin proto`. Never force-push.
- Commits use explicit paths (`git add <paths>`), never `git add -A` or `git add .`.

## Consequences
- The backlog (issues, labels, milestones, board) lives in the same repo (0007).
