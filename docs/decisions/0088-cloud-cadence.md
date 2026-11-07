# 0088. Ten productions of one team never fail on Cloud limits or throttled archives

Date: 2026-11-03. Status: accepted. Decided by: Claude (cloud-cadence), firm point from Charlie: « no blocker ever ».

## Context
vps-rendu's scale test ended 0/10 with the Cloud's default limits (300 requests a
minute per account, 20 media searches a minute): every package step waited its 2 minutes of 429 and failed. With the limits
raised it made 9/10; the tenth was a documentary whose archive searches came back empty because the public archives
throttled concurrent searches and the app took that for « nothing found » (#105, #106).

## Decision
1. **The app paces itself** (`src/engine/cloud-busy.ts`, `cloud-http.ts`):
   - a 429 is waited for as `Retry-After` asks, +0–25 % jitter, for up to 5 minutes per request (was 2);
   - the wait is **shared**: once one request of the process is told to wait, every request to that Cloud (per class: media,
     uploads, the rest) waits with it and leaves staggered by up to 0.5 s, so N productions do not hammer a Cloud that asked
     for a pause;
   - at most 4 media searches at once per Cloud from the process; uploads stay at 4;
   - job polls back off to every 4 s (was 3 s), ±20 % jitter, so jobs started together do not look together.
2. **The Cloud's per-account limits fit N productions**: `DEFAULT_REQUESTS_PER_MINUTE = 1200` (was 300) and
   `DEFAULT_MEDIA_SEARCHES_PER_MINUTE = 120` (was 20), both in `cloud/src/http/limits.ts`, configurable
   (`requestsPerMinute`, `mediaSearchesPerMinute`). Sizing: a running job is polled at most 15 times a minute; ten productions
   with up to four jobs each stay near 600 requests; a search is cached and costs nothing, ten productions ask well under 120 a
   minute. Abuse protection is unchanged in kind: still per account, still `429` + `Retry-After`, a flood of refused tokens is
   still stopped per address (1200 a minute), the 400-open-jobs-per-team cap, the spend alerts and the wallet's atomic holds of
   decision 0076 are untouched. A raised limit moves no money.
3. **A throttled archive is not « nothing found »** (`src/engine/archive/`):
   - every archive request goes through one gate per host (3 at once, shared by the whole process) and a 429 / 502 / 503 / 504
     is asked again up to 3 times (`Retry-After`, else 0.4 s × 2ⁿ with jitter, at most 15 s) before it is an error;
   - when every source that answered found nothing but one failed, that source is asked once more after a pause;
   - the failure stays in `errors`; the run counts it (`archive-trouble.ts`); `visuals.fulfil` says « Aucun média n’a été
     trouvé » only when every source truly answered empty, otherwise it fails as a retryable (`transient`) error: « Les archives
     publiques n’ont pas répondu ». The next source (the Cloud's stock chain) is still asked for each item.

## Consequences
- Proof: N=10 on the fake remote with the **default** limits: 0/10 before → 10/10 in 119 s after (no raised limits).
- Tests: `tests/unit/archive-throttle.test.ts`, `cloud-busy.test.ts` (shared pace), `cloud/tests/cloud-cadence.test.ts`.
- Not measured: a real Cloud under a real team. Re-measure on the real server (`docs/DEPLOY.md`) and adjust the two numbers.
