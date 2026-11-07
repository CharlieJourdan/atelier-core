# 0014. Providers: provisional defaults per capability, final choice after Charlie's case study
Date: 2026-10-30. Status: accepted (provisional list; a later record fixes the final choices). Decided by: Charlie
(production-1).

## Context
Research of 2026-10-30 (every price with its URL) gives a recommended
provider and a fallback per capability. Charlie is studying how a video-creation tool structures its stages and which
providers it uses (e.g. HeyGen for avatars, the Gemini API to find footage in YouTube videos) and wants that study
done before fixing providers. Bricks are interchangeable (0010, 0011), so a provider can change without touching
recipes. Unchanged from 10-24: provider APIs are Atelier's business, « lui l'utilisateur aura juste des crédits qu'il
peut acheter »; « Voix : Minimax comme fournisseur, derrière une interface ».

## Decision
- **No provider is final yet.** Until the case-study record, the candidates below are the defaults that sessions
  may wire behind fakes; nothing real is called (0003, COMMUN rules).

| Capability | Default candidate | Provider price (2026-10-30) | Fallback |
|---|---|---|---|
| Voice (French) | MiniMax speech-2.8-hd (Charlie's choice of 10-24, adapter written) | 0,10 $ / 1 000 chars (≈ 0,09 $ / min; turbo 0,06) | ElevenLabs Multilingual v2 / v3, 0,08 $ / 1 000 (≈ 0,07 $ / min, cheaper and the safest French): blind French listening test decides |
| Voice clone | ElevenLabs or MiniMax (1,50 $ / voice) | — | blind French listening test first |
| Talking avatar | **after the case study** (0012) | Hedra 720p ≈ 3 $ / min; HeyGen Avatar IV 3 $ / min | Kling Avatar v2 on fal 3,37 $ / min; InfiniteTalk on RunPod (benchmark) |
| B-roll images | Nano Banana 2 (Gemini 3.1 Flash Image) | 0,067 $ / image | FLUX.1 schnell 0,003 $ / MP |
| Thumbnails (text in image) | Gemini 3 Pro Image | 0,134 $ / image | gpt-image |
| AI video B-roll | Wan 2.2 on fal (adapter written) | 0,04–0,08 $ / s (480p–720p) | MiniMax Hailuo / H3-Lite 0,025–0,04 $ / s |
| Music | ElevenLabs Music | 0,15 $ / min | Lyria 3.5 |
| Transcription | AssemblyAI Universal-2 | 0,15 $ / h | Deepgram Nova-3 |
| Stock | Pexels (new API keys paused) + Wikimedia Commons | free | — |
| Eyes | Gemini Flash-Lite (adapter written) | ≈ 0,02 $ / 10 min of video | — |

- **Watch-outs for the case study:**
  - None of the voice or avatar vendors (ElevenLabs, MiniMax, Hedra, HeyGen) publicly grants the right to resell
    their output inside a credit-priced SaaS: written confirmation from each chosen vendor before a public launch.
    HeyGen's terms forbid white-labelling without their agreement.
  - Finding footage in YouTube videos with Gemini is reading; **re-using** clips from other channels' videos raises
    copyright, YouTube's « reused content » monetisation policy, and YouTube's terms that forbid downloading. A
    footage brick based on YouTube needs its own decision.
  - Clean room (0001): the study observes structure and provider choices only; nothing is copied.

## Consequences
- production-2 and -3 run on fakes and do not wait for the study; production-4 (avatar) and -5 (real keys) start
  after a record « providers, final » written with Charlie.
