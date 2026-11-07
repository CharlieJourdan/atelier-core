# 0063. A video is charged at cost to the fraction of a credit, made 8 jobs at once, and cloned with its layouts and its world

Date: 2026-11-02. Status: accepted. Decided by: Charlie (on Marcel's first full video, through the coordinator: « trop cher, trop
long, le présentateur toujours plein écran, des objets américains ») + Claude (avatar-efficience).

## Context
Marcel's 12:58 video (record 0062) cost 936 credits ≈ 10.2 $ (0.79 $ a minute) and took 2 h; Charlie expects 0.5–0.6 $ a
minute and 30 min–1 h like Headcast. The admin P&L showed why the bill was high: 254 stills of 0.0043 € each were billed a whole
credit (0.01 €), and every Veo job was a « loss » (the capture left out the grid's 5 % overhead and used another $ → € rate than
the P&L). It took long because the Cloud ran **2 jobs at once for everybody**, the illustration check judged its 32 batches one
after another, and Whisper ran on the processor (15 min). It looked wrong because the presenter was full frame in all 51 shots
(the references go split screen and inset after the hook), and the pictures showed American outdoor units and breaker panels
and a corrugated duct for a 16 mm condensate tube.

## Decision
1. **Billing** (Cloud, migration 018): one cost per job for capture and P&L (`jobCostEur`: provider $ × dated rate × (1 +
   overhead)); a real job is charged `floor(carry + exact)` credits and the fraction is carried to the team's next job (no
   « at least 1 credit », except a cost-0 glue job). A finished provider video that cannot be downloaded keeps its reference and
   is downloaded again (never generated again); videos may be 400 MB; Veo relaxed resumes its own task after its max wait.
2. **Speed**: the Cloud runs 8 jobs at once, 4 per provider (HeyGen MCP 3), as settings (`ATELIER_CLOUD_MAX_JOBS`,
   `…_PER_PROVIDER`). The engine asks 8 stills, 8 clips, 3 presenter calls and 4 uploads at once, judges 3 illustration batches
   at once, and looks at a job less and less often (250 ms up to 3 s). Whisper runs on the graphics card (CUDA 12 + cuDNN 9
   installed with pip, asked by Charlie through the coordinator on 02/11): 63 s for 13 min of voice, was 15 min.
3. **Fidelity** (record 0055: pipeline settings, never engine limits): `director.plan` `presenterLayouts` (full frame before
   `fromS`, then split / inset / full in their measured shares) — `avatar@1` carries its references' `{ fromS 88, split 0.77,
   pip 0.23 }`; `locale` on `director.plan` and `visuals.fulfil` (`text/locale.ts`: the country's homes, equipment, brands,
   money, units), set from the channel's language when a pipeline is cloned; `objectNotes` (« subject: how it really looks »)
   in the director's rules and on the pictures that name the object.
4. **Cost levers for Marcel's pipeline**: the presenter's measured share (reference 2's curve), half the clips serving two shots
   (« Plans par clip : la moitié »), short shots on Grok at their exact length (already the default), fewer remakes from exact
   prompts (locale and notes). The levers are options and settings of the pipeline, chosen per channel.

## Consequences
- Marcel's video billed at cost would have been ≈ 8.6 $ (0.66 $ a minute) without the lost presenter call; with the levers the
  estimate is ≈ 0.52–0.55 $ a minute.
- A team may owe up to one credit it has not been charged yet (the carry); the P&L counts a job as a loss only when it is at
  least a credit under its cost.
- The SaaS cannot ask its users for a graphics card: words.align runs on the Cloud's GPU executor (`src/engine/cloud-gpu.ts`,
  RunPod serverless, the worker image with faster-whisper large-v3 and CUDA), about a minute of GPU for 13 minutes of voice
  (≈ 0.02–0.05 $), until then on the user's computer (CUDA when present, else the processor).
- Still sequential: the clips start only once every still is made and checked (the node boundary); the director's passes take
  11 min. Both are the next levers for speed.
