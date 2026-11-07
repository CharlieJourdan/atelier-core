# 0003. Paid work goes through Atelier Cloud, billed in credits
Date: 2026-10-21. Status: accepted; prices, margins and caps are revisited as the economy is measured. Decided by: Charlie.

## Context
Users should not manage a dozen provider accounts and keys, and Charlie must never be surprised by a bill.

## Decision
- Atelier Cloud (`cloud/`) holds provider keys in an encrypted vault and is the only caller of paid providers.
- 1 credit = 0,01 €. Every paid call is a quoted job: quote → hold → capture (or release).
- A real provider runs only when ALL of these hold: `paidCalls` on in the Cloud `config.json`, the provider chosen
  there, its key in the vault. Otherwise the fakes answer, for free.
- The Cloud's HTTP contract is `src/shared/cloud-api.ts` (zod). Fastify is a devDependency: the Cloud is never in the
  app bundle.

## Consequences
- Tests and demos never call a paid provider. Real calls only go through `npm run cloud -- providers try …`, run by
  Charlie himself.
- A new provider = an adapter in `cloud/src/providers/`, a fake, a price line, and a section in `docs/PROVIDERS.md`.
