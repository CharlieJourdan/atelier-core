// E-mails a real SaaS needs: an address is verified (accounts.email_verified_at; every account that existed before this
// migration counts as verified), the language an account's e-mails are written in, single-use verification and
// password-reset tokens (stored hashed), the fake mailer's outbox (the dev Cloud keeps its messages here, `mail list`
// shows them) and the log that makes a billing e-mail go out once per event and recipient.
export const name = 'email_accounts'

export const sql = `
ALTER TABLE accounts ADD COLUMN email_verified_at TEXT;
UPDATE accounts SET email_verified_at = created_at;
ALTER TABLE accounts ADD COLUMN lang TEXT NOT NULL DEFAULT 'fr' CHECK (lang IN ('fr', 'en'));

CREATE TABLE email_tokens (
  hash        TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('verify', 'reset')),
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE INDEX email_tokens_account ON email_tokens(account_id, kind);

CREATE TABLE mail_outbox (
  id          TEXT PRIMARY KEY,
  to_addr     TEXT NOT NULL,
  subject     TEXT NOT NULL,
  text_body   TEXT NOT NULL,
  html_body   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX mail_outbox_created ON mail_outbox(created_at);

CREATE TABLE mail_sent (
  dedupe_key  TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  account_id  TEXT,
  created_at  TEXT NOT NULL
);
`
