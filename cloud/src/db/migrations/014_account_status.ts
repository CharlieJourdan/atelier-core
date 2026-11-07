// The founder console can disable an account (and enable it again): a disabled account cannot sign in, its tokens stop
// working at once and cannot be refreshed. NULL = active (every account before this migration).
export const name = 'account_status'

export const sql = `
ALTER TABLE accounts ADD COLUMN disabled_at TEXT;
`
