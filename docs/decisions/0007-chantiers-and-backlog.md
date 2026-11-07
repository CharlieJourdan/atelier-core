# 0007. One chantier per session; backlog in GitHub
Date: 2026-10-30. Status: accepted. Decided by: Charlie.

## Context
Long sessions that read every doc were slow and expensive. The state was spread over a 275 KB log, a recap and a
checklist. The app goes to a few testers, then to Charlie's CTO.

## Decision
- One chantier = one Claude Code session = one branch/worktree. Its brief is a file that starts
  with an exact « Lis seulement » list and ends with a proof of done and a report format.
- The backlog lives in GitHub issues: one label per track, milestones « Bêta Charlie », « Testeurs »,
  « Passation CTO », and a board.
- The current state is `docs/ETAT.md` (short). Lasting decisions are records in `docs/decisions/`.

## Consequences
- A chantier closes its issues, rewrites `docs/ETAT.md`, and updates its track's line in the roadmap.
- Nobody appends to the archived log any more.
