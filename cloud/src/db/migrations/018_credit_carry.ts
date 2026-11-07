// (File 018: see migrations/index.ts.) The fraction of a credit a team has used and not been charged yet: a real job is charged what it cost,
// to the fraction of a credit, instead of being rounded up to a whole credit (a 0.0043 € picture used to cost 0.01 €). Wallets and
// the ledger stay whole credits; the part of a credit not charged yet is carried here to the team's next job (jobs.ts, takeCarry).
export const name = 'credit_carry'

export const sql = `
ALTER TABLE wallets ADD COLUMN carry REAL NOT NULL DEFAULT 0 CHECK (carry >= 0 AND carry < 1);
`
