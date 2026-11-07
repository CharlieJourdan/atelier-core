# 0016. Recipe compiler: slots between bricks, checkpoints as owner gates, settings left open for the profile
Date: 2026-10-30. Status: accepted. Decided by: the production-2 session, within decisions 0010 and 0011.

## Context
0010 makes every technology a coded brick and 0011 orders bricks by stage in a recipe, interchangeable inside a stage.
production-2 had to turn a recipe into one `atelier.pipeline/1` without each technology knowing the others, keep the
channel's style profile (the « eyes ») working, and make checkpoints a channel setting.

## Decision
- **Slots.** Bricks hand each other named slots (`brief`, `script`, `voice`, `words`, `plan`, `images`, `subs`, `video`…).
  `@slot` reads the latest brick BEFORE this one that provides it (a translation replaces the script for every later
  brick); `@slot?` reads the latest one before, else the last one after, else stays unwired (the render reads captions
  and music wherever they sit in Montage). A brick may add params or inputs to an earlier brick's node (`contributes`:
  an avatar asks the director for presenter shots).
- **Settings.** Technology defaults < recipe < channel < project, each layer limited to the settings the technology
  lets it set (`not_overridable` otherwise). Channel and project settings are keyed by technology name (no version), so
  they survive a new version. A setting the profile also tunes (cuts per minute, picture mix, thumbnail look, call to
  action) is optional with no default: unset, the technology leaves the node param open and the profile fills it.
- **Checkpoints** (the recipe's, else the channel's, else topic + thumbnail) are `owner` gates on the node that provides
  the checkpoint's slot; every other node is explicitly `none` (the package and thumbnails no longer stop by default).
  A project's run is « tout d'un coup » between them.
- **One fixed mode.** Recipes compile with `budget.default: usage_max` and no `modes`; the cap is `budget.capCredits`.
- **Pages.** Production keeps its page ids (other screens route to them) and maps them to the new screens.

## Consequences
- A new technology is wired by naming slots, never by editing the compiler or another technology
  (`docs/ENGINE-SPEC.md` §42).
- A project needs a channel to run (a run needs a video, a video a channel); a project without one is kept.
- A project has ONE run: launched again after an interruption (app closed), a failure or a cancel, the same run is
  relaunched (finished steps reused); while it runs or once it succeeded, it is refused.
- The per-video cap is enforced where every run starts (`ProductionRuns`, also for library pipelines that carry one): a
  quote over the cap is refused before anything is created; the run's hold is its quote, so its spend stays under it.
- The old pipeline library, drawings editor and composer screens are gone from Production; their engine code
  (`from-drawing.ts`, `library_pipelines`) stays for the agents and the old runs until a later chantier retires it.
