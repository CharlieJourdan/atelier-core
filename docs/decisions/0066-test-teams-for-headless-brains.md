# 0066. Our test brains sign in with a test team's key, never with a person's sign-in

Date: 2026-11-02. Status: accepted. Decided by: Charlie (02/11, through the coordinator: « create a dedicated TEST team so our
test brains never wait for his sign-in again ») + Claude (test-team).

## Context
Real paid tests (style samples, full videos) run on headless brains. Each one had to be signed in to the beta Cloud by the
device flow, which needs a person to open a link and type a password: the samples waited a night for Charlie. A shared
person's account would mix test spend with his own and give the brains his password.

## Decision
1. `npm run cloud -- admin test-team create --name N --credits C --key-file PATH` makes a team marked `test` (migration 019,
   `teams.test`; also `internal`: at cost, out of the customers' P&L), grants C credits noted « crédits de test », and adds ONE
   member whose password hash is `NO_PASSWORD`: no password ever matches it (same scrypt cost and error as an unknown address),
   `setPassword` refuses it, so no browser sign-in and no reset. Its address is on `tests.atelier.invalid` (no e-mail is
   delivered).
2. The command issues a **brain key** (`attb_…`, 48 random bytes), writes it alone to PATH (mode 0600, refused if the file
   exists) and never prints it; the Cloud keeps its SHA-256 only (`test_brain_keys`), valid 365 days. `key` adds one, `list`
   shows teams and keys without values.
3. A brain started with `--token-file PATH` (and `--cloud-url`) exchanges the key (`POST /v1/auth/test-brain`) for the usual
   device tokens (access 1 h, refresh rotated) on a new device of **that team only** (« Cerveau de test — <machine> »). The
   key stays in memory; when the tokens die (device revoked, refresh refused) the session exchanges it again. Several brains
   can share one key file: each exchange is its own device, so one brain's refresh never collides with another's.
4. `admin test-team revoke --team T` revokes every key and every device of the member at once: running brains are refused at
   their next call, the key cannot be exchanged again. The team and its history stay.
5. The founder console shows such a team as « équipe de test » (CRM) and « test (crédits de test) » (costs).

## Consequences
- The operator runs `create` once on the beta and puts the file at a token file outside the repo; every test brain
  uses it. Spend stays visible per team; nothing in a test can touch a customer's or Charlie's own credits.
- Anyone with the file can spend the test team's credits: keep it outside git and logs, cap the credits, revoke on doubt.
- Not done: a console button to revoke (the CLI does it), per-key spending caps.
