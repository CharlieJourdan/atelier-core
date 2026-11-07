# 0033. The pipeline graph: built from the compiled pipeline, bands when the canvas is narrow, options off drawn greyed
Date: 2026-11-01. Status: accepted. Decided by: the production-13 session, within decision 0023 (Charlie asked the
chantier to settle open points with sensible defaults and record them).

## Context
production-13 draws the read-only graph of `docs/specs/production-model.md` §11 (« un graphique un peu à la N8N des
différentes parties jusqu'à la vidéo finale »). R11.1 says « columns = the seven stages ». The graph must never disagree
with what runs (R11.4) and stay simple for beginners (§13). Several points were open.

## Decision
1. **Built in the engine from the compiler's result** (`src/engine/technologies/graph.ts`, `pipelineGraph`): one node per
   brick of the compiled document, one edge per (brick, brick, slot) read from the compiled nodes' `in` wiring, gates from
   the compiled `owner` gates, engine / fallbacks / style from the compiler's pins. Main serves it (`graph.pipeline(doc,
   channelId?)` compiled with that channel's settings like a run; `graph.run(runId)` compiled exactly as the project's
   run was, `ProjectStore.graphOfRun`). In a run the gate of each brick is the run's own (`gateKind`).
2. **An option « off »** is a value whose effects remove bricks and add none (music « none », sponsor « off », fact check
   off). Its bricks are drawn greyed with their edges dashed: the document is compiled a second time with that option on,
   and only the removed bricks and the edges touching them come from that second compile; every other node and edge is
   the real compile's. A swap (script by the agent / imported) is a choice, not an off: nothing greyed.
3. **Two orientations, same steps.** Left to right with the stages as columns (R11.1, n8n-like) when the canvas reads at
   85 % or more; otherwise the stages become **bands read top to bottom**, parallel branches side by side. avatar@1 is
   10 steps wide (≈ 2 400 px) and the editor's column is ≈ 870–1 100 px: in columns it would read at a third of its size,
   so the editor and the run view show the bands today. Inside a stage, a brick that reads another of the same stage is
   one step further; bricks at the same step run in parallel.
4. **Our own layout code** (`src/renderer/screens/production/graphe/graph-layout.ts`, pure, tested), HTML nodes over one
   SVG for the lines: no layout or graph library (strict CSP, nothing injects `<style>`). The running edge's dash is a
   keyframe in `app.css`, still under `prefers-reduced-motion`.
5. **Costs** come from the editor's estimate (production-11): a brick shows the lines whose `brick` is its name (pictures
   and clips add up), its share of the average per minute, or « par vidéo » for thumbnails; an LLM brick says « IA de votre
   abonnement » or « IA payée à part » (the LLM line is the team's, not one brick's); others « sans crédits ».
6. **Clicks.** In the editor a brick opens « Avancé » and its settings (scrolled to, lit); a greyed brick scrolls to the
   option that removed it. In a run a brick selects its waiting node, else the last node that produced something.
7. **Inputs and end.** A card lists the pipeline's inputs with their source (à chaque vidéo / de la chaîne / fixé), dotted
   lines to the bricks that read them; a « Vidéo finale » block follows the brick that hands the video over (the package,
   else the render).

## Consequences
- A new brick, slot or option needs nothing in the graph: it follows the compiler.
- A full-screen view (columns at 100 %, pan) can come later on the same layout; editing in the graph stays out (R11.4).
