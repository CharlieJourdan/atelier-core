# 0109 — The free demo shows found pictures and the presenter's photograph, through a Cloud client that can never spend

Date: 2026-11-05 · Chantier: moteur-doublures · Spec: `docs/METHODE-REVERSE-PIPELINE.md` · After 0102 (free gate), 0105 (free
sources cost nothing), 0106 (unmarked judge copy)

## Context
Charlie's rule: before any paid round, a FREE demo of the Style Definition must pass a blind judge (decision 0102,
`style-gate.ts`). The demo engines replaced exactly what makes a channel like Finary: every generated or found picture became a
keyword gradient slide with its own « DÉMO » mark, video items became drawn clips with a sweeping marker, and the presenter a drawn
blob. Finary's three demos scored layout 10/100 and the clone stopped honestly before paying (moteur-briques). No setting could fix
that: the stand-ins themselves hid the layout. A demo run also had no Cloud at all, so it could not even search free stock.

## Decision
1. **A demo run's Cloud = the free usages only** (`src/engine/cloud-demo.ts`). `freeUsagesOnly` refuses `synthesize`,
   `generateImage`, `generateVideo` and `talkingAvatar` before any request; only `searchStock` (and the free media search) pass. The
   HTTP client underneath is `freeOnly`: a quote priced above 0 credits is refused before a job (and its hold) exists. It never says
   `realRun` (a demo film stays a demo) and keeps its own key records (`cloud-keys-demo/`). The production host gives it to a demo
   run while signed in (`forDemoRun`, `CloudRunsPort.forDemoRun`, `runs/service.ts`); signed out, nothing changes.
2. **`standIns: 'found'`** (recipe setting of `visuals.fulfil`, `clip.make`, `avatar.speak`; default unchanged = drawn):
   - `visuals.fulfil` demo (`nodes/visuals-found.ts`): every picture item — found or generated, still or video — becomes a free stock
     photograph searched with the item's own planned words (its search for a stock item, its key terms, its subject), cover-cropped
     full frame, no text, no per-item mark, never the same photograph twice while another result is left; an item whose words
     find nothing (a demo's script is a template) takes a photograph of a subject the measured look names (`lookQueries`:
     « brokerage account screen », « courtroom imagery » for Finary), else one left by a neighbour's search; the look's measured colour
     words (black and white, red, warm, cool, saturated, dark…) are put on it as the image engine would; an item nothing was found
     for shows its neighbour (said in the record); without a Cloud or with nothing found at all, the drawn stand-ins as before.
   - `clip.make` demo: no drawn clip; a video item's found still takes the shot's planned camera move in the render.
   - `avatar.speak` demo (`presenter/stand-in.ts`, inside `presenter/talk.ts`): a PHOTOGRAPH of a person of the planned type. First
     the presenter's own picture for that framing — the look-alike placeholder's portrait and angles, made from words only, never
     from the reference's frames, the very picture a paid run animates (this goes one step past the brief, which asked for a stock
     photo: it costs nothing and is closer to the paid result) —, else ONE free stock photo searched with `standInPerson` (the
     planned type, e.g. « man 35-45 fitted black turtleneck portrait »), the same for every call. A close framing without its own
     angle is a tighter crop; the picture breathes slowly (never frozen); `render.assemble` lays it out as planned (full, half,
     inset at the measured sizes). Without picture or Cloud: the drawn silhouette.
3. **Only the gate's demo carries them.** `withFoundStandIns(recipe, def)` (`compare/runner.ts`) sets them on the demo recipe and
   on its unmarked judge copy (`create.ts`); the plan's own recipe, and every paid run, never do. The single film « DÉMO » mark stays
   on the copies the user sees; the judge sees the unmarked copy (0106).
4. **The judge is not loosened.** Same axes (layout, cadence, motion, captions), same 70 floor, same rule on placeholder words.
   Never the reference's own frames as stand-ins.

## Consequences
- Channels made of pictures and a presenter can now show their layout and cadence to the free gate. Finary
  (a folder outside the repo): the engine judge's layout rose from 10 to 25, still
  refused; an independent blind judge says « not the same channel » (layout 30). What is left is the definition and bricks
  (cadence 17 vs 9 cuts/min, presenter angles, gold counters and pill labels, the look-alike's set), not the stand-ins.
- A drawn fallback writes why in the images' meta (`standInFallback`): the first real runs lost every search on a missing
  download folder, and only this line said so.
- A demo now depends on the Cloud's free stock search when signed in (network, the stock providers' rate limits); it falls back to
  the drawn stand-ins rather than failing.
- Stand-in pictures match the planned WORDS, not the planned scene: a demo script is a template, so its pictures are on-topic at
  best. The judge is told card words are placeholders; it is not told pictures are (they are judged on paid renders).
- Tests: `tests/unit/demo-stand-ins.test.ts`.
