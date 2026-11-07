// QA B3: a run whose render failed must not sit « waiting » on a gate (asking to validate a doomed video).
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { doomedByError, refreshLiveStatus } from '../../src/main/production/runs/recorder'

function db(rows: [string, string, string][]): DatabaseSync {
  const d = new DatabaseSync(':memory:')
  d.exec('CREATE TABLE video_runs (id INTEGER PRIMARY KEY, status TEXT); CREATE TABLE video_run_nodes (run_id INTEGER, node_id TEXT, state TEXT, gate TEXT)')
  d.prepare("INSERT INTO video_runs VALUES (1, 'running')").run()
  for (const [n, s, g] of rows) d.prepare('INSERT INTO video_run_nodes VALUES (1, ?, ?, ?)').run(n, s, g)
  return d
}

describe('a failed node with only a gate left', () => {
  it('dooms the run: the failed nodes are named', () => {
    expect(doomedByError(db([['render', 'error', 'none'], ['thumbnails', 'waiting_gate', 'waiting']]), 1)).toEqual(['render'])
  })
  it('does not while a node still works, nothing failed, or no gate waits', () => {
    expect(doomedByError(db([['render', 'error', 'none'], ['voice', 'running', 'none'], ['thumbnails', 'waiting_gate', 'waiting']]), 1)).toBeNull()
    expect(doomedByError(db([['render', 'done', 'none'], ['thumbnails', 'waiting_gate', 'waiting']]), 1)).toBeNull()
    expect(doomedByError(db([['render', 'error', 'none']]), 1)).toBeNull()
  })
  it('a healthy waiting gate still makes the run « waiting »', () => {
    const d = db([['render', 'done', 'none'], ['thumbnails', 'waiting_gate', 'waiting']])
    refreshLiveStatus(d, 1)
    expect((d.prepare('SELECT status FROM video_runs').get() as { status: string }).status).toBe('waiting')
  })
})
