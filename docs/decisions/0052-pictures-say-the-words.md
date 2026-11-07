# 0052. Pictures say the words: hard anchors, talk to the presenter, the reference's grammar, an illustration check every run

Date: 2026-11-01. Status: accepted. Decided by: Charlie (his verdict on the second real hook, run 5) + Claude (avatar-qualite part 2).

## Context
Run 5 looked good but its shots did not illustrate the words under them: « il faut que ce soit coupé au moment même, ultra
précis, de ce qui est dit ». The audit: the voice timings are exact (the
render's silences match the word pauses within 0.03 s); meaning was lost because a directive's anchor was only a preference
(5 of 10 directives cut elsewhere or merged), the presenter was placed by a time quota on the most visual sentences while talk
sentences got pictures of ideas (a hand on a « healthy » wall, a mason wiping a trowel, gloves for « quatre temps »), and a
shot left without a directive could take an unrelated subject. 427 shots of Charlie's two Headcast videos, labelled against
their words: 95 % show what the words say, the angle follows what is said,
the camera is steady, talk sentences are the presenter's.

## Decision
1. **A directive's anchor is a hard cut** when it falls within the shot's natural length plus 1.5 s; a length cut never passes an
   anchor and prefers a sentence start. Each sentence gets as many directives as its time off the presenter (one a ~3.5 s, at
   least one from a second on); the scene pass is told so, and a top-up call fills what is still short.
2. **Talk to the presenter**: one small call (fast tier, cached; a rule on the words without Claude) sorts the sentences talk /
   show; the presenter's placement takes talk sentences first, waits before a show sentence when a talk one follows, and never
   ends a shot in the last 1.2 s of a sentence.
3. **The reference's grammar in the director's rules** (`ILLUSTRATION_GRAMMAR`): literal; the angle by what is said; what
   happens in the words happens in the picture; steady phone photos and videos at eye level, close, in the references' soft grey
   overcast light; no on-screen text labels in `avatar@1` (`labelsPerMin` 0, the references have none). A shot without a fresh
   directive shows the same subject from another angle, never a new one. The clips' default motion keeps the camera still and
   moves the hands or the object.
4. **An illustration check every run** (`visuals-illustration.ts`, `visuals.fulfil` param `illustration`, on by default): Claude
   (the director's backend, free on the subscription) looks at each generated still with the words spoken under its shot
   (`GenItem.context.said`) and scores it 0–10 with its angle; under 8 it is rewritten with the judge's prompt and made again
   once, before any clip is made from it (the clip then moves the new scene). Verdicts are cached by the picture's bytes, its
   words and its prompt: a rerun never pays the same remake twice. The images record keeps each score.
5. **Pictures in the LLM layer**: `CompletionRequest.images` (and the engine's `ClaudeService.ask`): Claude Code reads them with its
   Read tool, allowed on their folders only; the Anthropic API gets image blocks.

## Consequences
- On the same hook, a real director pass now puts every picture on the words that name it (the spray, the mould behind the
  wardrobe, the roller, the sack of lime, a hygrometer for « sec et tiède ») and the presenter on the talk sentences.
- One more cheap call per video (the talk / show sort) and one judge call per six pictures; remade stills cost about 0.006 $ each.
- The judge varies a little between passes (Charlie's trowel 5 then 7): the bar is 8, the verdicts are cached per picture.
- The estimator's « continuous » presenter ratio (23.9 s a minute) is now a ceiling: with the presenter on talk sentences the
  cutaways are fewer (≈ 20.7 s a minute on the fake film).
