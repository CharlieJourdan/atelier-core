# 0069 — Media sourcing: one interface, free sources first, a legal status on every candidate

Date: 2026-11-02 · Chantier: technos-medias

## Decision
1. **One sourcing interface** (`src/engine/sourcing`): `searchMedia(query, options, deps)` → ranked candidates for four kinds
   (`image`, `video`, `sfx`, `music`), each with a **legal status** (`public-domain`, `cc0`, `cc-by`, `cc-by-sa`, `free-licence`,
   `fair-use-excerpt`, `forbidden`), a **review flag** (`clear` / `human-review`), a credit line, a preview URL and a cost.
   Every free source costs 0. `forbidden` candidates are dropped before anything sees them.
2. **A provider is one small object** (`id`, `kinds`, `secret?`, `paid?`, `optIn?`, `search`). The catalog lists the keyless ones
   first; a provider with a key we do not hold is *skipped and named* (« set FREESOUND_API_KEY »), never an error. A **paid**
   provider is never called unless the caller passes `allowPaid` (Charlie's OK, per run); a **web-excerpt** provider (yt-dlp)
   only runs when named.
3. **Keys stay in the Cloud vault.** The sourcing code runs in the engine (keyless sources, locally) and in the Cloud
   (`POST /v1/media/search`, keyed sources, free only, no download, no billing). To let Node run the Cloud's TypeScript
   directly, the imports of `src/engine/sourcing/` and `src/engine/archive/` now end in `.ts`, and `tsconfig.node.json`
   enables `allowImportingTsExtensions` (a one-line change; the bundler and vitest accept it).
4. **Web and YouTube excerpts are read-only and never cleared automatically.** yt-dlp is called with fixed read-only arguments
   (no cookies, no login, no upload; a test checks every argument list), downloads only the asked range (45 s by default,
   120 s at most), and a clip is a `fair-use-excerpt` with `human-review` unless the uploader chose a Creative Commons licence.
   Nothing ever writes to YouTube.
5. **Relevance without paying**: a free heuristic (provider order, query words in title/description/tags, size or duration fit,
   licence) drops noise; an optional re-ranker and query expander use **Claude on the subscription** (`claudeReranker`,
   `claudeExpander`, `fast` tier, ~24 titles per call). CLIP-style local scoring is not built (see the benchmark, §7).
6. **A cache** (memory, optional JSON files, 24 h) in front of every provider call: Pixabay requires it, and a repeated
   query is free and instant.

## Why
- The documentary clone needs archives and footage first, generated images last (Charlie's orders of 2026-11-02): that is a
  *search* problem across many small, uneven, free APIs. One interface lets the director ask once and lets the credits and the
  publish check read one field.
- Legal status is the product's real risk with archive and web footage; carrying it as data (not as a comment in a prompt)
  means a video cannot be published with an unreviewed fair-use excerpt by accident.
- Several free APIs need keys or are blocked for scripts (Library of Congress and Gallica sit behind a Cloudflare challenge; NARA
  needs an emailed key; Pexels has paused new keys). The design absorbs that: a missing key is a skipped provider, a blocked
  host is reached through its mirrors (Europeana carries the BnF's open items, Wikimedia Commons mirrors LoC, NARA and the
  Bundesarchiv).

## Consequences
- New sources are one file in `src/engine/sourcing/providers/` plus a line in `catalog.ts`.
- The documentary style (clone-markets-2) can consume `searchMedia` once merged; wiring it into its director is that chantier's
  work, not this one's.
- NARA's answer shape is written from the documentation and is **not verified with a live key**; its candidates are always
  `human-review` until a run with the real key confirms it.


## Update (same day, Charlie's later orders)
- **Media choice is an agent's job.** `pickMedia` lets a Claude agent on the user's subscription browse the candidates (text, optionally a contact
  sheet) and choose the one that fits the spoken words, or say none: only a « none » is a gap to generate. Measured: 90 % right, 60 % the editor's best
  (20 beats).
- **The footage chain** (needs → search → Gemini shot log → code filter → pick → ranged download → scene-cut snapping → contact-sheet check) is built in
  `needs.ts`, `watch.ts`, `cut.ts`, `verify.ts`, `chain.ts`, with a cost ledger that refuses a paid call past
  the film's ceiling before it is made (`budget.ts`).
- **Gemini watching costs money**, so `POST /v1/media/watch` answers only internal or test teams, with `paidCalls` on and `GEMINI_API_KEY` in the vault;
  the cost is reported from the real token counts, not billed (no pricing work). The default ceiling is 0.5 $ per finished minute.
- **Music: free sources only, no Epidemic Sound** (Charlie). If the free libraries fall short, Atelier builds its own library.
- **Similar-item search for clones** is local and free (`similar.ts`: a difference hash plus a colour grid from ffmpeg); Claude judges the best few.
