# Les fournisseurs réels d'Atelier Cloud

## Comptes et clés (choix de Charlie du 01/11/2026, chantier production-10)

Chaque clé se tape **toi-même**, rien ne s'affiche, jamais dans le chat. Dans PowerShell, dans le dossier du Cloud. Puis
`npm run cloud -- providers status` dit ce qui est présent (jamais les valeurs). P0 = le fournisseur principal d'une
brique, à faire d'abord ; P1 = un secours.

| Prio | Fournisseur | Pourquoi | Quel compte / forfait | Commande |
|---|---|---|---|---|
| P0 | **HeyGen** (forfait, serveur MCP) | le présentateur (Avatar IV Photo Look), ≈ 0,013 $/s | ton forfait HeyGen (**Pro** 49 $/mois pour 1 000 crédits, ou **Business** 149 $/mois pour 1 500 ; dis lequel dans `config.json` : `"heygen": { "plan": "pro" }` ou `"business"`) | `npm run cloud -- providers signin heygen` (ouvre le lien, connecte-toi ; pas de clé) |
| P0 | **UnificAlly** | les clips Veo 3.1 Lite « relaxed », 0,075 $ le clip | compte avec crédit prépayé | `npm run cloud -- vault set UNIFICALLY_API_KEY` |
| P0 | **OpenAI** | les images GPT Image 2.5 (basse ≈ 0,006 $) | compte API avec crédit | `npm run cloud -- vault set OPENAI_API_KEY` |
| P0 | **ai33.pro** | la voix (TTS, clone) | ton compte (pack de crédits) | `npm run cloud -- vault set AI33_API_KEY` |
| P0 | **MiniMax** | voix de secours et **design de voix** (3 $ la voix) | compte API paygo | `npm run cloud -- vault set MINIMAX_API_KEY` |
| P1 | HeyGen (API) | secours 1 du présentateur, 0,05 $/s | clé API HeyGen (paiement à l'usage) | `npm run cloud -- vault set HEYGEN_API_KEY` |
| P1 | WaveSpeed | secours 2 du présentateur (Pruna P-Video Avatar 0,025 $/s, InfiniteTalk) | compte avec crédit | `npm run cloud -- vault set WAVESPEED_API_KEY` |
| P1 | Kie.ai | secours 3 du présentateur (Kling Avatar 0,04 $/s), secours 2 des clips et des images | compte avec crédit | `npm run cloud -- vault set KIE_API_KEY` |
| P1 | RunPod | secours 4 du présentateur (InfiniteTalk sur GPU loué) | ton compte RunPod + l'endpoint (`infinitetalk.endpointId`) | `npm run cloud -- vault set RUNPOD_API_KEY` |
| P1 | Google Vertex AI (**facultatif**) | secours 1 des clips (Veo 3.1 Lite officiel, 0,03 $/s) ; sans lui, Kie.ai prend le relais | un projet Google Cloud + un compte de service (fichier JSON) | `Get-Content <fichier-compte-de-service>.json -Raw \| npm run cloud -- vault set VERTEX_SERVICE_ACCOUNT_JSON --from-stdin` |
| P1 | fal.ai | secours 1 des images (GPT Image 2.5, même prix) | compte avec crédit | `npm run cloud -- vault set FAL_KEY` |
| P1 | Cloudflare R2 (plus tard) | les fichiers dans un bucket ; sans R2, le Cloud sert lui-même aux fournisseurs les fichiers d'un job en cours (lien signé, 30 min, rien d'autre) | un bucket + une clé API R2 | `npm run cloud -- vault set R2_ACCESS_KEY_ID` puis `npm run cloud -- vault set R2_SECRET_ACCESS_KEY` (+ `storage` dans `config.json`) |

Ensuite, pour qu'un moteur parte vraiment : `"paidCalls": "on"` et son id dans `realEngines` de `config.json`, par
exemple `["presenter:heygen-mcp", "clip:veo31-lite-relaxed", "image:gpt-image-25-low", "voice:ai33", "voice:minimax-28-hd"]`.
Le Cloud doit être joignable en https par les fournisseurs (`publicUrl` de `config.json`, la bêta : son adresse Tailscale Funnel). Si le renouvellement de la connexion HeyGen échoue, une **alerte** apparaît dans la console fondateur et dans
`providers status` : relance `providers signin heygen`.

Les chaînes par défaut (`avatar@1`, principal d'abord) : présentateur HeyGen forfait → HeyGen API → Pruna (WaveSpeed) →
Kling (Kie.ai) → InfiniteTalk (RunPod) ; clips Veo Lite relaxed (UnificAlly, 15 min au plus par clip) → Vertex → Kie.ai ;
images GPT Image 2.5 OpenAI → fal → Kie.ai ; voix ai33 → MiniMax. Pas de musique pour l'instant. Coûts par minute :
[specs/pipeline-avatar.md §6](specs/pipeline-avatar.md).


## Ce qu'on utilise et pourquoi (décidé le 30/10/2026, chantier production-1)

Les décisions complètes : [0012](decisions/0012-compute-placement.md) (où tourne le calcul),
[0013](decisions/0013-llm-routing.md) (le cerveau IA), [0014](decisions/0014-providers-provisional.md) (les
fournisseurs, **provisoires** jusqu'à ton case study), [0015](decisions/0015-economy.md) (l'économie). Tous les prix
sont les prix publics des fournisseurs, lus le **30/10/2026**, en dollars, sans notre marge. Les recherches complètes, avec chaque lien, ont été faites en octobre 2026.

| Pour quoi | Ce qu'on prend | Prix | Pourquoi | Source |
|---|---|---|---|---|
| Le cerveau (scripts, réalisateur, agents) | **Ton abonnement Claude** (Claude Code sur l'ordinateur d'équipe), sinon **« Crédits Atelier »** (notre API Anthropic), sinon ta clé | abonnement : 0 pour Atelier ; API : Sonnet 5.5 2 $ / 10 $ le million de jetons (≈ 0,56 $ script + réalisateur d'une vidéo de 10 min), Haiku 5.5 0,10 / 0,50 $ | l'abonnement est gratuit pour nous et autorisé tant que tu te connectes toi-même ; l'API marche pour tout le monde, sans risque de règles | platform.claude.com/docs/en/about-claude/pricing ; code.claude.com/docs/en/legal-and-compliance |
| Les yeux (analyser une vidéo) | **Gemini Flash-Lite** | ≈ 0,02 $ par vidéo de 10 min | lit la vidéo directement, de loin le moins cher | ai.google.dev/gemini-api/docs/pricing |
| La voix française | **MiniMax speech-2.8-hd** (ton choix), en concurrence avec **ElevenLabs** | MiniMax 0,10 $ / 1 000 caractères (≈ 0,09 $ la minute) ; ElevenLabs 0,08 $ (≈ 0,07 $) | ElevenLabs est un peu moins cher et le plus sûr en français : une écoute à l'aveugle tranchera | platform.minimax.io/docs/guides/pricing-paygo ; elevenlabs.io/pricing/api |
| Cloner une voix | MiniMax (ou ElevenLabs) | 1,50 $ par voix, une fois | — | idem |
| L'avatar qui parle | **pas encore choisi** : après ton case study | Hedra 720p ≈ 3 $ / min ; HeyGen Avatar IV 3 $ / min ; Kling Avatar v2 (fal) 3,37 $ / min ; modèle libre InfiniteTalk sur carte louée ≈ 0,15–1,40 $ / min (à mesurer) | c'est la ligne qui décide du prix d'une vidéo avatar (voir 0015) | hedra.com/pricing ; help.heygen.com (API pricing) ; fal.ai/models/fal-ai/kling-video/ai-avatar/v2/standard ; github.com/MeiGen-AI/InfiniteTalk |
| Images B-roll | **Nano Banana 2** (Gemini) | 0,067 $ l'image | bonne qualité, cohérente | ai.google.dev/gemini-api/docs/pricing |
| Images pas chères | FLUX.1 schnell (fal) | 0,003 $ le mégapixel | 20 fois moins cher, pour les brouillons et les fonds | fal.ai/models/fal-ai/flux/schnell |
| Miniatures (texte dans l'image) | **Gemini 3 Pro Image** | 0,134 $ l'image | écrit bien le texte | ai.google.dev/gemini-api/docs/pricing |
| Vidéo IA (B-roll) | **Wan 2.2** (fal, déjà écrit) | 0,04–0,08 $ la seconde (480p–720p) | le meilleur rapport qualité-prix ; MiniMax Hailuo en réserve | fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video |
| Musique | **ElevenLabs Music** | 0,15 $ la minute | usage commercial permis (plan Starter) | elevenlabs.io/pricing/api |
| Sous-titres | les timings de la voix, sinon **AssemblyAI** | 0,15 $ de l'heure | presque gratuit | assemblyai.com/pricing |
| Footage gratuit | **Pixabay** (principal) puis, sans clé, **Wikimedia Commons**, NASA, Internet Archive ; **Pexels** si sa clé rouvre | gratuit | Pexels ne donne plus de nouvelles clés (02/11) ; jamais d'image générée à la place d'un footage | pixabay.com/api/docs |
| Le montage (rendu) | ton PC pendant la bêta ; ensuite des **machines partagées payées à la seconde**, à la demande | ≈ 0,03 $ par vidéo de 10 min (estimé) | jamais l'ordinateur de l'utilisateur (ta règle du 24/10) ; inclus dans l'abonnement |
| L'ordinateur d'équipe (agents) | un **tout petit PC** par équipe (2 cœurs, 4 Go) : Claude Code avec ton compte + un navigateur | ≈ 6 € / mois (Hetzner CX23 5,99 € ; Hetzner en rupture : 2ᵉ hébergeur à prévoir) | ton abonnement Claude doit tourner sur une machine à toi seul, 24 h/24 | |
| La carte graphique louée | **RunPod**, à la seconde, pour l'avatar en modèle libre | test : 20 $ maximum | 3 à 5 fois moins cher qu'un avatar en ligne, si le test le confirme | runpod.io/pricing |

À ne pas oublier avant d'ouvrir au public : aucun fournisseur de voix ou d'avatar n'autorise clairement la revente dans
un logiciel payant (accord écrit à demander à chacun) ; HeyGen interdit la marque blanche sans accord ; écrire à
Anthropic pour confirmer « Crédits Atelier ».

## Pour la session des vrais tests (production-10, 01/11/2026)

Written for the next agent session (English). Everything below is in code on `proto`; nothing was ever called for real.

- **Engine ids** (config.json `realEngines` accepts exactly these; shared tables `src/shared/presenter-engines.ts`,
  `src/shared/visual-engines.ts`, `src/shared/voice-engines.ts`; prices `cloud/src/providers/engines.ts`):
  presenter `presenter:heygen-mcp` (vault `HEYGEN_MCP_OAUTH`, sign-in), `presenter:heygen-avatar4` (HEYGEN_API_KEY),
  `presenter:pruna-avatar`, `presenter:infinitetalk-fast`, `presenter:infinitetalk-std` (WAVESPEED_API_KEY),
  `presenter:kling-avatar-kie` (KIE_API_KEY), `presenter:infinitetalk-gpu` (RUNPOD_API_KEY + `infinitetalk.endpointId`);
  clips `clip:veo31-lite-relaxed`, `clip:veo31-lite`, `clip:veo31-fast`, `clip:veo31-fast-1080p` (UNIFICALLY_API_KEY),
  `clip:veo31-lite-vertex` (VERTEX_SERVICE_ACCOUNT_JSON, optional), `clip:veo31-lite-kie` (KIE_API_KEY); stills
  `image:gpt-image-25-low|medium|high` (OPENAI_API_KEY), `image:gpt-image-25-fal-low|medium` (FAL_KEY), `image:gpt-image-25-kie`
  (KIE_API_KEY); voice `voice:ai33` (AI33_API_KEY), `voice:minimax-28-hd` (MINIMAX_API_KEY, also `designVoice`).
- **Turning real calls on in the beta** (the Cloud's `config.json`, then restart the beta Cloud): `"paidCalls": "on"`,
  `"realEngines": [ …the ids above you want… ]`, `"publicUrl": "https://<adresse-publique-du-cloud>:8443"` (providers fetch
  the job's files from `GET /provider-files/:job/:id` there), `"heygen": { "plan": "pro" }` or `"business"`. An engine is real only
  when all hold: paidCalls on, not a test run, its id in `realEngines`, its key (or sign-in) in the vault; else the fake answers
  (demo). `npm run cloud -- providers status` shows each usage real or demo, the accounts present, and the alerts.
- **One small call per engine**: `npm run cloud -- providers try talkingAvatar --engine presenter:… --image P.png --audio V.mp3`
  (prints the maximum cost first; at most 60 s of audio), `providers try synthesize --voice ID`. Stills and clips have no `try`
  command yet: run them as jobs through the app (a project) or add a `try` (follow-up).
- **Real cost per call**: every job stores the adapter's `costUsd` in `jobs.cost_usd` (and `provider`, `credits`); the adapter's
  `data` keeps the provider's own figures for reconciliation: OpenAI `usage` tokens, Kie `credits` / `creditsUsd`
  (0.005 $ a credit), ai33 `credit_cost`, MiniMax `usage_characters`, RunPod `gpuSeconds`, HeyGen `seconds` / `videoId`.
  `npm run cloud -- admin pnl --from … --to …` sums them per day and provider.
- **Price checks without paying** (what each provider offers; confirm on the first call): UnificAlly `dry_run: true` on
  `POST /v1/tasks` returns the cost of a request; Kie.ai shows `creditsConsumed` per task (`GET /api/v1/jobs/recordInfo`) and the
  balance in its dashboard; ai33 / OpenSpeaker `GET /v1/credits` and each task's `credit_cost`; HeyGen plan credits in the web
  dashboard (no API read known for the MCP plan); OpenAI, fal, WaveSpeed, MiniMax: no dry run, price from the model page and the
  answer's usage. The HeyGen MCP adapter reads the `create_video` schema (free) and refuses unknown arguments before paying.
- What to confirm on the first calls: each adapter's header comment lists it (`cloud/src/providers/*.ts`), plus HeyGen MCP's
  longest audio per call (try 3 to 4 minutes) and the credits per minute (16 or 20).
- **Learned on the first real calls (vrais-tests, 01/11; record 0043):**
  - Providers' workers do not all read the beta's `:8443` links: unifically and HeyGen adapters now upload our files to the
    provider's own storage first. A Funnel on 443 or R2 would make plain links work for the others.
  - New engines on UNIFICALLY_API_KEY: `image:flux3-klein|z-image-turbo|nano-banana-2-lite|nano-banana-21|seedream-50-lite`,
    `clip:grok-imagine-15-lite|seedance-20-mini-480p|seedance-20-mini|seedance-15-pro|hailuo-23-fast|kling-25-turbo`; each call is
    priced by unifically's free dry run. Hailuo answers « Insufficient credits » and Z-Image « url error » on unifically's side.
  - Real prices read: Veo 3.1 Lite relaxed 0.075 $ a clip at 4 or 8 s; Lite 0.15; Fast 0.30; Grok Imagine Lite 0.065 $ for 4 s;
    SeeDance 1.5 Pro 0.088 $ (4 s 720p); SeeDance 2.0 Mini 480p 0.158 $; Kling 2.5 Turbo std 0.189 $ (5 s); FLUX 3 Klein 0.0081 $
    (0.0131 $ with a reference); Nano Banana 2 Lite / 2.1 0.02 $; Seedream 5.0 Lite 0.028 $; GPT Image 2.5 low / medium 0.0059 /
    0.0132 $; HeyGen Avatar IV on the plan ≈ 2 credits for 8 s.
  - Commands: `providers bench-visual --plan P.json --out DIR --budget-usd N` (stills and clips, budget-capped, 15 $ max a run),
    `providers unifically-ledger [--since ISO]` (balance and real cost per model), `providers heygen-tools [NAME]` (the live
    MCP tools and their schemas, free).
  - The live HeyGen MCP tool set differs from its docs: a photo speaks through `create_video_from_image` (asset ids), polled by
    `get_video { videoId }`; `get_current_user` gives the plan's credits left (kept in the job's data as `planLeft`).
  - A beta account must have a verified e-mail to start paid jobs (`admin user verify`, the beta's mail is fake).

## Premier vrai run depuis l'app (production-16, à faire par le coordinateur)

Written for the coordinator (English). ONE real run of 10–15 s of `avatar@1`, paid, expected well under 1 $. Charlie OKed the
real tests on 01/11; say the expected spend before step 4 anyway. Do not run it twice.

1. **Beta on proto** (production-16 merged): `beta.ps1 deploy proto` (output to a log file)
   (in the background), then `beta.ps1 status` shows the new commit.
2. **Paid calls on, for this run only**: in the Cloud's `config.json` set `"paidCalls": "on"` (keep `realEngines` as
   vrais-tests left them: `voice:ai33`, `image:gpt-image-25-low`, `clip:veo31-lite-relaxed`, `clip:grok-imagine-15-lite`,
   `presenter:heygen-mcp`; `heygen.plan` `pro`), then `beta.ps1 restart`. `npm run cloud -- providers status` (from the beta folder
   with the beta's env) shows those usages real.
3. **Account and app**: Charlie's beta account, the team « Équipe de charlie » (≈ 2 855 test credits left;
   its e-mail must be verified: a 403 on a paid job means `npm run cloud -- admin user verify --email <his beta e-mail>`). Use the
   headless brain vrais-tests left signed in as Charlie, whose channel 1 « Test Headcast (vrais-tests) » has the ai33 voice clone and
   the accepted presenter clone: from the repo on proto,
   `npm run brain:headless -- --data <S>\brain\data --key-file <S>\brain\machine.key --port 8797 --no-mcp` with `<S>` = a scratch folder outside the repo
   (token in `<S>\brain\token.txt`; never print it). Calls: `POST http://127.0.0.1:8797/rpc {method, args}` with
   `authorization: Bearer <token>`. Check `llm.access`: `director.effective` must be `subscription` or `api` (else the
   thumbnail and packaging steps stop). (Charlie's own app works the same once released: Production › Projets › « Lancer la
   fabrication » › « Moteur réel (bêta) » › « Lancer pour de vrai ».)
4. **The project** (RPC): `recipes.fromBase('avatar@1')`, then `recipes.edit(id, [{op:'setOption',option:'script',value:'import'}])`;
   `projects.create({ recipeId, channelId: 1, title: 'Premier vrai run', idea: 'Test moteur réel', inputs: { script: '<35 to 40
   French words, ≈ 12–15 s>' }, adjustments: { minutes: 0.5 } })`; `projects.quote(id, { real: true })`: `real.available` true and the
   `usage_max` total ≈ 50 credits; **stop and report if it is above 150 credits** (1 credit = 0,01 €). Then
   `projects.run(id, { real: true })` and approve each waiting node (`production.get(runId)` → `waitingNodes` →
   `production.approve(runId, node)`) until `succeeded`.
5. **Check**: `production.get(runId)`: `cloud: true`, the voice, visuals, clips, avatar and thumbnails nodes list `engines` with
   `real: true` (`voice:ai33`, `image:gpt-image-25-low`, `clip:veo31-lite-relaxed` or `clip:grok-imagine-15-lite`,
   `presenter:heygen-mcp`) and their credits; `spentCredits` ≤ `quoteCredits`. Real dollars: `npm run cloud -- admin pnl --from <today>
   --to <today>` and `providers unifically-ledger`. Expected: voice ≈ 0.01 $, stills ≈ 0.03 $, one or two clips 0.075 $ each,
   HeyGen ≈ 4 plan credits, thumbnail ≈ 0.006 $: **≈ 0.25 $, under 1 $**. The video: `production.revealPackage` is refused remotely;
   the file is under `<S>\brain\data\production\video-<id>\`.
6. **Paid calls off again**: `"paidCalls": "off"`, `beta.ps1 restart`; stop the brain.

## Comment ça marche aujourd'hui

Neuf fournisseurs réels sont prêts derrière l'interface commune (PLAN-V2-PRODUCTION §4.6). Tant que tu n'as rien fait,
**tout reste en démo** : les faux répondent, aucun appel payant ne part. Il faut trois choses en même temps pour qu'un
usage devienne réel :

1. `"paidCalls": "on"` dans `config.json` ;
2. l'usage est réglé sur un fournisseur réel dans `config.json` (`providers`) ;
3. la clé de ce fournisseur est dans le coffre.

Si une des trois manque, l'usage reste en démo (badge DÉMO, faux fournisseur, aucun crédit réel dépensé). Les tests ne
touchent jamais le réseau, quoi qu'il y ait dans le coffre.

| Usage | Fournisseur | Nom dans `providers` | Nom dans le coffre | Fichier |
|---|---|---|---|---|
| Voix (`synthesize`) | MiniMax (choix du fondateur) | `minimax` | `MINIMAX_API_KEY` | `cloud/src/providers/minimax.ts` |
| Voix (`synthesize`) | ElevenLabs (même interface, en réserve) | `elevenlabs` | `ELEVENLABS_API_KEY` | `cloud/src/providers/elevenlabs.ts` |
| Clonage de voix (`cloneVoice`) | MiniMax | suit `synthesize` : `minimax` clone, tout autre réglage reste en démo | `MINIMAX_API_KEY` | `cloud/src/providers/minimax.ts` |
| Les yeux (`analyseVideo`) | Gemini | `gemini` | `GEMINI_API_KEY` | `cloud/src/providers/gemini.ts` |
| Images (`generateImage`) | Gemini image, « Nano Banana » (même adaptateur et même clé que les yeux) | `gemini` | `GEMINI_API_KEY` | `cloud/src/providers/gemini-image.ts` |
| Images (`generateImage`) | fal.ai, FLUX schnell | `fal` | `FAL_KEY` | `cloud/src/providers/fal.ts` |
| Vidéo générée (`generateVideo`) | fal.ai, Wan 2.2 (file d'attente, reprise après un échec) | `fal` | `FAL_KEY` | `cloud/src/providers/fal.ts` |
| Avatar parlant (`talkingAvatar`) | Hedra, Character-3 (piloté par l'audio : notre voix en entrée, une vidéo de présentateur en sortie) | `hedra` | `HEDRA_API_KEY` | `cloud/src/providers/hedra.ts` |
| Données de chaîne (`channelData`), lecture seule | YouTube Data API v3 (quota gratuit de 10 000 unités par jour ; voir la section 10) | `youtube` | `YOUTUBE_API_KEY` | `cloud/src/providers/youtube.ts` |
| Banque d'images et de vidéos (`searchStock`), **principale** | Pixabay (photos et vidéos libres) ; s'il en manque, la recherche continue dans des banques sans clé (Wikimedia Commons, Wellcome, le Met, NASA, Internet Archive), jamais une image générée | `pixabay` | `PIXABAY_API_KEY` | `cloud/src/providers/pixabay.ts` |
| Banque d'images et de vidéos (`searchStock`), en attente | Pexels (photos et vidéos libres) : les nouvelles clés sont en pause | `pexels` | `PEXELS_API_KEY` | `cloud/src/providers/pexels.ts` |
| Archives (`searchStock`) | Wikimedia Commons (domaine public et licences CC), **sans clé** | `wikimedia` | aucun | `cloud/src/providers/wikimedia.ts` |

MiniMax n'a besoin que de la clé : la documentation actuelle ne demande pas de `GroupId`. Il n'y a donc qu'une entrée de
coffre par fournisseur (la clé `GEMINI_API_KEY` sert aux yeux et aux images, `FAL_KEY` aux images et à la vidéo). Wikimedia
Commons est une API publique sans clé : il est quand même réel, donc **réseau**, donc soumis aux mêmes garde-fous
(`paidCalls` sur « on » ET l'usage réglé sur `wikimedia` dans `config.json`). L'usage sans adaptateur réel (GPU) reste en démo.

## 1. Mettre une clé au coffre

Dans **PowerShell** (ou Terminal.app sur le Mac), depuis la racine du dépôt. La valeur se tape **sans écho** : rien ne
s'affiche, et elle n'est jamais dans la ligne de commande.

```
npm run cloud -- vault set MINIMAX_API_KEY
npm run cloud -- vault set ELEVENLABS_API_KEY     # seulement si tu veux ElevenLabs
npm run cloud -- vault set GEMINI_API_KEY        # les yeux ET les images « Nano Banana »
npm run cloud -- vault set FAL_KEY                # images FLUX et vidéo Wan, seulement si tu les veux
npm run cloud -- vault set PIXABAY_API_KEY        # banque d'images et de vidéos (principale ; Wikimedia, NASA et Internet Archive n'ont pas de clé)
npm run cloud -- vault set PEXELS_API_KEY         # seulement si Pexels rouvre ses clés
npm run cloud -- vault set HEDRA_API_KEY          # avatar parlant, seulement si tu le veux
npm run cloud -- vault set YOUTUBE_API_KEY        # données de chaîne (YouTube Data API, lecture seule), seulement si tu les veux
npm run cloud -- vault list                       # les noms et les dates seulement, jamais les valeurs
```

(Dans Git Bash sous Windows : `winpty npm run cloud -- vault set MINIMAX_API_KEY`.) Il faut une clé maître avant la
première fois : `npm run cloud -- key init <chemin-hors-du-depot>/master.key` puis la variable
`ATELIER_CLOUD_MASTER_KEY_FILE` (voir `cloud/README.md`). Pour retirer une clé : `vault delete NOM`.

## 2. Choisir le fournisseur d'un usage

Copie `cloud/config.example.json` dans le dossier de données du Cloud, sous le nom `config.json`
(par défaut `%USERPROFILE%\.atelier-cloud\config.json`), puis règle `providers` :

```json
{
  "paidCalls": "off",
  "providers": {
    "synthesize": "minimax",
    "analyseVideo": "gemini",
    "generateImage": "gemini",
    "generateVideo": "fal",
    "talkingAvatar": "hedra",
    "searchStock": "pexels",
    "channelData": "youtube"
  }
}
```

- `synthesize` : `"fake"` (démo, le défaut), `"minimax"` ou `"elevenlabs"`.
- `analyseVideo` : `"fake"` ou `"gemini"`.
- `generateImage` : `"fake"`, `"gemini"` (Nano Banana, clé `GEMINI_API_KEY`) ou `"fal"` (FLUX schnell, clé `FAL_KEY`).
- `generateVideo` : `"fake"` ou `"fal"` (Wan 2.2, clé `FAL_KEY`).
- `talkingAvatar` : `"fake"` ou `"hedra"` (Character-3, clé `HEDRA_API_KEY`). Voir la section 8.
- `searchStock` : `"fake"`, `"pixabay"` (clé `PIXABAY_API_KEY`, photos et vidéos ; complète avec Wikimedia, NASA et Internet Archive quand elle ne trouve pas assez),
  `"pexels"` (clé `PEXELS_API_KEY`, en pause) ou `"wikimedia"` (aucune clé). Un seul à la fois : Pixabay pour le B-roll, Wikimedia seul pour les archives et le domaine public.
- `channelData` : `"fake"` ou `"youtube"` (YouTube Data API v3, clé `YOUTUBE_API_KEY`, lecture seule). Voir la section 10.
- Pour passer de MiniMax à ElevenLabs : remplace `"minimax"` par `"elevenlabs"`, mets la clé `ELEVENLABS_API_KEY` au
  coffre, redémarre le Cloud. Rien d'autre ne change.

Réglages facultatifs du même fichier :

| Clé | Valeurs | Défaut |
|---|---|---|
| `minimax.model` | `speech-2.8-hd` (finals) ou `speech-2.8-turbo` (brouillons, shorts) | `speech-2.8-hd` |
| `minimax.region` | `global` (api.minimax.io) ou `china` (api.minimaxi.com) | `global` |
| `minimax.speed` | 0,5 à 2 | 1 |
| `minimax.languageBoost` | `auto` ou une langue (par exemple `French`) | `auto` |
| `elevenlabs.model` | `eleven_multilingual_v2`, `eleven_v3`, `eleven_flash_v2_5` | `eleven_multilingual_v2` |
| `elevenlabs.speed` | 0,7 à 1,2 | 1 |
| `elevenlabs.languageCode` | code à deux lettres (pas pour les modèles multilingual v2) | aucun |
| `gemini.model` | un identifiant Gemini (les yeux) | `gemini-3.1-flash-lite` |
| `gemini.imageModel` | `gemini-nano-banana-2.1`, `gemini-3.1-flash-image`, `gemini-3-pro-image` (texte dans l'image) | `gemini-nano-banana-2.1` |
| `fal.videoResolution` | `480p`, `580p` ou `720p` (Wan 2.2) | `720p` |
| `hedra.model` | l'identifiant d'un modèle Hedra (liste : `GET /models` chez Hedra) | Character-3 |
| `hedra.resolution` | `540p` ou `720p` | `720p` |
| `youtube.dailyQuota` | un entier de 100 à 10 000 : le budget d'unités de quota YouTube par jour (le gratuit est de 10 000) | 8 000 |
| `wikimedia.contact` | une adresse ou un nom que Wikimedia peut joindre (ajouté au User-Agent, comme sa politique le demande) | un texte neutre |

`config.json` ne contient **jamais** de clé : le Cloud refuse tout champ inconnu.

## 3. Autoriser les appels payants

Dans le même `config.json`, passe `"paidCalls": "on"`, puis redémarre le Cloud (`npm run cloud:dev`). La ligne de
démarrage dit alors ce qui est réel (`paidCalls ON — real: synthesize=minimax, …`). Pour vérifier sans rien appeler :

```
npm run cloud -- providers status
```

Elle liste chaque usage, son fournisseur, `real` ou `demo`, et la raison d'une démo (« paidCalls is off », « the
platform key is not in the vault », « this usage is set to the fake provider »…). Pour tout remettre en démo d'un coup :
`"paidCalls": "off"`.

## 4. Les prix, les crédits et la marge

Ce que le fournisseur facture (en dollars, source dans l'en-tête de chaque fichier) :

| Fournisseur | Prix | Par caractère ou par minute |
|---|---|---|
| MiniMax `speech-2.8-hd` | 100 $ par million de caractères | 0,0001 $ / caractère (une minute de voix, environ 900 caractères, coûte 0,09 $) |
| MiniMax `speech-2.8-turbo` | 60 $ par million | 0,00006 $ / caractère |
| MiniMax voix clonée ou dessinée | 1,50 $ / 3,00 $ par voix, à la première utilisation | clonage : usage `cloneVoice`, 1,50 $ comptés une fois par voix, sur la tâche de clonage (voir §7) ; la voix dessinée n'est pas dans le contrat |
| ElevenLabs v3 / multilingual | 0,08 $ pour 1 000 caractères | 0,00008 $ / caractère |
| ElevenLabs Flash / Turbo | 0,04 $ pour 1 000 caractères | 0,00004 $ / caractère |
| Gemini 3.1 Flash-Lite | 0,25 $ / 0,50 $ (audio) par million de jetons en entrée, 1,50 $ en sortie | environ 0,023 $ pour 10 minutes de vidéo, soit 0,0023 $ / minute |
| Gemini 2.5 Flash-Lite | 0,10 $ / 0,30 $ en entrée, 0,40 $ en sortie | moins cher, plus ancien |
| Gemini image `gemini-nano-banana-2.1` (1K) | 0,0336 $ l'image | 0,0336 $ / image |
| Gemini image `gemini-3.1-flash-image` (1K) | 0,067 $ l'image | 0,067 $ / image |
| Gemini image `gemini-3-pro-image` (1K à 2K) | 0,134 $ l'image | 0,134 $ / image |
| fal.ai FLUX schnell | 0,003 $ par mégapixel, arrondi au mégapixel supérieur | 0,003 $ pour une vignette 1280×720 |
| fal.ai Wan 2.2 A14B | 0,04 $ (480p), 0,06 $ (580p), 0,08 $ (720p) la seconde de vidéo | 0,08 $ / s par défaut (720p) |
| Hedra Character-3 (avatar parlant) | « à partir de 0,025 $ la seconde » (prix plancher de la page tarifs : le tarif exact de Character-3 n'y est pas affiché) | 0,025 $ / s, soit 1,50 $ la minute |
| YouTube Data API v3 | gratuit : 10 000 unités de quota par jour et par projet ; 1 unité par appel de liste | 0 $ (notre ligne `channel.request` : 1 crédit par lecture) |
| Pixabay | gratuit, y compris en commercial, sans crédit obligatoire (100 requêtes par minute ; résultats à garder 24 h ; fichiers à télécharger, jamais en lien direct) | 0 $ |
| Pexels | gratuit, y compris en commercial (200 requêtes par heure, 20 000 par mois par défaut) ; nouvelles clés en pause | 0 $ |
| Wikimedia Commons | gratuit, sans clé | 0 $ |

La voix est facturée au **nombre de caractères réellement voix** (le compteur du fournisseur) : si le texte a coûté moins
cher que le devis, la différence retourne à l'utilisateur. L'analyse est facturée au devis : la vidéo est coupée à la
durée du devis (`minutes`), donc le coût ne peut pas dépasser ce qui a été annoncé.

Le prix en crédits suit la grille : coût réel × taux de change × frais, plus la marge.
La recherche propose un coefficient de **1,3** sur les crédits, c'est-à-dire
**30 % de marge**. La grille de départ contient des chiffres provisoires ; pour l'aligner sur les vrais prix :

```
npm run cloud -- admin price show
npm run cloud -- admin price set voice.chars --cost 0.0001 --margin 30        # MiniMax HD
npm run cloud -- admin price set analysis.minutes --cost 0.0023 --margin 30   # Gemini Flash-Lite
```

Avec ElevenLabs, mets `--cost 0.00008`. Pour les images, la vidéo et la banque (les prix de départ de la grille sont des
chiffres provisoires, **à aligner avant d'ouvrir à du public**) :

```
npm run cloud -- admin price set image.count --cost 0.0336 --margin 25     # Nano Banana 2.1 (0,003 avec FLUX schnell)
npm run cloud -- admin price set video.seconds --cost 0.08 --margin 25     # Wan 2.2 en 720p (0,04 en 480p)
npm run cloud -- admin price set avatar.seconds --cost 0.025 --margin 25   # Hedra Character-3 (prix plancher)
npm run cloud -- admin price set stock.searches --cost 0 --margin 0   # la banque : voir ci-dessous
```

**La banque d'images** (`stock.searches`, une ligne de grille par recherche) : Pexels et Wikimedia ne nous facturent rien. La
ligne coûte **0 crédit** (décision 0105) : toutes ces sources sont gratuites pour nous et notre « liant » (la recherche, le
téléchargement des fichiers retenus, l'attribution) n'est pas facturé ; une ligne à coût fournisseur 0 n'a pas de minimum d'1 crédit.
(Avant le 2026-11-04 elle valait 0,002 $ × 1,5, arrondi à 1 crédit par recherche : une erreur de facturation.) Cette ligne existe sans migration : une grille publiée avant
l'arrivée de la banque la reçoit à ce prix par défaut (`LATE_ITEMS` dans `cloud/src/pricing.ts`), et `admin price show` la
liste. Une recherche, trouvée ou non, ne coûte rien ; si elle ne trouve rien le moteur retombe sur une image
générée, facturée à son tour. Une grille ne s'applique qu'aux nouveaux devis ; l'ancienne reste lisible. Un
prix ne dépasse jamais le prix de référence de la grille, quelle que soit la marge.
Ton équipe interne ne paie que le coût réel, sans marge.

## 5. Tester avec UN seul petit appel payant (c'est toi qui le lances)

Rien ne part tant que tu ne lances pas cette commande à la main. Elle refuse de partir si l'usage n'est pas vraiment
réel (voir `providers status`), plafonne l'appel (200 caractères, 2 minutes de vidéo), passe hors portefeuille et affiche
le coût du fournisseur.

Voix (le texte par défaut fait 38 caractères, environ **0,004 $** avec MiniMax HD) :

```
npm run cloud -- providers try synthesize --voice IDENTIFIANT_DE_VOIX --out essai.mp3
```

`IDENTIFIANT_DE_VOIX` est un `voice_id` de ton compte MiniMax (liste des voix de la plateforme) ou, pour ElevenLabs,
un `voice_id` de `GET /v1/voices`. Écoute le fichier : si la voix est bonne et que la commande affiche `ok, provider cost`,
la clé et l'adaptateur marchent.

Yeux (1 minute d'une vidéo YouTube publique, environ **0,002 $**) :

```
npm run cloud -- providers try analyseVideo --url https://www.youtube.com/watch?v=IDENTIFIANT --minutes 1
```

Présentateur (UNE génération, au plus 60 secondes de voix ; voir la section 13, qui donne aussi le benchmark du GPU loué) :

```
npm run cloud -- providers try talkingAvatar --engine presenter:kling-avatar2-std --image visage.png --audio voix.mp3 --out essai
```

La commande affiche **« Coût maximum : X $ (plafond 20 $) »** avant tout appel et ne demande rien ensuite.

Ensuite, pour retomber en démo : `"paidCalls": "off"` dans `config.json`.

## 6. À vérifier avec une vraie clé (écrit d'après la documentation, jamais appelé)

- **MiniMax** : la clé seule suffit (pas de `GroupId`). Si MiniMax répond « invalid group », il faudra ajouter `?GroupId=…`
  à l'URL. Le format du fichier de sous-titres (minutage des mots) n'est pas décrit en détail : si les mots ne
  reviennent pas, la voix marche quand même (`words: []`, `wordTimings: "unavailable"`) et le moteur aligne le script lui-même.
- **ElevenLabs** : texte et minutage par caractères suivent la documentation ; les erreurs 401/429 ne sont décrites que
  sur la page des erreurs.
- **Moteurs de voix (production-5, décision [0029](decisions/0029-channel-voice-engines.md))** : une tâche de voix peut
  nommer son moteur (`voice:elevenlabs-v2`, `voice:minimax-28-hd`, `voice:fish-s2`, `voice:ai33`). Il ne devient réel que si
  `paidCalls` est `on`, que le moteur est dans `"realEngines": [...]` de `config.json` (vide par défaut) et que sa clé est au
  coffre (`ELEVENLABS_API_KEY`, `MINIMAX_API_KEY`, `FISH_API_KEY`, `AI33_API_KEY`). Le prix facturé reste celui de la ligne
  de grille de l'usage (`voice.chars`, `voice.clone`, `voice.design`) tant que production-11 n'a pas une ligne par moteur.
- **ElevenLabs, création et clonage** (`elevenlabs-voices.ts`, docs lues le 01/11/2026, jamais appelé) — à confirmer au
  premier appel : (1) `POST /v1/text-to-voice/design` répond bien `previews[]` avec `generated_voice_id` et `audio_base_64`
  (MP3), trois essais par appel, avec le modèle `eleven_multilingual_ttv_v2` ; (2) le prix réel d'un essai (la doc dit
  « les caractères du texte d'essai », sans le taux : on compte 0,08 $ / 1 000) ; (3) `POST /v1/text-to-voice` rend un
  `voice_id` et ne coûte rien ; (4) `POST /v1/voices/add` (clonage instantané) marche avec ton plan (Starter et plus d'après
  l'aide, pas vérifié), sans prix par voix, et `requires_verification` reste `false` ; (5) le nombre de voix gardées que
  ton plan permet (emplacements de voix).
- **Fish Audio** (`fish.ts`, docs lues le 01/11/2026, jamais appelé) — à confirmer : (1) l'en-tête `model: s2-pro` est
  accepté (le modèle conseillé est maintenant `s2.1-pro`, même prix ; `s2.1-pro-free` est gratuit jusqu'au 30/11/2026) ;
  (2) la réponse de `POST /v1/tts` est bien le MP3 brut ; (3) la longueur maximale d'un texte (non écrite : l'adaptateur
  coupe à 2 000 caractères) ; (4) le prix : 15 $ par million d'**octets** UTF-8 (une lettre accentuée compte 2) ; (5)
  `POST /model` (multipart, `train_mode=fast`, `visibility=private`) rend `_id` et ne coûte rien ; (6) le minutage des mots
  n'est pas demandé (il n'existe qu'en flux SSE) : le moteur aligne le script lui-même, vérifier qu'il dépasse 90 %.
- **ai33.pro = OpenSpeaker** (`ai33.ts`, pages publiques lues le 01/11/2026, jamais appelé) — à confirmer : (1) l'adresse
  `https://api.openspeaker.ai` et l'en-tête `xi-api-key` ; (2) le corps de `POST /v3/text-to-speech` : la doc de l'app
  l'envoie en multipart avec des voix `provider_id`, l'exemple public en JSON avec `provider:id` (l'adaptateur suit la doc de
  l'app) ; (3) `GET /v1/task/{id}` rend `status`, `credit_cost` et `metadata.audio_url` ; (4) le clonage
  `POST /v3/text-to-speech/voice-clone` (3 à 30 s, 10 Mo : l'app coupe l'échantillon à 30 s) et la voix `clone_<id>` ;
  (5) **le prix** : 5 $ le million de crédits (forfait 1 mois), mais le nombre de crédits par caractère n'est pas publié :
  lis-le sur ton tableau de bord et dans le `credit_cost` d'une vraie tâche, puis remplace le 0,01 $ provisoire de
  `voice:ai33` dans `engines.ts` ; (6) **ses conditions** : OpenSpeaker écrit qu'une réponse peut venir de son propre modèle
  plutôt que du fournisseur choisi, et que les sorties peuvent servir à entraîner ses systèmes : à toi de décider si c'est
  acceptable pour une voix clonée.
- **Gemini** : l'adaptateur utilise `generateContent` (stable). À confirmer au premier appel : que
  `generationConfig.mediaResolution = MEDIA_RESOLUTION_LOW` est accepté (la page de référence décrit aussi un réglage par
  morceau) et qu'un lien YouTube passe sans `mimeType`. Si Google refuse un champ, l'erreur le dit (`400`) et c'est une
  ligne à changer dans `gemini.ts`.
- **Gemini image** : l'adaptateur appelle `generateContent` avec `responseModalities: ["IMAGE"]` et `imageConfig { aspectRatio,
  imageSize: "1K" }`, le même point d'accès que les yeux. La documentation présente maintenant en premier l'API
  « Interactions » (`/v1beta/interactions`, `response_format { type: "image", aspect_ratio, image_size }`). À confirmer au
  premier appel : que `gemini-nano-banana-2.1` est accepté par `generateContent` et que `imageConfig` y porte ce nom. Si Google
  refuse un champ, l'erreur le dit (`400`) et c'est une ligne à changer dans `gemini-image.ts`. Le modèle répond dans sa taille
  « 1K » pour le rapport de côtés le plus proche (16:9 pour 1280×720) : le moteur recadre et met à l'échelle.
- **fal.ai** : le texte de la file d'attente et les URL de statut, de résultat et d'annulation viennent de la réponse de
  l'envoi (elles n'utilisent que le propriétaire et l'application du modèle, `fal-ai/wan`, jamais l'identifiant complet) ; la
  clé n'est envoyée qu'à `queue.fal.run` et `fal.run`. La poignée de la requête est gardée avec la tâche (`providerRef`) : une
  nouvelle tentative interroge la **même** requête, elle n'en paie pas une seconde. Une tâche annulée demande l'annulation à fal
  (au mieux : une requête déjà lancée peut être facturée). Un plan fait au plus 10 secondes (161 images à 16 par seconde).
  La facturation de FLUX est arrondie au mégapixel supérieur (règle lue sur la page du modèle, à vérifier sur une vraie facture).
- **Hedra** : écrit d'après l'API publique de Hedra (docs.hedra.com), **jamais appelé** : chaque nom ci-dessous est à confirmer au premier vrai appel. La clé va dans l'en-tête `x-api-key`, uniquement vers `api.hedra.com` (jamais vers le Cloud ni vers le fichier du résultat). Le déroulé : `POST /assets` (type `audio`) puis `POST /assets/{id}/upload` (multipart, champ `file`) pour envoyer la voix ; `POST /generations` avec `ai_model_id`, `start_keyframe_id` (le portrait), `audio_id` et `generated_video_inputs { text_prompt, resolution, aspect_ratio }` ; `GET /generations/{id}/status` jusqu'à `complete` (le lien de la vidéo est lu dans `url` ou `download_url`). À confirmer : l'identifiant de Character-3 (`d1dd37a3-…`, sinon prends celui de `GET /models` et mets-le dans `hedra.model`), les noms des états, la durée maximale d'une génération (l'adaptateur la limite à 120 s ; le moteur ne demande que 4 à 20 s) et le tarif réel par seconde (l'adaptateur compte 0,025 $, le plancher de la page tarifs : si la facture est plus haute, change `HEDRA_USD_PER_SECOND` dans `hedra.ts` et le coût de la grille). L'identifiant du portrait (`avatarId`) est celui d'une **image déjà envoyée dans ton compte Hedra** (Assets). La poignée de la génération est gardée avec la tâche (`providerRef`) : une nouvelle tentative interroge la **même** génération, elle n'en paie pas une seconde. Hedra ne documente pas d'annulation : une tâche annulée arrête d'attendre, la génération peut quand même être facturée.
- **Moteurs d'images et de clips (production-8, décision 0035)** : un adaptateur par moteur, dont l'identifiant EST celui du
  moteur (`image:…`, `clip:…`) ; une tâche qui nomme son moteur l'atteint par le registre, comme les voix. Un moteur n'est réel
  que si `paidCalls` est `on`, s'il est dans `"realEngines": [...]` de `config.json` et si sa clé est au coffre. **Jamais appelés** ;
  chaque ligne dit ce qu'il faut confirmer au premier appel. Un refus de contenu donne une erreur qui commence par `refused:`
  (jamais retentée) ; 429 et 5xx se retentent ; la poignée d'une tâche longue est gardée (`providerRef`) pour que la nouvelle
  tentative reprenne la **même** tâche. ⚠ Le devis (`cloud/src/http/routes-user.ts`, contrôle de `engine`) n'accepte encore que
  les moteurs de voix : à élargir aux moteurs d'images et de clips avant le premier appel réel.
  - `image:gpt-image-25-low` / `-medium` (`openai-image.ts`, clé `OPENAI_API_KEY`) — pages lues le 01/11/2026 :
    https://developers.openai.com/api/docs/guides/image-generation (platform.openai.com/docs/… y redirige) et
    https://developers.openai.com/api/docs/pricing. `POST /v1/images/generations` (JSON) sans référence, `POST /v1/images/edits`
    (multipart, une partie `image[]` par référence, au plus 4) avec. À confirmer : (1) **le nom du modèle** : le guide cite
    `gpt-image-2.5-sunburst` (précision d'édition) et `gpt-image-2.5-flare` (génération rapide), pas de `gpt-image-2.5` seul ;
    l'adaptateur envoie `flare` pour générer et `sunburst` pour éditer (constantes `OPENAI_GENERATE_MODEL` / `OPENAI_EDIT_MODEL`) ;
    (2) qu'une taille libre comme `1280x720` passe (multiples de 16, rapport ≤ 3:1, 655 360 à 8 294 400 pixels) ; (3) le nombre
    maximal d'images d'une édition (non écrit ; on en envoie 4) ; (4) **le prix** : GPT Image 2.5 est facturé au jeton (30 $ le
    million de jetons de sortie), pas à l'image ; on rapporte la ligne du moteur (0,0059 $ bas, 0,0132 $ moyen) et on garde les
    jetons dans `data.usage` pour la comparer aux vraies factures ; (5) un blocage rend `400` avec `code: moderation_blocked`.
  - `image:flux-schnell` (`fal.ts`, clé `FAL_KEY`) : l'adaptateur fal existant, images seulement, pas de référence ; le négatif
    est écrit « Avoid: … » à la fin de la consigne. Rien de nouveau à confirmer.
  - `image:nano-banana-2` (`gemini-image.ts`, clé `GEMINI_API_KEY`) — page lue le 01/11/2026 :
    https://ai.google.dev/gemini-api/docs/image-generation. Modèle `gemini-3.1-flash-image` (la page l'appelle la génération
    précédente et conseille `gemini-nano-banana-2.1`, mais le prix de 0,067 $ du moteur est celui de `gemini-3.1-flash-image`).
    Les références partent en parties `inlineData` après le texte dans le même `generateContent`. À confirmer : que `generateContent`
    accepte plusieurs images en entrée (la page ne montre que l'API « Interactions », où le texte vient avant les images, jusqu'à 14
    images), le nom `imageConfig`, et le choix du modèle.
  - `clip:wan22` (`fal.ts`, clé `FAL_KEY`) — page lue le 01/11/2026 : https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video/api.
    Avec `imageArtefactId` : `fal-ai/wan/v2.2-a14b/image-to-video` (`image_url` = le lien signé du plan, `negative_prompt`), sinon le
    texte vers vidéo ; 480p, 0,04 $ la seconde. À confirmer : que le point d'accès image prend les mêmes `num_frames` /
    `frames_per_second` et se facture pareil (la page ne donne pas de prix).
  - `clip:minimax-h3-lite` (`minimax-video.ts`, clé `MINIMAX_API_KEY`, la même que la voix) — pages lues le 01/11/2026 :
    https://platform.minimax.io/docs/guides/video-generation.md , …/api-reference/video-generation-v2-create.md , …-v2-query.md ,
    …-v2-delete.md , …/pricing/overview.md . `POST /v2/video_generation` (modèle `MiniMax-H3-Lite`, `content` avec une image
    `first_frame`, `resolution`, `duration`, `ratio`), sondage `GET /v2/query/video_generation/{id}` (`queued/running/succeeded/failed`,
    lien dans `content.url`), annulation `DELETE` d'une tâche encore en file. À confirmer : (1) que `MiniMax-H3-Lite` est bien le
    « Hailuo 3 Lite » voulu ; (2) un `ratio` explicite avec une image de départ (la page dit que l'image vers vidéo utilise toujours
    `adaptive`, mais que H3-Lite ne le prend pas) ; (3) les durées 6 et 10 s (la page dit 4 à 15) ; (4) **le prix** : 0,025 $/s en
    480P, 0,04 $/s en 768P (utilisé), alors que `engines.ts` dit 0,03 $/s : à aligner ; (5) un refus de contenu est `422` code `1026`.
  - `clip:veo31-lite-vertex` (`veo.ts`, clé `VERTEX_SERVICE_ACCOUNT_JSON` = le JSON de la clé d'un compte de service) — pages lues
    le 01/11/2026 : https://ai.google.dev/gemini-api/docs/video , https://ai.google.dev/gemini-api/docs/veo ,
    https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate . **L'API Gemini ne sert plus Veo 3.1**
    (les modèles « preview » ont été arrêtés le 22/10/2026) : l'adaptateur passe par Vertex (`veo-3.1-lite-generate-001`, statut
    « Preview », 4/6/8 s, 720p ou 1080p). **La page de référence REST n'a pas pu être lue** : `predictLongRunning` /
    `fetchPredictOperation`, les champs (`instances[].image.bytesBase64Encoded`, `parameters.aspectRatio / durationSeconds /
    resolution / generateAudio / negativePrompt`) et la réponse (`response.videos[].bytesBase64Encoded`, `raiMediaFilteredCount`) sont
    ceux de l'API Veo de Vertex telle que je la connais : **tout est à confirmer**. À confirmer aussi : le projet et la région
    (`us-central1`), que Lite accepte `generateAudio: false`, le jeton OAuth (JWT RS256 contre `oauth2.googleapis.com/token`, portée
    `cloud-platform`), et **le prix** (ligne du moteur 0,03 $/s ; des sites tiers donnent 0,05 $/s en 720p et 0,08 $/s en 1080p).
  - `clip:veo31-lite-relaxed`, `clip:veo31-lite`, `clip:veo31-fast` (`veo.ts`, clé `UNIFICALLY_API_KEY`) — par unifically.com, pages
    lues le 01/11/2026 : https://unifically.com/ , https://docs.unifically.com/ , …/api-reference/v1-tasks.md ,
    …/models/video/google/veo-3.1.md . `POST https://api.unifically.com/v1/tasks` (`google/veo-3.1-lite-relaxed`, `-lite`, `-fast` ;
    `input { prompt, start_image_url, duration 4|6|8, aspect_ratio, resolution 720p, allow_audio_filtered }`), sondage
    `GET /v1/tasks/{id}` (`processing/completed/failed`, `output.video_url`, `error_message`). À confirmer : (1) la forme d'un refus
    de contenu (la doc n'en définit pas : un échec dont le texte parle de politique, sécurité, modération ou contenu bloqué devient
    `refused:`) ; (2) **les prix** : seul le relaxed est publié (0,075 $ le clip de 8 s en 720p) ; lite 0,15 $ et fast 0,3 $ viennent
    de `engines.ts` (`dry_run: true` rend le coût gratuitement) ; (3) l'attente : la file « relaxed » est lente, l'adaptateur attend
    une heure puis la nouvelle tentative reprend la même tâche ; (4) pas de champ pour le négatif : « Avoid: … » dans la consigne ;
    (5) les conditions d'un revendeur (disponibilité, données envoyées) à lire avant d'ouvrir au public.
- **Pexels** : la clé va seule dans l'en-tête `Authorization` (pas de `Bearer`). Les photos sont prises en `large2x` (environ
  1880 px) : à confirmer que c'est assez haut pour une miniature verticale 9:16. Les vidéos sont le plus petit mp4 d'au moins
  1280 px. L'attribution (« Photo by X on Pexels ») est demandée, pas exigée : elle est gardée avec chaque résultat et la
  description du paquet YouTube la liste sous « Crédits images ». Les photos de Pexels ne doivent pas être revendues telles
  quelles ni servir à refaire Pexels : le Cloud ne remet à l'utilisateur que les images dont sa vidéo a besoin.
- **Wikimedia Commons** : seules les licences domaine public, CC0, CC BY et CC BY-SA sont gardées (jamais NC ni ND, les
  vidéos sont vendues). CC BY et CC BY-SA **exigent** le crédit (`attributionRequired`) ; CC BY-SA demande en plus qu'une
  œuvre dérivée garde la même licence : à valider avec un juriste avant la vente (retire-la dans `licenceUsable` si besoin).
  L'API ne filtre pas l'orientation : le Cloud filtre sur la taille. Les vidéos de Commons sont en `webm`/`ogv` et
  souvent lourdes : au-delà de 40 Mo un fichier est ignoré, jamais coupé.
- **Les moteurs du présentateur** (section 13) : écrits d'après les pages publiques lues le 2026-11-01, **jamais appelés**.
  À regarder au premier vrai appel de chacun :
  - *HeyGen Avatar IV* : les pages de référence (docs.heygen.com, devenu developers.heygen.com) ne se sont pas ouvertes ce jour-là :
    **tous** les noms sont à confirmer : `POST upload.heygen.com/v1/talking_photo` (corps = octets de l'image, réponse
    `data.talking_photo_id`), `POST upload.heygen.com/v1/asset` (la voix, réponse `data.id`), `POST api.heygen.com/v2/video/generate`
    (`character.type = talking_photo`, `use_avatar_iv_model`, `voice.type = audio`, `dimension`), `GET /v1/video_status.get`
    (`pending | waiting | processing | completed | failed`). Aussi : le prix de 0,05 $/s, la durée maximale d'un appel (180 s
    retenue par prudence), et la règle « un `avatarId` de 32 caractères hexadécimaux est un visage déjà enregistré ».
  - *Hedra Character-3* : que `1080p` est accepté, les prix par résolution (0,025 / 0,05 / 0,0625 $/s), et « 60 s par appel » (une autre
    page parle de moins en 1080p).
  - *Kling Avatar v2 standard (fal)* : le prix par seconde (la page du modèle n'en donne pas), la résolution réelle de sortie (aucun
    paramètre de résolution n'existe), la durée maximale de la voix.
  - *InfiniteTalk rapide (WaveSpeed)* : la page donne 0,015 $/s sans prix par résolution ni paramètre `resolution` (envoyé quand même,
    ignoré s'il est inconnu) ; le 0,03 $/s du 720p vient de nos recherches. Durée facturée : entière, de 3 à 600 secondes.
  - *InfiniteTalk sur GPU (RunPod)* : tout le worker est à vérifier (`deploy/runpod/infinitetalk/README.md`, « À vérifier ») ; côté Cloud,
    que `executionTimeout` et `ttl` de la politique de RunPod coupent bien le travail, que `executionTime` est bien le temps facturé, et le
    démarrage à froid (`delayTime`).
- **Voix du catalogue** : la liste de voix que l'app affiche vient encore des voix de démonstration ; avec un fournisseur
  réel, le `voiceId` passé au Cloud doit être celui du fournisseur.
- **Revente** : les conditions de revente de chaque fournisseur restent à vérifier avant l'ouverture au public.

## 7. Ce que le moteur fait des nouveaux usages

- **Banque et archives** : `visuals.fulfil` fait **une recherche par image de banque** (`stock.photo`, `stock.video`) : le
  Cloud cherche (Pexels ou Wikimedia, ou les fichiers de démonstration), télécharge les meilleurs résultats, et le moteur
  garde le premier dont l'orientation convient. Le choix par les « yeux » (juger les candidats en les regardant) viendra
  plus tard et remplacera cette seule fonction (`pickBest`, `src/engine/nodes/visuals-stock.ts`). La licence et la ligne de
  crédit de chaque image sont gardées dans l'enregistrement `images` du nœud (et restent dans le cache). Une vidéo de banque
  donne pour l'instant sa première image (le rendu ne place que des images), annoncé comme « dégradé ». Une recherche qui ne
  trouve rien retombe sur une image générée, annoncée aussi. Un fournisseur qui échoue (clé refusée, plus de crédit) ne
  retombe **pas** en silence : l'erreur est montrée.
- **Miniatures** : le nœud `thumbnail.make` écrit 3 concepts (Claude : un titre court en majuscules, une description
  d'image, la place du titre), fait dessiner l'image par `generateImage` en 1280×720 avec la consigne « aucun texte dans
  l'image » (les modèles écrivent mal), puis **pose lui-même** le titre en gros caractères avec un contour épais (ffmpeg, police
  Inter Bold) sur un voile sombre ou une bande jaune. La première miniature est la choisie : à la validation du
  propriétaire, son choix remplace la sortie avec la miniature choisie en tête. Le dossier du paquet reçoit `thumbnail.png`
  (les autres en `thumbnail-2.png`…, et un `thumbnail.jpg` si le PNG dépasse 2 Mo, la limite de YouTube).
  Dans Planning, le bouton « Télécharger la miniature » ouvre ce dossier quand `thumbnail.png` y est.
- **Vidéo générée** : `visuals.fulfil` fait **un job `generateVideo` par plan `video.gen`** : la consigne du réalisateur (plus une
  consigne de mouvement de caméra), la durée du plan coupée à celle du plus long clip du fournisseur (10 s), le format du film
  (16:9 ou 9:16). Le clip est gardé avec un enregistrement (`clips`), son image de départ sert d'image au plan. Le rendu le pose
  comme une vraie vidéo : mise à l'échelle et recadrage au cadre, 30 images par seconde, son du clip jeté ; un plan jusqu'à 1,3 fois
  plus long que le clip le ralentit, au-delà la dernière image est tenue (un clip réel n'est jamais rebouclé), un clip trop long est
  coupé. Un fournisseur qui échoue n'est plus remplacé en silence par une image animée : l'erreur est montrée. En démonstration le
  clip est dessiné ici (un zoom lent et une barre qui défile). Facturé à la seconde (`video.seconds`).
- **Avatar parlant** : le nœud `avatar.speak` découpe dans la voix le passage de chaque plan « avatar » (exactement les images du plan,
  pour que les lèvres suivent les mots), l'envoie au Cloud (`talkingAvatar`, Hedra) et garde un clip de la même durée. Par défaut le
  réalisateur ne met le présentateur que sur **l'accroche et la conclusion** (`avatar` du réalisateur : `segments`, `layout`,
  `hookS`, `outroS`), parce que c'est la ligne la plus chère. Deux mises en page : `full` (le présentateur est le plan, il remplace
  les plans de banque ou d'image qu'il couvre) ou `pip` (un carré en bas à droite avec une ombre douce, au-dessus du plan, la piste
  de base ne change pas). Si le budget est trop juste, le présentateur est rendu en images de banque sous la voix, la conclusion
  d'abord. Un dessin de pipeline avec une étape « Avatar » est compilé vers ce nœud (l'identifiant du portrait est l'entrée
  facultative `avatar`) ; sur un fond de gameplay le présentateur est forcément en `pip`.
- `providers try` ne couvre toujours que la voix et les yeux : un essai à la main des images ou de la banque n'est pas encore
  prévu (les tests, eux, passent par un faux `fetch`).

- **Voix du catalogue** : la liste de voix de la plateforme vient encore des voix de démonstration (le catalogue y ajoute
  les voix clonées par l'équipe, qui sont de vraies voix MiniMax) ; avec un fournisseur réel, le `voiceId` passé au Cloud
  doit être celui du fournisseur. Lister les voix système de MiniMax (`get_voice`) reste à faire.
- **Revente** : les conditions de revente de chaque fournisseur restent à vérifier avant l'ouverture au public.

## 8. Cloner une voix (MiniMax, et les moteurs de voix de la chaîne)

**Depuis production-5** : la voix appartient à la chaîne (Production, voix de la chaîne ; IPC `channelVoices.*`). On la crée
de trois façons : **décrite** (ElevenLabs propose trois essais, on en garde un), **clonée** d'un enregistrement (10 s à 5 min)
ou, à l'import d'une chaîne qui est **à toi**, de 30 à 60 s de parole prises dans une de ses vidéos (la voix est alors
**proposée** et il faut l'accepter), ou **importée** (l'identifiant d'une voix qui existe déjà chez un fournisseur). Aucun
clonage sans la case « c'est ma voix / j'ai l'accord écrit » (décision 0025) : qui, quand et quoi sont gardés avec la voix.
L'échantillon d'origine est gardé : la même voix peut être clonée sur plusieurs moteurs (par défaut ElevenLabs et MiniMax,
ceux de la pipeline avatar@1), et une voix créée sur ElevenLabs est clonée sur un moteur moins cher à partir d'une minute de
texte qu'elle lit d'abord. Le **test d'écoute à l'aveugle** (`channelVoices.blindTest`, ou `npm run voice:blind-test` en
démo) écrit le même texte de 30 s par chaque moteur en A, B, C… et la clé à part (`cle.json`). La musique sous la voix
d'une vidéo n'est pas encore retirée : l'isolation d'ElevenLabs (`POST /v1/audio-isolation`, 0,12 $ la minute) pourra
passer avant le clonage une fois son prix confirmé.


Dans l'app, **Production › Briques › Mes voix › Ajouter une voix** : on choisit un enregistrement (mp3, m4a ou wav, de 10 s à
5 min, 20 Mo au plus), on lui donne un nom, et le Cloud le clone. Côté Cloud c'est l'usage `cloneVoice`
(`audioArtefactId` d'un fichier envoyé par la route d'envoi, `name`, `language`), tarifé par l'article de grille
`voice.clone` (1,50 $ de coût fournisseur, 10 % de marge : 160 crédits au barème de départ, comptés **une fois par voix**).
Le Cloud télécharge le fichier par son lien signé, l'envoie à MiniMax (`POST /v1/files/upload`, `purpose=voice_clone`), puis
appelle `POST /v1/voice_clone` avec un `voice_id` que nous choisissons (`clone-` + 16 chiffres hexadécimaux tirés de
l'identifiant de la tâche : la même tâche redemande la même voix). La voix clonée est ensuite une voix comme les autres :
elle apparaît dans le catalogue de l'équipe (et seulement le sien) et se passe en `voiceId` à `synthesize`.

Le clonage n'a **pas** de réglage propre dans `config.json` : il est réel quand `providers.synthesize` vaut `minimax`, que
`paidCalls` est `on` et que la clé est au coffre ; avec ElevenLabs (qui n'a pas d'adaptateur de clonage ici) ou en démo, il
reste une démonstration (voix fictive `clone-…`, rien de réel dépensé, badge démo). À vérifier avec une vraie clé : la page de
MiniMax ne donne ni le format de la réponse du clonage, ni la liste de ses codes d'erreur, ni les règles du `voice_id` ; le
succès est `base_resp.status_code == 0`. Les frais de première utilisation que MiniMax signale dans `usage_voice_count` ne
sont plus ajoutés au coût d'une synthèse : ils sont déjà celui de la tâche de clonage.

## 9. Hedra, l'avatar parlant : activer, coût, usage

Hedra fait parler un portrait avec **notre voix** (celle de MiniMax ou d'ElevenLabs) : l'audio entre, une vidéo de présentateur
sort. Rien ne change tant que tu n'as pas fait les trois choses de l'introduction.

1. **Le portrait.** Envoie une image de ton présentateur dans ton compte Hedra (Assets) et note son identifiant : c'est l'`avatarId`
   (l'entrée « Avatar » du pipeline, ou le paramètre `avatarId` du nœud `avatar.speak`).
2. **La clé.** `npm run cloud -- vault set HEDRA_API_KEY` (la valeur se tape sans écho).
3. **Le réglage.** Dans `config.json` : `"talkingAvatar": "hedra"` (dans `providers`) et `"paidCalls": "on"`, puis redémarre le Cloud.
   Vérifie sans rien appeler : `npm run cloud -- providers status` doit afficher `talkingAvatar  hedra  real`. Sinon la ligne dit
   pourquoi elle reste en démo (« paidCalls is off », « the platform key is not in the vault », « this usage is set to the fake
   provider »).

**Coût.** 0,025 $ la seconde de clip chez Hedra (prix plancher) : 1,50 $ la minute. Un
film de 8 minutes avec le présentateur sur l'accroche (8 s) et la conclusion (8 s) coûte 16 secondes, soit 0,40 $ côté
fournisseur, au lieu de 12 $ pour un présentateur de bout en bout. La grille (`avatar.seconds`) vaut 0,02 $ au départ (chiffre
provisoire) : aligne-la avec `npm run cloud -- admin price set avatar.seconds --cost 0.025 --margin 25`. Une tâche est facturée au
nombre de secondes de la voix envoyée ; le Cloud garde le montant du devis en réserve et rend ce qui n'a pas servi.

**Sans clé, ou en démonstration.** Le Cloud répond avec son clip de démonstration ; le mode démonstration du moteur (`fake`) dessine
lui-même une silhouette dont la bouche suit la forme d'onde de la voix. `npm run engine:avatar-demo` en fait un film de 20 secondes
(un plan en vidéo générée, un présentateur sur l'accroche, puis le même film avec le présentateur en carré), sans réseau.

## 10. YouTube Data API : les données de chaîne, en lecture seule

L'usage `channelData` lit les **chiffres publics** d'une chaîne (titre, abonnés quand ils sont publics, et pour ses dernières vidéos : titre, vues,
date, durée, mentions « j'aime », commentaires) avec l'**API YouTube Data v3**. Les concurrents que tu suis dans Chaînes › fiche › Styles
sont lus ainsi ; les vidéos qui font bien mieux que le reste de leur chaîne (les « outliers ») nourrissent le sujet des vidéos et les
idées du Cerveau, et les meilleures sont confiées aux yeux (Gemini) pour construire le profil de style de la chaîne.

**Lecture seule, toujours.** L'adaptateur (`cloud/src/providers/youtube.ts`) n'envoie que des `GET` sur trois méthodes de liste :
`channels.list`, `playlistItems.list` et `videos.list`. Il n'utilise **aucun jeton OAuth, aucune portée (scope)** : seulement une clé d'API,
envoyée dans l'en-tête `x-goog-api-key` (jamais dans l'adresse, donc dans aucun journal). Il n'y a dans le code ni envoi de vidéo, ni
commentaire, ni note, ni Studio ; un test vérifie que chaque requête est un `GET` sur l'un des trois points d'accès. La règle du
projet (CLAUDE.md) reste : **Atelier n'écrit jamais sur YouTube**.

**Activer.**

1. Dans la [console Google Cloud](https://console.cloud.google.com/), crée un projet (ou prends celui des outils internes).
2. *API et services › Bibliothèque* : active **YouTube Data API v3**.
3. *API et services › Identifiants › Créer des identifiants › Clé API*. Ne crée **pas** d'« ID client OAuth » : il n'en faut pas.
4. Sur la clé, *Restrictions relatives aux API* : « Restreindre la clé » à **YouTube Data API v3** seulement. Si le Cloud tourne sur une
   machine à adresse fixe, ajoute aussi la restriction par adresse IP.
5. Mets la clé au coffre : `npm run cloud -- vault set YOUTUBE_API_KEY` (la valeur se tape sans écho, comme au §1).
6. Dans `config.json` : `"providers": { "channelData": "youtube" }` et `"paidCalls": "on"`, puis redémarre le Cloud.
   `npm run cloud -- providers status` doit afficher `channelData  youtube  real`. Comme pour les autres fournisseurs, il faut les trois
   conditions de l'introduction ; sinon l'usage reste en démo (le Cloud répond avec une chaîne de démonstration, sans réseau).

**Le quota.** L'API est gratuite jusqu'à **10 000 unités par jour et par projet Google** (remise à zéro à minuit, heure du Pacifique).
Chaque appel de liste coûte **1 unité** ; lire une chaîne et ses 30 dernières vidéos en coûte donc **3** (la chaîne, une page de la
liste de ses envois, un appel `videos` pour les chiffres), 7 pour 120 vidéos. Le Cloud **compte chaque appel avant de le faire** et le
garde en base (table `provider_quota`, migration 008), donc un redémarrage n'oublie rien.

- Budget : `"youtube": { "dailyQuota": 8000 }` dans `config.json` (8 000 par défaut, 10 000 au plus). Une lecture qui ferait dépasser le budget
  est **refusée avant tout appel**, avec un message qui dit combien d'unités sont déjà prises ; la tâche échoue et ses crédits sont rendus.
- Si Google répond tout de même `quotaExceeded` (un autre outil du même projet a épuisé la journée), le compteur passe au budget plein et le
  Cloud ne redemande rien avant le lendemain.
- `search.list` (100 unités l'appel) n'est **jamais** utilisé. Une chaîne se trouve par son identifiant (`/channel/UC…`), son `@nom`, son ancien nom
  d'utilisateur (`/user/…`) ou par le lien d'une de ses vidéos (une unité de plus). Un lien `/c/nom` n'a pas de recherche gratuite : il est
  refusé, avec la façon de le corriger.

**Le prix.** Google ne facture rien (`costUsd: 0`) ; la ligne de grille `channel.request` fait payer notre travail de liant : **1 crédit** par lecture
d'une chaîne. L'analyse des vidéos choisies (les yeux) est facturée à part, par minute regardée (§4).

**À vérifier avec une vraie clé** (écrit d'après la documentation, jamais appelé) : que `forHandle` accepte le `@` dans la valeur ; que la liste des
envois (`contentDetails.relatedPlaylists.uploads`) est bien rangée du plus récent au plus ancien ; que les comptes cachés (`hiddenSubscriberCount`)
reviennent à `null`. Une erreur de Google nomme son motif (`keyInvalid`, `quotaExceeded`…) dans le message de la tâche, jamais la clé.

**Dans l'app.** Chaînes › fiche d'une chaîne › Styles et pipelines, en mode réel : la liste des concurrents suivis, « Lire les chaînes »,
les vidéos qui surperforment, « Analyser les 5 meilleures vidéos » et « Construire le profil ». La méthode des outliers
(`src/shared/outliers.ts`) compare les vues d'une vidéo à la médiane des vidéos de la même chaîne **du même âge** (les 9 plus proches en âge, au moins 3) ;
à partir de 2 fois cette médiane et de 500 vues, c'est un outlier ; les vidéos de moins de 2 jours ne sont pas jugées. Une vidéo très récente est
comparée à des vidéos plus anciennes, donc jugée avec prudence.

## 11. Connexion Google : les vrais chiffres de TES chaînes (YouTube Analytics, lecture seule)

Le §10 lit les chiffres **publics** de n'importe quelle chaîne avec une clé d'API. Ici, c'est autre chose : Atelier lit, avec **ton compte
Google**, les chiffres **privés** des chaînes dont tu es propriétaire : vues, durée de visionnage, abonnés gagnés et perdus, **revenus
estimés** (AdSense). Ils remplissent les cartes de Chaînes (« connectées »), l'Accueil et Monétisation (la ligne AdSense de chaque chaîne
reliée et le bloc « YouTube ce mois-ci »). Sans connexion, rien ne change : les chaînes restent « non connectées » et Monétisation garde
les revenus saisis à la main, avec un bouton « Connecte Google ».

**Lecture seule, toujours.** Atelier ne demande que trois autorisations, toutes en lecture :
`yt-analytics.readonly` (statistiques), `yt-analytics-monetary.readonly` (revenus estimés) et `youtube.readonly` (la liste de tes chaînes).
Une autorisation qui contient autre chose (une écriture, un envoi de vidéo…) est **refusée et rendue à Google** ; une autorisation où tu as
décoché une des trois aussi. Le code n'appelle que `channels.list?mine=true` (API YouTube Data) et `reports.query` (API YouTube Analytics v2,
`ids=channel==MINE`). La règle du projet reste : **Atelier n'écrit jamais sur YouTube**.

**Ce qui est gardé, et où.** Le secret du client et le jeton de rafraîchissement sont **chiffrés** par le système (`safeStorage`, comme les
autres secrets de l'app) ; ils ne vont jamais à l'écran (seulement « enregistré / pas de secret ») ni dans un journal. Le jeton d'accès (une
heure) reste en mémoire. Les chiffres lus sont gardés dans la base de l'app (migration 023 : `google_channels`, `google_channel_days`),
relus **une fois par jour** et quand tu cliques « Actualiser maintenant ». « Déconnecter » révoque l'autorisation chez Google et efface ces
chiffres.

### Créer le client OAuth dans Google Cloud Console (une seule fois, une dizaine de minutes)

1. Ouvre la [console Google Cloud](https://console.cloud.google.com/) avec **le compte Google propriétaire de tes chaînes** et crée un projet
   (par exemple « Atelier »). Tu peux aussi reprendre celui de la clé du §10.
2. *API et services › Bibliothèque* : active **YouTube Analytics API** et **YouTube Data API v3** (la seconde est peut-être déjà active
   pour le §10).
3. *API et services › Écran de consentement OAuth* (dans la nouvelle console : *Google Auth Platform*) :
   - type d'utilisateurs **Externe** ;
   - nom de l'application « Atelier », ton adresse comme adresse d'assistance et comme contact du développeur ;
   - dans *Accès aux données* (« Data access »), tu peux ajouter les trois portées ci-dessus ; ce n'est pas obligatoire, Atelier les demande
     de lui-même ;
   - laisse l'état de publication sur **« Test »** (« Testing ») ; ne lance pas la validation par Google ;
   - dans *Utilisateurs test* (« Audience › Test users »), ajoute **ton adresse** (celle du compte propriétaire des chaînes). Seuls les
     utilisateurs test peuvent se connecter.
4. *API et services › Identifiants › Créer des identifiants › ID client OAuth* (dans la nouvelle console : *Clients › Créer un client*) :
   - type d'application **« Application de bureau »** (« Desktop app ») ; nom « Atelier bureau » ;
   - **aucune adresse de redirection à saisir** : pour ce type de client, Google accepte d'office `http://127.0.0.1` sur n'importe quel
     port, et c'est ce qu'Atelier utilise (une adresse locale, sur un port tiré au hasard, ouverte le temps de la connexion).
5. Google affiche l'**ID client** (`….apps.googleusercontent.com`) et le **code secret du client** (`GOCSPX-…`). Pour un client « Application
   de bureau », Google ne considère pas ce secret comme confidentiel (il est dans chaque copie de l'app) ; Atelier le chiffre quand même.

### Où le coller

- **Dans l'app** : Réglages › Chaînes › bloc **« Google : les chiffres de tes chaînes »**. Colle l'identifiant et le secret, « Enregistrer
  le client », puis **« Connecter Google »**. Ton navigateur s'ouvre sur la page de Google : choisis le compte (et, si Google le demande, la
  chaîne), coche les trois accès, valide. La page affiche « Atelier est relié à Google » : reviens dans Atelier, les chiffres arrivent.
- **Ou par l'environnement** (une machine de test, sans rien coller) : `ATELIER_GOOGLE_CLIENT_ID` et `ATELIER_GOOGLE_CLIENT_SECRET`. Ce qui
  est collé dans les réglages passe avant.
- Ensuite, dans le même bloc, chaque chaîne YouTube du compte dit quelle chaîne Atelier elle alimente. Le lien se fait par **l'identifiant
  `UC…` ou le `@nom`** inscrit dans la chaîne Atelier ; s'il manque, choisis la chaîne dans « Relier à » (Atelier y inscrit l'identifiant).

### Bon à savoir

- **En mode « Test », Google fait expirer l'autorisation au bout de 7 jours** (sa documentation le dit pour les applications externes en
  test). Atelier le voit tout seul : le bloc passe à « À reconnecter » et Monétisation le signale ; un clic sur « Reconnecter Google »
  suffit, les derniers chiffres restent affichés en attendant. Pour ne plus avoir à le faire, il faudra un jour publier l'écran de
  consentement (validation par Google) ; si ton compte est un compte Google Workspace qui possède lui-même les chaînes, le type **Interne**
  évite aussi l'expiration.
- **Les revenus** n'existent que pour une chaîne du Programme Partenaire : pour les autres, Atelier lit quand même les vues (« pas de
  revenus » dans le bloc) et Monétisation garde l'AdSense saisi à la main. Les montants sont demandés **en euros** ; ce sont des estimations
  de YouTube, qui arrivent avec 2 à 3 jours de retard.
- **Le quota** : chaque actualisation fait un appel `channels.list` (1 unité du quota YouTube Data du projet, le même que celui du §10) et un
  appel Analytics par chaîne (deux si la chaîne n'est pas monétisée). Une fois par jour, c'est très loin des limites. Si Google répond quand
  même « quota dépassé », le bloc l'écrit et Atelier réessaie le lendemain, sans insister.
- **Plusieurs chaînes** sur le même compte (comptes de marque) : Atelier lit celles que `channels.list?mine=true` renvoie pour le compte
  choisi dans le navigateur ; s'il en manque une, reconnecte-toi en choisissant cette chaîne.
- **Avec un ordinateur d'équipe connecté** (Réglages › Ordinateur d'équipe), la connexion Google reste sur ton ordinateur à toi (c'est ton
  navigateur et ton compte) ; les chiffres sont rattachés aux chaînes par leur identifiant YouTube, où qu'elles soient.
- **À vérifier avec le vrai compte** (écrit d'après la documentation de Google, jamais appelé) : que `reports.query` accepte `currency=EUR`
  avec `estimatedRevenue` ; qu'une chaîne non monétisée répond bien 403 sur les revenus (et non une ligne à zéro) ; que la page de
  consentement propose une case par portée. Les tests (`tests/unit/google-*.test.ts`) utilisent un faux Google, sans réseau.

## 12. Où sont les sources

- MiniMax T2A : https://platform.minimax.io/docs/api-reference/speech-t2a-http (lu le 2026-10-24) ; prix :
  https://platform.minimax.io/docs/guides/pricing-paygo ; clonage : https://platform.minimax.io/docs/guides/speech-voice-clone
- ElevenLabs : https://elevenlabs.io/docs/api-reference/text-to-speech/convert , `…/convert-with-timestamps` ,
  https://elevenlabs.io/docs/eleven-api/resources/errors.md , https://elevenlabs.io/docs/overview/models ,
  https://elevenlabs.io/pricing/api
- Gemini images : https://ai.google.dev/gemini-api/docs/image-generation (lu le 2026-10-24)
- fal.ai : file d'attente https://fal.ai/docs/model-apis/model-endpoints/queue , FLUX schnell
  https://fal.ai/models/fal-ai/flux/schnell/api , Wan 2.2 https://fal.ai/models/fal-ai/wan/v2.2-a14b/text-to-video/api
  (lus le 2026-10-24)
- Hedra : https://docs.hedra.com (non relu pendant ce lot : l'adaptateur est écrit d'après l'API publique telle qu'elle est connue, voir la section 6) ; prix : https://www.hedra.com/pricing
- YouTube Data API v3 : https://developers.google.com/youtube/v3/docs (channels.list, playlistItems.list, videos.list) et le coût en quota https://developers.google.com/youtube/v3/determine_quota_cost
- YouTube Analytics API v2 : https://developers.google.com/youtube/analytics/reference/reports/query et les métriques
  https://developers.google.com/youtube/analytics/metrics ; OAuth des applications de bureau (adresse locale, PKCE) :
  https://developers.google.com/identity/protocols/oauth2/native-app ; expiration des jetons en mode test :
  https://developers.google.com/identity/protocols/oauth2#expiration
- Pexels : https://www.pexels.com/api/documentation/ (lu le 2026-10-24)
- Wikimedia Commons : https://www.mediawiki.org/wiki/API:Search , https://www.mediawiki.org/wiki/API:Imageinfo ,
  https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia
- Gemini : https://ai.google.dev/gemini-api/docs/video-understanding , https://ai.google.dev/api/generate-content ,
  https://ai.google.dev/gemini-api/docs/pricing

## 13. Les moteurs du présentateur

Le présentateur de l'IA est une photo qui parle avec TA voix. Il y a **cinq moteurs**, un par choix de qualité ; une vidéo en utilise
**un seul** du début à la fin (le visage change d'un moteur à l'autre). Chacun a son adaptateur réel, dont l'identifiant EST celui du
moteur, et reste en démo tant que tu ne l'as pas activé. Les longueurs et les prix sont dans `src/shared/presenter-engines.ts` ; les
prix sont ceux lus les 30 et 31 octobre 2026 (provisoires, à relire sur la page du fournisseur avant tout appel).

| Moteur | Ce que c'est | Prix | Un appel au plus | Clé du coffre |
|---|---|---|---|---|
| `presenter:heygen-avatar4` | HeyGen Avatar IV par l'API : le visage est enregistré une fois (« look »), puis la vidéo est générée | 0,05 $/s | 180 s | `HEYGEN_API_KEY` |
| `presenter:hedra-c3` | Hedra Character-3 (540p, 720p, 1080p) | 0,025 / 0,05 / 0,0625 $/s | 60 s | `HEDRA_API_KEY` |
| `presenter:kling-avatar2-std` | Kling Avatar v2 standard, par la file de fal | 0,0562 $/s | 60 s | `FAL_KEY` |
| `presenter:infinitetalk-fast` | InfiniteTalk rapide, hébergé chez WaveSpeed (480p, 720p) | 0,015 / 0,03 $/s | 60 s | `WAVESPEED_API_KEY` |
| `presenter:infinitetalk-gpu` | InfiniteTalk (modèle ouvert) sur un GPU RunPod loué à la seconde | **≈ 0,005 $/s, estimation** | 60 s | `RUNPOD_API_KEY` |

**Les fichiers.** La photo et la voix ne partent jamais sur un hébergeur public : elles viennent du stockage du Cloud, par un lien signé
court (décision 0025). HeyGen et Hedra reçoivent les octets (envoyés par le Cloud) ; Kling, WaveSpeed et le GPU reçoivent le lien. Le Cloud
doit donc avoir une adresse publique en https (`"publicUrl"` dans `config.json`, le Cloud allumé) pour ces trois-là ; sinon l'adaptateur
refuse avec le message qui le dit. La clé du fournisseur n'est jamais envoyée vers un lien de fichier.

**Les échecs.** Une voix plus longue que le maximum du moteur est refusée avant tout appel (le moteur de vidéo coupe en plusieurs appels). Un
travail qui reprend après une coupure interroge la **même** génération (il ne la repaie pas). Un démarrage dont on n'a pas reçu la réponse
n'est **pas** rejoué tout seul (il a peut-être été accepté et facturé) ; seule une réponse « trop de demandes » (429) l'est.

### Activer un moteur

1. La clé : `npm run cloud -- vault set NOM_DE_LA_CLÉ` (voir le tableau ; rien ne s'affiche quand tu la tapes).
2. Dans `config.json` : `"paidCalls": "on"` et le moteur dans `"realEngines"`, par exemple
   `"realEngines": ["presenter:kling-avatar2-std"]` (la liste prend aussi les moteurs de voix). Redémarre le Cloud.
3. Le GPU loué demande en plus son endpoint : `"infinitetalk": { "endpointId": "…", "gpu": "4090" }` (voir plus bas).
4. Essaie avec UN appel (section 5, « Présentateur »). Sans l'étape 1 ou 2, la commande refuse et dit pourquoi.

### Ce que renvoie le Cloud

`data.engine`, `data.resolution`, la durée facturée ; pour HeyGen, **`data.registration`** : l'identifiant du visage enregistré, que
l'app garde par moteur et repasse en `avatarId` à la vidéo suivante (le visage n'est enregistré qu'une fois). Le mode démo renvoie
`fake-look-…` (huit signes tirés de l'identifiant de la photo).

### Le GPU loué et son plafond

Le Cloud envoie à RunPod, avec chaque travail, une **limite de temps d'exécution** (`executionTimeout`, réglable par
`"maxGpuSeconds"`, 1800 s par défaut) et une durée de vie (`ttl` = limite + `"coldStartReserveS"`, 180 s par défaut, le démarrage à
froid). Un travail coûte donc **au plus (limite + réserve) × prix de la seconde de GPU**, quoi que fasse le modèle. Prix du GPU
(RunPod serverless) : 4090 1,34 $/h, 5090 1,79, L40S 1,75, A100 2,72, H100 5,39. Le coût
facturé au client est le temps de calcul réellement utilisé × ce prix ; le démarrage à froid est noté à part
(`data.coldStartS`). Le worker à déployer est dans `deploy/runpod/infinitetalk/` (README en français, **écrit d'après le dépôt public,
jamais lancé**).

### Le benchmark du GPU (décision 0015 : 20 $ au plus, lancé par Charlie)

Il faut : le worker déployé et son endpoint dans `config.json`, `RUNPOD_API_KEY` au coffre, `"paidCalls": "on"` et
`presenter:infinitetalk-gpu` dans `realEngines`, le Cloud allumé sur son adresse publique (ou un stockage R2), ffmpeg sur le PC, une
photo et une voix d'**au moins 60 secondes**.

```
npm run cloud -- providers try talkingAvatar --engine presenter:infinitetalk-gpu --image visage.png --audio voix.mp3 --bench --budget-usd 20 --out bench-gpu
```

- Avant tout appel : « Plan : … » puis **« Coût maximum : X $ (plafond 20 $) »**. Rien n'est demandé ensuite.
- Quatre essais, l'un après l'autre : 10 s en 480p, 10 s en 720p, 30 s en 720p, 60 s en 720p (la voix est coupée avec ffmpeg ; un essai plus
  long que la voix est laissé de côté).
- Chaque essai a sa part du budget (15 %, 20 %, 25 %, 40 %) et sa limite de temps est calculée sur **ce qui reste** après les précédents
  (exécution + démarrage à froid comptés ; un essai en échec est compté à son plafond entier). Le total ne peut donc pas dépasser
  `--budget-usd` ; ce plafond ne peut pas dépasser 20 $ (la commande refuse davantage).
- Résultat : `bench-gpu/bench.json`, les vidéos, et un tableau « secondes de GPU par seconde de vidéo | dollars par minute de vidéo |
  démarrage à froid ». Compare avec l'estimation (≈ 25 s de GPU par seconde de vidéo en 720p, soit 0,56 $ la minute sur 4090 serverless)
  et **regarde les vidéos** (lèvres en français). Le résultat sert à fixer le prix de ce moteur dans `engines.ts` et la grille.
- Un essai sans `--bench` (une seule génération, 60 s de voix au plus) marche aussi sur le GPU : `--resolution 480p|720p`.
