// v2 lot 13, migration 009: group conversations.
// - `conversations` gains two kinds, `channel` (the channel Manager, one per channel) and `room` (a department room of
//   a channel), with `channel_id` and `department`. SQLite cannot change a CHECK in place, so the table is rebuilt; the
//   runner turns foreign keys off for this migration (SQLite's 12-step procedure), so `messages` and `proposals`, which
//   reference it with ON DELETE CASCADE, keep every row, and checks the keys before committing.
// - `message_mentions`: the agents an owner message @mentioned, in the order of the text, and how each turn ended.
// - `handoffs`: every `ask_agent` (who asked whom, the question, the answer or why it was refused).
// - Built-in agents still carrying their v1 English name get their French name (Charlie's edits are kept).
// Values are frozen here (not imported) so this migration always does the same thing.
import type { DatabaseSync } from 'node:sqlite'

export const name = 'group_chat'
/** Run with foreign keys off (see the runner): the rebuild must not fire the cascades. */
export const foreignKeysOff = true

const NAMES: readonly [string, string, string][] = [
  ['supervisor', 'Supervisor', 'Superviseur'],
  ['channel_strategist', 'Channel strategist', 'Stratège de niche'],
  ['trend_scout', 'Trend scout', 'Éclaireur d’outliers'],
  ['ideation_lead', 'Ideation lead', 'Responsable idées'],
  ['packaging', 'Packaging', 'Stratège packaging'],
  ['competitor_analyst', 'Competitor analyst', 'Analyste concurrence'],
  ['seo_researcher', 'Seo researcher', 'Spécialiste SEO'],
  ['researcher', 'Researcher', 'Recherchiste'],
  ['scriptwriter', 'Scriptwriter', 'Scénariste'],
  ['sponsor_writer', 'Sponsor writer', 'Rédacteur sponsor'],
  ['voiceover', 'Voiceover', 'Voix off'],
  ['video_producer', 'Video producer', 'Monteur'],
  ['thumbnail_designer', 'Thumbnail designer', 'Designer miniatures'],
  ['thumbnail_tester', 'Thumbnail tester', 'Testeur A/B'],
  ['metadata', 'Metadata', 'Rédacteur SEO'],
  ['qc', 'Qc', 'Contrôle qualité'],
  ['publisher', 'Publisher', 'Préparateur d’upload'],
  ['analytics_analyst', 'Analytics analyst', 'Analyste audience'],
  ['product_builder', 'Product builder', 'Produits et offres'],
  ['production_coordinator', 'Production coordinator', 'Chef de production'],
  ['budget_controller', 'Budget controller', 'Contrôleur budget'],
  ['freelancer_manager', 'Freelancer manager', 'Gestion freelances']
]

export function up(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE conversations_v9 (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      kind                  TEXT NOT NULL CHECK (kind IN ('supervisor','video','agent','channel','room')),
      title                 TEXT NOT NULL DEFAULT '',
      video_id              INTEGER REFERENCES videos(id) ON DELETE CASCADE,
      agent_id              TEXT,
      channel_id            INTEGER REFERENCES channels(id) ON DELETE CASCADE,
      department            TEXT CHECK (department IS NULL OR department IN ('direction','production','operations')),
      last_read_message_id  INTEGER,
      created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      CHECK (kind != 'room' OR (channel_id IS NOT NULL AND department IS NOT NULL)),
      CHECK (kind != 'channel' OR channel_id IS NOT NULL)
    );
    INSERT INTO conversations_v9 (id, kind, title, video_id, agent_id, channel_id, last_read_message_id, created_at, updated_at)
      SELECT c.id, c.kind, c.title, c.video_id, c.agent_id, v.channel_id, c.last_read_message_id, c.created_at, c.updated_at
      FROM conversations c LEFT JOIN videos v ON v.id = c.video_id;
    DROP TABLE conversations;
    ALTER TABLE conversations_v9 RENAME TO conversations;
    CREATE INDEX idx_conversations_video ON conversations(video_id);
    CREATE INDEX idx_conversations_agent ON conversations(agent_id);
    CREATE INDEX idx_conversations_channel ON conversations(channel_id);
    CREATE UNIQUE INDEX ux_conversations_room ON conversations(channel_id, department) WHERE kind = 'room';
    CREATE UNIQUE INDEX ux_conversations_manager ON conversations(channel_id) WHERE kind = 'channel';

    CREATE TABLE message_mentions (
      message_id        INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      agent_id          TEXT NOT NULL,
      position          INTEGER NOT NULL,
      state             TEXT NOT NULL DEFAULT 'queued'
                        CHECK (state IN ('queued','answering','answered','redirected','stopped','failed')),
      reply_message_id  INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      PRIMARY KEY (message_id, agent_id)
    );

    CREATE TABLE handoffs (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id   INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      owner_message_id  INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      card_message_id   INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      reply_message_id  INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      from_agent        TEXT NOT NULL,
      to_agent          TEXT NOT NULL,
      ask               TEXT NOT NULL,
      answer            TEXT,
      state             TEXT NOT NULL DEFAULT 'asked' CHECK (state IN ('asked','answered','refused')),
      reason            TEXT,
      created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      answered_at       TEXT
    );
    CREATE INDEX idx_handoffs_conversation ON handoffs(conversation_id);
    CREATE INDEX idx_handoffs_owner_message ON handoffs(owner_message_id);
  `)
  const rename = db.prepare('UPDATE agents SET name = ? WHERE id = ? AND name = ?')
  for (const [id, oldName, newName] of NAMES) rename.run(newName, id, oldName)
}
