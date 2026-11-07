# 0019. The team computer: a keeper, a boot task without a session, nightly encrypted backups to the Cloud
Date: 2026-10-31. Status: accepted. Decided by: the agents-5 session (brief by Charlie: auto-start, crash drill, backups).

## Context
The team computer runs the agents 24/7. After a reboot nothing restarted it (the logon task was never installed, and a
logon task needs someone to log in), nothing restarted a brain that crashed, and its data (`atelier.db`, team files) was
backed up nowhere. It must work on this Windows PC today, on H1 (a dedicated server) tomorrow, and on a Linux host later.

## Decision
- **A keeper in Node, the same on every OS** (`src/main/headless/keeper.ts`): it runs the brain and restarts it when it
  dies, 1 s → 60 s, reset after 10 min of good run. Exit 0 (asked to stop), 2 (bad options) and 3 (port taken: a brain
  already runs; checked before the database is opened) are never retried. Under systemd it sits under `Restart=`.
- **Windows: a scheduled task at boot, S4U, running `node` directly** (not PowerShell: the Store's `pwsh` alias may not
  start without a session), plus a logon trigger as a second chance. S4U runs as Charlie's account with no stored
  password; it has no network credentials of Windows, which the brain does not need (outbound HTTPS only). Registering a
  boot task needs an administrator PowerShell: Charlie runs `install-task` once.
- **Backups belong to the team, are encrypted on the machine, and the Cloud cannot read them.** One archive (database
  snapshot by `VACUUM INTO` + team files) encrypted with AES-256-GCM under a key derived (HKDF) from the machine key. The
  machine key is therefore THE secret to keep off the machine; no separate backup passphrase (one secret, already
  handled by `team-pc.key`). The Cloud keeps 14 days and always the team's newest; any enrolled machine of the team can
  restore, so moving to H1 = enrol H1, copy the key, `restore latest`.
- **Not in a backup**: renders (the kits on the Cloud hold the finished videos), account logins (per machine), caches,
  the machine's Cloud credential and the direct-access token.
- **A restore never writes over a database**; it checks `integrity_check` and refuses a newer schema.
- Cloud migration **015** (`team_backups`), routes in `src/shared/cloud-backup.ts`.

## Consequences
- Losing `team-pc.key` makes every backup unreadable: the docs and the report say to keep a copy off the machine.
- The beta Cloud itself still starts at logon (`beta.ps1 install-task`): after a reboot without a logon the brain runs
  and waits for its relay (it reconnects by itself). Moving the Cloud's task to boot is the infra track's call.
- A backup holds at most 256 MB (team files over 64 MB are named, not taken); the videos are never in it.
