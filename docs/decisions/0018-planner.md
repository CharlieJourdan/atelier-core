# 0018. The planner is code, works from confirmed goals only, opens a slot's work 5 days ahead and warns once
Date: 2026-10-31. Status: accepted. Decided by: Charlie (behaviour wanted: work picked up unasked, dropped threads followed
up, early alerts), the agents-3 session (mechanics).

## Context
With A2 each channel has standing goals and an approval level, but nothing turned them into work: the team only had three
routines. Charlie wants the Grok Bot behaviour: it picks up work before being asked, follows up dropped threads and judges
when to alert him (`docs/AGENT-RUNTIME.md` §24).

## Decision
- **The planner is deterministic code, not an agent.** It decides *what* is due and *when* (slots, steps, deadlines,
  budget, limits); agents only do the steps. No token is spent to plan.
- **Only goals Charlie confirmed are planned.** A draft (proposed) never makes the team work.
- **One key per slot and step**, written with its task in one transaction: idempotent across crashes and restarts.
- **A slot's work opens 5 days before it** (2,5 for a Short), not as soon as it is on the 7-day plan: the subscription is
  spread over the week and topics stay fresh. The slot and its video are on the plan 7 days ahead.
- **Budget is checked through the production port's quote** against the monthly credits minus runs and promised quotes;
  the planner never starts a run itself (B).
- **Expensive turns go after an account's reset** when the deadline allows; cheap work first.
- **An early warning is given once per slot and reason**, with the reason in plain French; a dead step is never relaunched
  by itself (no loop of new tasks).
- **Heartbeat:** one reminder for a question open 24 h; one follow-up task to the lead for a planned task stuck past its due.

## Consequences
- A4 (phone) carries the warnings and reminders to Discord; B plugs the production step into real runs and quotes.
- The step table (deadlines, durations, kinds) is in `orchestra/plan.ts`; a channel-level override can come later if
  Charlie wants other rhythms.
