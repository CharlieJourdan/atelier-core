// Lot P5: a job remembers the provider's own handle of the work it started (e.g. the RunPod job id), so a retry of the
// same Cloud job resumes that work instead of starting it twice, and a job that ends without success (or is cut off by
// a restart) can cancel it.
export const name = 'provider_ref'

export const sql = `ALTER TABLE jobs ADD COLUMN provider_ref TEXT;`
