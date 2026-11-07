// Agent runtime, migration 022: what an agent may do and what it knows (docs/AGENT-RUNTIME.md §18–§21).
// - orch_agents.technologies: the agent's own list of technologies (tool ids, JSON), NULL = the defaults of its role.
// - orch_agents.archived_at: set when the agent's channel is removed (the agent leaves the tree, its history stays).
// - orch_context: the shared memory layers above the agents' own memory: ONE workspace block (who the owner is, goals,
//   rules, tone) and one block per channel (niche, audience, language, style, rules, sponsors, competitors). A channel's
//   block is archived with the channel, never deleted.
// - orch_effects: the side effects a technology already made for a task (a channel created, a run started), so a turn
//   retried after a crash or a restart finds them instead of doing them twice.
// - orch_accounts.state / check_note / checked_at: the « Ajouter mon compte » flow (waiting for the login, ready, failed).
import type { DatabaseSync } from 'node:sqlite'

export const name = 'agent_context'

export function up(db: DatabaseSync): void {
  db.exec(`
ALTER TABLE orch_agents ADD COLUMN technologies TEXT CHECK (technologies IS NULL OR json_valid(technologies));
ALTER TABLE orch_agents ADD COLUMN archived_at TEXT;

CREATE TABLE orch_context (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scope        TEXT NOT NULL CHECK (scope IN ('workspace','channel')),
  channel_id   INTEGER REFERENCES channels(id) ON DELETE CASCADE,
  text         TEXT NOT NULL DEFAULT '' CHECK (length(text) <= 8000),
  source       TEXT NOT NULL DEFAULT 'user',
  updated_at   TEXT NOT NULL,
  archived_at  TEXT,
  CHECK ((scope = 'workspace' AND channel_id IS NULL) OR (scope = 'channel' AND channel_id IS NOT NULL))
);
CREATE UNIQUE INDEX orch_context_workspace ON orch_context(scope) WHERE scope = 'workspace';
CREATE UNIQUE INDEX orch_context_channel ON orch_context(channel_id) WHERE scope = 'channel';

CREATE TABLE orch_effects (
  task_id      INTEGER NOT NULL,
  tool         TEXT NOT NULL,
  key          TEXT NOT NULL,
  result       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (task_id, tool, key)
);

ALTER TABLE orch_accounts ADD COLUMN state TEXT NOT NULL DEFAULT 'ready' CHECK (state IN ('ready','login','checking','failed'));
ALTER TABLE orch_accounts ADD COLUMN check_note TEXT;
ALTER TABLE orch_accounts ADD COLUMN checked_at TEXT;
`)
}
