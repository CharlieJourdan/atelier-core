# 0015. Economy: margins, quotes, caps, plans with included credits, packs
Date: 2026-10-30. Status: accepted.
Decided by: Charlie (his words).

## Context
Charlie's words:
- « Les prix doivent ne pas être beaucoup plus chers que les providers » (10-24); credits for API work, auto top-up
  when low; « lui l'utilisateur aura juste des crédits qu'il peut acheter » (10-24).
- Margin per item « entre 20 et 50 » depending on the provider and on how much cheaper than the public price we buy
  (resellers, group buying); « que ça soit avantageux pour les gens d'utiliser notre tool plutôt que de build le
  leur » (production-1).
- Smallest plan « entre 50 et 80 »; every plan includes credits; « garder 30 euros de marge sur le plus petit », the
  rest in included credits; bigger plans give more channels and credits, and must be a better deal than buying
  credits, which stays possible with a margin (§13).
- Benchmark: a competitor sells video at 99 $ for 114 min (0,87 $/min ≈ 0,80 €/min), 0,66 $/min (≈ 0,61 €/min) on its
  best plan, non-adaptive and without agents; Atelier's price per minute should be « dans ces eaux-là », profitable,
  a video never expensive, cheaper than building one's own system (§13).
- Quote overrun: « marge de 10 %, puis stop » (production-1).
- Monetisation tab: cost per video and channel vs revenue (10-24).

Simulation (2026-10-30 list prices; 1 $ = 0,92 €; render on the team computer ≈ 0):

| Finished video | Real cost | Per minute |
|---|---|---|
| Documentary 9 min, no avatar, Nano Banana images | 4,07 € | 0,45 € |
| Documentary 9 min, FLUX images | 1,95 € | 0,22 € |
| Avatar 9 min, presenter 30 % (« hybride »), open model on rented GPU (estimate) | 5,07 € | 0,56 € |
| Avatar 9 min, presenter 30 %, Hedra 540p | 7,87 € | 0,87 € |
| Avatar 9 min, presenter 70 %, open model (estimate) | 6,41 € | 0,71 € |
| Avatar 9 min, presenter 70 %, Hedra 720p / HeyGen | 23,38 € | 2,60 € |
| Short 60 s, presenter 50 %, Hedra 720p / open model | 2,86 € / 1,52 € | — |
| Script + director on « Crédits Atelier » (Sonnet 5.5) | + 0,46 € per 9-min video | + 0,05 € |

Reading: documentaries already sit under the competitor's price per minute; avatar videos reach it only with an open
model on a rented GPU and a hybrid presenter share; a hosted avatar API at 70 % presenter costs 3–4 times more.

## Decision
- **1 credit = 0,01 €** of consumption (0003). Each grid line = real cost × (1 + margin), **margin 20–50 % per
  item**, and **never above the provider's public price** (the grid's `referenceEur` = list price): discounts we get
  (resellers, volume) become our margin, never a higher user price. Charlie's own team pays the real cost.
- **Quote before every project**, per stage and total. A run may spend up to **quote + 10 %**; beyond, it stops and
  asks (the owner, or the agent under its caps).
- **Caps**: per video (default = the recipe's cap), per channel per month, per team per month; never crossed, agent
  included.
- **Plans = the tool + included credits.** The plan pays the app, the agents and the team computer; the included
  credits pay generation. **Smallest plan: 30 € of margin, the rest in credits** (costed at real cost). Bigger plans
  give more channels and more credits at a better rate; each upgrade buys credits cheaper than packs do.
- **Packs** stay available, priced above the plans' marginal rate (proposal: 2 000 credits 25 €, 10 000 for 115 €,
  50 000 for 550 €; 24–32 % margin). **Auto top-up** opt-in, with a monthly cap chosen by the user.
- **The default recipes are efficient** (« On fait de l'efficience »): cheap bricks by default (e.g. FLUX for B-roll,
  open-model avatar once proven, presenter « hybride » 30 %), better ones per recipe when the channel needs them. The
  quote shows the price per finished minute.
- **Monetisation** shows cost per video, per channel and per finished minute.

## Charlie's answers in production-1 (the four open points)
1. **Smallest plan: 69 €.** Grid: 69 / 149 / 299 / 599 € a month for 1 / 3 / 8 / 20 channels (names and the
   Enterprise tier later), excl. VAT.
2. **Team computer: a very small always-on PC per team for the agents, renders on demand.** Charlie: « le plus
   rentable serait de prendre vraiment un tout petit PC pour faire tourner l'équivalent d'un navigateur pour les
   agents … pour les rendus, on fait juste à la demande ». Why a per-team PC at all: the user's Claude subscription
   must run on a machine dedicated to that user (0013, Claude Code legal page) and the agents work 24/7 while the
   user's own computer is off; without it every agent would run on paid « Crédits Atelier ». Size: 2 vCPU / 4 GB
   (≈ 6 € a month: Hetzner CX23 5,99 €; Contabo / OVH equivalents as a second provider while Hetzner is out of
   stock), 4 vCPU / 8 GB from the 299 € plan, 8 vCPU / 16 GB on the 599 € plan. **Renders** run on shared machines
   billed per second (≈ 0,03 $ per 10-minute video, ≈ 0,3 cent per finished minute, estimate from per-second CPU
   prices), included in the plan, not billed in credits; an Atelier-owned render server (≈ 100 € a month) only when
   volume passes ≈ 4 000 videos a month. **No GPU for assembly** (the ffmpeg graph is CPU-bound and already ≈ 4 min
   for 10 min of video); rented GPUs serve the avatar only.
3. **Avatar: benchmark the open model** (InfiniteTalk-class on a rented RunPod GPU), **budget 20 $ maximum**, run by
   Charlie himself once production-4 has built the GPU brick. Hosted APIs stay candidates for the case study.
4. **No free trial.** « Zéro essai gratuit, rien de gratos … faut payer avant d'y accéder. » Access to the app, the
   web app and the Cloud requires a paid plan.

Resulting grid (simulation at 2026-10-30 list prices; production-5 re-checks them):

| Plan | Channels | Team PC + renders | Margin | Included credits | Documentary minutes (€/min) | Hybrid avatar minutes, open model (€/min) |
|---|---|---|---|---|---|---|
| 69 € | 1 | ≈ 6,30 € | 31 € (44 %) | 3 200 | 55 (1,26) — ≈ 110 with FLUX (0,63) | 44 (1,57) |
| 149 € | 3 | ≈ 6,90 € | 45 € (30 %) | 10 800 | 185 (0,81) | 148 (1,00) |
| 299 € | 8 | ≈ 10,20 € | 75 € (25 %) | 24 400 | 417 (0,72) | 335 (0,89) |
| 599 € | 20 | ≈ 18,90 € | 130 € (22 %) | 51 600 | 882 (0,68) | 709 (0,85) |

Margins at 100 % use of the included credits (usual use is lower, so real margins are higher). Packs: 2 000 credits
25 €, 10 000 for 115 €, 50 000 for 550 € (24–32 % margin); each plan upgrade buys credits cheaper than a pack.

## Consequences
- production-5 enters these numbers in the grid (new Cloud migration or `admin price set`), the plans and packs, and
  the quote / cap behaviour.
