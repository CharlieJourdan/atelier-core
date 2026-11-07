# 0090. On a « tout automatique » channel the team produces for real alone; a run's gates follow the level; the topic is the run's
Date: 2026-11-04. Status: accepted. Decided by: Claude (chantier production-equipe, the handoff's acceptance test 2.4:
« the agent team produces real videos with no blocker »).

## Context
The first real day of the team on an imported channel (Marcel, avatar@1)
showed it could not finish a video without a human: a real run needed Charlie's yes in the task even on « tout
automatique » (decision 0065), a team run stopped at the recipe's owner checkpoints, the topic the team chose never
reached the run (avatar@1 then wrote about the slot's placeholder title), a refused video could not be remade, and the
team misread its money (local ledger at 0, the subscription's token-equivalent read as spend).

## Decision
1. **Real runs alone** when Charlie confirmed the channel's goals at a level that leaves the production to the team:
   « tout automatique », or custom without the `voice` and `video` gates (`goals.realRunAllowed`). The confirmed monthly
   budget is his authorisation; `project.run` still refuses a quote above the budget left. The recommended level keeps
   decision 0065 (his yes to the real engine).
2. **A team run's owner gates follow the channel's level**: each waiting node is mapped to a goal gate
   (`gateOfNode`: research/topic → topic, script, voice, thumbnail, package → kit, everything else → video); the planner
   passes the ones the level does not gate (or a « toujours » rule covers), event `auto-approved`, within a minute.
3. **An approval by the level takes the question's first option** (the agent's recommended choice, as « toujours
   valider » does) and the next turn reads it as the decision; it is still never Charlie's yes.
4. **The topic is the run's**: `project_prepare` saves `title` + `idea` on the video and its project; the planner saves
   a topic a step stated but did not save; `project_run` refuses a video still on its placeholder; on a pipeline that
   writes its own script, the team's outline is the idea. A slot's video is made at its goals' length.
5. **No silent dead end**: a refused QC holds the slot and gives the lead one « Refaire la vidéo » task (a new project:
   `project_prepare fresh`); a production step that launched nothing gives one « Lancer la fabrication » task.
6. **The team sees its real budget**: each channel's credits this month against its budget; Claude turns are said to be
   on the subscription. `brain-run start --mcp` gives a session's test brain the agents' tools.

## Consequences
- Proof: `tests/unit/team-autonomy.test.ts` (11 tests), `autopilot-goals.test.ts` (the option), `brain-run.test.ts`
  (`--mcp`); real: video #2 made, reviewed and held by the team with no manual step, budget refusal of the remake.
- `team-production.test.ts`: a run's package gate is now passed by Charlie or the level (same total).
- Left: issues #107–#110 (script patterns into avatar@1's writer, quote calibration, voice clone engines, Atlas and QC).
