# 0013. LLM routing: the user's Claude subscription OR Atelier credits (API), switch per team
Date: 2026-10-30. Status: accepted. Decided by: Charlie (production-1).

## Context
Scripts, the director, reviews and the agents need an LLM. Research of 2026-10-30 (sources below):
- **User's own subscription** through the unmodified Claude Code CLI on the user's own machine or own dedicated VM,
  signed in by the user: allowed by the Claude Code legal page, as long as Atelier never collects, stores or relays
  the login (no « log in with Claude » screen, no pasted `setup-token`). Risks: the Consumer Terms forbid
  « commercial or business purposes » (a monetised channel is one; Team/Enterprise plans are commercial), limits
  assume « ordinary, individual usage », and the policy moved five times in 2026.
- **Atelier's own Anthropic API key**, billed to users in credits: allowed under the Commercial Terms when Atelier's
  own code calls the Messages API as part of its product. Prohibited: hosted Claude Code or `claude -p` on Atelier's
  key for users, a shared Atelier-owned subscription.
- **The user's own API key (BYO)**: allowed (usage billed to the key owner).
- API prices per 1M tokens, input / output (cache read): Opus 5.5 4 $ / 20 $ (0,20 $), Sonnet 5.5 2 $ / 10 $ (0,10 $),
  Haiku 5.5 0,10 $ / 0,50 $ (0,01 $); batch −50 % (platform.claude.com/docs/en/about-claude/pricing, 2026-10-30).
  One 10-minute script plus one director pass: Sonnet ≈ 0,56 $, Opus ≈ 1,11 $, Haiku ≈ 0,03 $.

## Decision
- **Three backends behind the one `llm` interface**, chosen per team by a switch (« Mon abonnement Claude » /
  « Crédits Atelier » / « Ma clé API »):
  1. `subscription`: the Claude Code CLI on the team computer (the user's dedicated VM; in the beta, the owner's PC),
     signed in by the user in the CLI itself. Free for Atelier. Atelier never reads the token.
  2. `atelier`: Atelier Cloud calls the Anthropic Messages API with Atelier's key (vault), as a quoted job billed in
     credits per token (new Cloud usage and price lines). Never Claude Code on Atelier's key.
  3. `byok`: the user's own Anthropic key, encrypted with `safeStorage` (or in the team computer's vault), used only
     for that user's work. A Max/Ultra plan's monthly API credits are usable this way.
- **Defaults:** the app strongly recommends connecting one's own Claude account at the start (Charlie, 10-24: « on
  recommande fortement voir on oblige de connecter son compte claude code »; « le plus possible de choses, que ce
  soit le director »): a team with it connected runs everything on `subscription`. A team without it runs on
  « Crédits Atelier » (it costs the user more, as Charlie wanted). Charlie's own team runs on his subscription.
- **Rejected:** buying a Claude subscription in the user's name (Charlie's idea of 10-24, « on en achètera un. On lui
  mettra dessus son nom »): prohibited by Anthropic's terms (automation in account creation, paying for usage on the
  user's behalf). The « Crédits Atelier » backend replaces it.
- **Models per use** (same on every backend; overridable per recipe):
  - script writing, director: **Sonnet 5.5**;
  - simple passes (checks, translation, metadata, beat splitting, QC text): **Haiku 5.5**;
  - drafting a recipe for a channel (once per video type) and hard reviews: **Opus 5.5**;
  - the eyes (video understanding): **Gemini Flash-Lite** through the Cloud (`analyseVideo`), as today.
- **The agents** (long-running team work) run on `subscription` or `byok`; on `atelier` they spend credits under the
  team's caps (economy record) and a per-team concurrency cap.
- **Safety:** a kill switch per backend in the Cloud config; UI copy says « votre propre compte Claude » and never
  presents Atelier as Claude or Claude Code; re-read the Claude Code legal page before each public release.

## Consequences
- Atelier works for users without a Claude plan, and survives a change in Anthropic's subscription policy.
- Before charging money for the `atelier` backend: Charlie emails Anthropic sales with the architecture and asks for
  written confirmation (also listed in the production-5 report).
- production-3 wires the model per use; production-5 adds the `atelier` LLM usage, its price lines and the switch.

Sources (2026-10-30): code.claude.com/docs/en/legal-and-compliance; anthropic.com/legal/consumer-terms;
anthropic.com/legal/commercial-terms; anthropic.com/legal/aup; claude.com/pricing;
support.claude.com/en/articles/17154008; platform.claude.com/docs/en/about-claude/pricing.
