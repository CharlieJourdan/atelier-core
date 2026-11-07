# 0039 — Charlie's providers of 2026-11-01, the cost ladder and HeyGen on its plan (production-10)

Date: 2026-11-01 · Chantier: production-10 · Replaces the provisional list of 0014 for the avatar pipeline · Status: phase 1
(fakes); the real tests of phase 2 confirm or move the prices.

## Decision
1. **Providers per brick, principal first** (prices: `cloud/src/providers/engines.ts`, sources in pipeline-avatar §9):
   - presenter: HeyGen Avatar IV Photo Look on Charlie's HeyGen plan through HeyGen's remote MCP server
     (`presenter:heygen-mcp`) → HeyGen API (`heygen-avatar4`, now API v3) → Pruna P-Video Avatar on WaveSpeed → Kling AI Avatar
     standard on Kie.ai → InfiniteTalk on RunPod. Hedra and Kling-on-fal stay in code, out of the default chain;
   - clips: Veo 3.1 Lite « relaxed » on UnificAlly (15 minutes per clip, then the next engine) → Vertex AI Veo 3.1 Lite without
     audio → Kie.ai Veo 3.1 Lite;
   - stills: GPT Image 2.5 on OpenAI → the same model on fal → Kie.ai; the edit endpoint with the portrait when the presenter acts;
   - voice: ai33.pro → MiniMax speech-2.8-hd (MiniMax also designs voices); ElevenLabs and Fish stay in code, out of the chain;
   - music: none for now; LLM: not this chantier.
2. **HeyGen on its plan.** The Cloud is an MCP client (official TypeScript SDK `@modelcontextprotocol/sdk` 1.32.1, a Cloud
   devDependency like Fastify, never in the app bundle). The founder signs in once (`npm run cloud -- providers signin heygen`:
   OAuth 2.1, PKCE and dynamic registration done by the SDK); the client and tokens are ONE vault entry `HEYGEN_MCP_OAUTH`,
   written back by the job when the SDK refreshes them (`ProviderContext.saveSecret`). A failed refresh fails the job at once
   (« sign in again ») and raises a **provider alert** (Cloud migration 016 `provider_alerts`, shown in the founder console's
   overview and in `providers status`). The tool schemas are not published: the adapter reads `create_video`'s schema (free)
   and refuses, unpaid, when an argument it sends is unknown.
3. **The plan is a fixed cost.** An engine may name a provider plan (`planMonthlyUsd`, published on `GET /v1/engines`); the
   estimate lists it apart (`fixedMonthly`, « En plus, chaque mois ») and never spreads it into the price per minute. The fee is
   the founder's plan, config.json `heygen.plan`: Pro 49 $ (default, the coordinator's advice) or Business 149 $.
4. **Files to providers** (the coordinator's change of 11-01: Charlie has no R2 account): by default the Cloud serves them itself,
   `GET /provider-files/:job/:id`, a link bound to the job and the file, HMAC-signed, 30 minutes (6 h for RunPod), served only while
   the job runs and only for a file of its team, under the Cloud's public https address (the beta: Tailscale Funnel). With a
   bucket (Cloudflare R2, P1 for later) the link is the bucket's presigned one, same lifetimes.
5. **The cost ladder is options of `avatar@1`:** « Génération du présentateur » (`cut` default; `continuous` bridges cutaways
   shorter than 9.5 s, the base rung) and « Clips en deux plans » (`auto` = what the clip quality says; none / half / all =
   `clip.make` `pairShare` 0 / 0.5 / 1). With Charlie's profile the estimator gives 0.70 / 0.62 / 0.54 / 0.46 $ a minute
   (no regeneration), tested to 0.01 $. The presenter line now counts the 0.1 s silences between stretches.

## Why
Charlie compared the providers himself (01/11) and chose on price per finished minute: the presenter on the plan is ≈ 4 times
cheaper per second than HeyGen's API (0.0133 against 0.05 $), which is the whole difference (+0.64 $ a minute). Fallbacks come
from different vendors so one outage never stops a video.

## Watch-outs
- Using plan credits through MCP for a SaaS needs HeyGen's written OK before customers (0014 watch-outs stay).
- Vertex's `veo-3.1-lite-generate-001` is still Preview (its page also says pay-as-you-go is « not supported » and contradicts
  itself on image input): the first fallback of the clips may not work; Kie.ai is then the real fallback.
- ai33 publishes no price per character: 0.0067 $ / 1 000 characters is a placeholder until the dashboard is read.
- Charlie's profile counts 3.9 clip shots a minute (3.2 s); our director makes 3.7 s ones, so `avatar@1`'s own estimate is a
  little lower on clips than the table.
