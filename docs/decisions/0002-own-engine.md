# 0002. Our own production engine
Date: 2026-10-20 (lot P1). Status: accepted; the Production layer above it is rebuilt by 0008. Decided by: Charlie.

## Context
The external engine of v1 was removed (clean room, 0001). It gave us no control over cost, quality or packaging.

## Decision
- `src/engine/`: pure TypeScript plus ffmpeg. It never imports `electron` or `src/main/**` (lint rule
  `atelier/engine-boundary`).
- A pipeline is a JSON graph of nodes (`atelier.pipeline/1`, JSON Schema in `resources/schemas/`). Each node declares
  inputs, outputs, zod params, an `estimate`, a real `run` and a free `fake`.
- Artefacts are cached by fingerprint. Gates stop a run for an approval.
- A worker process runs one node at a time (`src/engine/worker/`), locally or on a rented GPU through the Cloud.
- Spec: `docs/ENGINE-SPEC.md`.

## Consequences
- The engine core, nodes, media, text and render code stay. The 0008 rebuild replaces the layer on top (pipelines
  shown to users, bricks, projects), not the core.
- Proofs: `npm run engine:demo`, `engine:dialogue-demo`, `engine:motion-demo`, `engine:avatar-demo`.
