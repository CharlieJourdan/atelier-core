# Atelier production engine: expected behaviour (v2)

> Written from Atelier's own plan, in Atelier's own words. It is the
> clean-room reference for `src/engine/`. **Part I** (§1–§14) is the engine core: graph, artefacts, format, scheduler,
> cache, events, money, failures, gates. **Part III** (§42) says how to add a technology. **Part II** (§15–§41, lot P1b) describes what every production stage must
> do, end to end: inputs, outputs, decisions, parameters, durations and costs, failure handling and the quality levers.
> Part II states behaviour and intent in our own words, with our own names; its numbers are approximate targets that
> the implementing lots measure and tune.
> Implementation lots read this document only. No third-party engine file, function, regular expression, prompt, log
> format, data format or style file may be referenced, copied or paraphrased in this document or in the code built
> from it; where Part II names a technique (loudness normalisation, sequence alignment, frame capture…) it is public
> craft, not someone else's code.
> Keywords MUST / MUST NOT / SHOULD / MAY are normative. Rules are numbered (`R<section>.<n>`) so tests can cite them.
> Anything not settled by the plan is marked **(decision)** when this spec fixes it, **(proposal)** when it adds to the
> plan's vocabulary and must be confirmed by the lot that implements it, or **(hypothesis)** when open.

---

## 1. Purpose and scope

R1.1 The engine produces one YouTube video as a **pipeline**: a directed acyclic graph of typed **nodes** (script,
voice, visuals, edit, sound, captions, render, QC, package). v2 supports **one format only: long YouTube videos, 16:9**.

R1.2 The engine is pure TypeScript in `src/engine/`. It MUST run unchanged in four hosts: the Electron app (macOS or
Windows), the local worker process, Atelier Cloud, and the RunPod worker images.

R1.3 Three **executors** run nodes:
- `local`: the user's machine, free. A worker process spawned by the app (never in the window), with ffmpeg and
  off-screen Chromium rendering.
- `cloud`: Atelier Cloud calls a provider on the user's behalf against an accepted quote; paid in credits.
- `gpu`: Atelier Cloud forwards the job to a rented RunPod GPU machine; paid in credits; result returns via Cloud.

R1.4 Nodes that need reasoning ("Claude nodes") MUST run on the user's machine through the user's own installed and
signed-in Claude Code (`claude` CLI), each playing an agent role (instructions, role memory, channel style, our
skills). They cost 0 credits. A platform Claude API fallback billed in credits exists but is OFF by default.

R1.5 Provider keys never leave Atelier Cloud; the engine never sees or needs one. The user buys credits instead.

R1.6 Real vs demo (plan §4.12): engine, local nodes, Claude Code, wallet, gates and editor are real (**R**). Cloud
nodes are real only when the platform key is in the vault and paid calls are allowed, otherwise demo (**R\***). Every
node MUST have a **fake** implementation (see §4) used by tests and demo mode; demo output is visibly marked.

---

## 2. Node contract

```ts
type NodeTypeId = `${string}@${number}`;          // e.g. "voice.tts@1"  (name@major)
type ArtefactType = string;                        // see §3, e.g. "audio.voice", "media.image[]"
type Executor = 'local' | 'cloud' | 'gpu';
type Gate = 'none' | 'review' | 'owner';

interface PortSpec { type: ArtefactType; required: boolean; label?: string }

interface NodeDef<P = unknown> {
  type: NodeTypeId;
  inputs: Record<string, PortSpec>;                // input name -> type
  outputs: Record<string, ArtefactType>;           // output name -> type
  params: ZodSchema<P>;                            // validated params, defaults applied
  executors: Executor[];                           // where it may run; first = default
  claudeRole?: string;                             // set for Claude nodes
  defaultGate?: Gate;
  estimate(ctx: EstimateCtx, params: P): Estimate; // pure, no I/O, no spending
  run(ctx: RunCtx, inputs: ResolvedInputs, params: P): Promise<NodeOutputs>;
  fake: (ctx: RunCtx, inputs: ResolvedInputs, params: P) => Promise<NodeOutputs>;
}

interface RunCtx {
  emit(e: NodeEvent): void;          // §8
  signal: AbortSignal;               // cancellation, §10
  store: ArtefactStore;              // read inputs / write outputs, keyed by fingerprint
  seed: number;                      // part of the fingerprint, §7
  budgetMode: 'qualite_max' | 'usage_max';
  where: Executor;                   // resolved placement
}
interface Estimate { units: { unit: 'chars'|'images'|'gpu_s'|'video_s'|'calls'|'tokens'; qty: number }[];
                     provider?: string; durationS: number }
```

R2.1 A node type id is `name@version` with an integer version. A new version MUST be registered alongside the old
one; existing pipelines keep resolving the old version. Removing a registered version is a breaking change.
R2.2 `run` MUST only read its inputs through `store`, MUST write every declared output, and MUST NOT write undeclared
outputs. Output values MUST match their declared artefact type (checked by the engine after `run`).
R2.3 `run` MUST honour `signal`: on abort it stops promptly, releases child processes and rejects with an abort error.
R2.4 `estimate` MUST be pure and deterministic (same params and input metadata → same estimate) and MUST NOT spend.
R2.5 A node MUST NOT read the clock, randomness or environment for content decisions except through `ctx.seed`;
two runs with the same fingerprint SHOULD give equivalent results (Claude and provider outputs are best-effort).
R2.6 The node registry is the single source for the catalogue, validation, the Builder's generated catalogue and
`pipeline_validate` / `pipeline_estimate`.

---

## 3. Artefacts and edge type-checking

An **artefact** is what a node produces: a file or a structured value. Base types:

| Family | Types |
|---|---|
| Text | `text.brief` (research and angle), `text.script` |
| Voice | `audio.voice` + `json.words` (per-word timing) |
| Segmentation | `json.beats` (script split into timed beats: sentence, start, end) |
| Edit | `json.editplan` (tracks, shots, durations, transitions; our format `atelier.editplan/1`), `json.genlist` (items to generate or source, each with its price) |
| Media | `media.clip[]`, `media.image[]`, `media.graphic[]` (rendered animations), `audio.music`, `audio.sfx`, `subs.track` |
| Final | `video.final`, `image.thumbnail[]`, `json.metadata` (title, description, tags, chapters), `json.qc`, `package.youtube` |

Pipeline inputs have a coarse `kind` (`text`, `video`, `audio`, `image`, `file`) that maps to artefact types.

R3.1 A `[]` suffix denotes a list of that type. A list type and its element type are different types.
R3.2 An edge is valid only if the source type equals the target port type **(decision: exact match; no implicit
coercion in v2)**. Example: an `media.image[]` output MUST be refused on an `audio.voice` input.
R3.3 Type-checking MUST happen at validation time (§5), before any quote, reservation or node run. A pipeline with
a type error MUST NOT be quotable, saveable or runnable. Zero credits are ever spent on an invalid pipeline.
R3.4 Every artefact carries `{ type, fingerprint, files?: string[], value?: JSON, meta }`; JSON artefacts are
validated against their schema (`atelier.editplan/1` etc.) when written.

---

## 4. Node catalogue v2 (target)

This is the **target** catalogue. Nodes arrive in later lots (P4+); P2 ships the engine core with test nodes only.
Executor column: `local` free, `cloud` credits via Atelier Cloud, `gpu` credits via RunPod; "Claude (role)" = Claude node.

| Node | Purpose | Executor | Fake behaviour |
|---|---|---|---|
| `research.topic` | Web research and video angle → `text.brief` | local, Claude | brief from a template |
| `research.youtube` | Close videos and outlier topics of the niche (official YouTube Data API, read only) | cloud | invented channels |
| `script.write` | Script with our skills (hook, retention, re-hooks, call to action) | local, Claude (Scriptwriter) | template script |
| `script.check` | Fact check and anti-plagiarism against analysed transcripts | local, Claude | fixed report |
| `voice.tts` | Synthetic voice + word timing | cloud (resold TTS) | OS voice (macOS `say`, Windows SAPI), marked demo |
| `voice.own` | User's recording, then word alignment (local Whisper) | local | — |
| `beats.split` | Split into timed beats | local | deterministic |
| `director.plan` | Director: edit plan + generation list within budget (§12) | local, Claude (Director) | deterministic plan |
| `visuals.fulfil` | Executes the list: stock, generated images/videos, avatar, cuts of user footage | mixed | drawn images showing the prompt text + DEMO watermark |
| `image.generate` | One image | cloud or gpu | drawn image |
| `video.generate` | One animated shot | cloud or gpu | slow zoom on the image |
| `avatar.talk` | A talking presenter | cloud or gpu | silhouette animated on the audio rhythm |
| `footage.input` | Cuts user footage (camera, gameplay) to beats, scene detection | local | sample footage |
| `background.clips` | A silent background video as long as the voice, made of pieces picked (seeded random) from a folder of the user's clips (the « gameplay » of a faceless short); built, lot « faceless formats » | local | real |
| `card.intro` | A post-style intro card (transparent PNG: avatar, channel, title) shown over the first sentence by `render.assemble`; built | local | real |
| `script.translate` | The script in another language, paragraph and sentence structure kept, outline carried over; built | local, Claude (Scriptwriter) | template script of the same length in the target language |
| `graphics.motion` | Animations (title, list, number, map, quote…) from **our** HTML templates, rendered frame by frame in Chromium; built as `motion.render` (§25.1) | local or gpu | real |
| `sound.music` | CC0 music + automatic ducking under voice | local | real |
| `captions.make` | Styled captions aligned on word timing | local | real |
| `render.assemble` | ffmpeg assembly, segment by segment | local or gpu | real |
| `thumbnail.make` | Concept by Claude, image, then text layout | cloud + local | drawn image |
| `qc.check` | Technical QC (duration, black, silence, loudness −14 LUFS) + Claude review of extracted frames | local | real |
| `package.youtube` | Title, description, chapters, tags, upload folder (never uploads) | local, Claude | real |
| `custom.claude` | Step described by a prompt with declared outputs | local, Claude | — |
| `tool.<id>` | A "My tools" tool declaring `expose.production`, exposed as a typed node | local | — |
| `pack.textstory.*` | Text-story pack: message cards, chat bubbles, gameplay background | local | real |

R4.1 Deliberately absent: downloading clips from other YouTube channels. No node may fetch third-party video media.
R4.2 No node writes to YouTube (no upload, comment or Studio action).

---

## 5. Pipeline format `atelier.pipeline/1`

```ts
interface Pipeline {
  $schema: 'atelier.pipeline/1';
  id: string; version: number; name: string;
  format: { kind: 'youtube_long' | 'youtube_short'; aspect?: '16:9' | '9:16' /* default 16:9; a short is 9:16 */; minutes: { default: number; min: number; max: number } };
  style?: string;                                  // "style:<id>@<version>" (atelier.style/1)
  inputs: { id: string; kind: string; required?: boolean; suggested?: boolean; label: string; help?: string }[];
  budget: { default: 'qualite_max' | 'usage_max'; capCredits?: number };
  nodes: PipelineNode[];
}
interface PipelineNode {
  id: string; type: NodeTypeId;
  in: Record<string, Ref>;                         // input port -> reference
  params?: Record<string, unknown | Ref>;
  gate?: Gate;                                     // default 'none' (or the node's defaultGate)
  where?: Executor | 'auto';                       // default: node's first executor
  modes?: Partial<Record<'qualite_max' | 'usage_max', Record<string, unknown>>>; // params overlay per mode
}
type Ref = `${string}.${string}` | `$inputs.${string}` | `$style.${string}`;
```

**The frame (aspect).** `format.aspect` is the shape of the picture: `16:9` = 1920×1080 (default, long-form), `9:16` = 1080×1920
(a short, `kind: 'youtube_short'`), 30 fps either way. The nodes that draw it carry the same `aspect` param (`director.plan`,
`background.clips`, `card.intro`; `validatePipeline` reports a mismatch as `bad_params`); everything downstream reads the size
from the edit plan (`plan.size`): visuals (stills and generation requests), segments, the final pass and its `verify`, captions
(ASS PlayRes), `qc.check`, `package.youtube` (a 9:16 plan makes a Short: no chapters, a `shorts` tag). The shorts caption
style is the `shorts` preset (1–3 words at a time, upper case, bold, thick outline, the spoken word in the accent colour,
centred above the bottom UI zone of a phone). A drawing whose `format` is `short` compiles to all of this.

Example (shortened for reading; it does **not** wire every port and is not a valid pipeline: the template pipeline's
wiring is the port table of §15.6, and tests MUST use a fixture built from that table):

```json
{
  "$schema": "atelier.pipeline/1",
  "id": "history-doc", "version": 3, "name": "History documentary",
  "format": { "kind": "youtube_long", "aspect": "16:9", "minutes": { "default": 10, "min": 1, "max": 30 } },
  "style": "style:history@4",
  "inputs": [
    { "id": "topic",  "kind": "text",  "required": true,  "label": "Topic or title" },
    { "id": "camera", "kind": "video", "suggested": true, "label": "Your camera shots (optional)" }
  ],
  "budget": { "default": "usage_max", "capCredits": 400 },
  "nodes": [
    { "id": "research", "type": "research.topic@1", "in": { "topic": "$inputs.topic" } },
    { "id": "script", "type": "script.write@1", "in": { "brief": "research.brief" },
      "params": { "skills": ["hook", "retention"] }, "gate": "review" },
    { "id": "voice", "type": "voice.tts@1", "in": { "script": "script.text" },
      "params": { "voice": "$style.voice" }, "gate": "review" },
    { "id": "beats", "type": "beats.split@1", "in": { "script": "script.text", "words": "voice.words" } },
    { "id": "director", "type": "director.plan@1",
      "in": { "beats": "beats.beats", "camera": "$inputs.camera" }, "gate": "review" },
    { "id": "visuals", "type": "visuals.fulfil@1", "in": { "list": "director.genlist" }, "gate": "review",
      "modes": { "qualite_max": { "videoShare": 0.4 }, "usage_max": { "videoShare": 0 } } },
    { "id": "render", "type": "render.assemble@1", "where": "auto",
      "in": { "plan": "director.plan", "visuals": "visuals.clips", "voice": "voice.audio" } },
    { "id": "qc", "type": "qc.check@1", "in": { "video": "render.video", "script": "script.text" } },
    { "id": "package", "type": "package.youtube@1", "in": { "video": "render.video" }, "gate": "owner" }
  ]
}
```

R5.1 References: `node.output` points to a declared output of another node in the same pipeline; `$inputs.x` to a
declared pipeline input; `$style.x` to a field of the channel style (resolved at run start and pinned in the run).
R5.2 `gate`: `none` = no validation; `review` = validation proposed (skipped in all-at-once mode, §11); `owner` =
always validated by the user, in every mode.
R5.3 `where`: `local`, `cloud`, `gpu` or `auto`; `auto` is resolved by the budget mode (§6). An explicit `where` not in
the node's `executors` is a validation error.
R5.4 `modes`: per-budget-mode params overlay, shallow-merged over `params` for the active mode before fingerprinting.
R5.5 Validation (zod in the app; also published as JSON Schema for the Builder) MUST report **all** errors with a
stable `code` and a path, and MUST reject:

| Code | Rule |
|---|---|
| `schema` | document does not match `atelier.pipeline/1` (wrong `$schema`, missing fields, wrong format/aspect) |
| `duplicate_id` | two nodes, or two pipeline inputs, share an id |
| `unknown_node_type` | `type` not in the registry (name or version) |
| `bad_params` | params (after mode overlay) fail the node's schema |
| `unknown_ref` | reference to a missing node, missing output, missing `$inputs.x` or unknown `$style` field |
| `unknown_port` | `in` names a port the node does not declare |
| `missing_input` | a required node input has no reference |
| `type_mismatch` | source artefact type ≠ target port type (§3) |
| `cycle` | the node graph is not a DAG (self-reference included) |
| `bad_where` | `where` not allowed for this node |

R5.6 Each save creates a new immutable version (`pipeline_versions`); the UI shows the diff with the previous one.
R5.7 A launched video pins the **exact** pipeline version and style version that produced it; later edits never alter it.
R5.8 Export/import is a single `.atelier-pipeline.json` file. Import MUST run full validation; an invalid file is refused.
R5.9 A required pipeline input blocks launch while missing; a suggested input never blocks.

---

## 6. Scheduling

R6.1 The scheduler (`src/engine/scheduler.ts`) starts a node as soon as all its inputs are available (upstream done
and, if gated, approved), and runs independent nodes in parallel.
R6.2 Concurrency limits, configurable, defaults: **2 Claude nodes**, **4 Cloud calls**, **1 render per machine**. A ready
node waiting on a limit stays `queued`. **(decision)** Ties are broken by pipeline declaration order.
R6.3 `auto` placement: `usage_max` prefers `local` (free) and cheaper options; `qualite_max` prefers the best models and
`gpu` render when it is estimated faster. The resolved executor is recorded in the run and is part of the fingerprint
only when it changes output (render placement SHOULD NOT change the fingerprint).
R6.4 A branch stopped at a gate (§11) does not block independent branches.
R6.5 Node states: `pending → queued → running → (waiting_gate) → done | error | cancelled | cached`.

---

## 7. Fingerprints and cache

R7.1 Fingerprint = `sha256` **(decision)** over the canonical serialisation of
`{ type: "name@version", params (after mode overlay and $style resolution), inputs: { port: inputFingerprint },
seed }`. Pipeline inputs (user files/text) are fingerprinted by content hash, combined with their `meta` when they
have one. A node that reads a run-wide setting (`minutes`, `budgetMode`) declares it (`NodeDef.reads`) and the
declared settings join the fingerprint; reading an undeclared one fails the node (lot PAF).
R7.2 Canonical serialisation MUST be stable: object keys sorted, no insignificant whitespace, numbers in a single
form, `undefined` fields dropped, arrays kept in order. The same logical input MUST always give the same fingerprint
on every host and OS (tested cross-platform with golden values).
R7.3 If an artefact exists for a fingerprint, the node MUST NOT run; its output is reused and costs **0 credits**
(state `cached`).
R7.4 Propagation is automatic: changing an upstream node (e.g. the voice) changes its fingerprint and therefore every
dependent fingerprint (beats, director, captions, render); unaffected nodes (the script) are reused. No manual
invalidation lists exist.
R7.5 "Regenerate unchanged" = new `seed` for that node only, which changes its fingerprint and its dependents'.
R7.6 Fine-grained caches: `visuals.fulfil` caches per shot, `render.assemble` per segment. Replacing one shot redoes
only that shot and its segment.
R7.7 Storage: locally `<data>/production/artefacts/<fingerprint>/`; in Cloud one folder per team, kept 30 days
(configurable). Writes MUST be atomic (write to temp, then rename) so a crash never leaves a half artefact cached.

---

## 8. Progress events

```ts
type NodeEvent =
  | { kind: 'start'; nodeId: string; at: number }
  | { kind: 'progress'; nodeId: string; frac: number; text?: string }   // 0..1
  | { kind: 'artefact'; nodeId: string; output: string; fingerprint: string }
  | { kind: 'log'; nodeId: string; level: 'info' | 'warn'; text: string }
  | { kind: 'done'; nodeId: string; fingerprint: string; cost?: Cost }
  | { kind: 'error'; nodeId: string; permanent: boolean; message: string; code: string };
```

R8.1 Per node, events are ordered: exactly one `start` first, then any `progress`/`artefact`/`log`, then exactly one
terminal `done` or `error` (or a cancellation). Nothing follows the terminal event.
R8.2 `progress.frac` is clamped to [0,1] and non-decreasing within one attempt.
R8.3 Progress is never inferred from parsing log text; logs are informational only.
R8.4 Global progress weights each node by its estimated duration, taken from the average of the user's past runs of
that node type (fallback: `estimate().durationS`). The ETA therefore sharpens over time. Cached nodes count as done.
R8.5 User-facing texts are short plain French phrases (via `fr.ts`), e.g. « 12 plans trouvés sur 40 »,
« segment 7 sur 18 ». No stack traces or raw provider messages reach the user.

---

## 9. Credit estimates and settlement

R9.1 Each node estimates cost in its provider's units (characters, images, GPU seconds…). Atelier Cloud converts units
to credits with its price grid (our real cost × adjustable margin). Local and Claude Code nodes cost 0 credits.
R9.2 Before launch, the app requests a **quote** for the whole video, node by node, shown e.g.
« ≈ 84 crédits (≈ 0,84 €) · ≈ 9 min ». A quote is valid **15 minutes**; an expired quote MUST be re-requested.
Cached nodes are quoted at 0.
R9.3 During the run each paid node **reserves** its credits before starting, then **settles** at real cost; the
difference is refunded via an adjustment row (same reserve → settle pattern as the v1 ledger). Never more is debited
than reserved without a new reservation.
R9.4 The director receives the budget (§12) and keeps the generation list within it.
R9.5 The app's local ledger records one row per spend, in credits and euros, per channel (for channel P&L).
R9.6 Claude Code nodes record tokens used (information only), with 0 credits.

---

## 10. Failures, retries, cancel, recovery

R10.1 Transient error (network, provider overloaded, RunPod machine reclaimed): up to **3 retries** with growing
backoff **(decision: e.g. 2 s, 8 s, 30 s, with jitter)**, on the **same reservation**.
R10.2 Permanent error (invalid params, content refused by provider) or retries exhausted: node → `error` with a clear
French message and four actions: **Retry**, **Change settings**, **Replace with my file**, **Ask the production
operator** (an agent reads the node events and explains). Dependents stay `pending`; independent branches continue.
R10.3 A failure costs the user nothing: the reservation is fully refunded. If the provider billed us anyway, it is a
platform loss recorded in the platform P&L.
R10.4 Cancel really stops: local node killed with its whole process tree (v1 kill-tree via `src/main/platform/`);
Cloud and RunPod jobs are cancelled remotely; finished artefacts stay cached; credits of unperformed work are refunded.
R10.5 Node run state is persisted through a `NodeStateStore` interface: in-memory first, then the `node_runs` table
(lot P7). On restart the run resumes: `done` nodes are reused, `running` local nodes are restarted, Cloud jobs are
re-attached by their key.
R10.6 Every Cloud job carries an **idempotency key** (derived from run id + node id + fingerprint + attempt group) so
the same job is never paid twice, including across retries and restarts.

---

## 11. Validation hook (human gates)

R11.1 At video creation, each node with `gate: review` or `owner` becomes a **deliverable** of that video (reusing
v1 workflow: deliverables, versions, approvals, revisions, max 3 revisions). Agent deliverables (research, metadata,
QC, package) remain.
R11.2 When a gated node completes, its branch pauses (`waiting_gate`) and a card appears in Validations and in the
video's conversation.
R11.3 Choices: **Approve** → the branch resumes. **Request change** → the note is added to the node's params, giving a
new fingerprint; the node reruns and every dependent is redone. **Edit myself** (script, edit plan, captions) or
**Replace** (upload or one of the user's tools) → the user's version becomes the node's output artefact (new
fingerprint, type-checked like any output) and dependents recompute.
R11.4 Modes: **step by step** = every gate in the pipeline; **all at once** = only `owner` gates, and the final package
is ALWAYS owner-validated in both modes.
R11.5 Because the director emits the generation list before any spend, the user can validate the **edit plan and its
price**, then the **visuals**, before the render starts.

---

## 12. Director and budget modes

R12.1 `director.plan` is a Claude node (role Director). Inputs: timed beats, channel style, user footage, catalogue of
possible shot kinds with prices, budget. Outputs: `json.editplan` and `json.genlist`.
R12.2 A non-AI checker runs after it: durations add up to the beats, item types are valid, total price ≤ budget. On
any mismatch it sends the list back to the director **once**; a second failure is a permanent node error.
R12.3 If the list exceeds the budget the director replaces generated shots with cheaper ones.
R12.4 Budget mode, chosen per video (channel default): **qualite_max** = best models, more generated video shots,
avatar if the format has one, RunPod render if faster; **usage_max** = stock first, animated stills, text animations,
fast voice, local render (free).
R12.5 A per-video credit cap is NEVER exceeded: the engine refuses a reservation that would cross it.

---

## 13. Code layout and lint rule

| Path | Content |
|---|---|
| `src/engine/` | pure engine: types, pipeline format, validation, scheduler, cache, events, estimation, nodes |
| `src/engine/render/` | ffmpeg + Chromium frame rendering; two backends: Electron off-screen (app), headless Chromium (Cloud, RunPod) |
| `src/main/production/` | app wiring: runs, gates, local worker |
| `src/main/cloud/` | Atelier Cloud client |
| `src/main/analysis/`, `src/main/builder/` | channel analysis, Builder |
| `cloud/` | Atelier Cloud server |
| `workers/` | RunPod images |
| `resources/skills/`, `resources/motion/`, `resources/music/` | our skills, animation templates, music, each with its licence |

R13.1 A lint rule MUST forbid, in `src/engine/**`, any import of `electron` or of `src/main/**`. OS differences reach
the engine only through injected interfaces.
R13.2 Unit tests of the engine run under plain Node 22+ with fake nodes and fake providers; no real paid call.

---

## 14. Out of scope (v2) and open hypotheses

Out of scope: Shorts and any non-16:9 format; "translate a channel" and "AI avatar channel" assistants; the upload
desk; book and site building; voice cloning (demo only); any YouTube write; downloading other channels' clips.

Open hypotheses:
- H1 Exact-match edge typing (R3.2) is enough; a coercion table may be added later.
- H2 Render placement does not affect fingerprints (R6.3) because local and RunPod renders are equivalent.
- H3 Duration history is a good weight for global progress after ~3 runs per node type.
- H4 Retry backoff values (R10.1) and idempotency key composition (R10.6) to be confirmed in P7 with Cloud.
- H5 Claude and provider outputs are not bit-reproducible; the cache guarantees reuse, not regeneration identity.

---
---

# Part II — Stage behaviour (lot P1b)

## 15. How to read Part II

15.1 **One section per stage**, each mapped onto our node catalogue (§4). Every stage section has the same parts:
*Node(s) and artefacts* · *Inputs* · *Outputs* · *Behaviour* (ordered steps) · *Decisions and heuristics* ·
*Parameters* (with defaults) · *Duration and cost* (orders of magnitude, provider prices as of late 2026, to be
re-measured) · *Failure handling* · *Cache* (what the fingerprint must include beyond §7) · *Fake* (what the fake
does, §1.6) · *Budget modes* (what changes between `qualite_max` and `usage_max`).

15.2 **Numbers are behavioural targets**, not constants copied from anywhere. Each node exposes the ones marked
"param" as params (zod, with the default given here), so a channel style (`$style.x`) or the Builder can tune them.
Unmarked numbers are internal defaults the implementer MAY tune with a test that shows why. Every number is a starting
target, chosen for a calm narrated long-form video at 30 fps; the lot that implements a stage records in `docs/ETAT.md` the
values it measured and kept.
Retry vocabulary used throughout Part II: "N attempts" = N tries in total (first try included); "retry once" = 2
attempts. Transient provider/CLI errors always follow R10.1 (1 try + 3 retries); the stage-specific counts below apply to
*content* failures (bad length, bad JSON, wrong language).

15.3 **Video length vocabulary.** `T` = target length in minutes (pipeline input, `format.minutes`). `D` = the real
voice duration in seconds once the voice exists; `F = round(D × 30)` is the film length in frames, and every timeline
length is expressed on that frame grid. Rates "per minute" are per minute of `D`. **Outline beat** = a narrative unit of
the outline (~1 per minute, §17); **timed beat** = a 2–10 s unit of `json.beats` (§20). "Beat" alone means a timed beat.

15.4 **The end-to-end flow** (default long-form pipeline):

```
research.topic ─► script.write ─► script.check ─┬─► voice.tts | voice.own ─► beats.split ─► director.plan ◄─ footage.input
                                                │                                               │        (user files)
                                                └─► thumbnail.make                              │
                                                                                                │
                 ┌───────────────────┬──────────────────┬─────────────────┬────────────────────┘
                 ▼                   ▼                  ▼                 ▼
          visuals.fulfil      graphics.motion      sound.music      captions.make
   (stock, image/video/avatar items)
                 └─────────┬─────────┴──────────────────┴─────────────────┘
                           ▼
                   render.assemble ─► qc.check ─► package.youtube ◄─ thumbnail.make
```

`research.youtube` feeds `research.topic` and the channel analysis (§2 of the plan); it is optional per pipeline.

15.5 **Proposed artefact additions (proposal).** Part I's base types are kept. Part II needs a few structured
intermediates; each is a JSON artefact with a zod schema, fingerprinted like any other:

| Type | Produced by | Content |
|---|---|---|
| `json.outline` | `script.write` | the beat plan the script was written from (shape, beats, word budgets, tags) |
| `json.factcheck` | `script.check` | per-claim verdicts, applied fixes, unchecked parts, plagiarism overlaps |
| `json.soundplan` | `sound.music` | music cues, silences, effect hits, levels (debug and editor view) |
| `json.textcheck` | `director.plan` checker | on-screen string verdicts (§21.9) |

If an implementing lot prefers to fold one of these into an existing output's `meta`, it MAY, and says so in `docs/ETAT.md`.
Two more are needed for inputs Part I does not type: `json.ytresearch` (output of `research.youtube`: related videos
with stats, outlier ratio, format × subject table) and `json.footage` (output of `footage.input`: the scene catalogue of
the user's files). Pipeline inputs of kind `text` resolve to the artefact type `text.input` **(proposal)**; kinds
`video`, `audio`, `image` resolve to `media.clip[]`, `audio.voice` (recording) and `media.image[]`.

15.6 **Port table (normative for the template pipeline; the §5 example is shortened and does not wire every port).**
"(opt)" = optional port; every other port is required.

| Node | Inputs (port: type) | Outputs (port: type) |
|---|---|---|
| `research.youtube` | `topic: text.input` | `related: json.ytresearch` |
| `research.topic` | `topic: text.input`, `links: text.input` (opt), `youtube: json.ytresearch` (opt) | `brief: text.brief` |
| `script.write` | `brief: text.brief` (opt when `pasted` is wired), `pasted: text.input` (opt) | `text: text.script`, `outline: json.outline` |
| `script.check` | `script: text.script`, `outline: json.outline`, `brief: text.brief` (opt) | `text: text.script`, `outline: json.outline`, `report: json.factcheck` |
| `voice.tts` | `script: text.script` | `audio: audio.voice`, `words: json.words` |
| `voice.own` | `recording: audio.voice`, `script: text.script` (opt) | `audio: audio.voice`, `words: json.words`, `text: text.script` |
| `beats.split` | `script: text.script`, `words: json.words`, `outline: json.outline` | `beats: json.beats` |
| `footage.input` | `files: media.clip[]` | `clips: media.clip[]`, `catalogue: json.footage` |
| `director.plan` | `beats: json.beats`, `words: json.words`, `outline: json.outline`, `footage: json.footage` (opt), `brief: text.brief` (opt), `script: text.script` (opt; read only when the `motion` param is set: the turns of a conversation), `factcheck: json.factcheck` (opt) | `plan: json.editplan`, `genlist: json.genlist`, `textcheck: json.textcheck` |
| `visuals.fulfil` | `list: json.genlist`, `footage: media.clip[]` (opt), `voice: audio.voice` (opt; required when the list has `avatar` items) | `clips: media.clip[]`, `images: media.image[]` |
| `image.generate` · `video.generate` · `avatar.talk` | one item spec (params); `video.generate` also `image: media.image[]`; `avatar.talk` also `voice: audio.voice` | `images: media.image[]` · `clips: media.clip[]` · `clips: media.clip[]` |
| `graphics.motion` (built as `motion.render`) | `plan: json.editplan` | `graphics: media.graphic[]` |
| `sound.music` | `voice: audio.voice`, `words: json.words`, `beats: json.beats`, `plan: json.editplan` | `music: audio.music`, `sfx: audio.sfx`, `soundplan: json.soundplan` |
| `captions.make` | `words: json.words`, `script: text.script`, `plan: json.editplan` | `subs: subs.track` |
| `render.assemble` | `plan: json.editplan`, `clips: media.clip[]`, `images: media.image[]` (opt when `background` is wired), `background: media.clip[]` (opt: replaces the pictures), `graphics: media.graphic[]` (opt: the intro card, its PNG and `startS`/`endS` in the meta), `motion: media.graphic[]` (opt: the animated overlays of `motion.render`, §25.1), `voice: audio.voice`, `music: audio.music`, `subs: subs.track` | `video: video.final` |
| `background.clips` | `voice: audio.voice`, `footage: media.clip[]` (opt; or the `folder` param) | `layer: media.clip[]` |
| `card.intro` | `outline: json.outline` (opt), `words: json.words` (opt), `script: text.script` (opt) | `card: media.graphic[]` |
| `script.translate` | `script: text.script`, `outline: json.outline` | `text: text.script`, `outline: json.outline` |
| `thumbnail.make` | `script: text.script`, `outline: json.outline` | `thumbnails: image.thumbnail[]` |
| `qc.check` | `video: video.final`, `plan: json.editplan`, `words: json.words`, `script: text.script`, `subs: subs.track`, `factcheck: json.factcheck` (opt), `textcheck: json.textcheck` (opt) | `qc: json.qc` |
| `package.youtube` | `video: video.final`, `script: text.script`, `outline: json.outline`, `words: json.words`, `subs: subs.track`, `thumbnails: image.thumbnail[]`, `qc: json.qc`, `plan: json.editplan`, `clips: media.clip[]` (opt), `images: media.image[]` (opt), `brief: text.brief` (opt) | `metadata: json.metadata`, `package: package.youtube` |

15.7 **Injected services.** The engine never imports `src/main/**` (R13.1). Everything a stage needs from the host
reaches it through `RunCtx.services` **(proposal, to add to the §2 contract in P2)**, each with a fake for tests:

| Service | What it provides | Host implementation |
|---|---|---|
| `claude` | `ask({ role, system, prompt, schema?, images?, tools?: ['web'] })` → validated JSON or text, usage | app: wraps `src/main/agents/call.ts` (R1.4) |
| `cloud` | `quote(items)`, `reserve`, `run(job, idempotencyKey)`, `cancel(key)`, provider catalogue (voices with their languages, models, prices) | app: `src/main/cloud/` client |
| `media` | ffmpeg / ffprobe execution with the run's `AbortSignal` | worker: system ffmpeg |
| `frames` | render an HTML template to frames at a given fps and size | app: Electron off-screen; Cloud/RunPod: headless Chromium |
| `asr` | word-timestamped transcription and forced alignment | local Whisper-family model |
| `lang` | offline language detection (bundled, licence checked) | engine library |
| `channel` | last titles, analysed reference transcripts, used-asset registry snapshot, style (`atelier.style/1`) | app database |
| `library` | music, effects, motion templates, fonts, map borders, with their licences | `resources/` |

15.8 **Style fields read by Part II.** `atelier.style/1` (plan §3) MUST carry at least these fields, each with a default
so a minimal style is valid **(proposal; the lot that defines the style schema owns it)**:
identity `{ name, niche, language, audience }`; voice `{ voiceId, model, speed, expressiveness, consistency,
pronunciations }`; script `{ shape, wpm, hookSeconds, skills[], forbiddenStems[], sentenceTarget, ctaMode, chapters }`;
visuals `{ mix { stock, image, video, graphics, footage, avatar }, styleSuffix, references[], characters[], grade,
texture }`; presenter `{ identity, layout }` (only if the format has one); animation `{ kit, skin, variants }`;
captions `{ preset, maxChars, lines, position, burn, font }`; sound `{ register, moods[], bedDb, effects, holes }`;
rhythm `{ cpm, minShotS, maxShotS, holdEveryS, introCurve, transitionFamily }`; thumbnail `{ layout, font, colours,
withFace, pools{}, count }`; packaging `{ titleRules, descriptionTemplate }`; budget `{ mode, capCredits, perMinute { qualite_max, usage_max } }`.

15.9 **Run-time additions to Part I (proposal, to fold into §6, §9 and §11 in P2/P7).**
- R15.1 **Gate hints.** A node's result MAY carry `gateHint`: `auto` (a `review` gate auto-approves because the node
  changed nothing, e.g. a fact check with no finding) or `required` (a `review` gate is kept even in all-at-once mode,
  e.g. unchecked fact-check parts). `none` and `owner` gates ignore hints.
- R15.2 **Two more node states.** `waiting_limit` (a Claude usage limit, R32.4; no reservation is held) and
  `paused_credits` (the wallet cannot cover the next reservation; nothing is reserved; resumes when credits are added).
  Both are sub-states of `running` for progress (frozen) and cancel (allowed).
- R15.3 **Paid items inside a node.** `visuals.fulfil` and `thumbnail.make` run locally and send each paid item
  (image, video, avatar) as its own Cloud job through `services.cloud`: one quote line, one reservation and one
  idempotency key (run id + node id + item fingerprint) per item. `image.generate`, `video.generate` and `avatar.talk`
  are the same operations exposed as one-item nodes. A node's "mixed" executor means: the node itself is `local`, its
  items are `cloud` or `gpu` (resolved by `where` and the budget mode).
- R15.4 **Pinned snapshots.** Anything outside the inputs that changes a node's output is resolved once at run start
  (or at quote time) and pinned in the run, then hashed into the fingerprint of the nodes that read it: the style
  version, the used-asset registry snapshot, the price-grid version, the list of optional enrichments the quote
  decided to run (R35.3), the analysed-transcript set. This keeps R2.5 true.
- R15.5 **Error codes** for `NodeEvent.error.code`: `transient`, `limit`, `credits`, `auth`, `refused_content`,
  `refused_topic`, `bad_params`, `bad_input`, `language`, `length`, `schema`, `verify_failed`, `provider_down`,
  `cancelled`, `internal`.

---

## 16. Research and angle — `research.topic`, `research.youtube`

**Node(s) and artefacts.** `research.topic` (local, Claude, role Researcher) → `text.brief`. `research.youtube`
(cloud, YouTube Data API read-only) → a list of related videos with stats, folded into the brief's inputs.

**Inputs.** Ports per §15.6: topic (`$inputs.topic`), optional user links and notes (`$inputs.links`), optional
`json.ytresearch`. Params and services: target length `T`, channel style (identity, niche, language, audience, script
card), the channel's last ~15 titles (`services.channel`).

**Outputs.** `text.brief`: a Markdown document with fixed sections:
1. the **angle** in one sentence (what this video promises that the channel's previous videos did not);
2. the **working title** (and up to 3 alternatives);
3. the **story shape** suggested (§17.3);
4. **key facts**, each with a source (URL or book reference) and a confidence (`sure` / `likely` / `disputed`);
5. **names, places, dates, figures** list (used later by the fact check and the on-screen text check);
6. **what to avoid** (angles already used by the channel, claims that could not be sourced);
7. **sources** (deduplicated list, later offered to `package.youtube`).

**Behaviour.**
1. If the user gave links, read them first (web pages through Claude's web tools; YouTube links: title, description
   and public captions only when available through official means, else just title/description). Each linked source is
   capped (~30 k characters) and labelled "facts to verify and build on, never wording to reuse".
2. Run a bounded web research loop through Claude Code's web tools (search + fetch, nothing else allowed): up to
   `maxSearches` searches and `maxFetches` page reads per video (the params cannot exceed 12 and 10). Search in the story's own language as well
   as the channel's.
3. Compare with the channel's previous titles: if the topic overlaps one, choose a different entry point, central
   image or question, and say so in the brief.
4. Write the brief. Every fact carries its source; a fact without a source is either dropped or marked `disputed`.

**Decisions and heuristics.**
- The brief is for the scriptwriter, not the viewer: dense, factual, no prose flourishes.
- Prefer primary and institutional sources; an encyclopedia is a starting point, not a citation.
- An angle is good when it is specific (a person, a moment, a number), surprising (contradicts an expectation) and
  answerable inside `T` minutes.
- `research.youtube` (when present; it reads the channel identity from the style and the niche's videos through the
  Cloud's YouTube Data API module) contributes, as `json.ytresearch`: the niche's outlier videos for this topic (views ÷ channel median),
  the formats that worked, and titles to avoid duplicating. Rank format × subject pairs by their **median** result and
  by the **number of distinct channels** that had a hit with them, never by one lucky video; treat several rows that
  cite the same example video as one signal.

**Parameters.** `maxSearches` (param, 8), `maxFetches` (param, 6), `language` (from style), `avoidTitles` (param,
last 15 titles of the channel), `requireSources` (param, true), `inspiration` (optional, at most 8 `{ title, why, channel }`: the
competitors' outliers the app read through the Cloud, `src/shared/outliers.ts`; absent = the prompt has no such block, and the
parsed params have no such key, so the fingerprint of a run without it does not move; the prompt says they are inspiration for
the angle only, never to copy).

**Duration and cost.** 1–4 minutes; 0 credits (Claude Code). `research.youtube`: a few API units per call, priced in
credits by the Cloud grid; quota-bound rather than money-bound.

**Failure handling.** No web tool available or nothing found → the brief is still produced from Claude's knowledge
with every fact marked `likely` and a visible warning « recherche web indisponible » on the gate card. A refusal (the
model declines the topic) is a permanent error with the message « Le sujet a été refusé : reformule-le ».

**Cache.** Fingerprint adds the topic text, the user links (URLs, not page contents) and the avoid-list. Web pages
are not re-fetched on a cache hit.

**Fake.** A brief built from a template with the topic inserted and three invented, clearly marked sources.

**Budget modes.** Identical (Claude only). `research.youtube` is skipped in `usage_max` unless the pipeline marks it
required.

---

## 17. Script writing — `script.write`

**Node(s) and artefacts.** `script.write` (local, Claude, role Scriptwriter) → `text.script` + `json.outline`
(proposal; the chapter list lives in the outline).

**Inputs.** `text.brief`, `T`, channel style (script style card: structure, hook rules, tone, words per minute,
length, forbidden words; checked skills), optional pasted script (`$inputs.script`), extra notes, language.

**Outputs.**
- `text.script`: **narration only**, plain text, paragraphs separated by a blank line, no Markdown, no stage
  directions unless the voice model supports them (§19.1). Chapter titles are NOT inside the narration.
- `json.outline`: shape, ordered outline beats `{ index, purpose, summary, wordBudget, tags[], anchors[] }`, chapter
  list `{ title, firstBeat, anchor }`, hook text, promise sentence, planted details and where each pays off. An
  **anchor** is the first ~8 words of the sentence a tag or chapter points at; links are by anchor text, not by sentence
  index, so an edit elsewhere in the script does not break them. After any change to the text (fact check, user edit),
  anchors are re-matched deterministically; a tag whose sentence disappeared is dropped and listed.
- `meta`: word count, estimated minutes, length ratio vs target, language, whether pasted.

### 17.1 Length targeting

R17.1 Target words `W = T × wpm`. `wpm` (param) defaults per language: ~150 for English, Spanish, French; ~145 Italian,
Portuguese; ~140 Dutch; ~125 German; ~120 Polish, Czech, Slovak, Russian, Ukrainian, Hungarian; 140 elsewhere. A
channel style MAY pin its own `wpm` only for its own language. (These are speaking rates of a calm documentary
narrator; they make `D ≈ T` within ~10 %.)
R17.2 Acceptance band: the final script MUST be within **90–112 %** of `W`. Under 90 % → rewrite pass (§17.4); over
112 % → tightening pass. After the passes, a script still outside **80–120 %** is accepted only with a visible warning on
the gate card (« script court : 7 min 40 au lieu de 10 »), never silently.
R17.3 Output token budgets are sized from `W` and the language's tokens-per-word ratio (≈1.4 English, ≈1.8–2.0 Romance
and German, ≈3.4 Polish/Czech), with a floor and the model's maximum as ceiling.

### 17.2 Writing in parts

Models return roughly 1.5–2 k words per answer regardless of what is asked; long scripts written in one pass come out
at about half length. Therefore:

R17.4 If `W > ~1,500` words (param `partsThreshold`), the script MUST be written **beat group by beat group**: the outline
is written first; beats are grouped into parts of ~3–4 beats (~600–900 words each); each part is one Claude call that
receives the outline, the part's beats with their word budgets, its position ("part k of n"), and the narration written
so far (the last ~20 k characters, plus a short running summary of the earlier parts so planted details are not lost).
R17.5 Part rules: the first part opens cold (no greeting, no "in this video"); middle parts end mid-story with no recap
and no wrap-up; the last part pays the promise and ends the episode. Each part MUST land within ~85–115 % of its budget;
a short part gets up to two "rewrite at full length" retries, keeping a rewrite only if it is longer and still within
the band; it is never padded with filler.
R17.6 If a middle or late part fails after its retries, the node fails (permanent error) rather than shipping a script
that stops mid-story. **(decision: unlike a "ship what we have" policy, a truncated script is never voiced.)**

### 17.3 Structure: story shape, hook, beats and retention devices

R17.7 The outline call first decides **story or lesson** (narrative vs explanatory), then picks a **shape** (param
`shape`, default `auto`) from our catalogue:

| Shape | When | Skeleton (positions are % of runtime) |
|---|---|---|
| `chronicle` | an event with a climax | cold open inside the event → context ≤ 30 s → rising steps → climax at ~45–65 % → consequences ≥ 25 % → closing line that recasts the title |
| `investigation` | a mystery, an unexplained fact | the anomaly → clues in order of discovery → false lead → key discovery at ~65–75 % → explanation → what remains open |
| `profile` | a person | defining moment first → origin → rise → turning point → fall or legacy → bookend |
| `explainer` | how something works | the surprising effect → mechanism step by step (one idea per beat) → a worked example → limits → takeaway |
| `countdown` | a ranked list | criteria up front → items from weakest to strongest, each with a mini-story → the strongest kept for last → summary |
| `versus` | two sides, two choices | the stakes → side A → side B → the decisive difference → verdict |
| `howto` | a practical method | the result first → steps → common mistakes → recap |
| `essay` | an idea or argument | a concrete scene → the thesis → three supporting movements → the counter-argument → resolution |

The shape is chosen from the title and brief; a style MAY pin it; the user MAY override it on the gate card.

R17.8 **Hook** (first ~15 s, ~40–60 words): it MUST confirm the title's promise and use at least two of: an open
question, a hard specific (name, number, date), a contradiction, rising stakes. No greeting, no channel name, no
"subscribe", no "in this video". The outline call self-checks the hook against these criteria before continuing.
R17.9 **Beats.** ~1 beat per minute (at least `max(6, 0.6 × T)` beats for `T ≥ 8`). Each beat answers one question
and opens the next within ~10 s ("open loops"). Concrete events at least every ~30 s; no stretch of background longer
than ~30 s. Best material in the middle, second-best first, third-best last. The payoff is foreshadowed at the hook and
roughly at one and two thirds. Details planted early are paid off later and listed in `json.outline`.
R17.10 **Beat tags.** Each beat carries tags from our vocabulary, used downstream by the director (§21), sound (§26) and
captions (§27): `hook`, `promise`, `question`, `payoff`, `pivot` (a turn of fortune), `disclosure` (a reveal),
`figure` (a key number), `citation` (a quote), `echo` (a callback), `chapter` (starts a chapter), `cta`. Tags are
attached to the beat and, for `figure`/`citation`/`pivot`/`disclosure`, to the sentence that carries them (by
anchor, §17 outputs), so `beats.split` can time them.
R17.11 **Chapters.** 3–8 chapters for videos ≥ 6 minutes (param `chapters`), each a short concrete title in the
video's language (2–5 words), stored in the outline, never spoken unless the style says chapter titles are read.
R17.12 **Call to action.** At most one mid-roll and one end CTA, only if the style enables them; the mid-roll CTA
never interrupts an open loop.
R17.13 **Style card rules** (forbidden words, sentence length, tense, person, tone, "no questions in the body", etc.)
are injected as constraints; a deterministic linter (§17.5) measures them after writing.

### 17.4 Post-writing passes

1. **Clean**: strip any preamble, trailing offers, Markdown emphasis, code fences, and lines addressed to an editor.
2. **Lint** (deterministic, no AI): length band; average sentence length (target ~10–16 words for narration); share of
   sentences over 25 words (target < 10 %); forbidden-word hits (stems from the style); question and exclamation
   density; repeated openings; numbers per 100 words (target ≤ ~2 — numbers are hard to follow by ear). The lint
   result goes into `meta` and the gate card.
3. **Revision pass** (optional, param `revise`, default on for ≤ ~4,000 words, and run **per part** above that so long scripts
   are not skipped): one Claude call scores the draft against the hook, beat and retention rules and rewrites it within
   ±10 % length, **adding no fact**. A deterministic guard keeps the rewrite only if: no new number, name, date or
   quote absent from draft + brief; no hedge removed from a figure; lint failures did not increase; length within band.
   Otherwise the draft stays (one retry with the reasons listed is allowed).
4. **Forbidden words**: sentences containing a forbidden stem are sent back in one batch for a same-meaning rewrite;
   a replacement is accepted only if the stem is gone and the sentence count is unchanged.

### 17.5 Decisions and heuristics

- **Truth over drama**: no invented scene detail (weather, weekday, thoughts in someone's head, an unnamed witness), no
  computed figures, no superlative or quote without a source in the brief. If a dramatic device needs a fact the brief
  does not have, the device is dropped.
- Spoken style: short sentences, concrete nouns, active voice, one idea per sentence; numbers rounded unless the exact
  value matters; a figure is always followed by what it means.
- **Language line first**: every Claude call of this node states the output language before anything else, and the
  result is checked with a language detector; a script in the wrong language is a retry, then a permanent error.
- **Refusals** are detected by structure, not phrase lists: a reply shorter than 30 % of the asked length, or with no
  paragraph break, or failing the outline schema, is treated as a non-answer and retried (max 3 attempts per call).

### 17.6 Pasted script

R17.14 A pasted script (`$inputs.script`) bypasses writing: the node only cleans, lints, splits chapters (Claude may
propose chapter titles) and emits the outline (one Claude call to tag beats). It is never lengthened, shortened or
revised without the user's request. Length warnings still show.

**Parameters.** `shape` (`auto`), `wpm` (language default), `partsThreshold` (1,500), `revise` (true), `chapters`
(auto), `skills` (from style), `hookSeconds` (15), `ctaMode` (`style`), `style` (optional `{ tone, structure[], hookPattern,
hookExample, hookSeconds }`: the channel's style profile, `src/shared/style-profile.ts`; it adds a "voice of this channel" line to
the writer's system prompt and the order of the parts and the hook pattern to the outline prompt; absent = no such line anywhere).

**Duration and cost.** Outline 1–3 min; each part 1–3 min; a 10-minute script ~6–12 min wall clock, a 30-minute one
~20–40 min (parts are sequential because each continues the previous). 0 credits. Rough Claude use for 30 min: 1 outline
+ 8–10 parts + 0–4 retries + revision ≈ 15–20 calls.

**Failure handling.** Outline fails 3× → permanent error. Language mismatch after retry → permanent error with the
detected language named. Length outside 80–120 % after passes → done with warning (not an error).

**Cache.** Fingerprint adds `T`, the style's script card version, the pasted text hash. A cached script is reused only
if its fingerprint matches — no "reuse if long enough" heuristics.

**Fake.** A deterministic template script of exactly `W` words (lorem-like sentences in the right language, with a
real hook-shaped first paragraph and chapter list) so downstream timing is realistic.

**Budget modes.** Identical.

---

## 18. Fact check and originality — `script.check`

**Node(s) and artefacts.** `script.check` (local, Claude, role Fact-checker) → `text.script` (corrected) +
`json.factcheck` (proposal). Default gate: `review`; the node returns `gateHint: auto` when it changed nothing and every part was checked (R15.1).

**Inputs.** `text.script`, `json.outline`, `text.brief` (facts and sources), the transcripts of the channel's analysed
reference videos (for originality; from `services.channel`, pinned per R15.4), language. Outputs also carry the
re-anchored `json.outline` (§17).

**Behaviour.**
1. Split the narration into parts of ~500–600 words at paragraph boundaries.
2. For each part (up to ~4–6 in parallel within the Claude concurrency limit, §6), one Claude call with **web search and
   page fetch only** checks every factual statement and reports only real problems, typed: `error` (wrong fact),
   `misquote` (quoted words not said verbatim), `overstated` (stated as certain but disputed), `invented` (decorative
   detail with no source), `superlative` (unsupported "first/biggest/only"). Each finding carries the exact original
   words, a replacement written as **finished narration in the script's language**, a source URL, and a confidence.
3. Absence of evidence never deletes a claim: it can only soften it (`overstated`) or be reported.
4. **Apply fixes by exact replacement only**: the original span must occur exactly once in the part, the replacement
   must not be more than ~3× longer, and it must read as narration (not an instruction). Anything else is reported as
   `unapplied`, never guessed.
5. **Whole-script consistency pass** (one extra call): checks names, dates and figures that recur across parts for
   contradictions (a fix in part 2 that contradicts part 5). This closes the gap of independent per-part checks.
6. **Originality (anti-plagiarism)**: deterministic n-gram overlap between the script and the analysed transcripts
   (word 8-grams after normalisation). Any shared 8-gram outside proper names and common phrases is listed; overlap above
   ~2 % of the script's 8-grams, or any shared run ≥ 15 words, raises a `plagiarism` finding that MUST be rewritten
   (one Claude call rewrites only the flagged sentences, same meaning, new wording). Facts may be shared; wording may not.
7. Write `json.factcheck`: per part `{ checked: bool, findings[], applied[], unapplied[] }`, plus originality overlaps.

**Decisions and heuristics.** A reply that just echoes the instructions or returns an empty list without having
searched is a non-answer (the call must report how many searches it made; zero searches with zero findings on a part
with factual content = retry). Search in the story's own language too. Never "fix" a quote by inventing different words:
either the real wording is found and used, or the quote becomes indirect speech.

**Parameters.** `partWords` (550), `parallel` (4), `maxSearchesPerPart` (6), `originality` (true),
`maxOverlapPct` (2), `maxSharedRun` (15).

**Duration and cost.** A 10-minute script (~1,500 words): 3 parts → 2–5 minutes in parallel. 30 minutes: 8–9 parts →
5–10 minutes. 0 credits on Claude Code (web search is part of the subscription's tools).

**Failure handling.** A part whose call fails after 2 attempts stays `checked: false`; the node still completes, but the gate
card shows « 2 parties non vérifiées » and the node returns `gateHint: required` (R15.1). No web tool at all → the
node completes with every part unchecked and the same hint.

**Cache.** Per-part cache: key = hash(part text, language, node version, node seed). Editing the script re-checks only the changed
parts. A replay of the same script reapplies recorded fixes without calls.

**Fake.** Returns the script unchanged and a fixed report with one applied and one unapplied finding.

**Budget modes.** Identical.

**Ordering rule.** R18.1 `script.check` MUST run before the voice. Any edit to the script after the voice exists changes
the script fingerprint and therefore re-voices (this is the honest cost of editing late; the gate card says so).

---

## 19. Voice and word timing — `voice.tts`, `voice.own`

**Node(s) and artefacts.** `voice.tts` (cloud, resold TTS) or `voice.own` (local) → `audio.voice` + `json.words`.

**Inputs.** `text.script` (narration only), voice settings from the style (voice id, model, `speed`, `expressiveness`
0–1, `consistency` 0–1, pronunciations; the Cloud adapter maps these to each provider's own settings), language.

**Outputs.** `audio.voice`: one mono or stereo 48 kHz file, loudness-normalised to about −16 LUFS (the final master
happens in `render.assemble`). `json.words`: `[{ w, start, end, sentence, paragraph }]` for every **script** word, in
seconds, with the script's own spelling and punctuation.

### 19.1 Preparation

- Remove anything that must not be spoken (headings, list markers, URLs → spoken form or removed).
- Normalise for speech: numbers, dates, units and abbreviations expanded the way a narrator would say them in that
  language ("1914" as a year vs a quantity), acronyms either spelled or read as words (a per-language rule: read as a
  word if pronounceable, spelled otherwise). The **display** text (captions, labels) keeps the written form; a mapping
  from spoken tokens back to script words is kept for timing.
- Optional pronunciation dictionary per channel (names, places), applied only to the spoken text.

### 19.2 Synthesis

R19.1 The text is cut into chunks at paragraph, then sentence boundaries, ~800–1,000 characters each (long chunks make
some voice models drift in pitch and pace; very short ones sound disconnected). A tail under ~200 characters is merged
into the previous chunk.
R19.2 Each chunk is sent with ~300 characters of preceding and following script text as **context** (for prosody across
seams), when the provider supports it. Chunks may then run in parallel (default 4, lowered automatically on a
"too many concurrent requests" answer).
R19.3 Each chunk is cached by hash(provider, model, voice, settings, text, context) so a failed run pays only missing
chunks. Chunks are joined with ~30–60 ms crossfades at sentence pauses; the join is verified: total duration ≈ sum of
chunks (±0.15 s), otherwise the provider timing is discarded and alignment (§19.4) is used.
R19.4 Speed: providers' native speed (0.7–1.2) is preferred. Without it, a pitch-preserving time-stretch (0.8–1.25) is
applied **before** timing so all downstream times are real.
R19.5 Optional **pace tightening** (param `minWpm`, off by default): first shorten pauses longer than ~0.6 s (never
cutting into a word), then, only if still below target, speed up by at most ~1.1×.
R19.6 Optional **de-noise**: if the noise floor (quietest 5 % of 100 ms windows) sits clearly above the near-digital
silence of clean synthetic speech (about −55 to −60 dBFS), apply a gentle
denoiser once; keep the raw file in the artefact for comparison.
R19.7 **No silent provider swap.** If the configured voice's provider is unavailable, the node fails with a permanent
error offering « Réessayer » or « Changer de voix ». A different voice in the middle of a narration is never
acceptable. **(decision: a fallback voice is only allowed for the whole narration and only if the user picked it.)**

### 19.3 Word timing

R19.8 Prefer **provider alignment** (character or word timestamps returned with the audio), offset by cumulative chunk
durations. If any chunk lacks timing, or the join check failed, or a time-stretch was applied without updating times,
use **forced alignment**: run a local speech recogniser with word timestamps (Whisper-family, small or base model on CPU
is enough for clean TTS) and align its words to the script words with a sequence alignment (exact and fuzzy matches,
numbers matched across digits and spelled forms). Unmatched script words are interpolated between matched neighbours
proportionally to their length, never across a pause > 0.3 s.
R19.9 Quality bar: ≥ 90 % of script words matched (TTS) / ≥ 75 % (own recording). Below that, the node still completes
but `json.words.meta.alignment = 'weak'`, and downstream nodes that need precise word times (captions, director) widen
their tolerances; QC reports it.
R19.10 Optional **onset refinement**: recognisers place words that follow a pause slightly early (0.15–0.4 s). An energy
analysis on ~10 ms frames moves each such word's start to the real acoustic onset. Used by precise cut styles and word
captions.

### 19.4 Own recording — `voice.own`

Normalise loudness, trim leading/trailing silence, optional de-noise (§19.6), then forced alignment against the script
(if a script exists) or transcription (if not: the transcript becomes the `text.script` output of the node, and the
voice length defines `D`). Voice-activity filtering is ON for own recordings (room noise), OFF for TTS.

**Parameters.** `chunkChars` (900), `parallel` (4), `speed` (1.0), `expressiveness`/`consistency` (style), `denoise`
(auto), `minWpm` (off), `onsets` (false).

**Duration and cost.** ~900 characters per minute of narration. Provider cost spans roughly 0.5–20 US cents per minute
depending on model tier; a 10-minute voice is ~9,000 characters. Wall clock: 1–4 minutes for 10 minutes of audio with
4 parallel chunks; alignment ~0.2–0.5× real time on CPU for a base model.

**Failure handling.** Transient (429, 5xx, timeout): §10.1 retries per chunk. Auth / quota / invalid voice: permanent.
Provider refuses settings: retry once with the voice's default settings and log it. Content refused: permanent with
the offending sentence shown.

**Cache.** Per-chunk cache (R19.3) inside the node's fingerprint; changing one sentence re-synthesises only its chunk
(and the neighbours whose context changed). The node seed is part of every chunk key.

**Fake.** OS voice (macOS `say`, Windows SAPI) with real word timing from forced alignment, marked demo; if no OS voice,
a tone per word at the target wpm so timing remains realistic.

**Budget modes.** `qualite_max`: best voice model, context stitching, onset refinement. `usage_max`: fast/cheap model,
no onset refinement.

### 19.5 Several voices in one video (characters)

For conversation and story channels a script can give the floor to several characters. **Syntax (implemented in
`text/script.ts`, `parseScript`).**

- A line that starts with an **upper-case name followed by a colon and a space** (or the end of the line) gives the floor
  to that character: `ALICE: Tu as vu la lune ?`. Names are upper-case letters, digits, spaces, `_ ' -`, at most 24
  characters; accents are fine (`ÉLODIE:`). The text after the colon, and every following line, belongs to the character
  until the next tag. The floor **stays** across blank lines. Lines before the first tag belong to the narrator.
- `NARRATEUR:` (also `NARRATRICE`, `NARRATOR`, `NARRATION`, `VOIX OFF`) gives the floor back to the narrator.
- A script is read this way only if it carries **at least two different names**: a lone `NOTE:` or `ATTENTION:` in a
  narration stays text. A tag in lower or mixed case (`Note:`) is never a tag. A script without tags parses exactly as
  before (no `speaker` field anywhere, same tokens, same chunks, same files: `npm run engine:demo` is unchanged).
- **The tag is not a word.** `ParsedScript.tokens`, captions, beats, anchors and `json.words` never contain it, and every
  tag starts a new paragraph (a turn is a paragraph). Each token of a several-voices script has an optional `speaker`
  (the upper-case name; absent for the narrator) and `ParsedScript.speakers` lists the characters in order of appearance.

**Voices.** `voice.tts` takes `speakers` (name to voice id, names matched in upper case); the narrator and any character
not listed use `voice`. A style gives it through `$style.speakers` (the app's run style has a `speakers` field and wires
it to every `voice.tts` node of the pipeline, template or library; absent, the node's fingerprint does not change).

**Synthesis (run).** The script is cut into **segments**: maximal runs of paragraphs said by one speaker. Each segment is
cut into chunks like a single narration (R19.1) and never merged with a neighbour's, so every chunk has one voice. Chunks
are cached by `hash(voice, speed, language, text, seed)` exactly as before: **the cache is per segment**, and editing one
turn pays only that turn. The pieces are joined end to end with a **0.25 s silence at every change of speaker**; the provider's
word times are offset by the chunks and silences before them, so times are continuous and exact at the seams. If a chunk
lacks times the usual fallback (recogniser, then aligner) runs on the whole track.

**Fake (demo).** Each segment is spoken by a system voice (a different system voice per distinct voice id while the
machine has enough voices of the language; else the tone voice at a different pitch), trimmed of its own silences, timed
alone, then laid end to end with the gap. `audio.meta` gains `speakers` (name to voice id), `segments` and, in demo,
`segmentS` (the length of each segment before the final trim).

**Out of scope.** Colouring a speaker's captions, per-speaker loudness, overlapping speech.

---

## 20. Beat splitting — `beats.split`

**Node(s) and artefacts.** `beats.split` (local, deterministic) → `json.beats`.

**Inputs.** `text.script`, `json.words`, `json.outline` (beat tags, chapters).

**Outputs.** `json.beats`: an ordered list of **timed beats** `{ i, text, start, end, sentenceIdx[], paragraph,
chapter?, tags[], keyTerms[] }` covering `[0, D]` with no gap and no overlap (silences belong to the beat before them).
`keyTerms` = names, places, dates, figures and concrete nouns found in the beat (used by the director and by visual
search).

**Behaviour.**
1. Sentences are the base unit, timed from `json.words` (first word start, last word end).
2. A sentence shorter than ~2 s merges with its neighbour in the same paragraph if the result stays ≤ ~10 s.
3. A sentence longer than `maxBeatS` splits at clause boundaries (comma, colon, dash, conjunction after ≥ 4 words) into
   parts of ~5–10 s, none under ~3 s.
4. Beat boundaries snap to the nearest word boundary; a beat starts at its first word's start minus a small lead
   (param `leadMs`, 80 ms) so a picture can land just before the word.
5. Outline tags are copied onto the beats that contain their sentences; `chapter` beats are marked as chapter starts.
6. Phrase marks inside each beat (comma, sentence end, pause ≥ 0.25 s) are listed as allowed cut points for the director.

**Parameters.** `minBeatS` (2), `maxBeatS` (10), `leadMs` (80).

**Duration and cost.** Milliseconds; 0 credits.

**Failure handling.** Deterministic; only fails on invalid input (schema). Weak alignment (R19.9) → wider snapping.

**Cache.** Standard.

**Fake.** The real implementation (it is deterministic).

**Budget modes.** Identical.

---

## 21. Director and edit plan — `director.plan`

The director is where a long video is made watchable. It works on two layers: a **scene layer** (which visual device
carries each moment) and a **cut layer** (where the picture changes, how fast, with which transition). Our director
produces both in one `json.editplan` and prices everything it asks for in `json.genlist` (§12).

**Node(s) and artefacts.** `director.plan` (local, Claude, role Director) → `json.editplan` + `json.genlist`
(+ `json.textcheck`, proposal).

**Inputs.** `json.beats`, `json.words`, `json.outline`, optional `json.footage` (the user's scene catalogue), optional
`text.brief` and `json.factcheck` (for the text check, §21.9); channel style (visual mix, palette, fonts, animation kit,
rhythm, caption and sound preferences), the **shot-kind
catalogue with unit prices** (from the node registry + Cloud price grid), budget mode and cap, `D`.

### 21.1 Shot-kind catalogue (what the director chooses from)

| Kind | Fulfilled by | Typical length | Use for |
|---|---|---|---|
| `stock.video` | stock video search | 2–7 s | concrete, filmable subjects without a specific identity |
| `stock.photo` | stock photo search + motion | 2–6 s | same, when video is weak |
| `image.gen` | `image.generate` + motion | 2.5–6 s | scenes that cannot be filmed (past, abstract, specific composition) |
| `video.gen` | `video.generate` (from a generated or stock still) | 3–5 s | hero moments (hook, chapter openers, climax) |
| `user.footage` | `footage.input` | 1.5–8 s | the user's own camera or gameplay material |
| `avatar` | `avatar.talk` | 4–20 s | presenter segments if the format has one; shot field `layout`: `full` or `pip` (picture in picture, bottom right, ~30 % width) |
| `graphic.<template>` (title, chapter, figure, list, timeline, quote, compare, bars, map, card, cta — §25) | `graphics.motion` | 3–9 s | a fact the picture cannot show |
| `label` | `captions.make` overlay layer | 2–4 s | a name, place, date or figure over another shot |
| `hold` | — | ≤ 3 s | extend the previous shot (used sparingly) |

### 21.2 Behaviour

1. **Scene pass (Claude).** The beats are cut into stretches (the hook = first ~45–60 s, then ~2–3 minute stretches),
   drafted in parallel within the Claude limit. Each call gets the shared rules + catalogue (stable, cache-friendly
   system text) and the stretch's beats with numbers and times. For each beat it returns one or more **shots**
   `{ beat, kind, anchorWords (1–6 words copied from the beat), subject, query or prompt, text fields (for graphics/
   labels), why }` **and** a `base` pair `{ stockQuery, imagePrompt }` that the cut pass uses for the filler shots of
   that beat.
2. **Anchor timing (deterministic).** Each shot's anchor words are located in `json.words` within its beat (fuzzy,
   digits = spelled numbers). Start = anchor time − kind lead; end = start + kind length, clipped to the cut grid.
   A shot whose anchor cannot be found is dropped (and logged in the plan's diagnostics).
3. **Cut pass (deterministic).** Fill every second between scenes with base shots from the channel's visual mix, at the
   style's rhythm (§21.4), cutting only on allowed cut points (§20 step 6); each filler shot takes its beat's `base`
   query or prompt (successive fillers of one beat vary the shot size in the prompt and take successive stock results).
4. **Selection under constraints (deterministic).** Resolve overlaps and caps greedily by value (§21.5).
5. **Budget pass (deterministic).** Price `json.genlist`; the budget is `capCredits` (pipeline or style) minus what
   the run has already reserved or settled; without a cap, the style's `budget.perMinute` for the mode × `T`. If above it, downgrade items in order of
   least value per credit (`video.gen` → `image.gen` → `stock.photo`; `avatar` → voice over stock) until within budget
   (R12.3). Never downgrade the hook's first shot unless nothing else is left.
6. **Checker (deterministic, R12.2)** + **on-screen text check** (§21.9). Mismatch → one revision call to the director
   with the findings; second failure → permanent error.

### 21.3 Scene-layer rules (targets, all style-tunable)

- **Hook**: something designed in every sentence of the first ~30–60 s (a map where the story starts, a figure, a name
  label, a hero generated shot); scenes may sit ~1 s apart; at least ~4 labels in the first minute.
- **Body, per minute**: ~1 graphic, a map only when a new place matters, ~3–5 labels; at least ~4–6 s of plain base footage between designed scenes.
- **Coverage cap**: designed scenes cover at most ~60 % of the hook and ~40 % of each body stretch (raise to ~75 % when
  base footage is scarce).
- **Variety**: two consecutive designed scenes are of different kinds and, for graphics, of different templates; the same subject
  (person, object, page) never shown twice; rare kinds (map flights, big reveal cards) at most once per ~2 minutes.
- **Meaning**: a graphic carries a fact the picture cannot show; it never retypes the sentence being spoken.
- **Identity**: a named real person is shown only through material that is genuinely about that person — in v2 that
  means the user's own footage; stock is generic and generated images never depict a real named person
  **(decision)**. Otherwise the person is carried by a label, a quote card or a figure. Private individuals are never
  shown, only named. (A licensed editorial-photo source is a later addition, hypothesis H13.)
- **Beat tags drive emphasis**: `hook` → densest; `figure` → a figure graphic or label; `citation` → quote card;
  `pivot` / `disclosure` → a transition accent and a sound hit (§26); `chapter` → chapter card; `echo` → reuse the
  look of the shot it calls back to.

### 21.4 Cut-layer rules (rhythm)

R21.1 Rhythm (style `rhythm`): cuts per minute **CPM** (param, default ~10–12 for documentary, 15–25 for fast styles),
min and max **base** shot length (default 1.5 s / 7 s; graphics, avatar shots and designed holds have their own lengths
in §21.1). The picture MUST change at least every ~3.5 s (a cut, a label, a
graphic build step or a camera move counts as change); designed long holds (6–12 s) are allowed about once per
60–90 s on reflective beats.
R21.2 Cuts land on allowed cut points, slightly **before** the word: ~3 frames for standard cuts, ~8 frames on
`pivot` beats. Never cut inside a word. Scene leads (start before the anchor word): graphic ~0.3 s, map ~1.0 s, label
~0.2 s, quote card ~0.5 s, avatar 0 s.
R21.3 Intro shape: the first ~30–60 s cut faster (~1.3–1.5× CPM); the last ~20 s slow down (~0.7×). A style MAY
specify a different curve.
R21.4 Voice gaps ≥ ~1.2 s are picture time: they get a breath shot or a montage of ~3 quick shots (≤ once per 2 min).
R21.5 Transitions by role: plain cut by default; a softer transition (dissolve, dip) at paragraph and chapter changes;
a stronger accent (flash, whip, light leak) only on `pivot`/`disclosure` beats, capped at ~3 per 10 minutes. The style
picks the family (hard-only, punctuated, soft, fast).
R21.6 Motion on stills: every still gets a slow camera move (push or pull ~10–20 % over the shot, eased at both ends),
alternating direction across consecutive stills so a run of stills does not feel like one long creep.

### 21.5 Selection and repetition

- Each candidate shot has a value (defaults, style-tunable): base by kind — map 5, figure/quote/timeline 4.5, other
  graphics 4, user footage on its words 5, `video.gen` 4, `image.gen` 3, stock 3 — minus 1.5 per same-kind scene within
  ~30 s, minus 4 for a subject already shown, minus 3 when it would hide user footage chosen for those exact words;
  shots under 0 are dropped.
- Greedy: highest value first; place if within caps and no overlap (try small shifts of ≤ ~4 s); else drop or degrade
  to a `label` carrying its figure, date, name or place.
- **Never show the same base clip twice**; near-identical cuts (same source, within ~20 s of source time) count as the
  same. A source returns only after ~40–60 s of film and holds at most ~10–15 % of base-footage time. If nothing fresh fits,
  fallback order: extend previous shot ≤ 3 s → bring next scene in early → unused clip from up to ~2 min away →
  reuse a still not seen for ≥ 60 s → reuse a clip reframed (~1.25× crop, later in-point), flagged in diagnostics.

### 21.6 Output format

`json.editplan` (`atelier.editplan/1`): `{ fps: 30, size: [1920,1080], frames: F, tracks: { base[], overlay[],
labels[] }, captionsPreset, shots: [{ id, startFrame, endFrame, kind, genItem?, source?, motion?, transitionIn?, layout?,
role, beat, anchor }], chapters[], diagnostics[] }` (times in frames; seconds = frames / 30). `json.genlist`: `[{ id, kind, prompt|query, constraints
(duration, aspect, style refs), context { beatText, subject, keyTerms[] }, voiceRange? { startFrame, endFrame } (avatar
items), footageRef? { clip, startFrame, endFrame } (user footage), unitPrice, units, priority, shotIds[] }]` + totals.
Every item carries what its executor needs, because `visuals.fulfil` does not read the plan.
R21.8 **User footage path.** User-footage shots are `json.genlist` items of kind `user.footage` with a `footageRef`;
`visuals.fulfil` passes the referenced normalised file through into its `clips` output (0 credits), so
`render.assemble` resolves every shot's `source` through the single `clips`/`images` ports; the frame range comes from
the shot.

R21.7 Shot boundaries are on the frame grid (1/30 s); the base track has no gap and no overlap and covers exactly
`[0, F)`; overlays and labels lie within it (the checker enforces it).

### 21.7 Parameters

`hookSpanS` (60), `stretchSeconds` (150), `cpm` (style), `minShotS` (1.5), `maxShotS` (7), `holdEveryS` (75),
`coverHook` (0.6), `coverBody` (0.4), `labelsPerMin` (4), `graphicsPerMin` (1), `videoShare` (mode: 0.4 / 0 = the
share of `image.gen` items, hook and `pivot`/`disclosure`/`chapter` beats first, upgraded to `video.gen`, never more than
`maxVideoClips`), `maxVideoClips` (mode: 12 per 10 min / 0), `shotTypes` (optional list: the kinds of shots the channel is known
for, from its style profile; one line of the scene pass's rules, nothing when absent), budget.

### 21.8 Duration and cost

10-minute video: 1 hook call + ~4 stretch calls, 2 at a time → ~2–4 minutes; deterministic passes < 1 s. 0 credits.
The genlist it emits is what costs money; its total is shown on the gate card **before** any spend (R11.5).

### 21.9 On-screen text check (part of the checker)

Every string the edit plan will draw (labels, graphic fields, map place names, chapter titles) is checked before any
render (the thumbnail headline has its own check, §29):
- deterministic first: every number, year, date and proper name in the string MUST appear in the script, the brief's
  facts or `json.factcheck`; a quote MUST be text the script quotes; a place label MUST be named by the narration within
  ~5 s of the label;
- then, for strings that pass but carry claims, one Claude call per ~50 strings returns a verdict with quoted
  evidence; a string that drops a qualifier its evidence has ("according to…") fails;
- a string that fails is reworded using only wording present in the script (then checked again), else an optional field is cleared,
  else the shot is dropped. Never re-guess a name, date or source.

**Failure handling.** Scene call fails for a stretch → retry once; then that stretch gets base shots only (logged,
visible on the gate card « réalisation simplifiée de 4:30 à 7:00 »). Checker fails twice → permanent error.

**Cache.** Per-stretch cache keyed on the stretch's beat texts, rules version, style version, budget mode, price-grid
version, footage catalogue fingerprint and node seed; a voice change that only moves times re-runs the deterministic
passes and reuses the Claude drafts when all of these are unchanged.

### 21.10 Mix mode (production-6, decision 0031)

When the pipeline has a mix with a presenter, a curve or shot lengths (production-model §6.2), the node gets `screen` and
works per sentence instead of per beat: the presenter is placed by code (opening first, `short` or `stretches`), the scene
pass returns `json.directives` (production-model §7.2: sentence, anchor words, kind, subject, prompt or query, layout, text,
never a time), the pictures are cut on the anchors and their kinds kept on the curve's shares part by part, then the label,
brick, overlay, budget and checker passes above run unchanged. Extra outputs: `json.directives` and `json.timeline`
(`atelier.timeline/1`, §7.3), which the rhythm mode also emits (no directives). Code: `director-mix.ts`,
`director-scenes.ts`, `director-run-mix.ts`, `formats/directives.ts`.

**Fake.** A deterministic plan: base shots at the style CPM, one graphic per minute, labels on every `figure` beat.

**Budget modes.** `qualite_max`: more `video.gen` (`videoShare` of the `image.gen` items, §21.7), avatar if the format has one, more
graphics. `usage_max`: stock first, `image.gen` only where stock is weak, no `video.gen`, motion on stills.

### 21.11 The editing kit — `edit.fx` (motion-montage, decision 0073)

A style's way of cutting, moving and sounding a film, as settings (`formats/edit-kit.ts` `EditKit`), applied to the director's plan by
`edit.fx@1` (`nodes/edit-fx.ts`, between `director.plan` / `sound.music` and `motion.render`, whose plan it gives, then `render.assemble`;
free, local, seeded). No kit: the plan and the music pass through unchanged. Charlie's rules of 02/11 hold in every kit: no effect
unless the style measured some, no punch-in coming back out, no still held with nothing happening, transitions with a reason.

- **Rhythm**: a shot-length distribution for the hook (`hookS` seconds) and the body (median, p10, p90), fitted as a split
  log-normal (`edit/rhythm.ts`). `planCuts` draws cuts on a voice's words (a sentence start first, then a comma or a pause, within
  ±35 % of the drawn length); `measureRhythm` and `detectCuts` (ffmpeg scene score) measure ours and a reference's the same way. The
  kit does not re-cut a director's plan; it reports its measured rhythm.
- **Transitions** (`edit/grammar.ts`): each base boundary is a `phrase`, `sentence`, `paragraph` or `chapter` boundary (from the
  words' sentence and paragraph, the plan's chapters); its transition is drawn from the kit's weights for that kind among `cut`,
  `dissolve`, `dip`, `flash`, `whip`, `push`, `zoom`, `match` (§28.1). The director's own soft transitions are kept unless
  `override`. With `purposeful` (default) a drawn transition is kept only where it means something, else it becomes a cut (a dissolve
  at a paragraph or a chapter): a `match` between two shots of the same picture, a `whip` or a `push` inside a run of quick stills
  (≤ 4 s each: an enumeration), a `zoom` into a card or a detail of the same picture, a `flash` at a chapter or a paragraph (a
  disclosure). At most `perMinute` transitions other than cuts. Whips and pushes alternate sides (or keep one). A blend is never laid
  across a presenter beside a picture.
- **Camera on stills**: a still without a move (or every still, `override`) gets push / pull / left / right / parallax by weight, its
  zoom travelling `speedPerS` (the documentary push: 3 % a second); parallax only from `parallaxMinS`. `ease: 'glide'` (default) paces
  every whole-shot move at an even speed with ≈ 0.7 s eased ends (editplan `Motion.ease`; without it a move is eased over the whole
  shot and nearly stops at both ends); with a `focus` a push glides towards the subject. **Cut-ins**: a still longer than `maxHoldS`
  (documentary 7 s, avatar 5 s, pov2d 4.5 s) is cut on the word nearest its middle (each part ≥ 2 s) into the same picture closer on its
  subject (`cutInZoom`, a gliding push; the boundary stays a cut).
- **Punch-ins**: on the voice's accents (a word after a pause ≥ 0.3 s, a number, a word in capitals or before « ! », a long word,
  a word said louder than the voice's median when the voice is given), on stills, at most `perMinute`, `minGapS` apart, `zoom`
  in 3 frames and held to the cut: never back out, so a punch lands only on a still that ends at most `maxAfterS` (2.5 s) after it.
- **Numbers said aloud** (`edit/numbers.ts`, kit `numbers`): the voice's numbers read in French or English, in letters or digits
  (« mille six cent trente-sept », « dix mille », « 40 % »), with their meaning — a factor (« multiplié par vingt », « vingt fois »,
  « doublé » → « ×20 », « ×2 »), a share (« 40 % »), an amount of something (« 10 000 florins »), a year (« 1637 »), a count of 1 000 or
  more — set as a `kinetic` overlay on their word (style, position, `holdS`), over a still or a card listed in `overCards` that does not
  show that figure, never over another overlay, at most `perMinute`, `minGapS` apart. On in `documentary` and `pov2d`.
- **Sound effects** (`media/sfx.ts`; none by default: `perMinute` 0 unless the style measured effects on its references, `pov2d`
  only today): per transition kind, per card or overlay that comes in (by template), per reveal inside one (a
  word punch, a counted row, a pin, a highlighted phrase, a stressed kinetic word), per punch-in, per chapter; capped at `perMinute`
  (transitions and chapters first, then cards, then reveals). Each effect's key moment lands on its event at `levelDb` (−20 dBFS).
  The library slot `resources/sfx/library.json` (CC0 or resale-cleared recordings, technos-medias) wins over the synthesised sound
  of the same kind. The effects are mixed into the bed (`music`, FLAC) and also given apart (`sfx`, WAV + the events).
- **Motion that fits the channel** (`edit/motion-fit.ts`, pure): `measureMotion` reads a reference's described shots (French or
  English) into its graphics' share of screen time, its families a minute (map, data, document, words on screen, timeline, name strap)
  and its look (period, newsprint, modern); `motionAdvice` turns it and the video's register and subject year into `clone` (keep its
  families and look, propose what it lacks), `propose` (no motion design: offer the register's families in the look of the subject's
  era: before 1880 period, before 1975 newsprint, after modern) or `none`, with what a viewer would find off; `motionBrief` writes it
  for the style agent, which shows each part to the user as an option.
- **Measured kits** (`EDIT_KITS`): `documentary` (Markets of the Past), `avatar` (The
  Japanese Method), `pov2d` (Le Monde en POV). `editKitOf(name, changes)` starts from one and changes any field.
- **Outputs**: `plan` (with `meta.report`: transitions, moves, punch-ins, cut-ins, numbers, effects, rhythm), `music`, `sfx`. Proof:
  `tests/unit/motion-kit-edit.test.ts`, `motion-kit-craft.test.ts`, `npm run engine:motion-kit-demo`.

---

## 22. Stock footage and photos — part of `visuals.fulfil`

**Inputs.** `json.genlist` items of kind `stock.video` / `stock.photo`, each with its beat text, subject and query;
the channel's visual taste line; the team's recently-used asset registry (snapshot pinned at run start, R15.4).
Stock sources are provider modules of the Cloud (plan §4.6), each recorded in `docs/LICENSES-PROVIDERS.md` as free for
commercial use.

**Outputs.** `media.clip[]` / `media.image[]` with `{ itemId, file, sourceId, licence, credit?, inPoint, outPoint }`.

**Behaviour.**
1. **Queries.** The director writes 2–4 concrete English words per item (stock libraries index in English): what the
   narrator is talking about in that beat, not the first noun of the sentence. Consecutive items change subject,
   setting or shot size. Names, brands and on-screen text are never queried. A CTA beat is illustrated by mood, never
   literally. One alternative query per item is kept as fallback.
2. **Search.** Landscape only; ask for ~10–20 results; prefer HD (≥ 1920 wide, take the smallest file ≥ target width,
   else the largest); clip length ≥ the shot length (or ≥ 60 % if a slow-down up to ~1.3× is acceptable).
3. **Choose.** Score candidates: freshness (not among the team's last ~1–2 k used assets; least-recently-used as a
   fallback, never an unbounded blacklist that starves the pool), resolution, duration fit, and a **vision check**
   (§22.1) when the beat names a place, an era or an identifiable kind of thing (the query stays generic, the check
   rejects a clip that contradicts the beat) or in `qualite_max`.
4. **Download and verify.** Probe; reject a clip whose first seconds are essentially black (< ~0.5 % of pixels above
   dark grey on low-resolution samples) or frozen; trim to the most active stretch of the needed length.

### 22.1 Vision check (proposal)

A contact sheet of 3 frames per candidate (6 candidates per sheet) is judged by Claude against the beat text: `fits`,
`generic` (acceptable mood shot), `wrong` (contradicts place, era or subject), `unusable` (burned-in text, logo,
watermark, black, garbled, game/CG passed as real). Wrong/unusable → next candidate. Cached by (asset id, beat text).

**Parameters.** `resultsPerQuery` (15), `freshWindow` (1,000), `vision` (mode: on/off), `minWidth` (1920).

**Duration and cost.** Search + download: seconds per item; a 10-minute video needs ~80–120 base shots → 2–6 min with
~6–8 parallel downloads. Stock libraries used must be free for commercial use (§6.4 of the plan); credit cost ≈ 0 except
bandwidth and storage. Vision: one Claude call per ~6 candidates.

**Failure handling.** No result → alternative query → broader query from the beat's mood → degrade the item to
`image.gen` (if budget) or `stock.photo` or a hold of the previous shot. Never fail the node for one item.

**Cache.** Per item: hash(query, constraints, vision setting, registry snapshot hash, node seed). Downloaded files
are content-addressed and shared across the team, so a cache miss on the item rarely means a new download.

**Shipped (v0).** One Cloud `searchStock` per stock item (Pexels, Wikimedia Commons or the demo files; `docs/PROVIDERS.md`);
the Cloud downloads the top results and the first whose orientation fits is kept (`pickBest`: the vision check of §22.1 replaces
this one function later). Licence and credit line ride in the `images` record (`stock`) and in the package description
(« Crédits images »). A stock video gives its first frame (the renderer places pictures only), flagged degraded; no result →
a generated image, flagged. Licences are listed in `docs/PROVIDERS.md` §6 (there is no separate LICENSES-PROVIDERS file).

**Fake.** Coloured clips with the query text and a DEMO watermark, of the right duration.

---

## 23. Generated visuals — `image.generate`, `video.generate`, `avatar.talk` (via `visuals.fulfil`)

**Inputs.** Genlist items with a prompt, aspect 16:9, style references (channel palette, a style reference image,
recurring character references), budget mode.

**Outputs.** `media.image[]` (1920×1080 or larger, cropped to 16:9) / `media.clip[]` (3–10 s, re-timed to 30 fps) /
avatar clip with lip-sync.

**Behaviour (images).**
1. **Prompt design** (done by the director, refined here per item): one concrete subject, explicit shot size (wide /
   medium / close, varied across neighbours), lighting, palette, era; **no text, letters or numbers** in the image; no
   faces looking into camera unless the channel is built around a character; roughly a third of scenes with no person.
   A channel-wide **style suffix** (from the style) is appended to every prompt for consistency.
2. **Consistency**: recurring characters (style `visuals.characters`: name, fixed description, reference image) are
   described identically in every prompt that shows them (models have no
   memory between images) **and** their reference image is attached when the provider supports references; a style
   reference image MAY ride along on every image.
3. **Generate** with up to ~8–10 in parallel; poll with a timeout (~10 min); on transient errors retry (§10.1).
4. **Check** (cheap, deterministic): resolution, aspect, not blank, not near-duplicate of another image in this video
   (perceptual hash). Optional vision check in `qualite_max` (text rendered in the image, extra limbs, wrong era) →
   one regeneration.
5. **Refusal (moderation)**: rewrite the prompt once in plainer words (no names, no violence words, no quotes) and retry;
   if refused again, degrade the item (stock or hold). A moderation refusal is never "shopped" to another provider.

**Behaviour (video from image).** Take the approved still (generated or stock photo) as first frame; ask for gentle,
physically plausible motion ("slow push, subtle movement, nothing new appears"); 5 s at 720p–1080p; re-time to 30 fps;
never loop; if the shot is longer than the clip, hold the last frame with a slow push.

**Behaviour (avatar).** Input: the presenter's identity (style `presenter.identity`: an image or a provider avatar id)
+ the voice segment of the shot, cut from `audio.voice` with ~0.2 s of margin; output: a lip-synced `media.clip[]`
item of the same length; `render.assemble` composites it per the shot's `layout` (`full` or `pip`).

**Implementation (lots proto-avatar).** `video.generate` runs inside `visuals.fulfil`: one Cloud `generateVideo` job per `video.gen` item
(text to video from the director's prompt plus a camera-move line, `seconds` = the shot's seconds cut at the provider's longest clip,
10 s; image-to-video from the approved still comes later), the clip in `clips` (record `{ itemId, file, durationS, width, height, demo }`)
and its first frame as the item's picture in `images`. `avatar.talk` is the node `avatar.speak@1`: inputs `genlist` (its `avatar` items
carry `voiceRange` and `layout`), `voice`, `words`; param `avatarId`; output `clips`. The voice is cut on the shot's own frames (no margin: the
clip starts with the shot, so the lips follow the words), one Cloud `talkingAvatar` job per item (Hedra, billed by the second, cached by the audio's
bytes). The director places it (`avatar` param: `segments` hook / outro, `layout` `full` = a base shot, `pip` = an overlay-track shot;
total at most half the film, each at most 20 s) and the budget pass gives it back as stock footage when credits are short. `render.assemble` takes
the clips on its `clips` and `avatar` ports (§28.1); a video before a dissolve makes a cut; a clip that is missing falls back to its picture.

**Shipped (production-8, decision 0035).** Stills: with a pinned image engine or a brick style, each prompt is composed from the
director's parts (`shot: { size, scene }`) and the style's look (suffix, negatives, people and brand rules by code, references);
engines per item (a refusal rewritten once on the same engine, then a found still or a hold; a down engine → the next); the
presenter's portrait on the shots where the presenter acts, a recurring object's first picture on its later ones; checks blank /
near-duplicate (and the optional `vision` service) with one regeneration. Clips: the node `clip.make@1` makes them FROM the
still (image to video), per item through the clip engines with a 15 min timeout, two shots per generation in eco (wide, then a
tight crop of the rest, billed once); no clip → the still with a slow push in the render.

**Parameters.** `imagesPerMin` (style mix; ~1.5–3 when images are the main source), `videoShare` (mode), `maxVideoClips`
(qualite_max 12 per 10 min, §21.7), `refImages` (style), `visionCheck` (mode).

**Duration and cost.** Image: ~10–60 s each; ~1–4 US cents per image depending on the model. Image-to-video: ~1–4 min
per 5 s clip; ~2–5 US cents per second at 720p, more at 1080p — **roughly 5–10× an image per shot**, which is why
`usage_max` uses none and `qualite_max` reserves them for hero beats. Avatar: per-second pricing, the most expensive
item; minutes of processing per minute of avatar.

**Failure handling.** Out of credits on the Cloud side → the node pauses with « crédits insuffisants » (never partial
silent fallback); already generated items stay cached; resuming generates only what is missing.

**Cache.** Per item: hash(provider model id, prompt, refs' fingerprints, size, seed). Replacing one item redoes only it.

**Fake.** Images drawn locally with the prompt text and a DEMO watermark; video = slow zoom on the image; avatar = a
silhouette animated on the audio envelope.

**Budget modes.** `qualite_max`: best image model, image-to-video on hero beats, avatar if format has one, vision check.
`usage_max`: cheapest image model, no video, no avatar, no vision check.

---

## 24. User footage — `footage.input`

(No reference behaviour to follow; this is Atelier's own.)

**Node(s) and artefacts.** `footage.input` (local; Claude for descriptions) → `media.clip[]` (normalised files) +
`json.footage` (catalogue). It runs before the director, which picks from the catalogue; the actual cut (in and out
points) is done by `render.assemble` from the editplan, so a re-cut never re-processes the footage.

**Inputs.** User files (`$inputs.camera`, gameplay…, kind `video` → `media.clip[]`).

**Outputs.** `media.clip[]`: one normalised file per input (30 fps CFR, 1920×1080 letter- or pillar-boxed, SDR BT.709,
yuv420p, audio kept). `json.footage`: `[{ clip, scenes: [{ id, startFrame, endFrame, subject, shotSize, motion,
speaksToCamera, quality, text? }] }]`.

**Behaviour.** Probe and normalise; detect scene changes (content-difference threshold, minimum scene ~1 s); describe
each scene with Claude from 3 frames (subject, shot size wide/medium/close, motion still/slow/fast, whether a person
speaks to camera, technical quality ok/shaky/dark); optionally transcribe speech (`services.asr`). User footage chosen
for specific words wins over stock (§21.5).

**Parameters.** `minSceneS` (1), `describe` (true), `transcribe` (false), `maxFiles` (50).

**Duration and cost.** Roughly real time ÷ 10 for scene detection and normalisation; one Claude call per ~6 scenes.
0 credits.

**Failure handling.** Unsupported codec or unreadable file → permanent error naming the file. A description call that
fails leaves the scene described as « non décrit » (the director can still use it by time).

**Cache.** Per file: content hash + params + node version. **Fake.** Bundled sample footage with a fixed catalogue.
**Budget modes.** Identical.

---

## 25. Motion graphics — `graphics.motion`

**Inputs.** Graphic items of the editplan (template id, text fields, data, duration, style kit), channel palette and
fonts (OFL only), language (for number formatting).

**Outputs.** `media.graphic[]`: 1920×1080, 30 fps, H.264 (or ProRes 4444 with alpha for overlay templates) clips of the
exact planned duration.

**Behaviour.**
1. **Templates are ours** (`resources/motion/`), each an HTML page that renders a frame from a time value alone
   (`render(t)`), with no CSS animation clock and no network. Fonts are embedded. A template declares its fields (zod),
   text limits, min/max duration and whether it has alpha.
2. **Field validation** before render: text length limits per field (e.g. title ≤ ~50 characters, label ≤ ~30, quote ≤
   ~160), numbers formatted for the language (thousands and decimal separators), a chart needs ≥ 2 values and a non-zero
   maximum, a timeline ≥ 2 events. Invalid → the director's checker rejects it earlier (§21.9); here it is a permanent
   error, never a silent truncation.
3. **Text fitting by measurement**: the template measures rendered text with the real font and steps the size down
   until it fits its box (with a floor); only below the floor is the text rejected. (Length tiers alone break on long
   words and non-Latin scripts.)
4. **Render**: off-screen Chromium (Electron in the app, headless in Cloud/RunPod) captures frames 0..N at 30 fps and
   pipes them to ffmpeg. Up to 2–4 renders in parallel, gated by free memory.
5. **Legibility rules**: a graphic is never drawn on pure black unless the template is designed for it; "over footage"
   templates are rendered with alpha, and `render.assemble` places them over a blurred, darkened copy of the base shot
   under them (so graphics never wait for visuals); contrast of text vs its backing ≥ 4.5:1.

**Template families (our v2 set).** title / chapter card; figure (big number, count-up, unit, context line); list
(3–5 items, staggered); timeline (2–6 dated events); quote (≤ 2 sentences + attribution); compare (two values or two
sides); bars (2–6 values with source line); map (place pin, region highlight, route along the way that draws itself — drawn from a
public-domain world border dataset, places resolved through an offline gazetteer whose licence allows
resale, never generated); card (short fact with highlighted words); CTA card. Labels are not a template: they are drawn
by the captions layer (§27). Each template has 2–3 layout variants and the style's skin (palette, fonts, texture); consecutive uses of a
template alternate variants.

**Parameters.** `parallel` (3), `jpegQuality` (93) or lossless PNG pipe for alpha templates, `fps` (30).

**Duration and cost.** ~30–80 ms per frame → a 6 s graphic (180 frames) ≈ 10–20 s; a 10-minute video with ~10–15
graphics ≈ 2–5 minutes. Local = 0 credits; `gpu` placement possible in `qualite_max` for heavy kits.

**Failure handling.** Browser crash → restart and retry (3 attempts); a template error is permanent and names the template
and field.

**Cache.** Per graphic: hash(template id + version, fields, duration, skin, node seed). Editing one
graphic's text re-renders only it.

**Fake.** Real (it is local and free).

**Budget modes.** Identical, except `qualite_max` may use richer kit templates.

### 25.1 What is built (lot « motion design »): `motion.render`

The node is `motion.render@1` (`src/engine/nodes/motion-render.ts`), the templates are ours and live in `src/engine/motion/` (TypeScript that
writes each page, not files under `resources/motion/`; only the bundled Inter 600 and 700 are embedded, as base64 `@font-face`). Spec of a graphic:
`src/engine/formats/motion.ts` (zod; a template id, its props, the channel's `accent` and a `dark` / `light` look).

- **Templates (7).** `title` (words rising one after the other over a scrim, kicker, subtitle), `lower-third` (name, role), `figure` (a counter, written
  in French: `12 000`, `3,5`; a short unit stands next to the number, a long one under it; the panel keeps the room of the final number), `list`
  (2–6 items revealed at the times the plan gives, numbered, counting down for a top-N), `quote`, `map-pin` (stylised: a graticule and blobs of land
  seeded by the place's name, a pin that drops, a pulsing ring; no tiles, no data) and `conversation` (message bubbles one by one, with the typing dots
  of the speaker just before, the list scrolling up to keep the newest bubble in view; two to five speakers, the first writes on the right in colour,
  names above the bubbles of a group chat). Both frame shapes (`frameSizeOf`: 1920×1080, 1080×1920) have their own measures.
- **A frame is a function of the time.** Every page carries one small script (`runtime.ts`) behind `window.atelierRenderAt(t)`: no CSS animation clock,
  no timer, no network (a CSS or Web animation, if a template ever had one, is paused and set to `t` too). Text fitting is by measurement
  (`data-fit`: one line on its width, several lines on its box, 2 px down to a floor). Text on its backing is kept at 4.5:1 or more (`readableOn`).
- **The browser is an injected service** (`BrowserService` in `services.ts`: `open({ html, width, height })` gives a page whose `frame(t)` is a transparent
  PNG). The plain-Node host (`host.ts`, used by the demos, the tests and the local worker) gives `chromiumService()` (`media/browser.ts`): Playwright's
  driver, loaded when the first page opens, on a Chromium that is already on the machine (`ATELIER_CHROMIUM`, Playwright's cache, then Chrome, Chromium or
  Edge of the system, per OS; nothing is downloaded); one browser for all the pages, started again after a crash. Without one the node fails with a
  French `missing_tool` message. Tests give a fake service or the real one (skipped with a reason when there is none).
- **Output.** One file per graphic: ProRes 4444 in a `.mov` (alpha), 30 fps, the frame's size, exactly as many frames as its shot (frame i at i/30 s),
  piped from the browser to ffmpeg. About 40 ms a frame (a 4 s title: 5 s). `graphics` is `media.graphic[]` whose value lists `{ shotId, file, startFrame,
  endFrame, template }` and whose meta says the size. Cache per graphic: hash of the spec, the size, the length and the template version (`MOTION_VERSION`).
  A page that fails is retried twice with a fresh page; a missing browser or a spec the template cannot draw is permanent (the message names the shot,
  the template and the field).
- **The director chooses** (`director.plan`, param `motion`; absent = none, the plan is the plan it always was). The cues are found in the timed
  narration without a model (`text/motion-cues.ts`; every string is copied from the script, every time is a word time): a figure said aloud (a number of
  100 or more, a decimal, or any number with a unit; not a year or a day of the month) → `figure`; a person named after a title (« le professeur Élise
  Moreau ») or named by the scene pass with a role → `lower-third`; a list announced with a colon or numbered by three sentences → `list`; a quotation
  between « » → `quote` (with its speaker when a name is next to it); a place after `à / en / dans / in…` → `map-pin`; the film's title → `title`;
  the turns of a several-voices script (§19.5; the script is wired to `director.plan`, word *i* is token *i*) → `conversation`, one bubble per sentence
  timed by its first word. The pass keeps the best within `share` of the film (default 0.2) and `perMinute` (default 3): no two at once (0.8 s apart), none
  over a presenter in picture-in-picture, none over a label that says something else (a label that only repeats the graphic is dropped). A conversation is
  the story itself: always kept, not counted in the share. The result is `motion` shots on the overlay track (`kind: 'motion'`, a `graphic` spec),
  checked by `checkEditPlan`. (This is not `graphic.*`, which takes the place of the captions, §27.5: the captions stay on.)
- **The render** lays each file over the base track from its first frame to its last (`finalPass`: `overlay` with an `enable` window half a frame early on
  both sides), **under** the intro card, the pictures-in-picture and the burned captions and labels. The templates keep out of the caption band and the
  labels' corner (`zone()`: a film's graphics end at 76 % of its height, a short's at 65 %). A file with no usable record is left out with a warning; one made for
  another frame size is refused.
- **Drawings.** The editor's `motion` step is `motion.render` (`from-drawing.ts`): the drawn share is the director's `share`; the script is wired to the
  director. Proof: `npm run engine:motion-demo`.
- **Not yet.** `timeline`, `compare`, `bars`, `CTA` and kinetic-text templates; several variants per template (a template written by an agent: §25.2);
  a browser inside the installed app (the packaged app has no Playwright: it needs the system's Chrome or Edge through `ATELIER_CHROMIUM`, or an
  Electron offscreen window behind the same service); `gpu` placement.

### 25.2 Briques sur mesure (custom bricks): a template written by an agent for one channel

A channel's own animated overlay (a character card, a channel card, a subscribe reminder, a title style) written by the channel's Monteur
(docs/AGENT-RUNTIME.md §23), approved by Charlie, then placed and drawn in the channel's films like our templates. **It is data, never code of the
app**: nothing of it runs in the main process, the renderer or the engine's Node; it is only ever drawn by the headless browser, in a sandboxed page.

- **The brick** (`src/engine/formats/brick.ts`, zod): `id` (`[a-z0-9-]`, the template is `custom:<id>`), `name`, `description`, `version`, `html`
  (the markup; `{{field}}` is replaced by the field's value, escaped), `css`, `script` (optional: it sets `brick.render = function (t) {…}`), `fields`
  (1 to 12: `text` with its `max`, `number` with `min`/`max`, `color` `#RRGGBB`, `image` as a `data:image/png|jpeg|webp` URI only; each with a `default`
  or `optional`), `sample` (the previews' values, checked against the fields), `seconds` `{min, max}` and `use` (where films place it: `start`, `end` or
  `person`, its length, `bind` = the text fields that take a named person's name and role, `max` per film). A brick placed in films has a default for
  every field it does not bind. `valuesSchema(fields)` is the strict zod schema of its values; `resolveValues` fills the defaults and names the field
  that does not fit.
- **Static checks** (`staticProblems`, before any page opens): no `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<base>`, `<form>`,
  `<style>` in the markup, no `on…=` handler, no `javascript:`, no web address (`http(s):`, `//…`); CSS without `@import` and with `data:` URLs only;
  a script without `eval`, `Function`, `import()`, workers, `fetch` / XHR / WebSocket, timers or clocks (`setTimeout`, `requestAnimationFrame`, `Date`,
  `performance.now`), `Math.random` (use `brick.random()`, seeded) or storage; a `{{field}}` that is not a field.
- **The page** (`motion/brick-page.ts`): OUR document around the brick, with a CSP `default-src 'none'; script-src 'nonce-<random>'; style-src
  'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; …` (no `unsafe-eval`), the nonce on our four scripts only (the runtime
  clock of §25.1, the `brick` object, the brick's script in its own strict function, the wrapper), the bundled Inter, the theme's variables, the safe
  area as `--safe-left|top|right|bottom` and colour fields as `--f-<name>`. Values are escaped where they land (text in the markup, JSON with every `<`
  escaped in the script). **The runtime contract of our templates**: `window.atelierRenderAt(t)` draws frame `t` (our presets `data-anim`, `data-fit`,
  `data-count` work in a brick too, then `brick.render(t)`); the page sets `window.atelierReady = true` when it started, `window.atelierError` when the
  brick's script threw. `brick` gives `values`, `width`, `height`, `duration`, `safe`, `ease`, `at(t, start, dur)`, `random()`, `format()`.
- **The sandbox** (`BrowserService.open({ …, sandbox: { loadMs, frameMs } })`, `media/browser.ts`): its own browser context, offline, service
  workers blocked, EVERY request aborted and listed (`problems().blocked`; `data:` / `blob:` are not requests and the CSP refuses the rest first),
  console errors and uncaught errors kept, a budget to load and start (8 s) and per frame (2.5 s). The frame's clock is moved by a task of the page's
  own event loop (a message to itself), not inside the driver's evaluation, so the CSP's eval ban holds there too. A page that overruns is closed (its
  renderer with it) and the error is permanent. No Node in the page (it is a plain Chromium page). `inspect()` measures the laid-out text in the page
  (`media/browser-inspect.ts`).
- **The lint** (`motion/brick-lint.ts`, pure): from each still's drawn share (the PNG is decoded, `media/png.ts`) and its text boxes: `empty` (a still
  inside the brick's time is empty, or all are: « draws nothing »), `overflow` (text cut by its box, out of a box that frames it, or out of the frame),
  `safe-area` (text outside `zone()`: the caption band, the edges), `small-text` (under 2.2 % of the frame's short side), `contrast` (under 4.5:1 on its
  backing over mid-grey footage, or no backing and no shadow), `console`, `network`.
- **Preview** (`previewBrick`, `motion/brick-render.ts`): stills at 0 %, 50 %, 100 % (PNG, plus a JPEG over a neutral grey, 768 px), the text measured at
  each, a short MP4 clip over the grey (H.264, 960 px), the console and the blocked requests, the lint. A problem of the brick is reported, not thrown.
- **In films.** `editplan` `graphic` is one of our templates or `{ template: 'custom:<id>', props: <values>, accent, theme }` (`GraphicSpec`, parsed by
  the schema its template says). `director.plan` takes `bricks` (`BrickPlacement[]`: template, fields, limits, `use`; no markup) and places them BEFORE
  our templates (`nodes/director-bricks.ts`): `start` over the first seconds (the title card then has no room), `end` before the last words, `person` on
  each person the narration names with a role (§25.1's cues) with the name and role in the bound fields; values checked; none over a presenter in
  picture-in-picture, a label or another overlay; our templates then keep out of their way. `motion.render` takes `bricks` (the validated briques'
  content) and draws a `custom:<id>` shot with `drawBrick`: sandboxed page, ProRes 4444 with alpha like §25.1, every 15th frame and the middle one
  decoded to check something is drawn. **Cache key** = hash(brick content hash with its version, the values, accent, theme, size, length, encoder).
  **Permanent errors that name the brick** (« La brique « Fiche personnage » (custom:fiche-personnage v3) n’a pas pu être dessinée : … »): a brick the
  run was not given, values that do not fit, the static checks, a script that throws, a frame over its budget, nothing drawn. A crashed browser is
  retried like our templates.
- **Where the bricks come from** (the app, not the engine): `src/main/bricks/store.ts` keeps them per channel in the workspace data folder
  (`<data>/orchestra/bricks/channel-<id>/<brick>/v<n>/brick.json`, the previews beside) with an index in SQLite (app migration 024 `bricks`: state
  brouillon / à valider / validée, the validated version, used in films or not, the open inbox item, Charlie's note, the previews of the round). When a
  run starts for a channel (`production/runs/profile.ts`), the validated version of each brick the channel uses goes to `motion.render.bricks` and its
  placement to `director.plan.bricks` (only when the pipeline has a `motion.render` node). The pipeline's own params still win.
- **Proof**: `tests/unit/brick-schema.test.ts`, `brick-sandbox.test.ts` (a real Chromium: network blocked, no Node, no eval, an endless frame cut, the
  lint on the real layout), `brick-cache.test.ts`, `orchestra-bricks.test.ts`; `npm run engine:brick-demo` (a channel card: preview and its MP4 checked by
  ffprobe, the real node's ProRes file, the cache, the walls).
- **Not yet**: a brick for captions (a caption style is a brick drawn over the film for now, not a `captions.make` preset); several bricks at the same
  cue; a brick in the packaged app without a system Chrome / Edge (same as §25.1).

### 25.3 The channel's own promo (promo-motion, decision 0050)

A channel's motion-design card that sends viewers to its own site or offer (Charlie's reference: the « Cahier d'Gaston » card at 1:25 of
his own video, 9.72 s), rebuilt piece by piece and made an input of the channel.

- **The bricks** (runtime presets, any template can use them): `data-anim="blur"` (comes out of a soft blur while it fades in and
  rises), `blurleft` / `blurright` (the same, sliding from a side), `reveal` (a logo: from 82 % and blurred to its size), with
  `data-blur=<px>` and `data-ease=out|inOut|linear`; `data-zoom` (a slow push in on a picture, `data-z0` → `data-z1`); `data-move="x0,y0,x1,y1"`
  with `data-click` (a pointer that travels and dips when it clicks); `data-lines=<n>` with `data-fit` (fit a text to n lines,
  counted on its glyphs, for tall faces whose ink overflows their line box). Fonts: Oswald 600/700 and Source Serif 4 400 (OFL,
  `resources/fonts`, `promoFontCssOf`).
- **The card** (`formats/promo.ts` `PromoCard`, page `motion/promo.ts`, drawn by `motion/promo-render.ts` `drawPromo`): the background
  light (two radial gradients fitted on the reference), the offer's picture (a product cut out, or a screenshot in a browser window with
  a push in and a clicking pointer), an optional logo, the condensed headline, a serif line, a white QR card (`qrSvg`, crisp at any
  size) with its caption, the address in big letters and « ↓ lien en haut de la description ». Entrances at the reference's measured
  times (`PROMO_TIMELINE`), then it holds; 1920×1080 scaled to the frame (16:9 only; a short has no promo layout yet). Opaque H.264
  (`CARD_ENCODER`, `renderGraphic({ encoder })`), cached by the hash of its page (card, pictures, timings, fonts), size, length and `PROMO_VERSION`.
- **In the channel's asset** (`formats/sponsor.ts`): `type : promo` makes the sponsor asset the channel's promo (`kind: 'promo'`):
  the card's lines (`titre`, `sous-titre`, `site`, `image`, `visuel : produit | écran`, `logo`, `légende du qr`, `ligne du lien`,
  `couleur du site`, `fond`, `lumière`, `côté`, `durée du clip`), or `média : <clip>` (the owner's own clip, laid as production-9's);
  `mode : identique | adaptée | par vidéo` (`reuse`), `place : après l'accroche | fin | mention | aucune` (`place`), `moment : 1:25`
  (`atS`, default 85 s). A promo has no reminder and a mention of about 14 s. `promoUnknowns` lists what is not set.
- **In the script** (`script.sponsor`, `nodes/script-promo.ts`): after the hook → the paragraph break nearest to the moment (`effectiveRule`);
  end → before the closing paragraph; mention → the first paragraph that already names the site (as said aloud: folded, « exemple-compagnon-
  tout-en-un-mot.fr » holds « exemplecompagnon ») or the product, the text unchanged, its sentences the slot; none → nothing. The written
  mention is in the reference's shape (« Petite parenthèse… c'est sur <site>, le lien est en haut de la description »); adapt / per-video
  ask the model for the card's headline and line too (outline `sponsor[].promo`).
- **On screen** (`edit.sponsor`): the card of the video (`cardFor`: same → the channel's card, one clip for every video; adapt → the
  headline or line written for the video, else « Pour aller plus loin sur « <title> » »; per video → the title as headline, the side
  varied by a hash of the title) drawn once into the workspace cache `promo`, laid over the slot from its first word, cut in, its last
  frame held (`role: 'promo'`). No browser → production-9's card and QR code, with a warning.
- **The agent asks** (`openQuestions`, `FitContext.channelPromo`): « Ta promo, on la place où ? » and « Ta promo, d'une vidéo à l'autre ? »
  when the channel's promo does not say; the answer is written into the asset (`ChannelSponsors.answerPromo`, `withSetting`).
- **Proof**: `tests/unit/promo-motion.test.ts`; `npm run engine:promo-demo` (the rebuild against the reference frame by frame, and the promo in a 2-minute avatar@1 film at about 1:25).


### 25.4 The motion kit (motion-montage, decision 0073)

More templates, a moving map, sub-frame motion blur and a fast draw, all reusable by every style (a style picks them; none is a rule).

- **Kinetic type** (`kinetic`, an overlay, `motion/kinetic.ts`): the spoken words set on screen, each on its own time (`words[]`:
  text, `atS`, `emphasis`), grouped into lines (≤ 18 characters in a film, 12 in a short) and screens of ≤ 3 lines (a new screen after
  a sentence's end, a pause over 1.4 s or 3 lines); styles `pop`, `slam` (lands from 1.6× with a damped shake), `stack` (lines push
  each other up), `typewriter`, `highlight` (an accent box behind each word); `position`, `background` none / scrim / solid, `case`.
  Stressed words in the accent colour at 1.25×. Set in Oswald (with Inter behind it).
- **Document** (`document`, a card, `motion/doc-highlight.ts`): a typed letter, a newspaper column, a typed report or a parchment
  (`paper`, `heading`, `date`, `text` ≤ 700 characters, `source`), or a scanned picture (no `text`: the shot's picture, marks as
  `rect`s); `marks[]` (≤ 6: a `phrase` of the text or a `rect`, `atS`, `style` highlight / underline / circle / box / strike) drawn on
  their words; `camera` follow (the page zoomed 1.35×, flying to each mark 0.3 s before it), push or still.
- **Chart** (`chart`, a card, `motion/doc-chart.ts`): `line` / `area` (points drawn left to right from `atS` over `drawS`, a tag
  riding the head and counting, the last value big at the end, `accentFrom`), `donut` (slices sweeping on their words, their shares
  counting), `counters` (1–4 big numbers counting up on their words). Same look family as `bars`.
- **Look** (`motion/look.ts`, `motion.render` param `look`): the video's look, set by its style: `'modern'` (the templates' own look;
  no look = the same pages and cache keys as before), `'period'` (iron-gall ink on ivory paper with fibres, stains and a vignette,
  Instrument Serif, a red-brown accent), `'newsprint'` (grey paper, black ink, a press red, Oswald, a fine grain), or
  `{ preset, palette?: { paper, ink, accent, muted }, type?: sans / condensed / serif, texture?: none / paper / grain }`. A paper look
  sets `kinetic` in its ink and face on a paper label with a double rule (`scrim`: the picture washed with the paper; `solid`: a sheet),
  stressed words in the accent (italic), calm entries (`slam` lands as an ink stamp, no shake; `highlight` draws a hatched rule); draws
  `chart` engraved (hatched area, open ink rings, an ink-framed tag, serif numbers, a plate mark for `period`); and sends `archive`,
  `map`, `bars`, `timeline`, `document` and the moving map to their parchment in the look's accent. It is in those graphics' cache
  keys. Other overlays, `prints` and `map3d` keep their own look. Stills: `scripts/motion-look-stills.ts`.
- **Runtime presets added** (`runtime.ts`): `slam`, `shift`, `data-around` (a hand-drawn mark around a measured phrase or box),
  `data-follow` (a camera that flies to `[data-focus-at]` children), `data-trace` (an element riding a polyline, counting its value).
- **Moving map** (`map` with `camera`, `motion/map-move.ts`): keys that frame a `view`, centre a `place` at a `zoom`, or `follow` a
  route while it draws: the camera rides the route's head along its curve (the head's place, computed with the page's curve and ease,
  sampled 10 times into keys marked `ease: 'linear'` that the camera glides through; it leaves the head a second before the next key),
  and a followed route is paced by its length on screen at that zoom (2.5–6 s unless `drawS`). The world (Earth, borders, regions,
  routes, names, pins) is drawn once by the page at up to 2× the frame at a fixed camera and photographed only when something in it
  changes; the title block is drawn apart with alpha; ffmpeg moves the camera (§28.1's pan through keys; a key's `ease: 'linear'`
  makes the move that ends at it even) and lays the title on top. A map without `camera` is drawn as before.
- **Map routes along the way** (`map` `routes[]`, `motion/geo.ts` `routeCurve`, `motion/map-card.ts`): `from`, `via` (0–8 waypoints,
  in order, framed with the places), `to`, optional `drawS` (1–12 s), `label`, `atS`. The points are smoothed into a centripetal
  Catmull-Rom curve (no `via`: a gentle arc bowing north). The path draws itself from its start (dark under-stroke and red line; the
  parchment's dashed ink) with a small head (a dot in a soft halo) riding exactly its drawn end: same points, same arc length
  (`data-cpath` is a polyline, the runtime's `tracePoint`), same `sine` ease. It draws for 1.6 s + its length / 380 px at 1080p
  (2.5–6 s) unless `drawS`; the halo fades as it arrives (the dot stays as the end) and the label shows then, at the middle of the way.
- **3D map** (`map3d`, a card, `formats/map3d.ts`, `motion/map3d*.ts`): a
  tilted Earth drawn by MapLibre GL JS (BSD-3, inlined in the page, its worker run as a classic worker) over NASA GIBS shaded-relief
  imagery and AWS Terrain Tiles (fetched once through the injected `fetch`, cached, lightened by `map3d-dem.ts`), Natural Earth
  borders, names in Barlow. Props: `kicker`, `title`, `look` satellite / parchment, `camera` (`keys[]` of centre, zoom 1–9, pitch
  0–70, bearing; or `follow` a route; `ease` push / inOut / linear; `drift`), `exaggeration`, `regions[]` (countries, tone red / gold /
  pale, `raise` km, `atS`), `pins[]`, `routes[]`, `names[]`, `facts[]`. Defaults copy the reference: pitch ≈ 50°, a push of
  cubic-bezier(0.30, 0, 0.30, 1) over 4–6 s then a slow drift, regions fading in over 1 s, labels that keep their size. The page
  waits on `window.atelierFrameReady()` (every tile of the camera path loaded before the first frame). Raised relief needs WebGL on a
  GPU; on software WebGL (a server) it is drawn flat unless `terrainOnSoftware`. 1080p: 70–150 s per minute on the GPU, 270–365 s in
  software. The director does not write it yet. `npm run engine:map3d-demo`.
- **Fast draw** (`motion/fast.ts`, `motion.render` param `fast`, default on): an opaque card is photographed as a JPEG (q 92) through
  the page's DevTools session (`BrowserPage.capture`), an overlay as a quickly encoded PNG with alpha; a frame whose page state did not
  change (a hash of every inline style and counted text) is not photographed again; the frames are split into runs drawn by up to 4
  pages at once and joined by a stream copy. Measured on the code PC (20 s each, under load): map card 320 s → 25 s, data card 122 s →
  21.5 s, archive card 525 s → 163 s; the same pictures (PSNR 44–48 dB against the classic path). `npm run engine:motion-bench`.
- **Motion blur** (`renderFast({ motionBlur })`): each frame is the mean of n pictures taken over its 1/30 s (n = 3 like a film
  camera's shutter), averaged by ffmpeg; a still part is not photographed again, so it costs only where things move.
- **GPU**: the browser's GPU rasterisation is opt-in (`ATELIER_BROWSER_GPU=1`, ≈ 25 % faster here; on Windows several pages at once
  sometimes fail to give a frame); everything runs on a CPU-only server.

---

### 25.5 The motion studio card `studio` (motion-studio, decision 0111)
A documentary card (opaque, the base shot) drawn by three.js (MIT, inlined) in our page: `formats/studio.ts` (look = the measured motion
style, camera keys, items: text, counter, bar, block, curve, object, dots, terrain, city), `motion/studio.ts` (page, `prepareStudio`:
the library and the glyph outlines, `motion/studio-font.ts`), `motion/studio-runtime.ts` + `studio-build.ts` (the page's script: closed-
form springs, a seeded random, a frame key from the spec alone). The director calls `studioSpec(beat, measured, d)`
(`motion/studio-style.ts`: split, equals, entity, hero, timelapse). Same capture and encoder as every card; CPU (SwiftShader) or GPU.
Proof: `scripts/motion-studio-demo.ts`.

## 26. Sound design and music — `sound.music` (+ `audio.sfx`)

**Inputs.** `audio.voice`, `json.words`, `json.beats` (tags, chapters, pauses), `json.editplan` (cuts, transitions,
graphic entries), channel style (music mood, register, levels), the music library (`resources/music/`, CC0
as the plan requires; any other licence only after it is recorded as allowing resale in `docs/LICENSES-PROVIDERS.md`) and effects library (ours, synthesised or CC0).

**Outputs.** `audio.music` (the full mixed music + effects bed, without voice, D long) + `audio.sfx` (effects stem,
optional) + `json.soundplan` (proposal).

**Behaviour.**
1. **Register** (style param): `sparse` (essay-like, quiet bed, few effects), `driven` (documentary-trailer, stronger
   bed, accents on turns), `dense` (wall-to-wall score). Table of targets:

| Register | Bed level vs voice | New music cue every | Effects per minute (body) |
|---|---|---|---|
| `sparse` | about −14 to −16 dB | ~45–90 s | ≤ 2 |
| `driven` | about −9 to −12 dB | ~25–70 s | ≤ 4 |
| `dense` | about −5 to −8 dB | ~12–45 s | ≤ 10 |

2. **Music cue sheet.** Sections follow chapters and mood changes (`pivot`, `disclosure`, `chapter` tags). Each section
   gets a track from the matching mood shelf (tension, reflective, hopeful, driving, sombre…), never the same track
   twice in a row, sections 25 s–5 min (split long ones at sentence starts). A cue starts or changes **only in a voice
   pause or on an accent**, with a 1–2 s crossfade or a cut on a hit; a slow blend while a sentence is being spoken is not allowed.
3. **Levels.** Each track is first normalised (~−20 LUFS), then set relative to the voice's active level (measured on
   speech-only blocks). **Ducking**: when the voice is active, the bed sits at the register level; in voice gaps ≥ ~1.5 s
   it lifts by ~4–8 dB with a ~0.3 s attack and returns before the next word (look-ahead from `json.words`, so the dip
   is never late). Fade in ~2 s at the start, fade out ~4 s at the end.
4. **Designed silences.** Brief music drop-outs (0.3–1.5 s) right before a `disclosure`, and at most one longer music
   hole (5–20 s, voice dry) on a factual passage per ~10 minutes; silences only where the voice already pauses; never in
   the first 30 s.
5. **Effects.** Only on events, never on plain cuts: graphic entries (soft whoosh / paper / tick by template), map
   flights, chapter cards, `pivot`/`disclosure` accents (low hit, riser ending on the cut), the first frame (one low
   hit). Density caps per register (table) and ~12 events max in the hook. Each effect is aligned on its key moment
   (peak or attack) at the target time; effects of one kind closer than ~80 ms merge. Effects sit around −18 to −20 dB
   relative to the voice, with per-event offsets.
6. **Output**: `audio.music` is music + effects only (no voice), with a soft limiter; a voice + bed preview mix is kept in the node's
   debug files only. The final mix and master happen in `render.assemble` (§28.5).

**Parameters.** `register` (style), `mood` (style), `bedDb` (register), `lift` (6 dB), `effects` (true), `holes`
(true in `sparse`).

**Duration and cost.** Seconds to ~1 minute (decoding and mixing). 0 credits with our library.

**Failure handling.** No track for a mood → nearest mood → neutral bed → no music (logged, QC notes it). Effects library
missing → no effects. Never fails the video for sound; a failed node gives voice-only with a warning (the node's
outputs are still produced as silence so types hold).

**Cache.** Standard; the cue sheet is deterministic given inputs + seed (track choice uses the seed).

**Fake.** Real (local library).

**Budget modes.** Identical.

---

## 27. Captions — `captions.make`

**Inputs.** `json.words`, `text.script` (display spelling), `json.editplan` (graphic windows where captions mute,
label track), style captions preset (position, words per line, highlight, font, colours).

**Outputs.** `subs.track`: a styled subtitle file (ASS-compatible, our own generator) for burn-in + a plain SRT/VTT for
the package (uploaded separately as closed captions is better for reach than burning; the style decides whether to burn).

**Behaviour.**
1. **Display text** is the script's spelling (names, numbers as written), timed by `json.words`.
2. **Line building**: ≤ ~42 characters per line, 1 line (or 2 for "classic"); break at sentence end, then clause marks,
   then balance widths; never end a line on a function word or split a number from its unit; a lone last word joins the
   previous line.
3. **Timing**: a line appears ~50 ms before its first word and leaves at the next line's start (min ~0.3 s; no gap
   flicker under ~0.25 s). Over a pause ≥ 1.5 s the line leaves.
4. **Presets** (style): `classic` (bottom, outline + shadow, no highlight), `highlight` (current word swept to the
   accent colour ~40 ms early), `word-by-word` (words accumulate on their onsets, 1–6 words per line), `pill` (dark
   rounded box, past words white, current accent, future dim), `bold-center` (2–4 words, caps, centred, pop-in). Font
   sizes are expressed at 1080p (~60–80 px), outline ≥ ~3 px, safe margins ≥ 90 px.
5. **Muting**: captions are removed where a full-screen graphic carries text; a cue that only grazes a graphic window
   (≤ 0.5 s) is trimmed instead.
6. **Labels** (names, places, dates, figures from the editplan) are rendered in the same file on their own layer
   (corner position, size, small box), so they cost no extra render pass. Labels are always burned; when `burn` is
   false the burned file holds only the label layer and the captions go to the SRT/VTT for the package.

**Parameters.** `preset`, `maxChars` (42), `lines` (1), `position` (bottom), `burn` (style), `leadMs` (50).

**Duration and cost.** Milliseconds; 0 credits.

**Failure handling.** Missing font → bundled fallback font, logged; weak alignment → letter-proportional timing within
cues, logged. **Cache.** Standard. **Fake.** Real.

---

## 28. Render and assembly — `render.assemble`

**Inputs.** `json.editplan`, `media.clip[]`, `media.image[]`, `media.graphic[]`, `audio.voice`, `audio.music`,
`subs.track`, style grade.

**Outputs.** `video.final`: MP4, H.264 High, 1920×1080, 30 fps (constant), yuv420p, BT.709 tagged, AAC 48 kHz ≥ 192
kb/s, fast-start (index at the front), exactly `F` frames (±1 frame) and audio of the same length.

### 28.1 Segments

The base track is rendered **segment by segment** (one segment per shot, or per group of shots ≤ ~10 s), each to an
intermediate of identical format (same size, fps, pixel format, colour tags, timebase) so the join is a stream copy.
- **Still**: scale to fill (high-quality filter), crop, apply the planned camera move as a smooth sub-pixel transform
  (no integer crop-window jitter), eased.
- **Video clip**: scale to fill, crop, conform to 30 fps; if the shot is up to ~1.3× longer than the clip, slow it
  (frame blending); longer → hold the last frame with a slow push. **Never loop** a real clip.
- **Graphic**: placed as rendered (alpha templates over a blurred, darkened copy of the base shot, §25); if the slot is
  longer, hold the last *meaningful* frame (not a faded one).
- **Avatar**: full frame, `split` (production-9: the presenter cover-cropped to one half, the picture beside it on the other,
  one segment), or `pip` over the base shot with a soft shadow.
- **Grade**: one per-channel tonal adjustment (style `visuals.grade`, pinned with the style) applied to stock and
  generated footage; user footage graded only if the
  style says so.
- **Transitions** that straddle a cut are rendered into the two neighbouring segments' head and tail (so the join stays a
  copy).
- **Camera, punch-ins, parallax, more transitions** (motion-montage, `render/camera.ts`, `render/transitions.ts`): a still's move may be
  a `pan` through camera keys (`keys`: centre 0..1 and zoom at a time; zoom interpolated in log space, eased key to key; a picture
  prepared at twice the frame when the camera goes past 1.5×), `punches` (a 3-frame jump in on a beat, held or released), or a
  `parallax` (the far layer slow and slightly soft, the near layer cut by a soft ellipse on `focus` or by a cut-out `mask`, `depth`
  times faster). A shot may come in with `flash` (through white), `whip` (a slide with a directional motion blur, ≈ 0.2 s), `push`
  (≈ 0.33 s), `zoom` (through the old picture) or `match` (a short dissolve whose new push starts at the zoom the old one reached),
  all drawn from the previous picture (a clip's or a card's last frame) like the dissolve. The classic moves keep their exact
  arguments (old segments stay cached). A graph longer than 6 000 characters goes to ffmpeg as `-filter_complex_script`.
- Workers: parallel per machine (≈ CPU cores ÷ 2), longest segments first; ffmpeg threads per process capped (~2).

### 28.2 Join and overlay pass

1. Probe every segment (duration, format); re-encode any that deviates (pixel format, range, size) before joining.
2. Join by stream copy; verify the joined duration equals the sum (±1 frame) — a short join is retried, then re-encoded.
3. One final pass: overlay track (alpha graphics, labels), burned labels (always) and captions (if `burn`, §27), optional film texture or
   vignette from the style, audio mux. Encode: x264 `veryfast`–`medium` CRF ~20–21 (`usage_max`/local) or `slow` CRF
   ~18 (`qualite_max`, flat-colour artwork benefits most). Intermediates at CRF ~16 or lossless for graphics-heavy styles.
4. Write to a temp file, verify (§28.4), then rename atomically.

### 28.3 Chunked final pass (speed)

The final overlay pass is mostly single-threaded (subtitle and blend filters). For videos ≥ ~2 min, the picture MAY be
encoded in 2–4 chunks in parallel, cut at segment boundaries, with closed GOPs and the film's own timestamps, joined by
copy and muxed with the audio once. This is enabled only after a per-machine **self-test**: a tiny synthetic film is
encoded both ways with lossless settings and compared frame by frame (decoded frame hashes); the verdict is cached per
ffmpeg build. Any mismatch or join failure falls back to the single pass. Same mechanism splits the work across RunPod
workers in `qualite_max` (§4 of the plan).

### 28.4 Verification (cheap, always)

- Header: frame count = `F` (±1 frame), audio duration = video duration (±1 frame).
- Tail decode of the last ~2 minutes: a still picture lasting until the last frame that the plan did not ask for means
  an input was cut short while reading → re-run the pass.
- No read error in ffmpeg's error stream (timeouts, I/O errors, missing index).

### 28.5 Audio master

Sum voice + `audio.music`; measure integrated loudness once; apply one linear gain to reach **−14 LUFS integrated**,
true peak ≤ **−1.0 dBTP** (a transparent limiter engages only if the gain would exceed the ceiling); no two-pass
dynamic normalisation (it pumps).

**Parameters.** `crf` (mode), `preset` (mode), `chunks` (auto), `workers` (auto), `burnCaptions` (style), `texture`
(style).

**Duration and cost.** Local, 10-minute video: segments ~2–6 min, final pass ~1–3 min (chunked) to ~3–8 min
(single). RunPod: similar or slower for one video, but parallel across videos and frees the user's machine; cost of a
CPU/GPU pod on the order of 10–20 US cents per hour → a few cents per video plus storage transfer. `usage_max` = local
= 0 credits.

**Failure handling.** A segment fails → retry 3× with backoff, deleting partial output; then render that slot as a
hold of the neighbour shot (never a black slot), flagged for QC. A final pass that fails verification twice → permanent
error with « Le rendu a échoué à la vérification » and the log attached for the production operator.

**Cache.** Per segment: hash(shot spec, input fingerprints, encoder settings) — R7.6. Changing one shot re-renders its
segment(s) and the final pass only. Intermediates are kept until the package is approved (the editor needs them), then
garbage-collected by the artefact store's retention policy.

**Fake.** Real (ffmpeg on fake media).

**Budget modes.** `qualite_max`: `slow` CRF 18, `gpu`/RunPod placement when the estimate is faster. `usage_max`:
local, `veryfast` CRF 21.

---

## 29. Thumbnails — `thumbnail.make`

**Inputs.** Title (working title from the outline), the outline's promise, hook and chapter titles (the "summary"), channel style thumbnail block (layout,
text rules, colours, fonts, with/without face, element pools), optional reference thumbnail (user upload), count N
(1–4, default 3), language.

**Outputs.** `image.thumbnail[]`: N PNGs 1280×720 (and a JPEG ≤ 2 MB copy each), with the concept in `meta`.

**Behaviour.**
1. **Concepts (Claude).** N distinct concepts, each: a headline of 2–4 short words in the video's language, in caps,
   that sells the **promise or threat** (it does not restate or summarise the title); an art prompt for one
   subject readable at ~320 px wide, staged for this video (not generic to the channel), leaving a quiet third for the
   text, explicit light/palette/mood, no text in the art; the headline position (top / middle / bottom).
2. **Variety**: if the style lists element pools (props, settings, expressions), each concept draws its own elements
   (seeded), so the look stays the channel's while scenes vary.
3. **Reference**: a reference thumbnail is described by Claude (vision) as 6–9 layout facts (composition, text place,
   word count, palette, contrast, arrows/circles, emotion) with no person, brand or words; concepts copy layout and
   energy, never people, logos or text. The image MAY ride along as a layout reference when the provider supports it.
4. **Art** via `image.generate` (16:9, then 1280×720).
5. **Text layout (local, deterministic)**: the style's layout (e.g. centred block with a soft scrim, or a solid top
   band); the largest font size that fits the box measured with the real font; heavy outline or band for contrast;
   max 2 lines.
6. **Checks** (deterministic, plus vision in `qualite_max`): headline language and word count; every name or
   number in the headline appears in the script; headline ≠ title; text contrast ≥ 4.5:1 against the area
   behind it; legibility at 320×180 (downscale and check text height ≥ ~18 px); optional vision check for artefacts.
   A failing concept is regenerated once (not duplicated to fill the count).

**Parameters.** `count` (3), `layout` (style), `font` (style, OFL), `withFace` (style), `reference` (optional).

**Duration and cost.** Concepts: < 1 min; images: N × image price (§23) and ~1–2 min; layout: seconds. A set of 3 ≈ a
few US cents to ~20 cents depending on model.

**Failure handling.** A failed concept is skipped; fewer than 1 thumbnail → node error (thumbnails do not block the
video render: the branch is independent, R6.4). **Cache.** Per concept (concept text, model, seed, reference
fingerprint). **Fake.** Drawn background with the headline laid out for real. **Budget modes.** `usage_max`: count 2,
cheapest model; `qualite_max`: count 3–4, best model, vision check.

**Shipped (v0).** `thumbnail.make@1` (`src/engine/nodes/thumbnail-make.ts`, headline layout in `media/headline.ts`): concepts by Claude
(role `thumbnail`), one `generateImage` at 1280×720 per concept, the headline laid out by us (scrim or band, Inter Bold, outline,
at most two lines; the font size is fitted with a conservative capital width, not measured with the real font), per-concept
cache, owner gate; the first output is the pick (`replaceOutput` reorders), `package.youtube` writes it as `thumbnail.png`
(others `thumbnail-N.png`, a `thumbnail.jpg` when the PNG exceeds 1.9 MB). Not yet: the reference thumbnail, element pools, the
contrast / 320 px legibility checks and the vision check. No `claudeRole` on purpose: a Claude node is quoted as free, and this
one pays for pictures.

---

## 30. Metadata and package — `package.youtube`

**Inputs.** `video.final`, `text.script`, `json.outline` (chapters), `json.words`, `text.brief` (sources),
`image.thumbnail[]`, `json.qc`, `json.editplan`, channel style (title rules, description template). Credits come from
the licence and credit fields of the media artefacts' `meta`, reached through the shots' `source` in the editplan.

**Outputs.** `json.metadata` and `package.youtube` (a folder: the video, thumbnails, `description.txt`, captions file,
`metadata.json`, and a checklist). **Never uploads** (R4.2).

**Behaviour.**
1. **Titles**: the working title plus 2–3 alternatives for A/B (different hook: a number, a question, the stakes, the
   most surprising fact), each ≤ 100 characters (best 40–70), truthful to the video, deduplicated against each other and
   against the channel's last titles; characters YouTube refuses (angle brackets) replaced.
2. **Description**: 4–6 plain sentences in the channel's voice opening on the tension the video resolves and saying
   what the viewer takes away; never promising what the video does not deliver; then sections from the style template
   (chapters, sources, credits, links). Total ≤ 5,000 characters.
3. **Chapters**: from the outline's chapters — each chapter's first sentence is located in `json.words` (exact, since
   the script is ours) → timestamp. YouTube rules: first at 0:00, ≥ 3 chapters, each ≥ 10 s apart, titles ≤ ~60
   characters, in the video's language. If fewer than 3 valid chapters, omit chapters (no generic "Part N").
4. **Tags**: 10–18 lowercase tags, deduplicated, total ≤ 500 characters.
5. **Sources**: from the brief's sources; each URL checked live (HEAD then GET, short timeout); a dead link keeps its
   label as text. Never invent a citation.
6. **Credits**: licences that require attribution (CC BY…) for media actually present in the final editplan (filtered
   against the plan, so a replaced clip is not credited).
7. **Checklist**: QC result, AI-content disclosure reminder (the uploader must tick YouTube's altered/synthetic content
   setting when relevant), language, audience flag reminder.

**Gate.** `owner` always (R11.4).

**Duration and cost.** 1–2 Claude calls, < 2 min; 0 credits.

**Failure handling.** Invalid JSON from Claude → one repair attempt, then retry; never ship an empty description
silently (permanent error if both fail). **Cache.** Standard. **Fake.** Real, with template text.

---

## 31. Quality control — `qc.check`

**First version (built; lot « faceless formats »).** The deterministic technical part only, no model call: inputs `video`
(and `plan`, opt, for the length), output `json.qc` as below with empty `frames` and `patches`. Checks: `black` (≥ 0.5 s fails),
`silence` (≥ 2 s below −50 dB fails), `freeze` (≥ 1.5 s warns, ≥ 4 s fails), `loudness` (−14 LUFS ± 1 fails; a peak over −0.7 dBTP warns),
`duration` (the plan's frames ± 1, and/or `expectedS` ± a share, `minS`, `maxS` — a short is `maxS: 60`), `format` (1920×1080, one
audio stream). Thresholds are params. A failing check never fails the node: `pass: false`, and the result is flagged
`meta.needsReview`, which parks the node at a review gate whatever the gate mode (scheduler: a node may flag its own result).
Caption sync, flashes, repetition, language, cadence and the visual review arrive with their inputs.

**Inputs.** `video.final`, `json.editplan`, `json.words`, `text.script`, `subs.track`, `json.textcheck`.

**Outputs.** `json.qc`: `{ pass, score, checks: [{ id, status: ok|warn|fail, detail, at?: seconds, shotId? }],
frames: [...], patches: [...] }`. A patch is one edit-plan operation `{ op, shotId, ... }` with `op` among
`replace_source` (`{ kind, query?|prompt?|footageRef? }`), `next_candidate` (stock: the next ranked candidate, which
`visuals.fulfil` keeps in each stock item's `meta.candidates`), `set_text` (`{ field, value }`, re-checked by §21.9),
`rerender` (no plan change; new segment seed) and `drop` (the neighbour shot takes the time, R37.2). `pass` = no `fail`; `score` = 100 − 10 per `fail` − 3 per `warn`, floored at 0.
Originality findings are copied from `json.factcheck` when wired.

**Behaviour — technical (deterministic, always).**
- Length = `F` frames ± 1; resolution, fps, codec, pixel format, colour tags as specified.
- **Black**: frames with mean luma < ~6 % and low variance for ≥ 0.5 s outside planned dips → `fail`.
- **Freeze**: no change for ≥ ~1.5 s outside planned holds and graphics holds (from the editplan) → `warn`; ≥ 4 s →
  `fail`.
- **Silence**: voice track below −50 dBFS for ≥ 2 s outside planned silences → `fail`; whole-mix silence ≥ 1 s outside
  planned holes → `warn`.
- **Loudness**: integrated −14 LUFS ± 1, true peak ≤ −1 dBTP.
- **Flash/glitch**: single frames differing strongly from both neighbours while those are similar → `warn`.
- **Caption sync**: sample 10 cues; caption start vs word start within ±0.15 s.
- **Repetition**: same source clip shown twice (from the plan) → `warn` per repeat.
- **Language consistency**: on-screen strings in the plan are in the video's language.
- **Cadence**: designed scenes per minute and max static span vs the style targets.

**Behaviour — visual review (Claude, vision).** Contact sheets: one frame per shot (and every label while fully on
screen), ~10–12 frames per sheet, ~2–3 sheets per call. Claude flags concrete defects with the frame id: wrong picture
under a named person, place or thing, a logo or text baked into the picture, clipped or unreadable text, blank/garbled frames, obvious AI artefacts,
era/place contradictions. Each flag maps back to a shot id.

**Repair proposals (proposal, bounded).** QC never edits upstream artefacts itself. For flags with a cheap fix (next
stock candidate, re-render a glitched segment, corrected graphic text, drop a sliver) it writes `patches` against the
edit plan. Applying them is exactly an « Modifier moi-même » on `director.plan` (R11.3): a new plan artefact, and only the
affected items and segments recompute through fingerprints. The pipeline MAY allow one automatic application (two in
`qualite_max`) before the package gate; otherwise the patches are offered on the package card.

**Duration and cost.** Technical: ~0.2–0.5× real time (one decode at low resolution). Visual: a 10-minute video ~60–120
shots → ~5–10 sheets → 2–4 calls → 1–3 min. 0 credits.

**Failure handling.** QC never deletes the video; `pass: false` makes the package gate show the failures first.

**Cache.** Standard. **Fake.** Real technical checks; visual review returns a fixed set of flags.

---

## 32. Claude calls inside nodes (shared behaviour)

R32.1 All Claude work goes through `services.claude` (§15.7), which the app implements with the v1 runner
(`agents/call.ts`), with the node's role, on the user's Claude Code (R1.4). Structured outputs are requested as JSON validated by the node's zod schema.
R32.2 **JSON handling**: extract the first complete JSON value; if a list is truncated, keep complete items and re-ask
only for the missing ids; a parse failure gets **one** repair request that quotes the validation error — never the same
prompt twice in a row.
R32.3 **Retries**: transient CLI errors 3 attempts with jittered backoff; a call timeout (default 15 min, param) is
transient once.
R32.4 **Plan limits**: when Claude Code reports a usage limit, the node enters `waiting_limit` (a sub-state of
`running`, shown « en attente de ta limite Claude, reprise vers 14:05 »), polls at the stated reset time, and NEVER
falls back to the paid API unless the user enabled the platform API fallback (R1.4). If the reset is beyond a max wait
(param, 5 h), the node fails with an explanation.
R32.5 **Language**: the output language is stated first in every prompt; outputs carrying user-facing text are checked
by a language detector.
R32.6 **Model tier per role** (`routes` table): Scriptwriter, Director, Fact-checker → balanced or best tier; metadata,
tagging, vision checks → fast tier. A fast-tier answer obtained only because the main tier was rate-limited is not
cached.
R32.7 **Answer cache**: judgement and extraction calls (vision verdicts, stock picks, text checks, director stretches) are
cached by hash(role, model resolved version, system text, prompt, image hashes, schema, node version, node seed); writing calls
are cached only through the node fingerprint (§7). Max size and age are configurable (default 300 MB, 30 days, LRU).
R32.8 **Concurrency**: the scheduler's Claude limit (R6.2) counts calls, not nodes, when a node fans out internally
(fact-check parts, director stretches).

---

## 33. Caching and invalidation (stage view)

Part I §7 is the rule. Part II adds per-stage granularity:

| Stage | Inner cache unit | Invalidated by |
|---|---|---|
| research | whole node | topic, links, avoid-list, seed |
| script | outline + per part | brief, `T`, style card version, pasted text, seed |
| fact check | per part (~550 words) | the part's text, language, node version, seed |
| voice | per chunk (text + context) | voice, model, settings, chunk text, neighbours' context, seed |
| beats | whole node | words, outline |
| director | per stretch draft (Claude) + deterministic passes | stretch beats' text, style, mode, price grid, footage, seed (drafts); any timing (deterministic passes) |
| stock / images / video / avatar | per genlist item | item spec, model, refs, registry snapshot (stock), seed |
| graphics | per graphic | template version, fields, duration, skin |
| sound | whole node | voice, words, beats, plan, style sound block, seed |
| captions | whole node | words, script, plan windows, preset |
| render | per segment + final pass | segment spec and inputs; final pass = any segment, overlays, captions, audio |
| thumbnail | per concept | concept, model, reference, seed |

R33.1 There is no "reuse if the file exists" anywhere; a stale artefact can only be reused through a matching
fingerprint. A language change, a title change, a length change each change fingerprints naturally.
R33.2 The user's "regenerate" on any node = new seed for that node (R7.5); "regenerate everything" = new run seed.
Every inner cache key includes the node seed, so a regenerate never returns a cached inner answer.

---

## 34. Progress (stage view)

R34.1 Each node reports `progress` with a count phrase from `fr.ts`: research « 5 sources lues sur 8 »; script
« partie 3 sur 9 »; fact check « 4 parties vérifiées sur 9 »; voice « 12 blocs sur 20 »; director « 3 passages sur 5 »;
visuals « 31 plans trouvés sur 64 », « 9 images sur 22 »; graphics « 6 animations sur 14 »; render « segment 47 sur
118 », « assemblage final 62 % »; QC « 4 planches relues sur 8 ».
R34.2 Default duration weights before any history (fraction of total, 10-minute `qualite_max` video): research 4 %,
script 15 %, check 6 %, voice 6 %, beats ~0, director 5 %, visuals 30 %, graphics 8 %, sound 2 %, captions ~0, render
20 %, QC 3 %, package 1 %. Parallel branches count by their critical path. Then R8.4 replaces these with measured
averages.
R34.3 The ETA is shown as a range (typical, ±) once at least 3 past runs of the node type exist on this machine.

---

## 35. Cost estimation and settlement (stage view)

R35.1 Each paid node's `estimate()` uses provider units from its inputs' metadata, available before running:
voice = characters of the script; images = genlist count; video = genlist seconds; avatar = seconds; stock = 0 (or API
units); render on RunPod = estimated pod-seconds from past runs. Claude nodes estimate tokens for information only.
R35.2 Before the director exists, the quote uses **per-minute defaults per budget mode** from the style (e.g. images per
minute × image price), clearly marked « estimation avant réalisation »; after the director, the quote is exact item by
item and the edit-plan gate shows it.
R35.3 Optional enrichments (vision checks, a second director draft, extra candidates) are skipped when the remaining
budget minus a reserve for mandatory later nodes would not cover them; each skip is listed in the run report. Mandatory
nodes are never skipped for budget; if they cannot be afforded, the run pauses with « crédits insuffisants » before
spending.

---

## 36. Failures, retries, cancellation (stage view)

R36.1 Every stage degrades **per item**, not per node, where a substitute exists (stock → image → hold; music mood →
neutral; graphic → label), and lists each degradation in the node's diagnostics and on the next gate card. A degradation
is never silent.
R36.2 Nodes that MUST NOT degrade silently: voice (no provider swap mid-narration), script (no truncated script), fact
check (unchecked parts make the gate mandatory), render (verification failure is an error).
R36.3 Cancellation reaches every child process (ffmpeg, Chromium, recogniser, `claude`) through the node's `AbortSignal`
and the platform kill-tree; Cloud items are cancelled by their idempotency key. Finished items (chunks, images,
segments) stay cached, so a resumed run continues where it stopped.
R36.4 Resource guards: before writing large intermediates, check free disk (≥ ~8 GB or 3× the expected size); heavy
local processes (render, Chromium) are limited by free memory; on low memory, new heavy work waits instead of starting.

---

## 37. Human review points

R37.1 Default gates of the long-form template pipeline (the Builder may change them):

| Node | Gate | What the card shows | Typical decision |
|---|---|---|---|
| `research.topic` | none (a pipeline may set `review`) | angle, title, key facts with sources | change the angle |
| `script.write` | review | script, outline, length vs target, lint, chapters | edit text, request a change |
| `script.check` | review, with `gateHint` (R15.1) | diff of fixes, unapplied findings, overlaps | accept fixes |
| `voice.tts` | review | player, 3 sample passages, duration | change voice or speed |
| `director.plan` | review | timeline view, shot list with thumbnails of choices, **price** | swap shots, accept price |
| `visuals.fulfil` | review | grid of every visual by beat | replace any item |
| `thumbnail.make` | review | the N thumbnails at real and phone size | pick, regenerate |
| `package.youtube` | owner | player, QC, titles, description, chapters, thumbnails | approve |

R37.2 **Edit after render**: the edit plan stays editable after the render; a change (swap a shot, retime within the
voice clock, edit a label or caption, redraw a graphic) changes only the affected items and segments, and a re-render
reuses everything else (R7.6). The voice clock never moves: a shot only gives time to its neighbour.

---

## 38. Language

R38.1 One language per video, resolved at launch: explicit user choice → pasted script's detected language →
title's detected language → channel style language. Stored in the run; all user-facing text (script, voice, captions,
on-screen text, thumbnail headline, metadata) uses it.
R38.2 Number, date and unit formatting follow the language (thousands and decimal separators, date order) in graphics,
labels and captions.
R38.3 The voice MUST be a voice that supports the language; a mismatch blocks launch with a clear message.

---

## 39. What makes the output good (quality levers)

Ranked by expected impact on a long faceless video:

1. **The script's retention structure**: a real hook in 15 s, open loops every beat, concrete events every ~30 s,
   payoff kept for late, no background dump, short spoken sentences. Most of the perceived quality is here.
2. **Truth discipline**: no invented details, fact check with sources, on-screen text checked against the script —
   a single wrong name on screen costs more trust than any visual polish gains.
3. **Picture follows the words**: each shot chosen for the words spoken under it (anchor words, not fixed grids),
   cuts landing just before the word, named things shown only with material about them.
4. **Never repeat**: no clip twice, no same subject twice, variety of kinds and shot sizes; viewers notice repetition
   long before they notice resolution.
5. **Rhythm**: a change at least every ~3.5 s, faster hook, designed holds on emotional beats, gaps used as picture time.
6. **Graphics that add facts** (figures, dates, maps, quotes) rather than retyping narration; consistent skin per channel.
7. **Sound that breathes**: music under the voice at the right level, lifting in pauses, changing at story turns,
   effects only on events, a clean −14 LUFS master.
8. **Voice quality and pacing**: a good voice model, chunks small enough not to drift, correct number and acronym
   pronunciation, seams inaudible.
9. **Caption timing** on real word times and the script's spelling.
10. **Thumbnail and title** that sell the promise, readable at phone size.
11. **Technical robustness**: no black, frozen or truncated output; exact duration; correct colour tags.

---

## 40. What Atelier does better (mapped onto plan §1)

| Failure mode of video pipelines we design against | Atelier's answer | Where |
|---|---|---|
| Stages implicit in one large script; reuse decided by a file existing on disk | typed node graph with declared inputs/outputs, validated before spending | §1–§5, plan §1.1 |
| Invalidation by "redo all" or deleting files; a changed title or length can reuse a stale script | fingerprints: change one thing, exactly its dependents recompute | §7, §33 |
| Progress inferred from log text with fixed stage weights | typed events, measured weights, real ETA | §8, §34 |
| A running render that cannot be stopped; no retry action | cancel with process-tree kill and refunds; four actions on error | §10, §36 |
| No human approval between script, voice, visuals and render; visuals only seen after the render | gates on any node; edit plan **and its price**, then visuals, validated before render | §11, §37 |
| Silent fallbacks (another voice mid-way, black slots, empty description) | per-item degradation always listed; some nodes never degrade | §36 |
| Costs measured after the fact, part of the spend outside any meter | quote before launch, reserve → settle per node, per-video cap never exceeded | §9, §35 |
| One budget behaviour; optional work cut by fixed reserves | two budget modes + cap; the director trades items by value per credit | §12, §21.2 |
| Run settings held in global state, so one video per process | engine is pure, run context explicit; parallel runs and Cloud/RunPod workers share the same code | §1.2, plan §1.5 |
| Per-part checks miss contradictions across parts; long scripts escape the revision pass | consistency pass across parts; revision pass per part | §17.4, §18 |
| Thumbnails never checked; missing concepts filled by copies | headline, contrast and phone-size legibility checks; regenerate, never duplicate | §29 |
| Stock picked from text only | vision check of candidates | §22.1 |
| Text fitted by character-count rules, which break on long words and other scripts | text measured with the real font | §25 |
| Clips taken from other people's videos | none: stock, generation and the user's own footage | R4.1, §24 |
| Provider keys stored on each user's machine | no provider key on the user's machine; credits | R1.5 |

---

## 41. Left open in Part II (hypotheses to settle in the implementing lots)

- H6 The `wpm` table (R17.1) is a starting point; P4 measures `D/T` on our default voices and adjusts per voice.
- H7 Whether the director's scene pass needs the best tier or the balanced tier (P4 ships `director.plan` v0; compare
  both tiers on 3 scripts before P12).
- H8 The originality thresholds (§18 step 6: 8-grams, 2 %, 15 words) need calibration on real analysed transcripts.
  The plan places anti-plagiarism in both `script.check` (§4) and P12's `qc.check`; the check is the same function, run
  on the script before the voice and recorded again in `json.qc`.
- H9 The vision checks (§22.1, §23, §31) cost Claude time; their default (on in `qualite_max` only) may change after
  measuring wall-clock impact.
- H10 Chunked final pass (§28.3) gains depend on the machine; the self-test decides per machine, but whether to ship
  it with P4's renderer or with P14's RunPod workers is decided there.
- H11 The sound register table (§26) and effects densities are craft targets; P4 ships the music bed and ducking,
  registers and effects follow and are tuned by ear with Charlie.
- H13 A licensed editorial-photo source (real people, events) would let the director show named subjects without user
  footage; out of v2 until a provider with resale rights is found.
- H12 Provider prices quoted in Part II are orders of magnitude from late 2026 and are not a price grid; the Cloud's
  grid (plan §4.4) is authoritative.

---

# Part III — Technologies and recipes (production-2)

## 42. How to add a technology

A **technology** is a brick written in code (decision 0010): a manifest over one or more nodes of §2, for one stage of
a recipe (decision 0011: Idée → Script → Voix → Réalisateur → Éléments → Montage → Contrôle et paquet). The registry the
app, the agents and the panel read is generated from the manifests (`technologyRegistry()`, `src/engine/technologies/`).
No technology is data; none is imported at run time. Adding one is a coding session and a release.

**The three lines.** Write the manifest with `defineTechnology` in `src/engine/technologies/catalog-*.ts`, add it to
`TECHNOLOGIES` in `registry.ts`, and add its French label (`tech.<name>`, `tech.<name>.blurb`) and the label of each new
setting (`techSet.<key>`) in `src/shared/fr-p-recipes.ts` (English in `en-p-recipes.ts`).

```ts
export const voiceTts = defineTechnology({
  id: 'voice.tts@1', labelKey: 'tech.voice.tts', stage: 'voix', kind: 'voice',
  nodes: [{ id: 'voice', type: 'voice.tts@1', in: { script: '@script' } }],
  provides: { voice: 'voice.audio', words: 'voice.words' },
  params: z.object({ voice: z.string().optional(), speed: z.number().min(0.7).max(1.2).default(1) }),
  overridable: { recipe: ['voice', 'speed'], channel: ['voice', 'speed'] },
  nodeParams: (p) => ({ voice: { voice: p.voice ?? '$style.voice', language: '$style.language', speed: p.speed } }),
  cloudUsages: ['synthesize'], agentTools: [], access: 'everyone', status: 'validated'
})
```

R42.1 `id` is `name@version` (integer version, like R2.1). A new version is registered BESIDE the old one; a recipe
names the version it uses, and a project pins its recipe version, so it keeps running the old one until someone moves
it (decision 0010). Removing a registered version is a breaking change.
R42.2 The node(s) a technology runs MUST already be registered (§2); a new kind of work is a new node first (its own
spec section, fake, tests), then the technology that wraps it. Node ids become pipeline node ids: two technologies of
one recipe may not make the same node id.
R42.3 Wiring between bricks goes through named **slots** (`brief`, `script`, `outline`, `voice`, `words`, `beats`,
`plan`, `genlist`, `images`, `clips`, `avatar`, `motion`, `background`, `graphics`, `music`, `subs`, `video`, `qc`,
`thumbnails`, `package`). An input written `@slot` reads the latest brick BEFORE this one that provides the slot (a
translation replaces the script for every later brick); `@slot?` reads the latest one before, else the last one after,
else stays unwired. `$inputs.x` / `$style.x` and `<own node>.<output>` are allowed as in §5. `provides` maps each slot
the technology hands on to one of its own outputs.
R42.4 `params` is a `z.object` whose every field has a default or is optional (the registry refuses otherwise). Leave a
field optional (no default) when the channel's style profile or the channel style should decide when the recipe says
nothing: `nodeParams` then omits it, so the profile fills it (the run's rule: the pipeline's own params win,
`src/main/production/runs/profile.ts`). Settings are plain values, never references.
R42.5 `overridable.recipe` / `overridable.channel` list what a recipe and a channel may set; a project may adjust either.
Settings resolve technology defaults < recipe < channel < project; a layer setting anything else is refused
(`not_overridable`), and the result must pass the schema (`bad_settings`).
R42.6 `contributes` adds params (and inputs) to the node that provides a slot of an EARLIER brick (an avatar asks the
director for presenter shots). Use it rather than editing another technology.
R42.7 Shared, never avatar-only (0008): a technology MUST work in a recipe without an avatar.
R42.8 `cloudUsages` names Atelier Cloud usages (`src/shared/cloud-api.ts` `USAGES`), hence the price lines; providers
stay behind the Cloud (0003). `agentTools` names tools of `src/main/orchestra/technologies.ts`. `status: 'draft'` shows
in the panel and the editor as « Brouillon » until it runs end to end on fakes and is validated.
R42.9 Proof: `tests/unit/recipes.test.ts` checks every registered technology (labels, usages, tools, at least one per
stage, every production node covered) and that a recipe of them compiles to a valid `atelier.pipeline/1`; add a case
when the technology changes the wiring. `tests/unit/recipes-api.test.ts` runs a project to an MP4 on the fakes.
R42.10 Engines, styles, mix (decisions 0021, 0022, 0027). `engineFamily` (`presenter`, `image`, `clip`, `voice`, `llm`,
`music`) says a recipe may pick an engine of that family for the brick, with fallbacks of the same family (a voice or a
presenter falls back for the whole video); `styleFamily` (`image`, `clip`, `presenter`, `director`, `script`, `edit`)
says it may wear a style of that family. Leave both out for local code. `fromMix(mix, ctx)` returns the recipe-layer
settings the pipeline's mix implies (only settings the recipe may set; the brick's own settings win).

**Compiling** (`compileRecipe`, `src/engine/technologies/compile.ts`): a recipe (`atelier.recette/2`, also the
`.atelier-recette.json` file; `/1` documents load as `/2`) first gets its base pipeline's options applied as edit
operations (`options.ts`, `edit-ops.ts`, decision 0027), then becomes one `atelier.pipeline/1` with one fixed budget mode (`usage_max`, no `modes`: no
« qualité max / usage max » switch, 0011) and the recipe's cap as `budget.capCredits`. Checkpoints (the recipe's, else
the channel's, else topic + thumbnail) become `owner` gates on the node that provides the checkpoint's slot; every
other node is explicitly `none`. Codes: `schema`, `unknown_technology`, `stage_order`, `duplicate_technology`,
`duplicate_node`, `not_overridable`, `bad_settings`, `missing_slot`, `no_video`, `unknown_base`, `bad_option`,
`no_engine`, `engine_family`, `bad_fallbacks`, `unknown_engine`, `no_style`. Beside the pipeline it returns `pins`
(per brick: engine, fallbacks, fallback scope, style) and the document as compiled (options applied).
