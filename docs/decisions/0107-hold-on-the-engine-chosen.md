# 0107. A step reserves its engine's price, not the grid line's worst case

Date: 2026-11-05. Status: accepted. Decided by: Claude (chantier reserve-devis), issue #89; no pricing-policy change.

## Context
On 2026-11-04 a 3-minute Marcel real run quoted 311 credits failed at « Clips » with « Crédits insuffisants » on a wallet of 395: the
step asked ≈ 619. The run's quote prices each brick on the engine it names (`pricesFor`, decision 0078 §4), but two other places priced
the same work on the grid line of the usage (`video.seconds`, `image.count`…), which is far above the cheap engines (a Veo 3.1 Lite
relaxed clip is ≈ 8 credits against ≈ 25 for 5 s on the line): the app's per-step check (`CreditSpender` → `POST /v1/estimates`) and the
hold of every Cloud job (`POST /v1/quotes`, the hold IS the quote). Decision 0076 listed « a hold per engine » as not done.

## Decision
1. **The Cloud prices an item on the engine it names.** `engineLineCredits` (`cloud/src/providers/engines.ts`) turns a quantity into
   credits on a declared engine of that usage with the price `GET /v1/engines` already publishes (cost × dollar rate × overhead × the
   global multiplier, or the line's margin; an internal team at cost), by the engine's unit: second, image, 1 000 characters, or a call
   of at most `maxSecondsPerCall` (a clip engine billed per clip: `ceil(seconds / 8)` calls; a per-second clip engine is held at the length it really makes, `clipLengthFor`, so a 1 s ask on a 6 s engine holds 6 s). The stored quote cost follows the engine, so the finance overrun alert still compares a job with it. `POST /v1/quotes` uses it when the input
   names an engine (so the job's hold is that price) and `POST /v1/estimates` takes an optional `engine` per item. No engine named, an
   unknown one, or a unit that does not convert: the grid line, as before. An engine dearer than the line is quoted dearer (the user
   pays the real cost; the Cloud no longer pays the difference, #89). Money stays the Cloud's: the app sends an engine id, never a price.
2. **The app asks for the engine the run was quoted on.** `CreditSpender` sends, per priced unit, the engine the node names when it is of
   the unit's family, else the family's default (`engineOfUnit`, the same rule as `pricesFor`), so a step reserves what its own quote line
   says; settling prices the real units the same way. The scheduler gives the spender the node's params.
3. **A run never reserves past its quote's ceiling.** A real run's `CreditSpender` knows `captureCeiling(quote)` (× 1.25 + 5, decision
   0078) and what earlier attempts spent; a step whose price would take reservations plus spend past it is refused before it starts
   (`budget`); it counts the attempt's own reservations, not what an earlier attempt captured (a node run again may reuse its jobs). The existing after-the-fact stop (`stopIfOverQuote`) stays as the net. A zero-credit step is never refused by it.
4. The balance can never be exceeded: unchanged — the wallet check before a step, the atomic hold at each job, and a capture never
   above its hold.

## Consequences
- Proofs: `cloud/tests/cloud-engine-hold.test.ts` (quote, estimate and job hold on the engine; six cheap clips fit a 50-credit wallet the
  line would refuse; a hold over the balance is refused; a charge never passes its hold), `tests/unit/credits-quote-line.test.ts` (the
  311 / 395 case on an in-process Cloud, the run ceiling, the wallet guard), `tests/unit/quote-capture.test.ts` (a whole avatar@1 run
  with only the quote's ceiling in the wallet).
- A job that names no engine (a brick with no pin) is still held at the grid line, while its step is checked at the family default's price, as the
  quote reads it: the bricks of the bases pin their engines, and pinning is how a hold follows the engine. Left as is on purpose.
- Not done: the real-money re-run of the Marcel example (Charlie's OK needed).
