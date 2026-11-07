# 0028. The script bricks: measured words per minute, support videos as summaries, fact check before the sponsor
Date: 2026-11-01. Status: accepted. Decided by: the production-4 session, within decisions 0013, 0021, 0022 and 0027 (the
spec `docs/specs/pipeline-avatar.md` §2.1, §2.2, §2.13 left these points open; Charlie asked the chantier to settle them).

## Context
production-4 builds the Idée and Script stages of `avatar@1`: `idea.brief`, `idea.support`, `script.write@2`, `script.import`,
`script.sponsor`, `script.factcheck`, and the option « Script ». Several points were open.

## Decision
1. **A new node version, not a change of `script.write@1`.** `script.write@2` keeps @1's writing (outline, parts, passes) and
   adds the avatar structure (`numberedParts`: list / mistake arc / auto), the persona line and the support videos. Its
   default words per minute are the measured ones of pipeline-avatar §2.2 (`wpmMeasured`: fr 180, en 180, de 155, it/pt 145,
   pl 130, es 160); @1 keeps ENGINE-SPEC R17.1's (150 in French). The channel's own rate (`wpm`) always wins.
2. **Models per use** travel with each call: `ClaudeService.ask` gains `tier` (`balanced` = Sonnet: outline, parts,
   revision, sponsor mention, fact check; `fast` = Haiku: length fitting, tagging an imported script, forbidden words). The
   app maps the tier to the tier model of Réglages; a model the owner pinned on the role wins. The backend is the default
   provider (« Mon abonnement Claude » = Claude Code, « Ma clé API » = Anthropic API) until production-14 adds the team
   switch and « Crédits Atelier ». The app's production host now has this Claude service (`src/main/production/claude.ts`):
   before, real (non-demo) runs had none.
3. **Support videos are read by the eyes only.** `idea.support` keeps the eyes' analysis (summary, hook, parts with their
   share of the length): never a transcript, so no wording of another channel reaches the prompts. No second model pass
   summarises it (the analysis is already a summary; the spec's « summary by Haiku » is dropped as redundant). Typed as
   lines `sujet : <lien>` / `structure : <lien>`; at most 3; an unreadable video is dropped with a note. « structure »
   feeds the outline prompt only; « sujet » feeds the outline and every writing prompt.
4. **The fact check runs before the sponsor mentions** (the spec listed it after): it must never « correct » the
   sponsor's own words. `addBrick` without `after` now places a brick before the first brick of its stage that reads what
   it provides, so the writer always comes before the mentions. Fixes apply only when the quote is unique in the whole
   script (stricter than « in the part »); the original is a second output beside the corrected script.
5. **The sponsor input is text** until the channel assets (0025) exist: JSON or `clé : valeur` lines (nom, pitch, lien,
   prix, placement début | milieu | fin, rappel, durée, prix dit). Each mention is its own paragraph on the paragraph break
   nearest to the rule; its sentences are listed in `json.outline.sponsor` by anchor. A spoken price is refused unless the
   rule allows it (one retry, then a template mention and a warning).
6. **The script gate is a brick setting.** Option « Script » has three values: `agent` (default, no gate), `agent-review`
   (`script.write.review = true`: an owner gate on the slot's final provider, so the owner sees the script with its
   mentions) and `import` (`script.import@1`, no gate). Manifests gain `ownerGate(settings)`; checkpoints are unchanged.
7. **`avatar@1` changes in place** (production-3: « unlock = remove `soon` »): `idea.research` + `script.write@1` become
   `idea.brief` + `idea.support` + `script.write@2` + `script.sponsor` (14 bricks). Research stays a brick an agent may add.

## Consequences
- Web search for the fact check needs the agents' MCP bridge (`webTools`); without it every part stays unchecked and the
  run says so (« n partie(s) non vérifiée(s) »). Wiring it is a follow-up.
- A copy of `avatar@1` saved with `script.write@1` cannot choose `agent-review` (`review` is a setting of @2 only).
- production-11 prices the new calls (Sonnet / Haiku volumes of production-model §9); production-14 adds the credits path.
