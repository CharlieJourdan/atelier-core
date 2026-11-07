# 0020. The phone is Discord: a thread per question, buttons over the gateway, « toujours » is a rule per channel and gate
Date: 2026-10-31. Status: accepted. Decided by: Charlie (behaviour wanted: talk to the team from the phone like coworkers,
be notified only when it matters, approve with allow once / deny / standing allow), the agents-4 session (mechanics).

## Context
Atlas on Discord was built (rooms, approvals by ✅ ❌, run announcements, daily summary) and never switched on. The Grok
Bot behaviour Charlie wants (`docs/AGENT-RUNTIME.md` §24) adds threads that continue across desktop and phone, approvals
« allow once / deny / always allow », and notifications only when a decision waits.

## Decision
- **Discord stays the phone** (no mobile app, no e-mail). One room per channel already exists; **each question gets its
  own Discord thread** on its message in `#à-valider`. Open question: a word there is the answer. Settled: it goes to the
  agent who asked, like `orchestra.say`, and its reply comes back in the thread.
- **Buttons arrive over the gateway** (a minimal WebSocket client, no intent), not over an HTTP interactions endpoint: the
  team computer has no public HTTPS address for Discord and must not need one. The rest stays pull-based REST. While the
  gateway is down, ✅ ❌ reactions and replies keep working (no decision is ever blocked on the live connection).
- **« Toujours valider » is a standing-allow rule per channel and per gate**, optionally limited to a series or a number
  of uses, read by the same gate check as the approval levels (A2). It never applies without a channel, keeps the « 2 per
  gate per task » limit, and is never Charlie's yes for `production.approve` / `channel.create`. Charlie sees and removes
  his rules in the channel's « Objectifs et validations ». Making a rule also answers the questions already waiting that
  it covers (that is what « always » means to him).
- **Notifications:** only what waits for a decision pings (a real mention); everything else is posted silent. Levels
  `important` (default), `everything`, `nothing`.
- **Reports are code** (no model call): daily digest and weekly report from the planner's slots and warnings, the inbox,
  the queue, the events and the ledger — the same numbers in the app and on Discord.

## Consequences
- Migration 028 (`orch_allow_rules`, `orch_inbox.gate / channel_id / series`).
- The bot's invitation asks two more permissions (create public threads, send in threads); a bot invited before needs the
  new link, else questions arrive without a thread (and the bridge says so).
- Turning the real bot on is Charlie's: he creates it in the Discord developer portal and types its token in Réglages ›
  Discord (never in chat); « Interactions Endpoint URL » must stay empty so the clicks come over the gateway.
