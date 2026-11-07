# 0065. The team on the real production: one project per planned video, imported scripts fill the slots, a run's end reaches the team
Date: 2026-11-02. Status: accepted. Decided by: Charlie (QA sweep of 2 Nov., blockers A1, A2, A4, A5, B1, B8; chantier B
« agents-production ») + Claude.

## Context
The QA sweep of 2 Nov. found the team could never make a video:
`core.ts` wired `UnavailableProduction`, so the planner stopped after topic and script with « la production n'est pas
encore branchée » (A1). « Nouvelle vidéo » had no place for the owner's script and a run then failed on the engine's raw
« required inputs missing: script » (B1); the imported scripts made their own videos while the planner's slot videos asked
for new scripts (A2). A failed run told nobody (A5), « Tout arrêter » left fabrications spending (A4), and run videos stayed
`in_progress` forever (B8).

## Decision
1. **The app's production port is `AppProduction`** (`src/main/production/app-port.ts`), on the same projects and runs as the
   app's « Lancer la fabrication » (production-16). A planned video gets ONE project on its channel's pipeline (the recipe the
   channel uses, `recipes.useForChannel`); quote = the project's quote, run = the project's run. `UnavailableProduction`
   stays for tests of an unwired port.
2. **Demo by default.** A team run is a demo (nothing spent) unless `real: true` is asked, which `project.run` accepts only
   with Charlie's yes in the task (`ask_human`) AND a real quote within what is left of the channel's monthly budget (its
   goals); the pipeline's per-video cap is checked by the run itself (decision 0037). The director and the script keep the
   subscription rule of decision 0038 inside the engine.
3. **Imported scripts fill the slots.** « Nouvelle vidéo » offers « J'ai mon script » (paste, or a .txt / .docx file read by
   the main process, `projects.readScript`): a project with its `script` input. A planner slot's video takes the oldest such
   project of its channel not used yet (`projects.video_id`, migration 037; the video takes its title), and that slot skips
   the topic, its approval and the script. A pipeline that reads a script refuses to launch without one, in French, before
   anything is created (`MISSING_SCRIPT`); an engine that does not start says why in French too.
4. **Two tools for the leads and the production supervisor**: `project.prepare` (the video's project, a script attached as
   text or team file, the quote) and `project.run` (by project or by video). The planner's production step is done only when
   the video's latest run succeeded; a run still going (or at a gate) holds it, a failed one waits for its relaunch, a
   cancelled one or none at all is warned about.
5. **A run's end reaches the team** (`runs/video-status.ts`, `orchestra/production-news.ts`): the video follows its run
   (`in_progress`, then `ready`, `failed` — a new status, migration 037 — or `cancelled`; a published video is never
   touched); a failure is an inbox alert with the French reason, a message in the channel's room and in Atlas's
   conversation; the planner looks again at once.
6. **« Tout arrêter » cancels every fabrication still going** (queued, running or waiting at a gate), besides killing the
   turns; `StopResult.runsStopped` says how many.
7. **The fake team works the planner's steps with the real tools** (`src/main/agents/fake-team-steps.ts`, used by
   `ATELIER_FAKE_LLM=1`): it asks Charlie at his gates, attaches a script, prepares and launches the project.

## Consequences
- Proof: `tests/unit/team-production.test.ts` (3 imported scripts, 3 slots produced on fakes, approvals in the inbox, one
  forced failure in the inbox and Atlas, its relaunch, the stop) and e2e `team-script.spec.ts` (the form, a .txt file, the
  French refusal).
- The planner test's scripted team now makes its run through the port (a production step without a run is no longer done).
- An inbox answer may hold a whole script (60 000 characters).
- Not done here: the learning loop of chantier B (results → lessons), the watchers, Codex / API-key tools; a real day on
  Charlie's subscription (his go first). Chaînes › Automatisation still shows the older per-step choices (C2).
