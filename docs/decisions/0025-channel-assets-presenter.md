# 0025. Channel assets: presenter, voice, style profile, sponsor; consent before any clone
Date: 2026-10-31. Status: accepted. Decided by: Charlie (10-24, 10-30, 10-31), written by the spec-avatar chantier.
Replaces the fake avatars list. Spec: `docs/specs/production-model.md` §6.4, `docs/specs/pipeline-avatar.md` §2.3,
§2.5, §2.13.

## Context
Charlie: creating the avatar (the presenter) is part of creating a channel or a pipeline; importing a channel clones
its voice and presenter, proposes them, and the user accepts; sponsoring is « plus propre à une chaîne qu'à une
pipeline », an input of the pipeline. Cloning a face or a voice without rights is a legal risk (0014 watch-outs).

## Decision
- A channel owns **assets** that pipelines read as `channel` inputs: presenter(s) (portrait, angles, per-engine
  registrations, linked voice), voice(s) (provider voice ids, the source sample, the cheaper clone), style profile
  (from the eyes: words per minute, mix, shot lengths, look), sponsor product (pitch, link, media, placement rule, QR),
  reference channels, custom instructions.
- **Consent step** before cloning a face or a voice: the user ticks that they own the channel or hold the rights to the
  face and the voice; the tick (who, when, what) is stored with the asset; no clone without it. Importing someone
  else's channel to clone its presenter is refused.
- Files sent to providers come from our own storage with short signed links, never a public anonymous host.
- A project without a channel asks for these inputs itself (one-off test videos).

## Consequences
- production-5 (voice) and production-7 (presenter) build the assets; the sponsor asset arrives with production-9.
