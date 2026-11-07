# 0089. « Créer une pipeline » is a conversation with a creation agent that watches whole videos, says what is real, and shows a real example before any claim

Date: 2026-11-03. Status: accepted. Decided by: Charlie (03/11, through the coordinator: « il faudrait plus se faire via un agent
conversationnel… analyser toutes les vidéos… dire qu'il y a une vraie personne… un stop complet quand ce n'est pas reproductible…
des imports avec de faux trucs en attendant… des exemples réels, pas des extraits de 17 secondes… pas que du texte ») + Claude
(chantier creation-conversationnelle; spec `docs/METHODE-REVERSE-PIPELINE.md`).

## Context
The form of record 0077 and the feasibility of record 0083 judged a channel from two videos' first minutes, answered in one wall of
text with approximate percentages, and showed 17-second samples. Charlie rejected it (essais-utilisateur, 03/11): no real example, an
analysis of « 5 minutes out of 48 », no sentence saying a real person is on screen, no loud stop for Yarnhub's 3D.

## Decision
1. **A conversation** (`src/main/production/creation/`, screen `production/creer`, IPC `creation.*`, migration 040): the user pastes a
   link; the agent asks every question at once (what to do — copy the channel, one video, my own channel, translate, inspiration, mix;
   which style when the channel has several formats, with their counts; the test budget 0/1/3/5/10 $), then works alone in the
   background and writes short messages carrying illustrated blocks (frames, bars, a verdict card, slots, an offer with its price, the
   example video, the side-by-side, the scores, the proposals). Typed messages are read for a link, a budget, a format; anything else
   is kept as an instruction. The Lab's « Créer une pipeline » opens it; the older ways sit under « Autres façons ».
2. **Whole videos, the latest and the best**: the two latest and the two most viewed of the chosen format (each once, 240 min at
   most), each downloaded normally (fixed arguments, decision 0085), kept for the side-by-side, and read whole by `eyes.watchVideo`
   (scene cuts, words by whisper or the video's own original-language captions, shots named by Claude at Haiku level). The structure
   is the video in ten parts with the share of each family and the mean shot; the hook is shown frame by frame.
3. **What is real**: one look (Claude, balanced tier) at a sheet of 16 frames spread over every video names the technique of each
   frame (filmed presenter, AI avatar, motion design, charts, documents, archive, stock, 3D CGI, 2D character animation, gameplay…) and
   says whether the presenter and the voice are real, with the evidence in a sentence. The shares are the logs' counted screen time,
   weighed by those techniques: the model never sets a share. Without a look, a presenter stays « je ne sais pas », never « real ».
4. **The verdict** (`verdict.ts`, pure): each technique has what Atelier does with it (yes / partly / no and how); « pas
   reproductible » when a third or more of the screen is out of reach (shown first as a red alert, with what Atelier can still do and
   three alternatives — the same subject as an archive documentary, a simpler 3D, the user's own 3D), « en partie » from 10 % out of
   reach or 20 % partly, else « reproductible ». A real presenter or a user's gameplay is an **import slot** with its placeholder (an
   invented presenter generated in the reference's set, a synthetic voice); the user is asked how the person enters the pipeline.
5. **A real example before any claim**: the pre-pipeline (the verdict's base, the measured presenter and motion shares, the measured
   cuts a minute, the reference's language, an imported narration the agent writes in the reference's construction on a new topic) is
   saved, its project quoted, and the agent asks « je te crée un exemple de 3 minutes ? » with the price range; nothing is spent
   before « oui ». The example is read back whole by the same eyes, set beside the reference (the hook on the same seconds, the body
   at the same share), scored per axis from a written defect list with weights (the score is 100 minus the weights: never typed), the
   edit review's remaining defects included (decision 0086), and re-scored by a blind second judge that only sees the frames and the
   numbers. When the test budget allows and the measures differ (presenter share, shot length), the next round is offered with what
   changes.
6. **Quota**: Haiku-level labels, one balanced look for the census and two for the scores, the best tier only for the narration.

7. **The example pipeline** waits at no validation (`checkpoints: []`; the user said yes to the whole example), takes the measured
   clip share through the option « clips » (its default would add a fifth), and a retest starts from the pipeline of the last example
   that was made. Raising the budget (« monte le budget à 9 $ ») or « réessaie » resumes the corrections.

## Consequences
- The creation is honest about time: hours for a channel (a 43-minute video reads in 15–25 minutes on the build PC).
- A brand-new channel still has no real voice by default: the example asks for one in plain French (follow-up: a default voice per
  language on the Cloud).
- The older form (`style.*`) stays reachable and unchanged; the agents' tools still use it.
