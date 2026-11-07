# 0074. Story shorts: the `story-short@1` base, a clip library made once per channel, one word at a time

Date: 2026-11-02. Status: accepted. Decided by: Claude (clone-reddit-shorts, a blind clone of Reddit Chroniques given only the
channel), within Charlie's standing orders (clone shot by shot, cheapest and fastest, settings not barriers, ai33 voices).

## Context
Reddit Chroniques (FR, 1 400+ Shorts) reads first-person stories at ≈ 310 words a minute over a stream of « satisfying » process clips
(factories, food, crafts: reposted Douyin / TikTok videos, not gameplay), one word at a time in the middle of the frame, the story's
title shown as a forum post for its first sentence, a soft music bed. Atelier had a Reddit drawing (gameplay folder, plain card,
`shorts` captions) but no base pipeline, no voice faster than 1.2×, no one-word captions, and no way to get the clips legally.

## Decision
1. A base `story-short@1` « Histoire Reddit (short) » (9:16, 2.5 min, cap 150 credits, no checkpoint): imported story (translated
   when needed, beats cut without a model), ai33 voice stretched to the measured pace (`voice.tts` `wpm`), director without a scene
   pass, the clip background, the post card, the `word` captions, a library music bed. Every number is a measured setting
   (`STORY_SHORT_PROFILE`), never an engine limit.
2. **The clips are a channel asset made once, never at production time**: `channelClips.*` fills `<userData>/channel-media/<id>/clips`
   from free sources (Wikimedia Commons keyless, filtered by title, motion and colour; Pixabay / Pexels through the Cloud) or the
   owner's own clips, normalised to 1080×1920 30 fps with their credits. A run reads the folder, the avatar and the channel's name as
   its `gameplay`, `channelAvatar` and `channel` inputs when it was given none; a project counts them before launching.
3. The pictures of a story short are never generated: the reference uses existing footage, so the clone uses found footage only
   (Charlie's rule, 02/11); no AI clip library is offered.
4. Every word is timed on the voice as heard (`words.align@1`, Whisper on this computer, free): the ai33 voice gives no word times, and
   estimated ones drifted 0.4 s median, 3 s at worst, at 310 words a minute (measured on the finished film; after: 0.0 s median).
5. A user decides what a reference cannot tell: the title card's picture, the music (theirs or the library's), the voice's speed and the
   clips' rhythm are options, asked in « Créer une pipeline ».
6. Captions `word`: Montserrat ExtraBold (OFL, bundled), sized in libass units calibrated on the reference (130 at 1080 px).

## Consequences
- A story short costs its voice: ≈ 0.01 $ a minute; ≈ 2.5 min of making for 2 min. Likeness 71.5 / 100 on Commons clips, ≈ 80 with
  clips of the reference's kind (the owner's or Pexels / Pixabay portrait videos).
- Not done: a vision pass that drops off-topic library clips (by hand today), a narrator voice per story gender, 60 fps, pricing the
  voice's reservation with its pinned engine (the cap leaves room for the generic hold).
