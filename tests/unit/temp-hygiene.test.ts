// Guard for the test suite's temporary folders (tests/setup/temp-root.ts): every test file runs with its own temp root,
// removed after the file, and a file that leaves an `atelier-*` folder behind fails unless it is in the baseline.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { trackTemp } from '../setup/track-temp'

describe('temporary folders of the tests', () => {
  it('os.tmpdir() is the private root of this test file, and a child process sees it too', () => {
    expect(basename(tmpdir())).toMatch(/^atelier-vt-/)
    expect(process.env.TEMP).toBe(tmpdir())
  })

  it('a folder registered with trackTemp() is a normal folder until the file ends (it is removed then)', () => {
    const dir = trackTemp(mkdtempSync(join(tmpdir(), 'atelier-hygiene-')))
    expect(existsSync(dir)).toBe(true)
  })

  it('the leak baseline only names test files that exist (it can shrink, never rot)', () => {
    const baseline = JSON.parse(readFileSync(resolve(import.meta.dirname, '../setup/temp-leak-baseline.json'), 'utf8')) as Record<string, string[]>
    for (const file of Object.keys(baseline)) expect(existsSync(resolve(import.meta.dirname, '../..', file)), file).toBe(true)
  })
})
