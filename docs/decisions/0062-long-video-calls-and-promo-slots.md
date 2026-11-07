# 0062. A long video: the voice's cuts in groups, presenter calls of at most 60 s, the promo on every passage that names it

Date: 2026-11-02. Status: accepted. Decided by: Charlie (« fais une vidéo complète de Marcel », 01/11) + Claude
(marcel-complet).

## Context
Every real run before this one was one minute long. Charlie's first full video (Marcel, « Avant d'arrêter votre clim pour
l'hiver », 2 363 words, 12 min 58 s) failed twice on things a minute never reaches, and its script speaks of the channel's
own offer twice (an aside after the intro, « clip A », and the end, « clip C »), as reference 2 does.

1. `voice.trim` removed every long pause with ONE `aselect='not(between()+between()+…)'`. ffmpeg 8.1 refuses that sum above
   about 90 terms (90 parse, 100 fail, then « Cannot allocate memory »); a 13-minute voice has hundreds of pauses.
2. The presenter was planned in calls as long as the engine allows (HeyGen MCP: 180 s). A 162 s call was made by HeyGen and
   then refused by the Cloud's download: at 1080p the presenter runs about 4.8 Mbit/s (97 MB), the Cloud brings back at most
   40 MB a provider file (`STOCK_MAX_FILE_BYTES`).
3. Promo placement « mention » used only the first paragraph that names the offer: clip C had no slot.

## Decision
1. **The cuts go in `aselect` filters of 40**, chained; a selected frame keeps its time, so each one reads the untrimmed clock,
   and `asetpts` renumbers once at the end. Each cut still removes exactly its length (to a 10 ms frame).
2. **A presenter call is at most 60 s** (`callLimitS`, `presenter/talk.ts`), whatever the engine's own limit: 60 s of 1080p
   fit the Cloud's download. Engines price by the second, so the cost is the same (more calls, same seconds).
3. **Promo « mention »: the first and the last paragraph that name the offer** become its slots (mention, then reminder),
   each on exactly its words. The card's address group may come in later (`linkAtS`, « arrivée du site » in the channel's
   asset): reference 2 brings it at 5.7 s, reference 1 at 1.3 s (unchanged default).

## Consequences
- Marcel's video ran end to end on the third attempt: 936 credits ≈ 9.4 € (0.72 € a finished minute, of which 69 credits for
  a presenter clip of the failed attempt), about 2 h of making.
- The 162 s HeyGen generation of the failed attempt was made on the plan and lost; a presenter-sized download cap on the Cloud
  (a few hundred MB) is a follow-up, then calls may grow again.
- QC flags the promo card held still after its animation (≥ 4 s, « image figée »): the reference holds its card the same way;
  the owner approves it. Follow-up: QC skips promo windows.
