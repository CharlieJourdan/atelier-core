# 0008. Rebuild Production from zero: shared technologies, avatar first
Date: 2026-10-30. Status: accepted.
Decided by: Charlie.

## Context
The Production feature (pipelines, bricks, projects) is a good idea but does not work for a user today. The app shows
pre-made pipelines that nobody can really run.

## Decision
- Keep the concept: projects made of bricks. Rebuild the feature from zero on top of the existing engine core (0002).
- Remove the pre-made pipelines and the demo data from Production.
- « Technologies » (script writing, director, thumbnails in a style, voice, avatar, video generation…) are shared
  across channels and video types. They are adapted per channel and per video type, never rewritten.
- Adding or updating a technology must be easy, from a simple panel, without restriction.
- The first technologies imported serve AI-avatar channels, but none may be avatar-only.
- Users see what things cost: credits, quotes, caps. The first real APIs get connected with a written « what we use
  and why ».
- Order of tracks: Production (avatar first), then Agents autopilot, then channel creation/import.

## Consequences
- Production is split into chantiers 1 to 5. The old production and agent briefs are archived.
