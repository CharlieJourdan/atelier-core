# 0112 — P4/P5 start from a ready base when one fits; every base setting is checked against the measurement

Date: 2026-11-04 · Chantier: moteur-base-existante (H) · Spec: `docs/METHODE-REVERSE-PIPELINE.md` § « Start from an existing
base » · Contract: 0095 (B 0096, C 0099, F 0100)

## Context
Charlie (2026-11-04): don't always start from zero. When Atelier already does a kind of channel well (an avatar channel →
the avatar base made from Marcel's style), the engine starts from that base, but the base is only a starting point: every
setting is checked against the channel's measurements and whatever differs is replaced. A base setting is never kept without
proof it matches. From zero only when no base fits (full animation). Goal: faster and cheaper for channels like those.

## Decision
1. **A registry of ready bases** (`clone/definition/base-registry.ts`): each base is a measured style (Style Definition
   paths → value + evidence from its own references, MEASURED fields only), the base pipeline that runs it, what it is good
   for, the improvements its own comparison rounds earned (`earned`) and what its renders proved (`proof`: rounds, blind
   « same channel », $/min, making time). First entry `avatar-marcel` (avatar@1, Marcel's two references as P4 measured
   them); not render-proven yet: `earned: []`, `proof: null` until chantier « Avatar · base Marcel » records its rounds.
   Tests and the app may inject other bases (`CloneServices.readyBases`).
2. **The match** (`base-match.ts`) reads only measured values and scores each base: gates first (presenter vs none, a
   channel mostly drawn or 3D against a base that is not), then origins of the pictures 0.45, presenter time 0.2, cutting
   pace 0.2, music 0.15. Below 0.6, or with origins under 50 % alike, no base fits; a channel with 30 % or more drawn / 3D
   screen never fits a base without it. Every candidate is recorded with its score and why.
3. **The verification** (`base-start.ts`, called by P4 after the measured fields are written): for every base setting,
   measured equal within the field's measurement tolerance → **kept** (with this channel's evidence; the value is the
   base's own only when its renders proved it, else the measurement); measured differently → **replaced** by the
   measurement; not measured here, or chosen per clone (presenter, voice, language, cost) → **dropped**, the definition's
   own default stays. Earned improvements apply only where this channel measures the same « before », and only to how the
   channel is cut, paced, laid out and sounds (never identity, presenter kind, timbre or voice descriptors); each applied
   round counts as an improvement round (the definition version; the measured definition before them is saved as v1),
   written like a P8 change (`measured`, the base's comparison sheet in its note). Tolerances: shares 3 points, loudness 1 LU, bed 2 dB, sync
   50 ms, other numbers 5 %, counts / identity / configurations / strings exact. The record is `definition.baseStart`.
4. **The rule kept, in P4's check**: a measured field may differ from its measurement only if the record keeps it within
   the engine's tolerance (recomputed, not trusted from the record) or it is an earned change of the same « before »;
   every kept / earned field must have been measured here; an earned record must be one the named ready base really earned
   (checked against the registry, never trusted); a field carrying a base note without a record is refused.
5. **P5** composes the bricks from the definition as before (decision 0099) and records in `plan.startedFrom` which of
   the base pipeline's bricks are kept, added and dropped. Settings still never come from a base (plan-rules.ts unchanged).

## Proof (fakes, `tests/unit/clone-base-start.test.ts`)
Another avatar channel (a mechanic, inset-heavy, 172 wpm) starts from `avatar-marcel`: identity, layout curve, voice,
words per minute and cuts replaced, equal settings kept, a look-alike of the mechanic's type; Marcel himself: nothing
replaced, his own presenter and voice; Le Monde en POV and Yarnhub: from zero, with why. An improvement Marcel's base earned
(transitions) transfers to the mechanic's channel because it measures the same « before »; one whose « before » differs
(cut pace) does not; an identity « improvement » never applies; a forged earned record is refused. P0→P10 on fakes: the
mechanism only — the « proven base » there is the same fake channel's own earlier run (its round-1 fix replayed), and a
fake round costs a fixed amount, so « 4 → 3 renders, 5.75 $ → 4.75 $, 1 440 s → 960 s, both same channel » shows that an
earned round is not run again, not the size of a real saving.

## Also in this chantier: P3 shares agree with their analyses
A real single-video clone (a 1-min Finary Short) stopped at P3: the presenter element covered 46 % of the screen, its
analysis 34 %. Cause: `ELEMENT_RULES` gave every shot of kind « presenter » to the presenter, including FOUND footage of
public figures speaking (layout off). Now a « presenter » shot owns the presenter element only when its origin is the
presenter, or it is on screen and not found. When the rules still disagree with the analyses, `measureElements` repairs
itself: every shot owned by its measured origin, shares recomputed (the one with fewer disagreements is kept); P3's check
is unchanged and strict (`tests/unit/clone-p3-shares.test.ts`).

## Consequences
- Today `avatar-marcel` is unproven: a clone that starts from it gets the same values as from zero plus the record; the
  saving starts when its rounds are recorded (`earned`, `proof`). Real size of the saving: to measure on the first real
  avatar clone.
- Adding a base = one registry entry with measured fields; it never changes how a field is measured.
