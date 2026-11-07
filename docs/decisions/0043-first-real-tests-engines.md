# 0043. First real tests: files through the provider's own storage, Veo relaxed stays, Grok first fallback

Date: 2026-11-01 · chantier vrais-tests · Charlie OKed paid tests that day.

## Context
The first paid calls (the model benchmark, )
showed three things the code had assumed wrongly from public docs:
- The workers behind Veo, SeeDance, Hailuo and Nano Banana (through unifically.com) and HeyGen could not read the beta's signed
  file links (`https://<host>:8443/files/…`, Tailscale Funnel on a non-standard port) although the Cloud served them; FLUX and
  Seedream could. Decision 0025 (never an anonymous public host) and production-10 (the Cloud serves a running job's files)
  stay; the link just does not reach every provider.
- The live HeyGen MCP server has no `create_video`: a photo speaks through `create_video_from_image` with HeyGen asset ids,
  polled by `get_video { videoId }`.
- Measured on the same 15 start frames, Veo 3.1 Lite on unifically's relaxed queue (0.075 $ a clip, 4 or 8 s alike, ≈ 70 s
  of queue) is as good as Veo Lite and Veo Fast and as cheap per usable shot as the cheapest model (Grok Imagine 1.5 Lite,
  0.065 $ for 4 s, ≈ 40 s); GPT Image 2.5 low stays the best still per dollar and the only one that keeps the presenter's face.

## Decision
1. **A provider gets our files through its own storage when it has one**: the adapter reads the artefact with the Cloud's
   signed link and uploads it (unifically `files.unifically.com/upload`; HeyGen `create_asset_upload` + presigned PUT +
   `complete_asset_upload`), then sends the provider's own file id or link. A link to the Cloud stays the way for providers
   without storage. The provider is the one that generates from the file anyway; nothing goes to a third party.
2. **Engines are checked against the live service before paying**: the HeyGen adapter reads the server's tool schema
   (free) and refuses unknown arguments; `providers heygen-tools` prints it. unifically's free dry run prices every call of
   the new engines, and `providers unifically-ledger` reconciles with `jobs.cost_usd`.
3. **Defaults** (per brick, principal first): stills GPT Image 2.5 low (qualité: medium); clips Veo 3.1 Lite relaxed, two shots
   per clip where the shot allows, then **Grok Imagine 1.5 Lite** (new first fallback: fast, billed per second), then Vertex,
   Kie.ai; presenter HeyGen Avatar IV on the plan, once then cut.
4. **Shipped style updates**: a newer version of a base style ships as a new version on top (`SHIPPED_UPDATES`), only over a
   style whose latest version is still a shipped one; `phone-real` v2 names the place of the sentence (indoors or outside).

## Consequences
- The cost per minute of a Headcast-like video is ≈ 0.72 $ on today's engines (its measured profile is 64 % clips), not the
  0.46 $ of the ladder built on a 21 % clip profile; [specs/pipeline-avatar.md §6](../specs/pipeline-avatar.md) keeps its ladder,
  the benchmark page gives the measured one.
- Rejected for now: FLUX 3 Klein (face drift), Seedream 5.0 Lite (aspect), SeeDance (invents scenery; Mini is dearer than its
  from price), Kling 2.5 Turbo and Veo Lite / Fast (price). Not measured: Hailuo and Z-Image (failures on unifically's side),
  every fal / Kie.ai / Imagen model (no key).
- Code: `cloud/src/providers/{unifically,unifically-common,unifically-ledger,try-visual,heygen-mcp}.ts`, `src/shared/{visual-engines,cloud-engines}.ts`,
  `src/engine/technologies/bases/avatar.ts`, `src/main/production/styles/{seeds,store}.ts`.
