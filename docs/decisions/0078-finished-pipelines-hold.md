# 0078. Finished pipelines hold: one runner for real runs, watchdogs, one quote with a ceiling, nothing silent

Date: 2026-11-02. Status: accepted. Decided by: Claude (chantier solidite), from Charlie's order of 2026-11-02: production and
agents must never be blocked; a finished pipeline never stalls or stops half-way, keeps its quote, and is hardened by many
automated tests rather than rigid rules.

## Context
The evidence of 01–02/11: every Claude session invented its own RPC script for a paid run (and each was stopped by its
permission check); the Cloud took about twice the quote the owner had seen on 1-minute runs; a node that hung (ffmpeg, a
browser render, a provider) kept a run « running » forever; a run killed by a crash stayed « interrupted » in silence; a job
the app gave up on was still captured while a fallback engine was paid for the same item; one demo item put « DÉMO » over a
whole real film; the avatar's clip-share slider silently undid the recipe's own share (round 2 rendered as round 1); word
captions drifted on story shorts read at 310 words a minute; `engines.list` said « demo » for engines served for real (#88).

## Decision
1. **One runner for real runs: `node scripts/brain-run.mjs`** (BRAIN-HEADLESS §11). It starts or reuses the test team's
   headless brain, quotes, refuses to start above `--max-usd`, cancels a run that spends past it, stops loudly on a gate, a
   failure or a stall, and prints one JSON report. One permission rule covers it: `Bash(node scripts/brain-run.mjs:*)`.
2. **Nothing waits forever.** Each node attempt has a watchdog (quiet 30 min or 3 h in all, stretched to 4× its estimate):
   stopped (its process tree killed), retried, then failed `stalled` with its name. Every provider call on the Cloud has a
   deadline (2 h, GPU 12 h). A Cloud job the app gives up on is cancelled there; a job a Cloud restart cut short is retried; a
   failed look or download is retried instead of falling back to another engine. A worker whose parent died stops.
3. **Nothing ends half-done in silence.** After a crash or restart, an interrupted run resumes by itself on the team
   computer (`autoResume`, 3 attempts in all, a real run waiting up to 2 min for the Cloud sign-in) or the team hears of it
   with the reason (inbox, room, Atlas). A stored result whose files were deleted is made again.
4. **One quote, and a ceiling.** The quote shown before a launch and the quote a run holds itself to read the same prices
   (`runPrices`: the Cloud's engines), each brick priced on the engine it names. A real run whose real captures pass
   `ceil(quote × 1.25) + 5` credits (`CAPTURE_TOLERANCE`) stops at once with the reason: at most the job that crossed the line
   is paid above the quote.
5. **No demo item in a real film.** On a Cloud whose paid calls are on, a real run's job answered in demo is refused (next
   engine, then the gap, or a clear failure). A Cloud with paid calls off still makes whole demo runs.
6. **No silent override.** A slider nobody moved leaves a value the recipe set itself; one moved on purpose replaces it and the
   override is listed (`recipes.check`, `projects.compile`) and kept in the run's notes (migration 038).
7. **Captions follow the voice at any pace.** Without provider times or a recogniser, a sped-up voice's words are timed at
   natural speed on the same cut, then follow the stretch.
8. **`served` says real** when paid calls are on, the engine is in `realEngines` and its key is in the vault (#88).

## Consequences
- Proofs: `tests/unit/brain-run.test.ts`, `engine-watchdog`, `runs-restart`, `cloud-job-stalls`, `cloud/tests/cloud-job-deadline`,
  `quote-capture` (every base pipeline on stand-in engines billing their declared prices), `demo-items`, `option-overrides`,
  `caption-sync` (150 to 400 words a minute), and `npm run pipelines:soak` (every base pipeline N times under random faults).
- Stand-in engines (`tests/unit/pipeline-bench.ts`): keyless « real » adapters with the engines' ids that answer with the fakes'
  media and bill their declared prices, so quote against capture is measured offline as on the beta.
- A run on a development Cloud (paid calls off) is billed at the grid in play money: only real captures count for the ceiling.
- Not done here: the quote still assumes no remake (regenerations, owner change requests); a run-level ceiling before a job
  starts (today the line is checked as captures arrive); engine-aware holds on the Cloud (holds still use the generic grid).
