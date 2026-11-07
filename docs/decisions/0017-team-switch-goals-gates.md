# 0017. The team's switch, standing goals on channel create / import, approval levels enforced by the runtime
Date: 2026-10-31. Status: accepted. Decided by: Charlie (target, triggers, default gates), the agents-a session (mechanics).

## Context
Charlie wants « a Grok Bot, with Claude as the engine and Atelier as the skeleton » (`docs/AGENT-RUNTIME.md` §24): a team
that works 24/7 on its own computer, comes back only for approvals, and that he can switch on, watch and stop. Until now
`orchestra.enabled` was read only at start, nothing stopped a run, and channels had no goals the agents could read.

## Decision
- **Never before Claude.** The background loop runs only when the team is on AND an account passed « Vérifier »
  (`state = ready` with a check time). Switched on without one, the team is `blocked` and starts by itself after the check.
- **Live switch, persisted.** Off / on / paused-until live in the settings and apply at once; a pause survives restarts and
  ends by itself. **« Tout arrêter »** kills every run and requeues its task **without spending an attempt** (a stop is
  Charlie's choice, not a failure), then switches off.
- **Goals are triggered by two actions only**: creating a channel or importing one (first link to a YouTube channel id).
  Each proposes once: a baseline computed in code (own rhythm for an import, else the watched competitors' median; time
  AND budget in credits), then the lead refines it with `goals.propose` until Charlie confirms. Confirmed goals are final
  for the agents (the tool is refused); only Charlie changes them.
- **Approval levels are enforced by the runtime, not left to the agents' goodwill.** A validation carrying a gate the
  channel does not gate is approved at once, with no inbox item; default level « recommandé » = topics and thumbnails;
  « tout automatique » = zero question. A question without a gate always reaches Charlie.
- Budget estimate: 100 credits per produced minute until production-5 quotes for real.

## Consequences
- The rich onboarding « Objectifs » step (paused, 0009) will reuse `autopilot.goals` / `saveGoals`.
- A3 (planner) works backwards from confirmed slots and budgets; A4 adds standing-allow rules on top of the gates.
- The production gates (recipe checkpoints, 0016) and these gates must converge when B plugs the team into production.
