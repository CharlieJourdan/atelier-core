# 0105. A source that costs us nothing costs the user nothing

Date: 2026-11-04. Status: accepted. Decided by: Charlie (audit of the beta Cloud database) + Claude (audit-depenses).

## Context
Reading the beta Cloud database, Charlie found 195 Pixabay searches billed 1 credit each although Pixabay bills us nothing.
Cause: the grid line `stock.searches` priced our own « glue » at 0.002 $ (margin 50 %), and every line has a one-credit
minimum, so a free search was worth 1 credit. Decision 0003 says users are charged our real cost, and (until a pricing policy
is decided) no margin. The same audit found a MiniMax voice clone (1.50 $) nobody authorised: `channelVoices.fromChannelVideo`
cloned on MiniMax HD whenever no engine was named (issue #109, fixed by 4164e75a; now covered by a test on that path too).

## Decision
1. A price line whose provider cost is 0 (and which is not a fixed price) is **0 credit**, whatever the quantity, the margin,
   the global multiplier or the team. The one-credit minimum stays for every line we pay for, including a measured quantity
   of 0 on a paid line (a saved voice preview). A fixed price is a decision and is charged as written.
2. `stock.searches` (Pixabay, Pexels, Wikimedia Commons, Wellcome, the Met, NASA, Internet Archive and every keyed or keyless
   archive behind `searchStock`) and `channel.request` (YouTube Data API reads) therefore cost 0 credit. A quote may be worth
   0 credit: Cloud migration 020 loosens `quotes.total_credits >= 1` to `>= 0` (a CHECK edit through `writable_schema`, no row
   touched). A 0-credit job opens no hold and captures nothing, so it runs with an empty wallet.
3. Abuse protection is unchanged and does not depend on price: at most 400 open jobs per team, the per-provider concurrency
   cap, the per-account request limit (decision 0088, 0076 §3). A new free source must be added to the grid with cost 0, and a
   source that starts to bill us must get its real cost in the grid first.
4. The only paid voice engine for a clone is ai33 Pro (standing order 2026-11-02). MiniMax is cloned only when a caller names
   it with a quote shown, as in the dedicated « Voix · clones MiniMax » chantier.

## Consequences
- Deploy check: the beta grid (v1, checked in the database copy of 2026-11-04) has no `stock.searches` row, so it takes the new
  default. A grid published later stores the row it had: after any `admin price set`, run `admin price set stock.searches --cost 0 --margin 0`.
- Accepted risk (review): `channelData` is now 0 credit too, and the YouTube daily quota is shared by the whole Cloud; only the
  per-minute request limit and the open-jobs cap hold a single team back. A per-team daily cap is a follow-up if it shows.
- The beta grid (version 1 + late items) takes the new default at the next Cloud deploy; no new grid version is needed. Old
  quotes keep their stored price.
- The 146 + 49 credits already billed for Pixabay in the beta were test credits of the internal test team; nothing to refund.
- The spend by provider, per day, from the database: a spend report kept outside the repo (29.21 $ since
  2026-11-03 18:00 UTC; 58.10 $ for the whole beta).
