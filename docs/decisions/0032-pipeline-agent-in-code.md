# 0032. The pipeline agent in code: variants by rule, the model drafts on top, one pending change per pipeline
Date: 2026-11-01. Status: accepted. Decided by: the production-12 session, within decisions 0013, 0022, 0024 and 0030
(Charlie asked the chantier to settle open points with sensible defaults and record them).

## Context
production-12 builds the agent of `docs/specs/production-model.md` §10.1–§10.2 and §13 R13.1: it proposes two or three
variants of a pipeline for a channel (existing, to launch, or a concept), the user changes it by talking, every change is
a diff with Δ cost and Δ fit, saved as a new version when the owner accepts. The spec left these points open.

## Decision
1. **The variants are built by code, the model drafts on top.** `src/engine/technologies/propose.ts` builds them from the
   measured profile (`pipelineForProfile` of 0030) on the base `avatar@1`, priced with the estimator and scored with the
   fit; each is « the base + a list of edit operations », shown to the user. The model (one call, route
   `pipeline_architect`, tier best = Opus 5.5 while the role has no route of its own: 0013 « drafting a recipe ») then reads
   the variants, may adjust them only with edit operations (the same tools), and writes the summary and one reason per
   variant. Without a model, or when it fails, the code's proposal is shown with a plain note. Free, instant and testable;
   the model adds judgement (a concept's words, what the measures miss), never a free-text pipeline.
2. **The three variants.** Faithful = the profile with standard pictures (`quality.images: standard`, presenter eco);
   economical = eco pictures and presenter, half the AI clips (`clipShare` and the mix's clip share halved); premium =
   premium pictures and presenter. Faithful is recommended (the spec's « fidèle »). An economical variant that saves nothing
   (no clips, eco already) is not shown, so there are two or three. To tune with Charlie on real channels.
3. **Questions = what nothing measured.** Who writes the scripts (always, R6.12), a product or sponsor (when no video says),
   burnt-in captions (when no video says), the presenter's screen time (when no video measures it: 12 / 26 / 45 %). Each
   answer is a batch of edit operations added to every variant; answering re-applies the model's draft without a new call.
4. **Targets.** `channel` = the channel's own analysed videos; `niche` = the analysed videos of the competitors it
   watches (a channel to launch); `concept` = a text, no measure. « Je n'ai pas d'idée » only links to Chaînes; « J'ai déjà
   des pipelines » goes to the start screen (R13.1).
5. **One pending change per pipeline.** The conversation lives in `pipeline_messages` / `pipeline_changes` (migration
   031). A proposed batch is checked (`tryEdit`: the edit operations, then the estimator, typed errors otherwise), stored
   `pending` on the version it was made on, and replaces a change still waiting. Accepting goes through `recipes.edit` on
   the latest version (an edit saved meanwhile is kept or the batch is refused); rejecting changes nothing. An option is
   stored as its value: the diff shows the option, its bricks follow at compile (0027).
6. **Tools.** Three tools, the same everywhere: `pipeline_read`, `pipeline_try` (diff, Δ cost, Δ fit, nothing saved),
   `pipeline_propose`. Claude Code reaches them through the agents' MCP bridge (`askModel` now registers tools on it for one
   call); the fake calls them in-process; a provider without tools (API key, Codex) gets the same contract as a fenced
   block (` ```atelier-ops ` / ` ```atelier-proposal `), checked the same way. The team agents get them as technologies
   `pipeline.read|try|propose` (role `pipeline_architect`), on a team pipeline by id; their proposal waits in the
   pipeline's conversation for the owner. No agent ever saves a pipeline itself.
7. **Several channels.** `pipelineAgent.assign` sets the channels a pipeline serves for its video type (the others stop
   using it); each `channel` input shows what the channel has: its default active voice, its style profile version; the
   presenter and the sponsor are « à fournir » until their chantiers (production-7, the channel assets of 0025).

## Consequences
- The proposal costs nothing but the one model call on the owner's subscription; tests run on `FakeProvider`.
- When the eyes measure more (presenter time, look, words), the questions shrink and the faithful variant gets closer by
  itself. The reproduce-and-compare loop (§10.3), alternatives and the script database stay in the backlog.
