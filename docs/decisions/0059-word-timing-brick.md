# 0059. « Minutage des mots »: every word timed on the voice we ship, by Whisper on this computer

Date: 2026-11-02. Status: accepted. Decided by: Charlie (on run 7: « c'est ultra important de ultra bien transcrire avec
Whisper ou je sais pas quoi pour savoir exactement ce qui est dit à quel moment… tu peux carrément le mettre dans une techno »)
+ Claude (avatar-qualite part 5).

## Context
Run 7's spray picture came before « spray », the repaint before « repeint ». The voice engine (ai33) returned no word times,
so `voice.tts` timed the words with its pause aligner; with pauses cut to 0.3 s it put sentences in the wrong pauses:
« L'an dernier, vous l'aviez frotté avec un spray du supermarché » in 1.2 s, « spray » at 14.41 s. faster-whisper large-v3,
run on the same file, hears it at 17.32 s, and « repeint » at 20.50 s instead of 17.14 s (2.9 and 3.4 s); the voice's
times were more than 0.15 s off for most words between 13 and 30 s. The engine could already use a speech recogniser
(`AsrService`), but the app gave it none.

## Decision
1. **A brick of its own, `words.align@1` « Minutage des mots »**, right after the voice in every base pipeline (`avatar@1`,
   `voiceover@1`): it hears the final narration (after `voice.trim`) and times every script word on what it heard (matched
   word by word; the few words it misses placed between their heard neighbours). Every later brick reads `@words` from it
   (director, beats, presenter, captions, sponsor, music). Its log says how far the voice's own times were.
2. **The recogniser is local and free**: faster-whisper large-v3 (`media/whisper.ts`), spawned without a shell with a fixed
   Python program, on the graphics card (CUDA) and else on the processor (int8, about real time: 56 s for run 7's 58 s),
   cached by the audio's bytes. `nodeHost` gives it to every run (app, brain).
3. **It never breaks a run**: no Python with faster-whisper, a failure, or under 80 % of the words heard: the voice's own
   times are kept and the log says why. A demonstration run never starts it. A person's own recording (`voice.own`) is still
   timed by the recogniser inside its node.
4. **The director cuts on the heard times**, with the pipeline's lead (`cutLeadS`, avatar@1: 0.1 s, the references measured
   the same way). Then, for a pipeline that cuts on the word: a picture that starts more than 0.15 s before the word that names
   it is moved onto it when the shot before can hold (the presenter up to its run limit); what cannot move is listed in the
   plan's diagnostics and the log (`director-cutcheck.ts`). A filler picture never shows a directive before its word (run 7:
   the spray from « L'an dernier »). The last picture before the presenter may be as short as the references' shortest (1.1 s).
5. **Talk and show** (`presenterOnTalk`): a sentence that names something is never the presenter's, whatever the curve asks;
   when the opening sentence names something, the presenter says its first clauses and the picture comes on the clause that
   names it (« Ce matin, en cherchant les couvertures d'hiver, » | « vous avez décalé l'armoire de la chambre du fond »); a
   talk sentence is the presenter's unless the part is well ahead (run 7 gave « je vais vous dire honnêtement » and « en quatre
   temps » pictures of an idea). The presenter's hook share can fall short of the curve: the words decide.
6. **The illustration check keeps the better picture**: a remake that scores lower puts the first one back (run 7: 7 then 5,
   and the 5 was kept).

## Consequences
- On run 7's real voice, the director replayed with part 4's recorded pass: every picture on a directive starts 87–107 ms
  before its word (spray 17.23 for 17.32, repaint 20.40 for 20.50), against up to 3.5 s early in run 7 as rendered.
- The graphics card needs the CUDA 12 libraries for faster-whisper (`py -3.13 -m pip install nvidia-cublas-cu12
  nvidia-cudnn-cu12==9.*`, about 1 GB, to be approved by Charlie); until then the processor does it.
- Pipelines saved before this record lack the brick; a new pipeline from a base has it.
