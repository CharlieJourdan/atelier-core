# Atelier — instructions for Claude Code (and any coding agent)

Atelier is an AI agent team plus its own video engine whose one objective is to reverse-engineer a YouTube channel's
PRODUCTION PIPELINE, then copy / translate / adapt / bend / mix it. Backend: engine (`src/engine/`), brain
(`src/main/`), Cloud (`cloud/`). The Electron renderer (`src/renderer/`) is the screen reference for a future web app.
Docs are in French; code, comments and commits are in English.

Start here: `README.md`, `docs/METHODE-REVERSE-PIPELINE.md` (the rules of a good copy), `docs/ARCHITECTURE.md`,
`docs/STRUCTURE.md`, `docs/ETAT.md`, `docs/DECISIONS-CLES.md`, `docs/decisions/`.

## Stack (rules)
- TypeScript strict everywhere; Electron + electron-vite; React 19; Tailwind v4 over CSS variable tokens; UI text in
  French through `src/shared/fr*.ts` (`t(key)`), English in `en*.ts`. Alias `@` = `src/renderer`. Strict CSP: no CDN.
- Data: SQLite through `node:sqlite`; schema changes only through numbered migrations (`src/main/db/migrations/`,
  Cloud `cloud/src/db/migrations/`); a published migration is never edited, removed or renumbered (decision 0004).
- IPC: ONE typed invoke channel (`atelier:call`) backed by the `api` object in main (`src/shared/api/`); every argument
  is validated with zod. Preload exposes only `window.atelier = { call, on }`.
- The engine never imports `electron` or `src/main/**` (lint rule `atelier/engine-boundary`). Spec: `docs/ENGINE-SPEC.md`.
- Cloud: Fastify + `node:sqlite`, run by Node's type stripping (imports carry `.ts`); HTTP contract
  `src/shared/cloud-api.ts` (zod). The Cloud is the authority on money (decision 0076).
- LLM: providers behind one interface (`src/main/llm/`): Claude Code CLI on the user's subscription, Anthropic API with
  a key, Codex CLI. Default ids `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`.
- OS-specific code goes through `src/main/platform/` (injectable, unit-tested with a simulated darwin).

## Commands
- `npm install`, `npm run typecheck`, `npm run lint`, `npm test` (vitest, includes `cloud/tests/` and the clean-room
  check), `npm run test:e2e` (Playwright Electron, needs a desktop session).
- `npm run cloud:dev` = Cloud on 127.0.0.1:8787 with fakes; `npm run cloud -- <cmd>` = admin tool (`vault set NAME`
  reads the secret without echo); `npm run smoke:cloud`.
- `npm run schemas` regenerates `resources/schemas/` (`engine-schema.test.ts` fails while stale).
- Engine proofs (system ffmpeg): `npm run engine:demo`, `engine:dialogue-demo`, `engine:avatar-demo`,
  `engine:story-demo`, `engine:motion-demo`; exit 0 = pass. `npm run orchestra:demo`, `npm run team-pc:drill`.
- `node scripts/cleanroom-check.mjs [--asar <app.asar>]`.
- Work is done only when `npm run typecheck`, `npm run lint` and `npm test` exit 0.

## Rules
- Never write to YouTube (no upload, no comment, no Studio automation). Reading public pages or the official read API is fine.
- Nothing paid without the owner's OK: `paidCalls` stays `off`; tests use fakes, never real API calls.
- No secrets in git, logs or test fixtures. Provider keys live in the Cloud vault; `.env.example` lists names only.
- Never weaken a test or change an expected value to make it pass; fix the code.
- Keep modules small (< 600 lines); one domain per file in `src/main/api/`.
- A third party's face or voice is never cloned; a stand-in look-alike is marked as a placeholder.
- Clean room (decision 0001): never open or copy from the third-party engine that the first version drove (its name is
  only in `scripts/cleanroom-check.mjs`), nor from any commercial app: no code, names, regexes, prompts, log formats,
  assets or style files. `scripts/cleanroom-check.mjs` must pass.
