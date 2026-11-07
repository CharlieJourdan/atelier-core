// Full schema of archived doc SPEC (old repository) § Données. Timestamps are ISO-8601 UTC text; JSON columns hold JSON text.
// Money is USD as REAL. Later lots add behaviour, not tables, unless a new numbered migration says so.

export const name = 'initial_schema'

export const sql = `
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL CHECK (json_valid(value)),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Encrypted secrets (safeStorage ciphertext). Never stored in clear.
CREATE TABLE secrets (
  name        TEXT PRIMARY KEY,
  ciphertext  BLOB NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE providers (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('claude_code','anthropic','fake')),
  label       TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  config      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE prices (
  model                 TEXT PRIMARY KEY,
  provider_id           TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  tier                  TEXT CHECK (tier IN ('best','balanced','fast')),
  input_per_mtok        REAL NOT NULL CHECK (input_per_mtok >= 0),
  output_per_mtok       REAL NOT NULL CHECK (output_per_mtok >= 0),
  cache_read_per_mtok   REAL NOT NULL DEFAULT 0 CHECK (cache_read_per_mtok >= 0),
  cache_write_per_mtok  REAL NOT NULL DEFAULT 0 CHECK (cache_write_per_mtok >= 0),
  is_placeholder        INTEGER NOT NULL DEFAULT 0 CHECK (is_placeholder IN (0,1)),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- role → tier (→ model through the tier map in settings), with optional per-role overrides.
CREATE TABLE routes (
  role         TEXT PRIMARY KEY,
  tier         TEXT NOT NULL CHECK (tier IN ('best','balanced','fast')),
  provider_id  TEXT REFERENCES providers(id) ON DELETE SET NULL,
  model        TEXT,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE channels (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT NOT NULL,
  youtube_channel_id    TEXT,
  niche                 TEXT NOT NULL DEFAULT '',
  standards             TEXT NOT NULL DEFAULT '',
  monthly_budget_usd    REAL CHECK (monthly_budget_usd IS NULL OR monthly_budget_usd >= 0),
  autopilot_on          INTEGER NOT NULL DEFAULT 0 CHECK (autopilot_on IN (0,1)),
  autopilot_target      INTEGER CHECK (autopilot_target IS NULL OR autopilot_target >= 0),
  autopilot_weekly_max  INTEGER CHECK (autopilot_weekly_max IS NULL OR autopilot_weekly_max >= 0),
  auto_approve          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(auto_approve)),
  owner_gates           TEXT NOT NULL DEFAULT '["publish_package"]' CHECK (json_valid(owner_gates)),
  thumbnail_style       TEXT NOT NULL DEFAULT '',
  script_style          TEXT NOT NULL DEFAULT '',
  archived_at           TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE goals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  INTEGER REFERENCES channels(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  target      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(target)),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','met','missed','dropped')),
  due_at      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_goals_channel ON goals(channel_id);

CREATE TABLE videos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  goal_id     INTEGER REFERENCES goals(id) ON DELETE SET NULL,
  title       TEXT NOT NULL DEFAULT '',
  brief       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'idea'
              CHECK (status IN ('idea','in_progress','waiting_approval','ready','published','cancelled')),
  deadline    TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_videos_channel ON videos(channel_id);
CREATE INDEX idx_videos_goal ON videos(goal_id);
CREATE INDEX idx_videos_status ON videos(status);

CREATE TABLE deliverables (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id             INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  type                 TEXT NOT NULL CHECK (type IN ('research','thumbnail_brief','script','metadata','narration',
                                                     'thumbnail','edit','qc_report','publish_package')),
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','in_progress','waiting_approval','revision_requested','approved','done')),
  needs_approval       INTEGER NOT NULL DEFAULT 0 CHECK (needs_approval IN (0,1)),
  owner_gate           INTEGER NOT NULL DEFAULT 0 CHECK (owner_gate IN (0,1)),
  current_version_id   INTEGER REFERENCES versions(id) ON DELETE SET NULL,
  approved_version_id  INTEGER REFERENCES versions(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (video_id, type)
);
CREATE INDEX idx_deliverables_status ON deliverables(status);

CREATE TABLE deliverable_edges (
  deliverable_id  INTEGER NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  depends_on_id   INTEGER NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  PRIMARY KEY (deliverable_id, depends_on_id),
  CHECK (deliverable_id <> depends_on_id)
);
CREATE INDEX idx_edges_depends_on ON deliverable_edges(depends_on_id);

CREATE TABLE versions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  deliverable_id  INTEGER NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  number          INTEGER NOT NULL CHECK (number >= 1),
  content         TEXT,
  file_path       TEXT,
  mime            TEXT,
  cost_usd        REAL NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  author          TEXT,
  task_id         INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (deliverable_id, number)
);
CREATE INDEX idx_versions_task ON versions(task_id);

CREATE TABLE version_checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id  INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  check_name  TEXT NOT NULL,
  passed      INTEGER NOT NULL CHECK (passed IN (0,1)),
  detail      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_version_checks_version ON version_checks(version_id);

CREATE TABLE approvals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  deliverable_id  INTEGER NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  version_id      INTEGER REFERENCES versions(id) ON DELETE SET NULL,
  decision        TEXT NOT NULL CHECK (decision IN ('approved','revision_requested','auto_approved')),
  decided_by      TEXT NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_approvals_deliverable ON approvals(deliverable_id);
CREATE INDEX idx_approvals_version ON approvals(version_id);

CREATE TABLE agents (
  id            TEXT PRIMARY KEY,
  role          TEXT NOT NULL,
  name          TEXT NOT NULL,
  instructions  TEXT NOT NULL DEFAULT '',
  tools         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tools)),
  tier          TEXT CHECK (tier IN ('best','balanced','fast')),
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_agents_role ON agents(role);

CREATE TABLE custom_agents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id    INTEGER REFERENCES channels(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  base_role     TEXT,
  instructions  TEXT NOT NULL DEFAULT '',
  tools         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tools)),
  tier          TEXT CHECK (tier IN ('best','balanced','fast')),
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_custom_agents_channel ON custom_agents(channel_id);

CREATE TABLE agent_memory (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    TEXT NOT NULL,
  channel_id  INTEGER REFERENCES channels(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_agent_memory_agent ON agent_memory(agent_id, channel_id);

CREATE TABLE tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id        INTEGER REFERENCES videos(id) ON DELETE CASCADE,
  deliverable_id  INTEGER REFERENCES deliverables(id) ON DELETE CASCADE,
  title           TEXT NOT NULL DEFAULT '',
  assignee_type   TEXT NOT NULL CHECK (assignee_type IN ('agent','owner')),
  assignee        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'blocked'
                  CHECK (status IN ('blocked','ready','running','waiting_approval','done','failed','cancelled')),
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts    INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  est_cost_usd    REAL CHECK (est_cost_usd IS NULL OR est_cost_usd >= 0),
  last_error      TEXT,
  started_at      TEXT,
  finished_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_video ON tasks(video_id);
CREATE INDEX idx_tasks_deliverable ON tasks(deliverable_id);

CREATE TABLE conversations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  kind                  TEXT NOT NULL CHECK (kind IN ('supervisor','video','agent')),
  title                 TEXT NOT NULL DEFAULT '',
  video_id              INTEGER REFERENCES videos(id) ON DELETE CASCADE,
  agent_id              TEXT,
  last_read_message_id  INTEGER,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_conversations_video ON conversations(video_id);
CREATE INDEX idx_conversations_agent ON conversations(agent_id);

CREATE TABLE messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  author_type      TEXT NOT NULL CHECK (author_type IN ('owner','agent','system')),
  author_id        TEXT,
  body             TEXT NOT NULL DEFAULT '',
  card             TEXT CHECK (card IS NULL OR json_valid(card)),
  tools            TEXT CHECK (tools IS NULL OR json_valid(tools)),
  attachments      TEXT CHECK (attachments IS NULL OR json_valid(attachments)),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, id);

CREATE TABLE proposals (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  message_id       INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL,
  payload          TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','expired')),
  decided_at       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_proposals_conversation ON proposals(conversation_id);
CREATE INDEX idx_proposals_message ON proposals(message_id);
CREATE INDEX idx_proposals_status ON proposals(status);

CREATE TABLE ledger (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id         TEXT NOT NULL,
  model               TEXT NOT NULL,
  channel_id          INTEGER REFERENCES channels(id) ON DELETE SET NULL,
  video_id            INTEGER REFERENCES videos(id) ON DELETE SET NULL,
  task_id             INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  status              TEXT NOT NULL CHECK (status IN ('reserved','settled','refunded')),
  estimate_usd        REAL NOT NULL DEFAULT 0 CHECK (estimate_usd >= 0),
  amount_usd          REAL NOT NULL DEFAULT 0 CHECK (amount_usd >= 0),
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  settled_at          TEXT
);
CREATE INDEX idx_ledger_created ON ledger(created_at);
CREATE INDEX idx_ledger_channel ON ledger(channel_id);
CREATE INDEX idx_ledger_video ON ledger(video_id);
CREATE INDEX idx_ledger_task ON ledger(task_id);
CREATE INDEX idx_ledger_status ON ledger(status);

CREATE TABLE custom_routines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id   INTEGER REFERENCES channels(id) ON DELETE CASCADE,
  agent_id     TEXT,
  name         TEXT NOT NULL,
  prompt       TEXT NOT NULL DEFAULT '',
  schedule     TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  last_run_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_custom_routines_channel ON custom_routines(channel_id);

CREATE TABLE routine_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id   INTEGER NOT NULL REFERENCES custom_routines(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed','skipped')),
  output       TEXT NOT NULL DEFAULT '',
  cost_usd     REAL NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  started_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at  TEXT
);
CREATE INDEX idx_routine_runs_routine ON routine_runs(routine_id);

CREATE TABLE script_samples (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL,
  source_url  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_script_samples_channel ON script_samples(channel_id);

CREATE TABLE notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  target      TEXT CHECK (target IS NULL OR json_valid(target)),
  read_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_notifications_unread ON notifications(read_at);

CREATE TABLE connectors (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  label       TEXT NOT NULL,
  config      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config)),
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  target  TEXT,
  detail  TEXT CHECK (detail IS NULL OR json_valid(detail))
);
CREATE INDEX idx_audit_at ON audit(at);
`
