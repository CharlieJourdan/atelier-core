# Atelier agent runtime (`src/main/orchestra`)

The agent runtime turns Atelier's agents from chat partners into a team of employees that take work, remember, report
and never silently stop. A hierarchy of agents (one principal agent, one lead per channel, specialists under each
lead, plus agents created on demand) works a durable task queue under a supervisor loop with a watchdog. Each agent
has long-term memory, a log of its turns and a working session; sessions are compacted and reset before the context
gets too big. Calls are routed to the cheapest tier that fits the task and spread over a pool of provider accounts
(several Claude Code subscriptions, OpenAI Codex logins, the Anthropic API key, the Atelier relay later), with
transparent failover when an account hits its usage limit.

Everything here is main-process code, unit-tested with the FakeProvider, an injectable clock and fake child
processes; `npm run orchestra:demo` runs the whole loop offline.

---

## 1. What is reused (and what is new)

| Existing piece | How the runtime uses it |
|---|---|
| `llm/claude-code.ts` (`claude -p --output-format stream-json`) | Runs every Claude Code turn. New: an optional `session` on the request (stable working folder per agent, `--resume <id>`, `--effort`); without it, the plain completion path is unchanged (`--no-session-persistence`). One provider per account, with `CLAUDE_CONFIG_DIR` in its environment. |
| `llm/types.ts`, `llm/fake.ts` (FakeProvider) | The provider interface and the test provider. |
| `llm/anthropic.ts` | The API account of the pool (key in the encrypted secrets, as today). |
| `llm/routes.ts` (`llm.tierModels`) | The model of each tier (best / balanced / fast) comes from the existing tier map. |
| `agents/call.ts` (`runReserved`) + `ledger/` | Every runtime call is reserved, streamed and settled exactly like chat turns and task runs. New ledger columns: `account_id`, `orch_task_id`. |
| `agents/roles.ts`, `shared/roles.ts` | Names, one-line jobs and instructions of the existing roles (researcher, scriptwriter, director, packaging, competitor_analyst, publisher, video_producer = the editor "Monteur", qc…). |
| `chat/store.ts`, `chat/handoffs.ts` | Agents post in the channel's group conversation, in a video's conversation or in the Supervisor conversation; a delegation is a handoff record + its card; `@mentions` (shared `mentionsIn`) wake agents. New: `ChatStore.onPosted` listener. |
| `team/claude.ts` (`claude_profiles`) | When an account linked to a profile hits a limit, the profile's « limite atteinte » is set too (the hand-off noted in that file). |
| `platform/process.ts` (`killTree`) | The watchdog aborts a run; the provider kills the CLI's whole process tree (taskkill `/T /F` by full path on Windows, SIGKILL to the process group on macOS). |
| `db/migrations` | One new numbered migration, `019_orchestra.ts`. |
| `shared/api/*` pattern | A new module `orchestra` (`src/shared/api/orchestra.ts`, handlers in `src/main/api/orchestra.ts`). |

New: `src/main/orchestra/` (tree, queue, supervisor, turn engine, memory, compaction, routing, accounts, limits,
routines, inbox, messaging, prompt protocol, fakes), `src/main/llm/codex.ts` + `codex-json.ts` (Codex CLI provider).
Then (§18–§22): `technologies.ts` + `toolbox.ts` + `tools-work.ts` + `tool-args.ts` (what each agent may call),
`eyes-look.ts` (the eyes as a tool), `layers.ts` + `assemble.ts` (memory layers and what a turn reads), `connect.ts` +
`platform/terminal.ts` (« Ajouter mon compte »), `services.ts` + `app-services.ts` (the app services the tools reach),
migration `022_agent_context.ts`.

The runtime's own roles (principal, channel_lead, production_supervisor, pipeline_architect, sponsor_manager,
qc_eye) live in `orchestra/roles.ts`, not in `shared/roles.ts`: that list drives the 27 agents of the Agents screen
and their colours, and the runtime's agents are per channel anyway (`orch_agents`).

## 2. Architecture

```
                                 renderer (Agents / Orchestre screens, another engineer)
                                         │  window.atelier.call('orchestra.*')   ▲ 'atelier:changed' {topic:'orchestra'}
─────────────────────────────────────────┼──────────────────────────────────────┼─────────────── main process
                                 api/orchestra.ts (21 typed methods)              │
                                         │                                        │
                               ┌─────────▼──────────────── Orchestra (runtime.ts) ┴───────────────────────┐
                               │                                                                           │
   routines (cron) ──enqueue──▶│  TaskQueue (orch_tasks)   ◀──lease / heartbeat / complete / fail──┐       │
   @mention in chat ─enqueue──▶│   queued → leased → running → done | waiting | waiting_human | dead│      │
   orchestra.enqueue ─────────▶│                                                                    │      │
                               │  Supervisor.tick()  (injectable clock)                              │      │
                               │   1 watchdog: expired lease → abort → provider killTree → retry/dead│      │
                               │   2 routines due → tasks                                            │      │
                               │   3 auto-bump parents, wake parked tasks, "work resumes"            │      │
                               │   4 schedule: runnable tasks × free account slots × 1 task/agent ───┤      │
                               │   5 agent statuses (sleeping = no tokens)                           │      │
                               │                                                                     │      │
                               │  TurnEngine.run(task)                                               │      │
                               │   budget → compaction? → resume or fresh session → callModel ───────┘      │
                               │   → limit? markLimited + failover → actions (delegate, post, remember,     │
                               │     ask_human, done)                                                       │
                               │                                                                           │
                               │  AgentTree   MemoryStore (items, episodes, sessions)   Router (kind→tier)  │
                               │  AccountPool (orch_accounts)  Inbox (orch_inbox)  Messaging → ChatStore    │
                               └───────┬───────────────────────────┬───────────────────────────────────────┘
                                       │ callModel → Ledger.reserve/settle (runReserved)
                     ┌─────────────────┼───────────────────┬─────────────────────┬──────────────────┐
             ClaudeCodeProvider  ClaudeCodeProvider   CodexCliProvider     AnthropicProvider   relay (placeholder)
             default login       CLAUDE_CONFIG_DIR=…  CODEX_HOME=…         API key (secrets)
             `claude -p …`       `claude -p …`        `codex exec --json`
```

## 3. The agent tree

Seeded by `orchestra.seed` (idempotent; one Atelier database = one workspace):

```
principal (Agent principal) ─┬─ pipeline-architect
                             └─ lead-<channel> (Responsable de chaîne · <channel>) ─┬─ researcher-<ch>, competitor-analyst-<ch>,
                                                                                    │  qc-eye-<ch>, publisher-<ch>, sponsor-manager-<ch>
                                                                                    └─ production-supervisor-<ch> ── scriptwriter-<ch>,
                                                                                       packaging-<ch>, director-<ch>, video-producer-<ch>
```

Each agent (`orch_agents`): slug (stable handle for delegations), role, name (also its `@mention`, e.g.
`@Recherchiste_Histoire`), parent, channel (null for workspace agents), instructions, model policy (`tier`, `effort`,
`model`, per-kind overrides, `compactAtTokens`), monthly budget, paused flag and a status recomputed from its tasks:

| status | meaning |
|---|---|
| `working` | a task of it is leased or running |
| `waiting` | its task waits for sub-tasks, an account, a budget, or the user |
| `idle` | runnable work is queued for it |
| `sleeping` | nothing to do: no call, no token |
| `paused` | paused by the user: its tasks stay queued |
| `error` | its last task was dead-lettered (cleared by the next success or a retry) |

Agents can be created on demand (`orchestra.createAgent`: name, any role, parent, instructions, policy, budget).

## 4. Lifecycle of a task

```
          enqueue (user, routine, mention, delegation)
                │
                ▼                  lease = one guarded UPDATE (status + not_before), attempts + 1
   ┌────────▶ queued ───────────────────────────────▶ leased ──▶ running ──▶ done
   │            ▲  ▲                                   │  heartbeat on every streamed delta (lease_expires_at = now + TTL)
   │            │  │ sub-tasks all finished (bump)     ├──▶ waiting (children) ──────────────┘ (parent woken with childResults)
   │            │  └─ waiting (accounts | budget) ◀────┤    attempt given back; not_before = reset time / next month
   │            └──── answer ── waiting_human ◀────────┤    inbox item for the user
   │                                                   │
   └── failed (not_before = now + 30 s × 2^(attempt−1), ≤ 30 min) ◀── error, watchdog, restart
                                                       └──▶ dead (attempts used up): dead letter
```

- `kind` (routing), `title`, `payload` (brief, childResults, human answers, the message that woke it…),
  `priority` 0–9, `assignee`, `created_by`, `parent_id`, `depends_on` (runs once they are all finished), channel,
  video, lease owner / expiry / heartbeat, attempts / max attempts, `not_before`, result, error.
- **Delegation**: an agent delegates to an agent below it (`to: <slug>`) or to every direct report of a role
  (`role: researcher`). Children are created with `parent_id`, a handoff card is posted in the channel (or video)
  conversation, and the parent sleeps (`waiting`, reason `children`). When the last child finishes, the parent is
  bumped back to the queue with `payload.childResults` and fresh attempts; after 4 bumps it is closed with what its
  children returned (no endless re-delegation).
- **Dead letter**: the agent goes to `error`, the handoff is refused, an alert lands in the inbox and a line in the
  Supervisor conversation; `orchestra.retryTask` sends it back with fresh attempts.
- **Invariants** (property-based tests, `orchestra-queue-props.test.ts`): a task is never leased twice at once (only
  a released task can be leased; only the holder can heartbeat, complete or fail it); a done task never runs again;
  attempts never exceed `max_attempts`.

## 5. Supervisor, watchdog and recovery

`Supervisor.tick()` runs every 5 s in the app while the setting **`orchestra.enabled`** is `true` (off by default:
nothing spends until Charlie turns the team on), and by hand in tests, the demo and through `orchestra.tick`.

1. **Watchdog** — a lease past `lease_expires_at` (no heartbeat for 10 min: a hung CLI writes nothing) or a run
   longer than `orchestra.maxRunMs` (45 min) is aborted. The abort makes the provider kill the CLI's process tree
   (`platform/process.ts`); the task fails over to its backoff, or is dead-lettered.
2. **Routines** due enqueue their task (`orch_routines`: 5-field cron, local time; one open task per routine; a
   routine missed while the app was closed fires once). Seeded: the principal's daily digest (08:00), each lead's
   "ideas every Monday" (Monday 09:00), each competitor analyst's morning scan (07:00).
3. **Auto-bump** of parents, wake-up of tasks parked for accounts or budget, "le travail reprend" when an account is
   back.
4. **Scheduling** — runnable tasks by priority, within `orchestra.maxConcurrent` (3) turns at once, one task per
   agent, on an account with a free slot (`max_concurrent` per account).
5. Statuses: an agent with nothing to do sleeps.

**Recovery**: at start (`Orchestra.start` → `recover`), every task left `leased`/`running` by a previous run of the
app (a quit or a crash) is taken back: retried at once (it keeps its session, so its next turn resumes the CLI
session when it lives on the same account) or dead-lettered if it had no attempt left. Ledger reservations left open
are settled at their estimate by the existing `settleStale`.

## 6. Sessions, memory and compaction

Per agent:

- **Memory items** (`orch_memory`): `fact | preference | style | note | lesson`, a source (`task:<id>`,
  `compaction:<session>`, `user`), an importance 1–5. Written by the agents (`remember` action) and by compaction.
  Recalled top-k (8) for each fresh turn: 3 points per keyword shared with the task, + importance, + up to 2 for
  recency (30 days). No embeddings. At most 300 items per agent (least important first out).
- **Episodes** (`orch_episodes`): every turn's prompt and answer (cut to 6 000 characters), tokens, cost, account.
- **Working session** (`orch_sessions`, one active per agent): the Claude Code / Codex session id, the account it
  lives on, the estimated context, the handover it was seeded with.

**Resume vs fresh.** A turn resumes the CLI session (`claude -p --resume <id>`, `codex exec resume <id>`) when the
setting `orchestra.resumeSessions` is on (default), the agent has a session id and the turn runs on the same account
(sessions are stored per CLI config folder and per working folder: every agent runs in
`<userData>/orchestra/agents/<slug>`). A resumed turn sends only the new task (the persona, memory and handover are
already in the session). Otherwise the turn is fresh: system prompt (persona, manager, reports, protocol) + task +
handover + recalled memory. If the CLI says the session is gone, the turn retries fresh once, same attempt. Plain
completions elsewhere in the app keep `--no-session-persistence`.

**Compaction.** Context estimate: a fresh turn sets it to what it sent and received, a resumed turn adds to it (the
CLI replays the conversation). When it reaches the agent's `compactAtTokens` (setting `orchestra.compactAtTokens`,
default 60 000), before the next turn the runtime asks the fast tier (kind `compaction`, Haiku) to turn the session's
episodes into memory items and a ≤ 10-line handover (JSON), closes the session and opens a fresh one seeded with the
handover; the next turn is fresh (no `--resume`) and carries the handover and the top-k memory. If the cheap call
fails or returns garbage, the handover is cut from the last answers: compaction never blocks an agent. (API-key
turns are always fresh, so their context never grows; their continuity is the handover and the memory.)

## 7. Model routing

Task kind → tier and effort. Precedence: the agent's policy for that kind > the agent's policy > the workspace table
(setting `orchestra.routing`, `{ "<kind>": { "tier": "fast", "effort": "low" } }`) > the built-in table > balanced /
medium. The tier's model is the existing tier map (Réglages › Claude et modèles), unless the agent pins a model or the
account maps the tier to its own model (Codex).

| tier (model) | effort | task kinds |
|---|---|---|
| fast (`claude-haiku-5-5`) | low | `triage`, `summary`, `compaction`, `qc_check`, `mention`, `publish_package` |
| fast | medium | `digest` |
| balanced (`claude-sonnet-5-5`) | medium | `plan`, `topics`, `research`, `competitor_scan`, `packaging`, `production`, `sponsors`, `task`, any unknown kind |
| best (`claude-opus-5-5`) | high | `script`, `architecture` |
| best | medium | `review` |

Claude Code gets `--effort <low|medium|high|max>` on runtime turns; Codex gets `-c model_reasoning_effort=…`; the API
gets `output_config.effort` as today.

## 8. The account pool

`orch_accounts`: kind (`claude-code`, `codex`, `anthropic`, `relay`), label, config folder, tiers served, per-tier
models, priority (lower first), `max_concurrent`, enabled, `limited_until` + note, calls, failures, monthly spend
(from the ledger's `account_id`). The first account is created automatically: the user's own Claude Code login
(default config folder), 2 turns at a time.

**Selection** for a call of tier T: enabled, state `ready` (not « à reconnecter »), not limited, serving T, below its
concurrency; then the kind preference of T (setting `orchestra.kindPreference`; **the beta rule, decision 0038: only
Claude Code and Codex, never the API key or the relay**), an account that passed « Vérifier » before one that never did,
the account priority, the lightest load, the fewest calls.

**Dead logins** (decision 0038): `detectAuthFailure` reads « Failed to authenticate: OAuth session expired », « Not logged
in · Please run /login », an invalid key, a 401, a missing CLI. The account goes « À reconnecter » (state `login`,
switched off, `reconnect: true`) and the **same attempt moves to the next account**: no retry is spent on it. With no
working account the task waits (`waiting`, reason `accounts`, attempt given back) and the agent answers in the chat at
once (`account-health.ts`: what to click, the message is kept); a message that arrives while nothing works is answered
the same way before any pass. A good « Vérifier » releases the waiting tasks and puts back in the queue the dead letters
of a dead login of the last day. The app's other LLM calls (chat, asks, the engine's script nodes) run on the same pool
through `SubscriptionProvider`, with the same failover.

**Limits**: `limits.ts` reads the refusal text (Claude Code's error result, Codex `turn.failed`, the stderr tail,
HTTP 429): `Claude AI usage limit reached|<epoch>`, `You've hit your limit · resets 3pm`, `try again in 2 hours 5
minutes`, `Retry-After: 30`, an ISO time… The account is marked `limited_until` (default one hour for a usage limit
without a time, one minute for a rate limit, never more than 8 days) and the **same turn moves at once to the next
account** (event `failover`). When every account for the tier is limited, the task waits (`waiting`, reason
`accounts`, attempt given back) until the earliest reset, the principal posts "le travail reprend vers HH:MM" in the
Supervisor conversation, then "le travail reprend" when an account is back. `orchestra.clearLimit` lifts a limit by
hand and releases the waiting tasks. An unrecognised refusal is an ordinary failure (backoff), never a crash.

### Terms of service: who logs in where

Each subscriber's agents run on **their own** team computer (today: the build PC; later one VM per subscriber), with
**their own** CLI logins. Atelier never sees, stores, copies or forwards an OAuth token or a session cookie: it only
starts the official CLI with an environment variable pointing at a config folder the user logged into themselves
(`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) and removes stray API keys from the CLI's environment so the subscription login is
used. API keys (Anthropic) go through the existing encrypted secrets store. Using several subscriptions of one's own
must stay within each provider's terms (personal subscriptions, no sharing of one login between people); the relay
(Atelier credits) is the path for anything beyond that.

### Connecting several Claude Code accounts

1. Pick a folder per extra subscription, e.g. `%USERPROFILE%\.claude-account-2` (macOS: `~/.claude-account-2`).
2. Log that subscription in, in a terminal:
   - Windows (PowerShell): `$env:CLAUDE_CONFIG_DIR="$HOME\.claude-account-2"; claude` then `/login`, follow the
     browser sign-in with the second account, then `/exit`.
   - macOS (Terminal): `CLAUDE_CONFIG_DIR=~/.claude-account-2 claude`, then `/login`, then `/exit`.
3. Check it: same variable, `claude -p "ok" --model claude-haiku-5-5` (one cheap turn).
4. Add it to Atelier: `orchestra.saveAccount({ kind: 'claude-code', label: 'Claude Code · compte 2', configDir:
   '<that folder>', priority: 1, maxConcurrent: 2 })` (the renderer's account screen will call this).

The first account is the default login (`claude` then `/login` without the variable). Sessions of an account stay in
its folder: a task that moves to another account starts a fresh session (handover + memory carry the continuity).

### Connecting OpenAI Codex accounts

1. Install the CLI: `npm install -g @openai/codex` (codex-cli 0.164 is installed on the H1).
2. Per account, pick a folder and log in with ChatGPT: Windows `$env:CODEX_HOME="$HOME\.codex-account-1"; codex
   login`; macOS `CODEX_HOME=~/.codex-account-1 codex login`. Check with `codex login status` (same variable).
3. Add it: `orchestra.saveAccount({ kind: 'codex', label: 'Codex · ChatGPT', configDir: '<folder>', models: {
   balanced: '<model id>' } })`. Without `models`, Codex uses the model of its own configuration (no `-m`).

The provider runs `codex exec --json --skip-git-repo-check --ignore-user-config -c sandbox_mode=read-only
[--ephemeral] [-m <model>] -` with the prompt on stdin (Codex has no system-prompt flag: the instructions are first
in the prompt), `codex exec resume <id> …` to continue a session. **To verify on a real account** (no real run was
made): the `sandbox_mode` and `model_reasoning_effort` config keys, the JSONL event shapes (`thread.started`,
`item.completed` with `agent_message`, `turn.completed` usage, `turn.failed`), and the exact wording of its usage-limit
message.

## 9. Messaging, mentions, digest

- Agents post (`post` action) in the channel's group conversation (`chat` kind `channel`), in a video's conversation,
  or (`principal`) in the Supervisor conversation, as author `orch:<slug>`.
- A message — Charlie's or a runtime agent's — that `@mentions` runtime agents wakes them: a `mention` task (fast tier)
  whose answer is posted back in the same conversation. Loops are bounded: a mention made by an agent woken by a
  mention is one level deeper, nothing is followed beyond depth 2, and an agent never has more than 3 mentions
  waiting. (The existing group engine still answers Charlie's messages for the 27 chat agents; the runtime only reacts
  to the names of its own agents.)
- Delegations are handoffs of the existing handoff store: the card "X passe la main à Y" is posted with the ask, and
  answered (or refused) with the sub-task's result.
- The principal's daily digest routine gets the numbers of the last 24 hours (computed by the runtime: done,
  stopped, queue, limited accounts) and posts its write-up in the Supervisor conversation.

## 10. Human in the loop

An agent asks (`ask_human` action, kinds `validate`, `input`, `files`, with options): the task goes `waiting_human`,
an inbox item (`orch_inbox`) appears for the renderer, and a line is posted in the channel conversation. Answering
(`orchestra.answer(id, { choice?, text?, files? })`; a choice must be one of the options) puts the task back in the
queue with fresh attempts and the answer in `payload.human`; the agent's next turn reads it. Alerts (dead tasks,
budgets reached) are inbox items of kind `alert`; answering one dismisses it.

## 11. The agent's protocol

Provider-agnostic, plain text (works on Claude Code, Codex and the API without tool plumbing): the agent answers,
then ends with one fenced block

````
```atelier
{"actions": [
  {"type": "delegate", "to": "researcher-1", "kind": "research", "title": "…", "brief": "…"},
  {"type": "delegate", "role": "channel_lead", "kind": "topics", "title": "…"},
  {"type": "post", "room": "channel", "text": "… @Scénariste_Histoire …"},
  {"type": "remember", "kind": "fact", "content": "…", "importance": 4},
  {"type": "ask_human", "kind": "validate", "question": "…", "options": ["Valider", "Revoir"]},
  {"type": "done", "result": "what the manager receives"}
]}
```
````

No block: the answer is the result. A broken block or an invalid action is logged as a `warning` event, never a
failure. Two actions are rights (§18): `delegate` needs the technology `team.delegate`, `ask_human` needs `inbox.ask`; an
agent without them is not offered them in its prompt and they are refused (warning) if it writes them anyway. Besides the
block, an agent calls its **technologies** as tools mid-turn (§18): Claude Code gets them through the agents' MCP server
(only that server, `--strict-mcp-config`, every built-in tool disabled); without technologies the turn stays tool-less
(`--tools ''`).

## 12. Settings

| key | default | meaning |
|---|---|---|
| `orchestra.enabled` | `false` | the team is switched on: the loop runs in the background once a Claude account passed « Vérifier » (§25; else only `orchestra.tick`) |
| `orchestra.pausedUntil` | `null` | while paused: when work resumes (ISO); the watchdog still runs (§25) |
| `orchestra.maxConcurrent` | `3` | turns at once, all accounts together |
| `orchestra.compactAtTokens` | `60000` | default context budget (an agent's policy can override) |
| `orchestra.resumeSessions` | `true` | resume CLI sessions when they live on the same account |
| `orchestra.maxRunMs` | `2700000` | a run longer than this is killed |
| `orchestra.routing` | `{}` | workspace routing overrides per kind |
| `orchestra.kindPreference` | subscriptions first | account kinds per tier, in order |

Queue constants (code): lease TTL 10 min, backoff 30 s doubling up to 30 min, 3 attempts by default, 4 bumps max.

## 13. How the renderer consumes the API

Module `orchestra` (`src/shared/api/orchestra.ts`, 29 methods, all typed): `status`, `tree`, `agents`, `seed`,
`createAgent`, `updateAgent` (pause/resume, instructions, policy, budget, technologies), `tasks(filter)`, `enqueue`,
`retryTask`, `cancelTask`, `accounts`, `saveAccount`, `clearLimit`, `routines(agentId?)`, `toggleRoutine`,
`memory(agentId)`, `deleteMemory`, `inbox(includeClosed?)`, `answer`, `events(afterId?, limit?)`, `tick({ wait? })`, `say`,
`technologies`, `agentContext(agentId, taskId?)`, `contextBlock(scope, channelId?)`, `saveContextBlock`, `addCliAccount`,
`openLogin`, `checkAccount`.

- Subscribe to `atelier:changed` with topic **`orchestra`** (fired on every runtime event) and refetch what the screen
  shows: `useApi('orchestra.tree', ['orchestra'])`, `useApi('orchestra.inbox', ['orchestra'])`…
- Activity feed: keep the last event id and call `orchestra.events(lastId)` on each change (each event: `at`, `type`,
  `agentId`, `taskId`, `text`; types: enqueue, lease, run, turn, delegate, bump, done, retry, dead, kill, recover,
  limit, failover, wait, blocked, resumed, compaction, session, post, wake, mention, inbox, answer, routine, warning,
  error…).
- Agent cards: `status`, `currentTaskId`, `queued` (load), `spentUsdMonth` vs `budgetUsdMonth`, `lastActiveAt`.
- Group chats: messages authored by runtime agents have `authorId = "orch:<slug>"`; map them with
  `orchestra.agents()` (name, role) — the existing chat screens show unknown ids by their raw id until then.
- Account screen: `limitedUntil`/`limitNote` while limited, `running`/`maxConcurrent`, `calls`, `spentUsdMonth`;
  `status().resumesAt` when everything is limited.
- Inbox: open items (`validate` with `options`, `input`, `files`, `alert`); answer with `orchestra.answer`.
- "Turn the team on" = `autopilot.setPower({ state: 'on' })` (live, §25; refused before a Claude account passed
  « Vérifier »); a "run now" button can call `orchestra.tick`.

## 14. Proof

- `npx vitest run tests/unit/orchestra-*.test.ts`: queue properties (fast-check), watchdog kill + retry + dead letter
  + max run time, recovery after a real restart on a file database, delegation and auto-bump, dependencies, routines
  and cron, wake on mention and its depth bound, human in the loop, cancel / pause / concurrency, sessions (`--resume`,
  agent folder, effort, other account → fresh), compaction (and its fallback), memory recall, routing, limits,
  failover (and the Réglages profile), all accounts limited → wait → resume, Codex JSONL / arguments / resume /
  limit / abort, Claude Code → Codex failover, the IPC module.
- `npm run orchestra:demo`: the whole loop offline (see its header); exit 0 = 11 invariants hold. `--real` uses the
  machine's Claude Code CLI (spends from the subscription; only on purpose).
- §18–§22: `orchestra-technologies.test.ts` (role lists, the tools offered, refusal of a tool not granted, action rights),
  `orchestra-eyes-look.test.ts` (frames from a tiny ffmpeg-made clip, count, paths under the workspace, transcript,
  YouTube with and without the Cloud's analysis), `orchestra-memory-layers.test.ts` (blocks written at seed / channel
  added / profile built, archived with the channel and its agents, the context sections and budgets, no secret),
  `orchestra-atlas-scenarios.test.ts` (the two Atlas scenarios, restart in the middle, crash after a tool ran),
  `orchestra-connect.test.ts` (account add flow on a fake terminal and a fake `claude`).

## 15. Real vs to-do

Real now: everything above, in the main process, tested; the Claude Code path is the real provider (on a fake child
in tests); the ledger books every call with its account.

To do / to verify:
- **Codex**: verify the flags and the JSONL shapes on a real login (see §8); no real Codex run was made.
- **Relay** (Atelier credits): a placeholder provider that refuses; to build with the Cloud.
- **Tools on Codex and the API key**: the technologies reach Claude Code (MCP) and in-process providers; Codex and the
  API key turns still act through the action block only (their prompt says the tools cannot be reached).
- **Delegation into production**: the supervisor starts engine runs step by step (`production.start`, first gate for
  Charlie); wiring `script` tasks to the workflow deliverables of the v1 screens is still to do.
- **eyes.look on YouTube without the Cloud's analysis**: facts and thumbnail links only (no download, by rule).
- **Heartbeat granularity**: text deltas and every tool call renew a lease; a single tool longer than the 10-minute TTL
  (a very long eyes.look) would need its own heartbeat.
- **Renderer**: screens for the tree, tasks, accounts, routines, memory, inbox (another engineer, on this API).
- **Team computer / VM**: today the runtime runs inside the desktop app on the build PC; running it headless on a VM per
  subscriber (same code, a Node host) is to do.
- Prices of Codex models are not in the price table: Codex calls are booked at $0 with their tokens.

## 16. Decisions

- One SQLite file, guarded single-statement transitions: no external queue, no Redis; correct under crashes and with
  several supervisors (lease owner ids are per process).
- The runtime's roles do not join `shared/roles` ROLES (see §1).
- Plain-text action protocol instead of tools, so every provider of the pool works the same way.
- The loop is off by default (`orchestra.enabled`): nothing spends tokens until Charlie turns the team on.
- A usage-limit failover does not count as an attempt; a watchdog kill does.
- The demo runs with `engine:demo`'s Node flags but its own import hook, `scripts/ts-transpile.mjs`: the
  main-process code uses TypeScript parameter properties, which plain type stripping refuses, so the hook transpiles
  the repository's .ts files with the TypeScript compiler (no experimental flag: Node 26 removed
  `--experimental-transform-types`, and `engine-plain-node.test.ts` forbids it).

## 17. The published blueprint (`src/main/blueprint`)

The founder's « Blueprints » (console, published to Atelier Cloud) shape every workspace without code. The app fetches
`GET /v1/blueprint` when it connects, every 30 minutes and on demand (`cloud.blueprint`), keeps it in the setting
`blueprint.cache` (with the Cloud address and the version; never read by another Cloud or when signed out) and serves it
read-only. Not connected, or 404: the built-in defaults, unchanged. Unreachable Cloud: the cached version, marked stale.

- **Roles** (`map.ts` `ROLE_TABLE`): `atlas` → principal, `chef-chaine` → channel_lead, `sujets` → researcher, `scenariste` →
  scriptwriter, `realisateur` → director, `monteur` → video_producer, `miniatures` → packaging, `analyse` →
  competitor_analyst, `qualite` → qc_eye; an id equal to a seeded role id also feeds it. Any other id is a « recrutable »
  template (Équipe › Recruter). Tiers: fast → fast (Haiku), balanced → balanced (Sonnet), deep → best (Opus), through the
  existing tier routing (`policy.tier`).
- **Routines**: a French sentence with a time or a day (« à 8 h », « chaque lundi », « chaque jour ») becomes a cron routine
  (09:00 for a weekday alone, 08:00 for « chaque jour »); the others stay as `Routines :` rules in the instructions. For a
  role with scheduled blueprint routines, they replace the built-in seeded routine of that role on NEW agents.
- **New vs existing agents**: `orchestra.seed` uses the blueprint for agents it creates (and remembers what it wrote in
  `blueprint.applied`); existing agents are never touched. `cloud.blueprintPlan` lists, per agent, the instruction / tier /
  routine changes and whether the agent was edited by hand (different from what the blueprint last wrote, or from the
  built-in text); `cloud.blueprintApply(version, agentIds)` changes only the agents the user picked (Équipe › « Appliquer la
  version N »: hand-edited agents start unticked). Agents created by hand are never in the plan.
- **Pipelines** appear in Production › Pipelines › Modèles Atelier (real mode) as drawings; each step has an optional
  `kind` set in the console, else a label heuristic (`guessDrawingKind`), flagged `kindSource: 'guessed'`.

## 18. The tree and its technologies

```
Atlas (principal) ─┬─ Architecte pipeline
                   └─ Responsable de chaîne (one per channel) ─┬─ Recherchiste, Analyste concurrence (« les yeux »),
                                                               │  Œil qualité, Publication, Sponsors
                                                               └─ Superviseur de production ── Scénariste, Miniatures,
                                                                                              Réalisateur, Monteur
```

Each agent has an explicit list of **technologies**: the tools it may call (`technologies.ts`). By default it is its
role's list; an edited list (`orchestra.updateAgent(id, { technologies: [...] })`, Équipe › fiche › Réglages ›
« Technologies ») replaces it, `null` goes back to the role's. A technology that is not on the list is **never offered**
to the model and is **refused** if called anyway (`Refused: <id> is not one of <agent>'s technologies`, event
`refused`). The sheet shows the list and the agent's model tier (its policy, else the routing of its role's usual kind).
Blueprint roles land on these runtime roles through `blueprint/map.ts` (`ROLE_TABLE`), so a blueprint agent gets the
technologies of the role it feeds.

| role (blueprint id) | default technologies |
|---|---|
| principal — Atlas (`atlas`) | `team.delegate`, `inbox.ask`, `dashboard.read`, `channel.create`, `memory.workspace`, `memory.channel` |
| channel_lead (`chef-chaine`) | `team.delegate`, `inbox.ask`, `dashboard.read`, `memory.channel`, `style.profile`, `channel.outliers`, `production.status`, `goals.propose` |
| researcher (`sujets`) | `channel.outliers`, `ideas.list`, `channel.read`, `style.profile`, `inbox.ask` |
| competitor_analyst (`analyse`), the eyes | `eyes.look`, `channel.read`, `channel.outliers`, `ideas.list`, `memory.channel` |
| scriptwriter (`scenariste`) | `script.brief`, `script.save`, `style.profile`, `qc.check` |
| production_supervisor | `team.delegate`, `inbox.ask`, `production.quote`, `production.start`, `production.status`, `production.approve`, `production.cancel` |
| director (`realisateur`) | `eyes.look`, `style.profile`, `production.status` |
| video_producer, the Monteur (`monteur`), also the channel's motion designer | `production.status`, `eyes.look`, `bricks.draft`, `bricks.preview`, `bricks.propose` |
| packaging, Miniatures (`miniatures`) | `thumbnail.brief`, `style.profile`, `files.save`, `production.status` |
| qc_eye (`qualite`) | `qc.check`, `eyes.look`, `production.status`, `files.save`, `inbox.ask` |
| publisher | `production.status`, `files.save`, `inbox.ask` |
| sponsor_manager | `files.save`, `inbox.ask` |
| pipeline_architect | `production.quote`, `dashboard.read`, `inbox.ask`, `pipeline.read`, `pipeline.try`, `pipeline.propose` |
| any other (custom) role | `inbox.ask`, `files.save` |

What they do (MCP tool name = the id with `_`):

- `eyes.look`: §19.
- `channel.read`: the Cloud's `channelData` for the channel and its watched competitors (one small credit job).
- `channel.outliers`, `ideas.list`, `style.profile`, `thumbnail.brief`: the eyes' store, free.
- `script.brief`: the channel memory, the style profile and, for a translation, the source script (a run's or a team
  file's) with the target language. `script.save`: the script as a team file `<data>/files/channel-<id>/scripts/<title>.md`,
  checked with the engine's own narration lint and language detector.
- `files.save`: a note or a brief as a team file.
- `production.quote|start|status|approve|cancel`: our engine's runs through the same `ProductionRuns` as the screens. A
  start is step by step, so the run **stops at its first gate for Charlie**; `production.approve` is refused unless Charlie
  said yes in that task.
- `qc.check`: pass / fail checks of a script or of a run.
- `dashboard.read`: channels, team, queue, runs, inbox, spend this month.
- `channel.create`: the same `channels.create` handler as the screens (the channel, its memory, its team); **refused
  until Charlie validated it** through `ask_human` in that task.
- `memory.workspace`, `memory.channel`: one line added to a block (§20).
- `goals.propose`: the lead's refined goals for its channel, while Charlie has not confirmed them (§25).
- `team.delegate`, `inbox.ask`: rights on the action block (§11).
- `bricks.draft`, `bricks.preview`, `bricks.propose`: a custom brick of the channel (§23).
- `pipeline.read`, `pipeline.try`, `pipeline.propose`: a team pipeline by id, changed only by edit operations; a proposal waits
  in the pipeline's conversation until the owner accepts it in the editor (production-12, decision 0032).

**Safety.** An agent of a channel only touches its channel (its runs, its memory, its team folder); a translated channel
may read the runs of the channel it translates. Each tool has a quota per turn (`eyes.look` 3, `channel.create` and
`production.start` 1, `bricks.preview` 4, `bricks.propose` 1…). A side effect is recorded with its task (`orch_effects`): a turn retried after a crash or a
restart gets « already done » back, never a second channel or a second run. Spending tools go through the usual quotes,
holds and caps.

**How tools reach the model.** Claude Code: the turn registers its tools on the agents' MCP bridge (the same named pipe /
Unix socket as the chat agents, one token per turn, revoked at its end); the CLI runs with only that server
(`--strict-mcp-config`), every built-in tool denied, `--max-turns 16`. Tool results may carry images (MCP `image`
content). The FakeProvider calls them in-process (`req.tools`). Codex and the API key: not yet (§15).

## 19. The eyes as a tool (`eyes.look`), without any paid key

`eyes.look` takes ONE source: a local file (`file`, absolute path), a finished run (`run`: its final video, and its
transcript from the voice's word timings), a team file (`teamFile`, inside `<data>/files`), or a YouTube link (`url`).

- **A file, a run, a team file**: ffprobe gives duration, size and fps; ffmpeg finds the scene changes
  (`select='gt(scene,0.35)'` on a 160 px copy) and takes N JPEG frames (half evenly spaced, the rest at scene changes,
  never two closer than 0.75 s) into `<data>/eyes/look-<task>-<time>/frame-NN-<t>s.jpg`. The answer lists the frames
  (time and path), the facts and the transcript (a `.srt` / `.vtt` beside a local file is read too), and **attaches the
  frames as images**: the agent's own Claude looks at them, on the user's subscription, at **zero API cost**.
- **Budget**: at most 16 frames per call, 3 calls per turn; pass `quick` (default: 6 frames, 384 px wide) or `detailed`
  (12 frames, 768 px). Routing of the looking pass: the kinds `look` and `competitor_scan` route to balanced (Sonnet) by
  default; `{ "look": { "tier": "fast" } }` in the setting `orchestra.routing` (or on the agent's policy) looks with Haiku.
- **A YouTube link**: Atelier never downloads it. With the Cloud's video analysis on (its `GEMINI_API_KEY` set and paid
  calls on: the catalogue says `real`), the link goes through `analyseVideo` (first 15 minutes at most, billed in credits
  like the eyes' analyses). Otherwise the answer gives what Atelier already read about it (title, views, length, date) and
  the thumbnail links, and **says that this is all it could see**.
- No ffmpeg on the computer: the tool says so (Réglages › Moteur shows how to install it).

## 20. Memory layers and what an agent sees at each turn

| layer | where | written by | read by |
|---|---|---|---|
| Workspace memory | `orch_context`, scope workspace | the first seed / onboarding (a starter text when empty), Réglages › Général « Mémoire de l'espace », Atlas (`memory.workspace`) | every agent, every fresh turn |
| Channel memory | `orch_context`, one per channel | `channels.create` (from the sheet: name, niche, rules, styles, competitors), `channel.create` (language, source channel, audience, notes), each new style profile (its « Style : » line is replaced), the channel sheet › Règles « Mémoire de la chaîne », the lead / analyst (`memory.channel`) | every agent of that channel |
| Agent memory | `orch_memory` (§6) | the agent (`remember`), compaction | that agent: top 8 by relevance |
| Session handover | `orch_sessions` (§6) | compaction | that agent, first turn of a fresh session |
| Thread | the room's chat (channel group, video chat, Supervisor chat) | everyone | the agent: its last 8 messages |
| Video thread | the video's chat (a task with a video) | everyone | the agent: its last 8 messages |

**Removing a channel** (`channels.archive`) archives its memory block and its agents (they leave the tree, their open
tasks are cancelled, their memory and history stay); restoring it brings the same agents and block back. Adding a channel
(`channels.create`) writes its block, then seeds its team.

**What a turn reads** (`assemble.ts`; token budgets at 4 characters per token):

| part | budget | fresh turn | resumed CLI session |
|---|---|---|---|
| system: role (persona, instructions, manager, reports, protocol) | 1 500 | yes | yes |
| system: technologies (one line each; the schemas go through MCP) | 600 | yes | yes |
| system: workspace memory | 500 | yes | no (already in the session) |
| system: channel memory | 900 | yes | no |
| prompt: the task (title, brief, sub-task results, Charlie's answers, dependencies, message) | 3 000 | yes | yes |
| prompt: handover of the previous session | 750 | yes | no |
| prompt: selected memories (top 8) | 900 | yes | no |
| prompt: recent thread (8 messages) | 600 | yes | yes |

At most about 8 750 tokens for a fresh turn. Compaction (§6) starts a fresh session before the working session passes
`compactAtTokens` (60 000 by default). **Secrets never get in**: every part goes through `scrubSecrets` (`sk-…`, `xox…`,
`Bearer …`, « token: … », « mot de passe : … », « clé API : … » become « [secret retiré] »), and nothing reads the
secrets store or a CLI's credential files. **« Ce que l'agent sait »** (Équipe › fiche › onglet « Ce qu'il sait »,
`orchestra.agentContext`) shows these exact parts for the agent's next task, read-only, with their size and budget.

## 21. Brancher ton abonnement Claude (et Codex)

Dans **Réglages › Claude › « Comptes de l'équipe d'agents »** :

1. Clique **« Ajouter mon compte Claude Code »**. Atelier crée un dossier rien que pour ce compte
   (`<données>/orchestra/accounts/claude-code-1`, c'est la variable `CLAUDE_CONFIG_DIR`) et ouvre un **terminal** qui
   lance `claude` avec ce dossier. Le compte apparaît « En attente de ta connexion », désactivé.
2. Dans ce terminal, tape `/login`, connecte-toi avec ton compte Claude dans le navigateur, puis `/exit`. **Tu te
   connectes toi-même** : Atelier ne voit, ne lit, ne copie et ne garde jamais tes identifiants, ni les fichiers que
   Claude Code écrit dans ce dossier.
3. Reviens dans Atelier et clique **« Vérifier »**. Atelier te prévient d'abord : la vérification pose **une toute petite
   question à Haiku avec ce compte, donc sur ton abonnement** (quelques tokens, notés dans le registre des dépenses). Si
   Claude répond, le compte passe « Prêt » et s'active ; sinon il reste « En attente de ta connexion » (ou « Échec »,
   avec la raison).
4. C'est tout : l'équipe d'agents passe par ce compte, avec le relais automatique vers un autre compte quand l'un
   atteint sa limite d'usage (§8).

**Pendant l'intégration** (premier lancement, étape « Branche ton abonnement ») : le même parcours, avec l'état réel —
Claude Code trouvé ou non (et comment l'installer : `npm i -g @anthropic-ai/claude-code`), compte ajouté, vérifié. Relié à un
ordinateur d'équipe, l'étape dit que le compte vit là-bas et montre la commande que donne le cerveau. On peut continuer sans
compte vérifié : les agents ne travaillent pas tant que ce n'est pas fait (Réglages › Claude).

**Codex** : pareil avec « Ajouter mon compte Codex » (dossier `codex-1`, variable `CODEX_HOME`, le terminal lance
`codex login`, connexion ChatGPT dans le navigateur).

Si aucun terminal ne s'ouvre, Atelier affiche la commande à taper. Sous Windows (PowerShell) :
`$env:CLAUDE_CONFIG_DIR="<le dossier>"; claude` ; sur Mac : `CLAUDE_CONFIG_DIR='<le dossier>' claude`.

**Sur l'ordinateur d'équipe (le cerveau sans écran)** : ouvre son **écran à distance** (Réglages › Ordinateur d'équipe,
docs/BRAIN-HEADLESS.md §9), puis « Ajouter mon compte » depuis l'app reliée au cerveau. Le cerveau crée le dossier sur
l'ordinateur d'équipe ; s'il a un écran virtuel, un terminal s'y ouvre, sinon la commande s'affiche : tape-la dans le
terminal de l'écran à distance, puis `/login`. Ensuite « Vérifier » comme ci-dessus. La connexion reste sur l'ordinateur
d'équipe, sous le compte `atelier`, et n'en sort jamais.

## 22. Donner du contexte à Atlas

- **Ce qui vaut pour tout** (qui tu es, tes objectifs, tes règles, ton ton) : Réglages › Général › « Mémoire de
  l'espace ». Tous les agents la lisent avant chaque tâche. Atlas peut y ajouter une ligne quand tu lui dis quelque chose
  de durable (« retiens que… »).
- **Ce qui vaut pour une chaîne** (niche, public, langue, style, règles, sponsors, produits, concurrents) : la fiche de la
  chaîne › Règles › « Mémoire de la chaîne ». Remplie à la création de la chaîne, mise à jour par les analyses.
- **Ce qui vaut pour un agent** (ses instructions, ses technologies, son niveau de modèle) : sa fiche dans Équipe.
  L'onglet « Ce qu'il sait » montre exactement ce qu'il lira.
- **Une demande** : écris à Atlas (Accueil, Messages), par exemple « Traduis ma chaîne X en anglais » ou « Ajoute une
  chaîne sur les énigmes historiques ». Atlas te pose ses questions et te demande ta validation dans ta boîte de réception
  avant de créer quoi que ce soit, puis confie le travail au responsable de la chaîne, qui le répartit entre ses
  spécialistes. Chaque étape est une tâche suivie (Équipe, Messages) ; une fabrication s'arrête à chaque validation pour
  toi.

## 23. Briques sur mesure: an agent that writes, looks at and fixes its own motion template

**Who.** The Monteur of each channel (`video_producer`) is also its motion designer: its default technologies include `bricks.draft`,
`bricks.preview` and `bricks.propose` (we chose the existing editor role over a new role so the seeded team stays the same; a custom agent can be
given them on its sheet). Atlas, the channel lead and the production supervisor are told in their instructions that a custom brick is the Monteur's:
« fais-moi une carte de présentation pour la chaîne X » goes Atlas → lead → supervisor → Monteur, each step a durable task (Production › Briques ›
« Demander une brique » posts that sentence to Atlas, `bricks.request`).

**The loop** (`src/main/bricks/tools.ts`, the engine side is docs/ENGINE-SPEC.md §25.2):

1. `bricks_draft` writes the brick (markup, CSS, optional script, fields, sample values, placement) for the agent's own channel. The schema and the
   static checks run first: a `<script>`, an `on…=` handler, a web address, `eval`, a timer are refused with the reason, nothing is written. A change
   makes a new version (`v<n>` folder); the same content keeps its version.
2. `bricks_preview` renders it in the sandboxed headless browser (the engine's `chromiumService` on the Chromium / Chrome / Edge of this computer;
   none → the tool says so): stills at 0 %, 50 %, 100 % **returned as images** (JPEG over a neutral grey, like `eyes.look`'s frames: the agent's own
   Claude sees them on the subscription, zero API cost), a short MP4 clip, the console errors, the blocked requests and the lint (empty frames, overflow,
   safe area, small text, contrast, network). The answer ends with `LINT PASS` or `LINT FAIL` and what to do next.
3. The agent fixes what failed (`bricks_draft` again) and previews again. **Caps**: 4 previews a round (a round ends with a proposal or with Charlie's
   refusal), each preview within 120 s, the per-turn quotas (`bricks.draft` 6, `bricks.preview` 4, `bricks.propose` 1). Past the cap the tool tells it to
   propose the brick as it is, saying what still fails, or to ask Charlie.
4. `bricks_propose` (only after a preview of this version passed its lint) puts a `validate` item in Charlie's inbox (« Brique à valider : … », the
   stills' paths, the fields, where films place it, the agent's note; options Valider / Refuser) and the task **waits for Charlie** (`waiting_human`:
   the tool marks the turn, `applyReply` parks it). A turn retried after a crash finds the proposal already made.
5. **Charlie's answer** (Accueil › À valider, or Production › Briques: `bricks.decide` answers the same inbox item): « Valider » → the brick is
   validated (that version, used by the channel's films from now on; « Utilisée dans les vidéos » switches it off and on); « Refuser » with a note → the
   brick is a draft again with the note, and the agent's task resumes with the note in its prompt: it revises (a new version), previews, proposes again.
   A new draft of a validated brick leaves the validated version in the films until the new one is validated.

**Safety.** A brick is data: files in `<data>/orchestra/bricks/channel-<id>/…` and an index (migration 024). Its code never runs in the app's main
process or renderer: only in a sandboxed page of the headless browser (strict CSP with a nonce, no network, no Node, no eval, time budgets). An agent
writes and previews only its own channel's bricks.

**Proof.** `tests/unit/orchestra-bricks.test.ts`: the FakeProvider plays Atlas, the lead, the supervisor and the Monteur; a fake sandboxed browser
reports the overflowing name; the Monteur drafts, sees `LINT FAIL overflow`, fixes, sees `LINT PASS` with three images, proposes; Charlie refuses with a
note, it revises (v3) and proposes again; Charlie validates from Production › Briques; every task finishes; a run of the channel gets v3 (the director
places it on the named person, `motion.render` draws v3). Also: the tries cap, the technologies (a scriptwriter is refused), a script tag refused before
any drawing. `tests/unit/bricks-api.test.ts` for the IPC module.

## 24. The target: « a Grok Bot, with Claude as the engine and Atelier as the skeleton » (2026-10-31)

Charlie's reference is the behaviour of xAI's Grok Bot (beta since 2026-08): AI teammates on their own always-on
computer, given real jobs they finish end to end, talked to like coworkers, organised as a team under a chief of
staff, with memory, routines, growing proactivity and approvals. We match the behaviour in our own design; nothing
is copied. Mapping, and what is missing (the agent chantiers 1 to 7):

| Grok Bot behaviour | Atelier piece today | Missing → chantier |
|---|---|---|
| Its own always-on computer, signed into the user's tools | the team computer running the headless brain (`docs/BRAIN-HEADLESS.md`), reached through the Cloud relay; Claude Code signed in there with the user's own login (§21) | auto-start after a reboot (`team-pc.ps1 install-task` never run), crash and reboot proven, its data backed up to the Cloud → **A5**; a general browser / terminal for the agents (they only get Atelier's technologies) → later |
| The engine | Claude Code on the user's subscription, account pool with failover (§8) | never run for real: one real day with Charlie's OK, after A1 |
| Real work end to end; back only for approvals or judgment | durable queue, delegation, tools (`production.*`, `eyes.look`, `script.save`…), `ask_human` | a planner that creates the work (**A3**); production on the new projects / technologies and the learning loop (**B = agents-7**) |
| Talk to them like coworkers, threads across desktop and phone | channel group chats, video chats, the Supervisor chat, `@mentions`, `orchestra.say`; Atlas on Discord (module built, never switched on) | Discord switched on as the phone thread, notifications, approvals answered from the phone (**A4**) |
| A team: chief of staff over specialists, group chats | Atlas → channel leads → specialists (§3, §18), delegation with handoff cards | nothing structural |
| Memory of history and preferences; follows up dropped threads | workspace / channel / agent memory, sessions and compaction (§6, §20) | following up stale threads (a question unanswered for days, a task stuck) → **A3** heartbeat |
| Routines and schedules; teach by demonstration | cron routines (three seeded per tree) | standing goals the routines serve (**A2**); routines taught by watching Charlie once (**A6**, later) |
| Growing proactivity; judges when to alert | — (three routines) | the planner and heartbeat working backwards from slots, budget- and limit-aware, warning early (**A3**); watchers (**B**) |
| Approvals: allow once, deny, standing allow; auto-review rules | `ask_human` validate (allow once / deny) and the inbox | per-channel approval levels: which gates ask Charlie (**A2**); standing-allow rules made from an answer (**A4**) |
| You can switch it off, see what it does, stop it | `orchestra.enabled` (read at the next start only), the events log | a live switch on / off / pause, an « Activité » view, a red stop, never on before Claude is connected (**A1**) |

## 25. The switch, « Activité », goals and approval levels (agents-1, agents-2)

**The switch** (`orchestra/power.ts`, IPC module `autopilot`, Équipe › bar on top, Réglages › Claude): `off`, `on`,
`paused` until a time (1 h, tomorrow 8 am, or any time within 30 days) and `blocked` (on, but no account is enabled with
`state = ready` and a check time: the account made by default is never checked, so the team never runs in the background
before Charlie clicked « Vérifier »). Settings `orchestra.enabled` and `orchestra.pausedUntil` hold the state, so it survives
a restart of the app or of the team computer; `power.apply()` makes the loop match it at once. A pause lets the watchdog run
but starts no turn and fires no routine (missed routines then fire once); it ends by itself. **« Tout arrêter »** kills every
run, puts its task back in the queue with the attempt in flight given back (`queue.requeue`, event `requeue`), switches
the team off and says so in the Supervisor chat (event `stop`). When the app is linked to a team computer, the `autopilot.*`
calls are answered by its brain (`brain/route.ts`): the switch is the team computer's.

**« Activité »** (`orchestra/activity.ts`, Équipe › Activité, live on topic `orchestra`): who works on what since when
and on which account; what waits and on whom (Charlie with the inbox item, the sub-tasks' agents, limited accounts with
their reset time, the budget); the next queued tasks; the next routines; the accounts (ready, limited until, not checked);
the team's calls today and its spend today and this month (ledger rows with an account); the latest 40 events.

**Goals** (`orchestra/goals.ts`, `goals-flow.ts`, migration 026 `channel_goals`, Chaînes › fiche › Automatisation
« Objectifs et validations »). Two actions trigger them, once per channel: **creating** a channel (`channels.create`: the
screens, the onboarding, Atlas's `channel.create`) and **importing** one (`channels.update` that links a YouTube channel id
for the first time). Either seeds the team and its memory block, then:
1. a baseline proposal computed in code from what Atelier read: the channel's own videos for an import (source 0 of the
   eyes' reads), else the median of its *watched* competitors; a video of 3 minutes or less is a Short. Long videos 1–7 a
   week of 4–40 minutes; nothing read → 2 long videos of 10 min a week. Slots spread over the week (long 18:00, Shorts
   12:00); budget = minutes a month × 100 credits a minute (decision 0015's grid gives 0,63–1,57 € a minute; production-11
   replaces the estimate with quotes); a first deadline = the first long slot at least a week away; level `recommended`;
2. an inbox item « Objectifs proposés · <channel> » (Confirmer / Je modifie dans la fiche);
3. a task `goals` for the channel lead: analyse the channel and its competitors and refine the draft with `goals.propose`
   (refused once Charlie confirmed: his word stands).
Charlie confirms (the inbox item or the card) or edits then confirms (`autopilot.saveGoals`). Every turn of every agent of
the channel, resumed sessions included, reads the goals at the end of its task part (`assemble.ts`), marked « PROPOSÉS
(brouillon) » until confirmed.

**Approval levels.** Gates of a video: `topic`, `script`, `voice`, `thumbnail`, `video`, `kit`. Levels: `recommended`
(topics and thumbnails), `all-auto` (« tout automatique »: none), `manual` (all), `custom` (picked). An `ask_human` of kind
`validate` carrying a `gate` the channel does not gate is approved at once, with no inbox item: the task goes back to the
queue, its next turn reads « Approved by the approval level of the channel (Charlie was not asked) », event
`auto-approved`. Limits: never for an agent without a channel (Atlas creating a channel always asks); at most 2 per gate in
one task (the third goes to Charlie: no endless loop); such an approval is never Charlie's yes (`approvedIn` ignores it, so
`production.approve` and `channel.create` still need him); the lead's `goals.propose` sets time and budget only, never the
level. A channel without goals keeps the recommended gates. Questions without a gate (or of another kind) always reach
Charlie. « Lancer un tour maintenant » (Réglages › Claude) is enabled only while the team is on.

**Proof.** `tests/unit/autopilot-power.test.ts` (refused before « Vérifier », live on/off, pause then resume by itself,
stop: runs killed and tasks queued with their attempts, a pause kept across a restart on a file database, « Activité »
names who waits on whom), `tests/unit/autopilot-goals.test.ts` (create and import, once; own rhythm vs competitors'
median; bounds; edit, confirm, inbox « Confirmer »; the lead's `goals.propose` and its refusal after confirmation; the goals
in the prompt; recommended / all-auto / manual), `tests/e2e/live-team-power.spec.ts` (the built app on the fake team:
switch, stop, Activité, a new channel's goals confirmed).

## 26. The planner and the heartbeat (agents-3)

The team picks up work before being asked (`orchestra/plan.ts`, `planner.ts`, `heartbeat.ts`, migration 027
`orch_plan_slots` / `orch_plan_steps` / `orch_plan_warnings` + `orch_inbox.reminded_at`). Both run inside the supervisor's
pass (`Supervisor.proactive`, after the routines, never while paused), so they only act while the team is on.

**The planner** is code, no LLM. It runs every hour, and at once when a planned step finished, over each channel whose
goals Charlie **confirmed** (a draft plans nothing). Each slot of the next 7 days gets a row and its video (`videos`, status
`idea`, deadline = the slot); from 5 days before the slot (2,5 for a Short, so the subscription is spread over the week) its
chain opens, worked backwards from the slot:

| Step | Task kind (tier) | Deadline before the slot | Usual duration | Asks Charlie when the level gates |
|---|---|---|---|---|
| topic | `topics` (balanced) | 96 h | 1 h | — |
| approval (only when topics are gated) | `approval` (fast) | 84 h | 12 h | `topic` |
| script | `script` (best: the expensive turn) | 72 h | 2 h | `script` |
| production | `production` (balanced) | 48 h | 6 h | `voice`, `video` |
| qc | `qc_check` (fast) | 36 h | 1 h | — |
| thumbnail | `packaging` (balanced) | 24 h | 1 h | `thumbnail` |
| kit | `publish_package` (fast) | 12 h | 1 h | `kit` |

(A Short halves deadlines and durations.) Only the next missing step is enqueued, for the channel lead, with the slot, the
deadline, the gates that apply and the earlier steps' results in its payload and brief; the brief says plainly whether
Charlie validates the step (`ask_human` with the gate) or not, and A2's auto-approval still covers a question about a gate
the channel does not have. Priority grows as the slack shrinks; cheap kinds get +1, the expensive one -1.
- **Never twice.** A slot and each of its steps have a key (channel, slot time, step); the step row and its task are written
  in one transaction, so a crash or a restart between two passes never makes a duplicate.
- **Budget.** Before the production step the port quotes the video (`quotePipeline`, mode `usage_max`); the step opens only
  if the quote fits in the monthly credits minus this month's runs of the channel's videos (through the port) and the quotes
  promised to planned productions that have no run yet (whatever month they were promised in; a cancelled or dead one
  promises nothing). Every port call is bounded (30 s): a Cloud that does not answer is a warning, never a hung loop. Otherwise: an early warning with the numbers; the next pass checks again (a raised
  budget unblocks it). Production not wired (`UnavailableProduction`, the app today): topic and script go on, then one
  warning per slot.
- **Subscription limits.** While every account of a step's tier is at its limit, the step is enqueued with `not_before` =
  the first reset. An expensive step (tier `best`) waits for a limited account's reset whenever its deadline allows, so the
  accounts left serve the cheap work first.
- **Goals that change.** A planned slot that is no longer in the goals (Charlie moved or removed it, or the time zone
  changed) is retired: its open steps cancelled, its video cancelled, its warnings cleared; finished steps are kept if it
  comes back. Its work is never done twice. One channel that fails is logged (event `error`) and the others are planned.
- **Never past a stop.** The pass awaits the planner (quotes); if Charlie stopped, switched off or paused the team meanwhile,
  that pass starts no turn.
- **Early warning.** An `alert` in the inbox (« Créneau menacé · <chaîne> · <créneau> ») and a line in the channel chat, once
  per slot and reason: `late` (the usual durations of the steps left end after the slot: it names the current step and by
  how many hours), `budget`, `production`, `failed-<step>` (a step's task died or was cancelled; never re-enqueued by
  itself: Charlie or the lead relaunches it). When the kit step is done the slot is `ready` and its video too.

**The heartbeat**, every pass: a question to Charlie (validate, input, files) open for 24 h gets **one** reminder in the
Supervisor chat (event `reminder`); a planned task stuck `waiting` / `waiting_human` past its due time (its deadline, or its
opening plus its usual duration when it opened already late) gives its channel lead **one** `followup` task (« Relance :
#N … bloquée »).

**Proof.** `tests/unit/autopilot-planner.test.ts` (slots and the chain; confirmed goals only, once, after many passes; the
5-day window; recommended vs « tout automatique »; budget and its numbers; production not wired; a slot too close; an
account at its limit; a dead step; the reminder; the lead told; a stop while a quote is awaited; a port that never answers;
a moved slot retired; a cancelled production giving its quote back; one failing channel not stopping the others). `npm run orchestra:week`: a simulated week of three
channels on the fake CLI, the fake production port and the fake clock (account 1 limited on Wednesday evening, a crash with
runs in flight on Friday evening, Charlie leaving one question 30 h): every slot has a ready kit or an early warning, no
duplicate task, budgets respected, Charlie asked only at his gates, zero question in « tout automatique », the restart safe,
one reminder, the lead told, script turns after the reset while cheap turns ran on account 2. Exit 0 = 9 checks hold.

## 27. Threads on the phone, notifications, « toujours valider » (agents-4)

Charlie talks to the team from his phone like with coworkers: the bot of Atelier on his own Discord server
(`src/main/discord/`, Réglages › Discord; it runs where the team runs, the team computer's brain when the app is linked).
Decision 0020.

**Where things are.** The category « Atelier » holds `#atlas` (the principal; the daily summary and the weekly report),
`#à-valider` (every decision), `#production` (runs) and **one room per channel** (its lead). A message there reaches the
agent exactly like the app's « écrire à l'agent » (`orchestra.say`: an @mention in its room); what the runtime says in those
conversations is mirrored back. **Every question gets its own Discord thread**, opened on its message in `#à-valider`
(`threads.ts`): while the question is open, a word in the thread is the answer (`orchestra.answer` with the text, or the
note of a refusal for a deliverable or a production gate); once it is settled, a word there goes to the agent who asked
(`orchestra.say`) and the agent's next reply in its room is posted back in the thread. A thread is followed while its
question is open and 3 days after its last message (15 at most).

**Buttons.** A validation shows « Valider une fois » (its first option), « Refuser » (its second), and, when it is about
a gate of a video of a channel, « Toujours valider : <étape> » — plus « Toujours : série « X » » when the agent named a
series (`ask_human` gains `series`). An alert (early warning « Créneau menacé », a dead task, a budget) shows « Vu »;
`input` and `files` questions are answered in their thread (files: in the app). A click is an interaction, which a bot
without a public HTTPS endpoint receives over the **gateway** (`gateway.ts`: a WebSocket with no intent, heartbeats with
zombie detection, resume after a drop, a growing delay between reconnections, stop on a refused token); it is answered
within Discord's 3 seconds by rewriting the message (« ✔ … », buttons removed) or, for a person not allowed or an error,
by a message only the clicker sees. While the gateway is not connected the bot puts ✅ ❌ under the question (reactions
and replies keep working); « Toujours » then needs the app. Everything else stays pull-based over REST every ~5 s.

**« Toujours valider » = a standing-allow rule** (`orchestra/allow.ts`, migration 028 `orch_allow_rules`, plus `gate`,
`channel_id`, `series` on `orch_inbox`): per channel, per gate, optionally limited to one series (compared without case or
spacing) or to N uses (the app's API; used up = closed). Made from an open validation, in the app (« Toujours valider » in
the answer dialog, `autopilot.allowAlways`) or on Discord; the question itself is answered with its first option, and the
other questions already waiting that the rule covers are answered too. The A2 gate check (`actions.ts`) reads it: a
question whose gate the level asks about is approved at once when a live rule covers it (a series rule first, else a rule
for the whole gate), with the same limits as the level's approvals: never for an agent without a channel, at most 2 per
gate in one task, and never Charlie's yes for `production.approve` / `channel.create`. Event `auto-approved` (« standing
rule #N »); the next turn reads « Approved by Charlie's standing « toujours valider » rule ». Charlie sees and removes his
rules in Chaînes › fiche › « Objectifs et validations » (`autopilot.rules`, `autopilot.revokeRule`).

**Notifications, only when it matters.** Level `important` (default): a post that waits for a decision (everything in
`#à-valider`, and an agent's answer to Charlie's own message in a thread) pings the allowed people (`<@id>` with
`allowed_mentions`); every other post is sent with Discord's « silent » flag (no push). `everything`: Discord's own rules;
`nothing`: all silent. Advice to Charlie: set the server to « Only @mentions ».

**Reports** (`orchestra/reports.ts`, code, no model call): the daily digest (24 h) and the weekly report (7 days) —
**shipped** (kits made ready for their slot, videos marked published), **late and why** (the planner's early warnings of
slots still open, slots passed without a ready kit), **decisions to make** (open questions, oldest first, with their age),
the work done and stopped, the questions approved without Charlie (by level, by rules), and the **spend** of the team's
calls (period, per channel, month). In the app: Équipe › Activité « Rapport » (`autopilot.report`); on Discord: the daily
summary carries what is late and the approvals made without him; the weekly report is posted in `#atlas` on the chosen day
(Monday by default) at the summary hour.

**Proof.** `tests/unit/agents-phone.test.ts` on the in-memory Discord and its gateway socket: a question reaches
`#à-valider` with its buttons and a ping, in its own thread, and a word in the thread answers it; a word after it reaches
the lead and its answer comes back in the thread (the room mirror silent); « Toujours valider » creates the rule and the
next question of that type is approved without asking (another gate, another channel and a revoked rule ask again);
« série » covers that series only; a stranger's click is refused; the app's `allowAlways` with a limit answers the waiting
questions and is used up; notification levels; the daily and weekly reports from real state (the planner's own warning)
in the app and posted once on Discord; the gateway identifies without intents and resumes after a drop.
