// Migration 019: the agent runtime (src/main/orchestra, docs/AGENT-RUNTIME.md).
// - orch_agents: the agent tree (principal → channel leads → specialists, plus agents created on demand).
// - orch_tasks: the durable task queue (lease + heartbeat + expiry, attempts with backoff, dependencies, parent task).
// - orch_accounts: provider accounts (several Claude Code / Codex CLI logins, the API key, the relay placeholder).
// - orch_routines: cron-like schedules that enqueue tasks.
// - orch_memory / orch_episodes / orch_sessions: long-term memory, the log of turns, the working session of an agent.
// - orch_inbox: human-in-the-loop items (validate, input, files) and alerts for the user.
// - orch_events: the runtime's timeline (what the renderer's activity feed and the demo print).
// - ledger gains account_id and orch_task_id (which account paid, for which runtime task). No foreign key on them:
//   spend history outlives deleted tasks and accounts.
// Times are ISO-8601 UTC text written by the runtime's own clock (injectable), not by SQLite.
import type { DatabaseSync } from 'node:sqlite'

export const name = 'orchestra'

export function up(db: DatabaseSync): void {
  db.exec(`
CREATE TABLE orch_agents (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  slug               TEXT NOT NULL UNIQUE,
  role               TEXT NOT NULL,
  name               TEXT NOT NULL,
  parent_id          INTEGER REFERENCES orch_agents(id) ON DELETE SET NULL,
  channel_id         INTEGER REFERENCES channels(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'sleeping'
                     CHECK (status IN ('working','idle','sleeping','waiting','paused','error')),
  instructions       TEXT NOT NULL DEFAULT '',
  policy             TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(policy)),
  budget_usd_month   REAL CHECK (budget_usd_month IS NULL OR budget_usd_month >= 0),
  custom             INTEGER NOT NULL DEFAULT 0 CHECK (custom IN (0,1)),
  paused             INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0,1)),
  error_flag         INTEGER NOT NULL DEFAULT 0 CHECK (error_flag IN (0,1)),
  last_active_at     TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_orch_agents_parent ON orch_agents(parent_id);
CREATE INDEX idx_orch_agents_channel ON orch_agents(channel_id);

CREATE TABLE orch_accounts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  kind             TEXT NOT NULL CHECK (kind IN ('claude-code','codex','anthropic','relay')),
  label            TEXT NOT NULL,
  config_dir       TEXT,
  secret_name      TEXT,
  profile_id       INTEGER REFERENCES claude_profiles(id) ON DELETE SET NULL,
  tiers            TEXT NOT NULL DEFAULT '["best","balanced","fast"]' CHECK (json_valid(tiers)),
  models           TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(models)),
  priority         INTEGER NOT NULL DEFAULT 0,
  max_concurrent   INTEGER NOT NULL DEFAULT 1 CHECK (max_concurrent >= 1),
  enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  limited_until    TEXT,
  limit_note       TEXT,
  calls            INTEGER NOT NULL DEFAULT 0,
  failures         INTEGER NOT NULL DEFAULT 0,
  last_used_at     TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE orch_routines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id     INTEGER NOT NULL REFERENCES orch_agents(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  payload      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
  cron         TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  next_run_at  TEXT,
  last_run_at  TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE (agent_id, name)
);

CREATE TABLE orch_tasks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  kind              TEXT NOT NULL,
  title             TEXT NOT NULL DEFAULT '',
  payload           TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
  priority          INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 0 AND 9),
  assignee_id       INTEGER NOT NULL REFERENCES orch_agents(id) ON DELETE CASCADE,
  created_by        INTEGER REFERENCES orch_agents(id) ON DELETE SET NULL,
  parent_id         INTEGER REFERENCES orch_tasks(id) ON DELETE CASCADE,
  depends_on        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(depends_on)),
  channel_id        INTEGER REFERENCES channels(id) ON DELETE SET NULL,
  video_id          INTEGER REFERENCES videos(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','leased','running','waiting','waiting_human','done','failed','dead','cancelled')),
  wait_reason       TEXT,
  lease_owner       TEXT,
  lease_expires_at  TEXT,
  heartbeat_at      TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts      INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  not_before        TEXT,
  bumps             INTEGER NOT NULL DEFAULT 0,
  account_id        INTEGER REFERENCES orch_accounts(id) ON DELETE SET NULL,
  routine_id        INTEGER REFERENCES orch_routines(id) ON DELETE SET NULL,
  result            TEXT,
  error             TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  started_at        TEXT,
  finished_at       TEXT,
  CHECK (status NOT IN ('leased','running') OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX idx_orch_tasks_runnable ON orch_tasks(status, not_before);
CREATE INDEX idx_orch_tasks_assignee ON orch_tasks(assignee_id, status);
CREATE INDEX idx_orch_tasks_parent ON orch_tasks(parent_id);

CREATE TABLE orch_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id        INTEGER NOT NULL REFERENCES orch_agents(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  cli_session_id  TEXT,
  account_id      INTEGER REFERENCES orch_accounts(id) ON DELETE SET NULL,
  context_tokens  INTEGER NOT NULL DEFAULT 0,
  turns           INTEGER NOT NULL DEFAULT 0,
  handover        TEXT NOT NULL DEFAULT '',
  last_turn_at    TEXT,
  started_at      TEXT NOT NULL,
  closed_at       TEXT,
  close_reason    TEXT
);
CREATE UNIQUE INDEX ux_orch_sessions_active ON orch_sessions(agent_id) WHERE status = 'active';

CREATE TABLE orch_memory (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id      INTEGER NOT NULL REFERENCES orch_agents(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('fact','preference','style','note','lesson')),
  content       TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT '',
  importance    INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  uses          INTEGER NOT NULL DEFAULT 0,
  last_used_at  TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_orch_memory_agent ON orch_memory(agent_id);

CREATE TABLE orch_episodes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    INTEGER NOT NULL REFERENCES orch_agents(id) ON DELETE CASCADE,
  session_id  INTEGER REFERENCES orch_sessions(id) ON DELETE SET NULL,
  task_id     INTEGER REFERENCES orch_tasks(id) ON DELETE SET NULL,
  account_id  INTEGER,
  prompt      TEXT NOT NULL DEFAULT '',
  reply       TEXT NOT NULL DEFAULT '',
  tokens      INTEGER NOT NULL DEFAULT 0,
  cost_usd    REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_orch_episodes_agent ON orch_episodes(agent_id, session_id);

CREATE TABLE orch_inbox (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id      INTEGER REFERENCES orch_tasks(id) ON DELETE CASCADE,
  agent_id     INTEGER REFERENCES orch_agents(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('validate','input','files','alert')),
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  options      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(options)),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','dismissed')),
  answer       TEXT CHECK (answer IS NULL OR json_valid(answer)),
  created_at   TEXT NOT NULL,
  answered_at  TEXT
);
CREATE INDEX idx_orch_inbox_status ON orch_inbox(status);

CREATE TABLE orch_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL,
  agent_id  INTEGER,
  task_id   INTEGER,
  type      TEXT NOT NULL,
  text      TEXT NOT NULL DEFAULT ''
);

ALTER TABLE ledger ADD COLUMN account_id INTEGER;
ALTER TABLE ledger ADD COLUMN orch_task_id INTEGER;
CREATE INDEX idx_ledger_orch_task ON ledger(orch_task_id) WHERE orch_task_id IS NOT NULL;
CREATE INDEX idx_ledger_account ON ledger(account_id) WHERE account_id IS NOT NULL;
`)
}
