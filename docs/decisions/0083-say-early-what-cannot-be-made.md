# 0083. « Créer une pipeline » says early what Atelier cannot make, and what it does instead

Date: 2026-11-03. Status: accepted. Decided by: Charlie (03/11, through the coordinator: « dire tôt et honnêtement si le style est
reproductible, en partie ou pas du tout… proposer ce qu'Atelier sait faire à la place… proposer des humains… lister les technologies
qui manquent ») + Claude (essais-utilisateur).

## Context
Twelve links a new user might paste (a studio cartoon trailer, a 3D city timelapse, a music teaser, a podcast, a vlog, a recap of an
animated series, a webcam monologue, a 3D-game war channel, a 3D essay, a drawn business story, an archive documentary, a finance
channel with a filmed presenter) all came back « la pipeline reprend ce style » at 38–80 / 100. The eyes called filmed footage and
hand-made animation « AI clips ». Channel links answered in demonstration (no YouTube key on the beta). Video titles were the eyes'
English summary. « Voir un exemple » ran in demonstration on a brain signed in to the Cloud.

## Decision
1. Every study carries a **feasibility** (`style-agent/feasibility.ts`, shown first by `Feasibility.tsx`): verdict (yes / partial /
   no), the share Atelier reproduces, the parts (made, approached, not made, with how), what the eyes did not watch, the people the
   pipeline needs, the technologies missing (import / build / train, with cost; « slot ready » when the owner can bring it today) and
   what Atelier does instead, priced from the pipeline's own ingredient options.
2. The code judges first from the measures and the page's words (title, description, credits, category); the agent's one call
   corrects it, but only ids from the fixed lists pass and the verdict follows the share; « reproductible » also needs every part of a
   quarter of the video or more made as it is; a reproducible style needs no one but a reviewer (or the owner's filmed head).
3. No likeness shown above that share. A style out of reach takes the agent's nearest base Atelier makes well, with that base's own
   mix (Yarnhub's 3D battles → archive documentary at 0.6 credit a minute, not 100 % generated clips at 1.7).
4. A pasted video asks « le style de cette vidéo / de toute sa chaîne »; the channel is read from the video's page.
5. Public pages are read on the owner's machine with yt-dlp (metadata only, no login, link after `--`): real titles, lengths (« j'ai
   regardé les 5 premières minutes sur 47 »), channels and, when the Cloud cannot read YouTube, a channel's latest videos and Shorts.
6. A style sample runs on the real engines whenever the runs can; a real engine refusing a demonstration voice says « donne-lui une
   vraie voix ».

## Consequences
- The verdict is as good as the words and the eyes: the eyes still watch 5 minutes; the whole-video capability (regarder-videos)
  is listed as a missing technology until it lands.
- A brand-new channel has no real voice (the Cloud's catalogue lists only demonstration voices and the team's clones): its first
  real run stops at the voice with what to do. A default real voice per language is a Cloud follow-up.
- No migration (the study's state is JSON).
