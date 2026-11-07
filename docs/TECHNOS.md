# Technologies et fournisseurs branchés

Tout ce qui est payant passe par **Atelier Cloud** (`cloud/`). Les adaptateurs réels sont dans `cloud/src/providers/`.
Un moteur réel n'est appelé que si **les 4 conditions** sont réunies (`cloud/src/providers/registry.ts`) :
`"paidCalls": "on"` dans la config, ce n'est pas un run de test, le fournisseur (ou le moteur) est choisi dans la
config (`providers` ou `realEngines`), et sa clé est dans le **coffre** (`npm run cloud -- vault set NOM`).
Sinon, c'est le **fake** (`cloud/src/providers/fakes.ts`) : gratuit, local, déterministe.

Les prix ci-dessous sont des prix publics relevés fin octobre 2026 ou des coûts **mesurés** lors des premiers vrais
appels (début novembre 2026), en dollars, hors marge. Ils bougent : à revérifier avant de s'en servir.
Les identifiants de moteurs (`voice:…`, `image:…`) sont dans `src/shared/voice-engines.ts`, `presenter-engines.ts`,
`visual-engines.ts` et les prix dans `cloud/src/providers/engines.ts`.

## Voix

| Techno | Usage | Adaptateur | Clé (coffre) | Prix |
|---|---|---|---|---|
| ai33.pro | voix TTS et clonage (`voice:ai33`), voix principale | `ai33.ts` | `AI33_API_KEY` | payant (pack de crédits ; coût réel lu dans chaque tâche) |
| MiniMax speech-2.8-hd | voix, clonage, design de voix (`voice:minimax-28-hd`) ; exception limitée (décision 0101) | `minimax.ts` | `MINIMAX_API_KEY` | ≈ 0,10 $ / 1000 car. (≈ 0,09 $/min) ; clone 1,50 $ ; design 3 $ |
| ElevenLabs | voix (`voice:elevenlabs-v2`), voix perso | `elevenlabs.ts`, `elevenlabs-voices.ts` | `ELEVENLABS_API_KEY` | ≈ 0,08 $ / 1000 car. (≈ 0,07 $/min) |
| Fish Audio | voix (`voice:fish-s2`) | `fish.ts` | `FISH_API_KEY` | payant (prix non relevé) |
| Voix système (macOS `say`, Windows SAPI) | démos et secours local | `src/engine/media/speech.ts` | — | gratuit |

## Yeux (analyse vidéo) et minutage

| Techno | Usage | Adaptateur | Clé | Prix |
|---|---|---|---|---|
| Gemini Flash-Lite | lire une vidéo entière plan par plan (`analyseVideo`) | `cloud/src/providers/gemini.ts` ; app : `src/main/eyes/`, `src/engine/watch/gemini.ts` | `GEMINI_API_KEY` | ≈ 0,02 $ par vidéo de 10 min (mesuré 0,003–0,005 $/min) |
| faster-whisper (Python) | minutage de chaque mot, transcription | `src/engine/media/whisper.ts`, `src/main/eyes/python.ts` | — (env `ATELIER_WHISPER_PYTHON`) | gratuit (local) |
| OpenCV YuNet + SFace | vérifier l'identité du présentateur | `src/engine/presenter/face-id.ts` | — | gratuit (Apache 2.0) |
| yt-dlp | lire une vidéo publique / extraits courts, lecture seule, jamais de cookies | `src/engine/sourcing/providers/ytdlp.ts` | — (binaire) | gratuit |

## Images

| Techno | Usage | Adaptateur | Clé | Prix |
|---|---|---|---|---|
| OpenAI GPT Image 2.5 (`image:gpt-image-25-low/medium/high`) | images principales | `openai-image.ts` | `OPENAI_API_KEY` | mesuré : low 0,0059 $, medium 0,0132 $ l'image |
| Gemini « Nano Banana » (`image:nano-banana-2`) | images B-roll | `gemini-image.ts` | `GEMINI_API_KEY` | ≈ 0,067 $/image |
| fal.ai (FLUX schnell, GPT Image via fal) | images | `fal.ts`, `fal-image.ts` | `FAL_KEY` | FLUX schnell ≈ 0,003 $/mégapixel |
| UnificAlly (FLUX 3 Klein, Nano Banana 2 Lite/2.1, Seedream 5.0 Lite, Z-Image) | images multi-modèles | `unifically.ts`, `unifically-common.ts` | `UNIFICALLY_API_KEY` | mesuré : FLUX 3 Klein 0,0081 $, Nano Banana 0,02 $, Seedream 0,028 $ |
| Kie.ai | secours images / clips / avatar | `kie.ts` | `KIE_API_KEY` | crédit Kie = 0,005 $ |

## Clips vidéo

| Techno | Usage | Adaptateur | Clé | Prix |
|---|---|---|---|---|
| Veo 3.1 via UnificAlly (`clip:veo31-lite-relaxed/lite/fast…`) | clips principaux | `veo.ts`, `unifically.ts` | `UNIFICALLY_API_KEY` | mesuré : Lite relaxed 0,075 $/clip, Lite 0,15 $, Fast 0,30 $ |
| Grok Imagine, SeeDance, Kling 2.5 Turbo, Hailuo (via UnificAlly) | clips | `unifically.ts` | `UNIFICALLY_API_KEY` | mesuré : Grok Lite 0,065 $ (4 s), SeeDance 1.5 Pro 0,088 $, Kling 2.5 0,189 $ (5 s) |
| Veo 3.1 Lite via Google Vertex AI | secours facultatif | `veo.ts` | `VERTEX_SERVICE_ACCOUNT_JSON` (JSON sur une ligne, `--from-stdin`) | ≈ 0,03 $/s |
| fal Wan 2.2 (`clip:wan22`) | B-roll IA | `fal.ts` | `FAL_KEY` | ≈ 0,04–0,08 $/s |
| MiniMax Hailuo (`clip:minimax-h3-lite`) | clips | `minimax-video.ts` | `MINIMAX_API_KEY` | non chiffré |

## Présentateur / avatar parlant

| Techno | Usage | Adaptateur | Clé | Prix |
|---|---|---|---|---|
| HeyGen via MCP (forfait, `presenter:heygen-mcp`) | présentateur principal (Avatar IV photo) | `heygen-mcp.ts`, `heygen-oauth.ts`, `signin-cli.ts` | `HEYGEN_MCP_OAUTH` (pas une clé : `npm run cloud -- providers signin heygen`) ; config `heygen.plan` | ≈ 0,013 $/s ; forfait Pro 49 $/mois |
| HeyGen API (`presenter:heygen-avatar4`) | secours | `heygen.ts` | `HEYGEN_API_KEY` | ≈ 0,05 $/s |
| Hedra Character-3 (`presenter:hedra-c3`) | avatar | `hedra.ts` | `HEDRA_API_KEY` | ≈ 3 $/min |
| WaveSpeed (Pruna P-Video Avatar, InfiniteTalk) | secours | `wavespeed.ts` | `WAVESPEED_API_KEY` | Pruna ≈ 0,025 $/s |
| fal Kling Avatar v2 | avatar | `fal-avatar.ts` | `FAL_KEY` | ≈ 3,37 $/min |
| InfiniteTalk sur GPU RunPod (`presenter:infinitetalk-gpu`) | modèle libre sur GPU loué (jamais lancé en réel) | `infinitetalk-gpu.ts`, `cloud/src/runpod/`, `deploy/runpod/infinitetalk/` | `RUNPOD_API_KEY` + config `infinitetalk.endpointId` | estimé ≈ 0,005 $/s |

## Médias trouvés (sourcing)

Interface unique et statut légal par résultat : `src/engine/sourcing/` (décision 0069). Liste canonique des clés
gratuites : `src/engine/sourcing/catalog.ts` (`FREE_KEYS`).

| Source | Clé | Prix |
|---|---|---|
| Wikimedia Commons, Internet Archive, NASA Images, The Met, Cleveland Museum, Wellcome, Openverse, banque locale CC0 | aucune | gratuit |
| Europeana (BnF, Bundesarchiv…) | `EUROPEANA_API_KEY` | gratuit |
| Smithsonian Open Access | `SMITHSONIAN_API_KEY` | gratuit |
| NARA (archives US) | `NARA_API_KEY` | gratuit (jamais vérifié en réel) |
| DVIDS (US DoD) | `DVIDS_API_KEY` | gratuit (jamais vérifié en réel) |
| Pixabay / Pexels (photos et vidéos de banque, `searchStock`) | `PIXABAY_API_KEY` / `PEXELS_API_KEY` | gratuit |
| Freesound (effets CC0 / CC BY) | `FREESOUND_API_KEY` | gratuit |
| Jamendo (musique CC, revue humaine) | `JAMENDO_CLIENT_ID` | gratuit (non commercial) |
| YouTube Data API v3 (lecture seule, `channelData`) | `YOUTUBE_API_KEY` | gratuit, quota 10 000 unités/jour |

## Moteur local (gratuit, sans clé)

- **ffmpeg / ffprobe** du système : montage, mixage, probe, rendu (`src/engine/media/`, `src/engine/render/`). Sur Mac,
  `ffmpeg-full` (libass, drawtext).
- **Chromium (Playwright)** : rendu des cartes motion et du studio three.js (`src/engine/media/browser.ts`,
  `src/engine/motion/`). Env `ATELIER_CHROMIUM`, `ATELIER_BROWSER_GPU`.
- **three.js** (MIT) et **MapLibre** : studio 3D et cartes (`src/engine/motion/studio*.ts`).
- Synthèse d'effets sonores maison et banque SFX : `src/engine/media/sfx*.ts`, `resources/sfx/`.

## LLM et agents (côté app)

| Techno | Usage | Fichiers | Clé | Prix |
|---|---|---|---|---|
| Claude Code CLI (abonnement de l'utilisateur) | cerveau principal, agents | `src/main/llm/claude-code.ts` | aucune (le CLI se connecte) | 0 pour Atelier |
| API Anthropic | secours (crédits Atelier ou clé de l'utilisateur) | `src/main/llm/anthropic.ts` | secret chiffré de l'app `provider.anthropic.apiKey` | Sonnet 5.5 : 2 $ / 10 $ le million de jetons |
| Codex CLI | runtime d'agents alternatif | `src/main/llm/codex.ts` | aucune | abonnement utilisateur |
| MCP maison | outils d'Atelier pour les agents | `src/main/mcp/` | env `ATELIER_BRIDGE`, `ATELIER_BRIDGE_TOKEN` (générés) | gratuit |
| Discord (bot) | notifications et validations sur téléphone | `src/main/discord/` | jeton du bot saisi dans Réglages › Discord | gratuit |
| Google OAuth + YouTube Analytics | chiffres du propriétaire, lecture seule | `src/main/google/` | env `ATELIER_GOOGLE_CLIENT_ID`, `ATELIER_GOOGLE_CLIENT_SECRET` | gratuit |

## Infrastructure

| Techno | Usage | Fichiers | Clé | Prix |
|---|---|---|---|---|
| Hetzner Cloud | « ordinateurs d'équipe » par abonnement | `cloud/src/machines/` | `HETZNER_API_TOKEN` ; config `machines.sshKeys` | cx33 ≈ 9 €/mois |
| Cloudflare R2 (S3) | fichiers d'équipe, kits, liens présignés | `cloud/src/blobs/s3.ts` | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` ; config `storage` | ≈ 0,015 $/Go/mois |
| Stripe | paiements (Checkout, abonnements, packs, webhooks) | `cloud/src/billing/` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` ; config `payments: "stripe"` | commission |
| Resend | e-mails | `cloud/src/mail/resend.ts` | `RESEND_API_KEY` ; config `mail` | palier gratuit |
| Caddy + Litestream | HTTPS devant le Cloud, sauvegarde continue de la base | `deploy/cloud/` | `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY` (env du service) | gratuit |
| Rendu à distance : Scaleway Jobs, Modal, RunPod CPU | rendus lourds facturés à la seconde (**jamais appelés en réel**) | `cloud/src/render/`, `deploy/render-worker/` | `SCALEWAY_SECRET_KEY`, `SCALEWAY_JOB_DEFINITION_ID` ; `MODAL_RENDER_URL`, `MODAL_PROXY_KEY`, `MODAL_PROXY_SECRET` ; `RUNPOD_API_KEY`, `RUNPOD_RENDER_ENDPOINT_ID` | estimé ≈ 0,03 $ par vidéo de 10 min |
| Electron + electron-updater | app de bureau, mises à jour depuis le flux du Cloud | `src/main/updater/`, `electron-builder*.mjs` | — | gratuit |

## Liste complète des noms du coffre (Cloud)

Format : `^[A-Z][A-Z0-9_]{1,63}$`, chiffrement AES-256-GCM (`cloud/src/vault.ts`), clé maître hors dépôt
(`ATELIER_CLOUD_MASTER_KEY_FILE`, créée par `npm run cloud -- key init /chemin/absolu/master.key`).

`AI33_API_KEY`, `MINIMAX_API_KEY`, `ELEVENLABS_API_KEY`, `FISH_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `FAL_KEY`,
`UNIFICALLY_API_KEY`, `KIE_API_KEY`, `VERTEX_SERVICE_ACCOUNT_JSON`, `HEYGEN_API_KEY`, `HEYGEN_MCP_OAUTH`,
`HEDRA_API_KEY`, `WAVESPEED_API_KEY`, `RUNPOD_API_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `YOUTUBE_API_KEY`,
`FREESOUND_API_KEY`, `JAMENDO_CLIENT_ID`, `EUROPEANA_API_KEY`, `SMITHSONIAN_API_KEY`, `DVIDS_API_KEY`, `NARA_API_KEY`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `RESEND_API_KEY`,
`HETZNER_API_TOKEN`, `SCALEWAY_SECRET_KEY`, `SCALEWAY_JOB_DEFINITION_ID`, `MODAL_RENDER_URL`, `MODAL_PROXY_KEY`,
`MODAL_PROXY_SECRET`, `RUNPOD_RENDER_ENDPOINT_ID`.

Commandes : `vault set NOM` (saisie sans écho), `vault list` (noms et dates seulement), `providers status`,
`providers try …` (affiche le coût maximum avant d'appeler). Référence détaillée en anglais : `docs/PROVIDERS.md`.
