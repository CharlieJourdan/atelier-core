# 0040 — The beta sells and grants credits at cost; the founder console follows spending and profitability

Date: 2026-11-01 · Chantier: console-depenses · Status: accepted · Decided by: Charlie (his words of 11-01). Overrides the
20–50 % margin of 0015 until the end of the beta.

## Context
Charlie (11-01): « fais-moi un dashboard admin pour suivre les dépenses par user, la rentabilité, même si pour le moment on
n'a pas de user et que l'on donne des free credits, et que pour le moment sur les crédits on ne met pas de marge ».
The Cloud already stored the provider's real cost per call (`jobs.cost_usd`, written by every adapter), but a credit did not
say whether an admin gave it or a payment bought it, finished videos were only kits (deleted after their retention), and the
margin lived in each grid line only (0015), changed by a new grid.

## Decision
1. **At cost during the beta.** One global **price multiplier** (Cloud `finance_settings`, migration 017): a line costs
   `ceil(real cost × multiplier ÷ credit value)`, still never above the reference price; it replaces each line's margin and
   fixed price. **1.0 now (margin 0 %).** `null` hands pricing back to the grid's margin per line (0015). Changed without code:
   the console's « Réglages » or `npm run cloud -- admin margin set 1.3|grid`; never under 1, at most 5. A quote keeps the
   multiplier it was priced with (`quotes.price_multiplier`), so a measured job settles on its quote's rule. The engines'
   published prices (`GET /v1/engines`) follow it. An internal team still pays the real cost.
2. **Offered credits are tracked apart.** Every grant and correction says who paid it in (`wallet_entries.funding`):
   « offered » (admin grants and corrections: `admin grant`, the console's CRM) or « paid » (billing: plans, packs,
   top-ups). Old entries took it from their idempotency key. Spending uses the offered credits first: the offered credits left
   are `max(0, offered − spent)`; what they would cost us = credits × credit value ÷ multiplier.
3. **Money.** Provider costs are dollars (`jobs.cost_usd` per call, fractions of a cent kept; a call without a reported cost
   counts at its quote's cost, marked « estimé »); the console converts them with a **dated $ → € rate**
   (`admin fx set 0.92 --date …` or the console). Revenue = what billing charged (`billing_charges`, euro cents), so a free
   credit spent is a cost with no revenue. Margin = revenue − real cost. Fixed costs are cents in their own currency.
4. **The founder console's « Coûts et rentabilité »** (`/admin/couts`, platform admins only, `ADMIN_FINANCE_ROUTES`):
   the top line (offered credits left and their cost, this month's provider spend, the month's result, overrun alerts:
   real cost > quote + 10 %); per team (sortable; period today / 7 days / month / all): credits offered, bought, spent, real
   cost in € and $, revenue, margin, finished videos and minutes, cost per finished minute; per provider and engine: calls,
   failures (not billed), credits, real cost; spend over time; the monthly fixed costs (typed by the founder, plus two
   computed lines: the HeyGen plan from config.json `heygen.plan` and the team computers); the overall result of the month
   and the **break-even** in finished minutes a month (none at margin 0; shown at × 1.3 for reference). Calls the fakes
   answered count only when asked (« Compter les appels en démo »).
5. **Finished minutes** come from `finished_videos` (one row per video, written when its kit reaches the platform with its
   length; the app sends the run's `durationS` with the kit).

## Consequences
- During the beta, credits sold or granted equal provider cost: the console shows losses equal to what we pay; the fixed
  costs are not covered (break-even « jamais »). Ending the beta = `admin margin set <x>` or `grid`, no code.
- Tests written about the grid's margins run with `makeCloud({ gridMargins: true })`; their figures did not change.
- Revenue counts billing's charges: with the simulated payment the console says the revenue is not real money.
- production-14 (plans, packs, Stripe) builds on `funding = 'paid'` and on the multiplier.
