# 0076. Money is the Cloud's: the client is fully trusted with pipelines and not at all with prices

Date: 2026-11-02. Status: accepted. Decided by: Charlie (brief of securite-agents) + Claude.

## Context
Users, through their agents, must be free to customise their pipelines as far as they like, but never change prices or
credits, alter the app's code from inside, reach free or cheaper runs, make prices run away or block production. An agent
may have full access to its user's machine: it can read the asar, edit the database, call every IPC method and send the
Cloud any request with the user's tokens.

## Decision
1. **The Cloud is the only money authority.** A quote is priced from the Cloud's grid on a measure the Cloud computes from
   the parsed input, stored with that input, used once, within 30 minutes, by its own team; a job runs the stored input. A
   capture never exceeds the hold. No request carries a price, cost, credit amount, multiplier, paid or test flag; extra
   fields are dropped. Client gates (`capCredits`, approvals, local caps and prices) are conveniences for an honest app.
2. **A client-declared quantity is either measured or enforced by the Cloud.** A talking avatar's `seconds` may not be
   shorter than its uploaded voice (the Cloud reads the WAV header; only PCM WAV is accepted); a GPU job's pod gets RunPod's
   `executionTimeout` = its quoted `estimatedGpuSeconds` + 60 s, and a time-out is final.
3. **No team can block another.** At most 400 open jobs per team (`rate_limited`, the app waits); the queue starts teams in
   turn (fewest running, then the one that started longest ago), each team in its own order (`cloud/src/job-queue.ts`).
4. **Through the relay a plain member drives production, not the machine.** `RELAY_ADMIN_METHODS` (keys, Cloud and brain
   links, spending caps, prices, settings, team, integrations, updates) are refused to the `member` role.
5. **Pipelines stay code in the engine, settings stay data.** Recipes are zod-strict with each technology's own zod
   `params`; refs are regex-bounded; no expression, code or shell. The generic `settings.set` refuses the caches the main
   process writes from the Cloud (`engines.*`, `blueprint.*`), malformed names and values over 64 KiB. External tools get
   user links after `--` (yt-dlp).

6. **No dumb caps on big spenders.** Hard stops: an empty balance (atomic holds), a member's own caps, the per-job maximum,
   fraud signals. Unusual spend (24 h over 5× the usual day and over 50 000 credits) raises a console alert, an audit entry
   and an e-mail asking the team to contact support if it was not them, once a day; it never blocks (`spend-watch.ts`).
7. **What the user's agent may change** is the pipeline's composition, as edit operations on a new version the user accepts
   or refuses: drop or add parts made of existing bricks, the presenter's curve, the mix, the charter's colours, options and
   settings each technology exposes. Never prices, credits, engines outside the catalogue or engine code (tested both ways).

## Consequences
- A user can still overspend their own money through their own agent; the bounds are the wallet, member caps, 100 000
  credits per job, the automatic top-up's monthly cap and the rate limits.
- Not done (threat model §5): a hold per engine (needs per-engine pricing, which Charlie paused), member caps on work run
  through a team computer, a Cloud-side run budget.
- Any new usage must say how the Cloud measures or enforces each quantity of its input before it ships.
