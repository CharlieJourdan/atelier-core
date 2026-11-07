# 0006. The beta runs on the owner's PC behind Tailscale Funnel
Date: 2026-10-25. Status: accepted; the host is to move to H1. Decided by: Charlie.

## Context
No domain and no server are bought yet, but the owner and a few testers need a live Cloud and site.

## Decision
- The beta runs from a frozen git checkout outside the repo. Data and the vault key live in other folders outside the repo. Tailscale Funnel publishes the site (443) and the Cloud API (8443).
- `paidCalls: off`, `payments: fake`, `mail: fake` until Charlie decides otherwise.
- The same PC is the beta team's « team computer » (headless brain, port 8795).
- Deploying is explicit: `beta.ps1 deploy <ref>`, which copies the DB first.

## Consequences
- When the PC sleeps, the beta is offline. A real server later follows `docs/DEPLOY.md` (same code, new address).
- Chantiers never touch the beta checkout or its secrets folder unless their brief says so.
