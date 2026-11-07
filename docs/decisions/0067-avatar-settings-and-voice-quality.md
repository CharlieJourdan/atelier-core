# 0067. Avatar's settings by group, each with its price a minute; ai33 while we test, MiniMax HD to release

Date: 2026-11-02. Status: accepted. Decided by: Charlie (« la voix de AI33 Pro est horrible » then « pas MiniMax par défaut,
surtout pas pour les tests ; c'est plutôt quand on sortira des vidéos ») + Claude (avatar-reglages-voix).

## Context
Charlie wants the Avatar base pipeline to offer, simply, the character, the voice, the offer, the presenter's shots, layouts and
acting in the pictures, and the editing's intensity, each with its effect on the price and a before / after. His blind ranking
of Marcel's voice: real > MiniMax > ai33. ai33 (OpenSpeaker) clones with its own model and takes no model or language from us.

## Decision
1. **The settings are `avatar@1` options, shown by group** (le personnage, la voix, l'offre, le montage, le script) in the
   pipeline page and summarised in « Nouvelle vidéo »: the presenter's shots, « Mises en page du présentateur » (full / + half
   screen / + inset), « Qui apparaît dans les images », « Qualité de la voix », the sponsor and « Où va ton offre » (over the
   channel sheet's place), « Montage » simple or dynamique (director `pace` 0.75), captions, chapters, music, the script. The
   character's look, outfit and setting and the voice itself (picked, cloned, designed) are the channel's: a one-off cost.
2. **Every choice shows its Δ credits a minute from the estimator**, and the run's forecast agrees: the still beside a
   half-screen or inset presenter is priced (`besideShare`, Headcast reference 1: 80 % of the presenter's time), the pace
   shortens every shot. avatar@1's cap follows (4 900).
3. **ai33 stays the default voice while we test; MiniMax HD is « Haute qualité (pour publier) »** (+8.9 credits a minute);
   ElevenLabs direct is « premium », « bientôt » until its key is in the vault. New voices are cloned on ai33 and MiniMax
   (MiniMax charges its 1.50 $ only when it first speaks the voice).
4. **A before / after the fakes cannot show is cut from our real videos** (`real` in `OPTION_PREVIEWS`) and the preview seed
   never remakes nor deletes it.

## Consequences
- The voice benchmark and the blind set on Marcel's voice inform the release choice.
- Charlie's 01/11 cost ladder keeps its assumptions in its test (no still priced beside a half-screen presenter).
