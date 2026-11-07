// The local store on Windows: a rename over a file that is open at that moment (read by another request, scanned by an
// antivirus) fails with EPERM / EACCES / EBUSY for a short while. The store retries, and never leaves its .part behind.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalBlobStore, type RenameFn } from '../src/blobs/local.ts'

const dirs: string[] = []
const fresh = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'atelier-blobs-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const busy = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: operation not permitted, rename`), { code })

/** A rename that fails `times` times with `code`, then does the real one. */
function flaky(code: string, times: number, real: RenameFn): { rename: RenameFn; calls: () => number } {
  let n = 0
  return {
    rename: async (from, to) => {
      n++
      if (n <= times) throw busy(code)
      await real(from, to)
    },
    calls: () => n
  }
}

describe('the local blob store', () => {
  it('retries a rename that Windows refuses for a moment (EPERM, EACCES, EBUSY), then the file is there', async () => {
    const { rename } = await import('node:fs/promises')
    for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
      const root = fresh()
      const f = flaky(code, 2, rename)
      const store = new LocalBlobStore(root, { platform: 'win32', rename: f.rename, retryDelayMs: 1 })
      await store.put('teams/t/artefacts/abc', new Uint8Array([1, 2, 3]))
      expect(f.calls()).toBe(3)
      expect([...readFileSync(join(root, 'teams', 't', 'artefacts', 'abc'))]).toEqual([1, 2, 3])
      expect(readdirSync(join(root, 'teams', 't', 'artefacts')).filter((n) => n.endsWith('.part'))).toEqual([])
    }
  })

  it('gives up after its retries, says why, and removes its .part file', async () => {
    const root = fresh()
    const f = flaky('EPERM', 1000, async () => undefined)
    const store = new LocalBlobStore(root, { platform: 'win32', rename: f.rename, retryDelayMs: 1, retries: 3 })
    await expect(store.put('k/x', new Uint8Array([9]))).rejects.toThrow(/EPERM/)
    expect(f.calls()).toBe(4)
    expect(readdirSync(join(root, 'k'))).toEqual([])
  })

  it('does not retry other errors, nor on macOS and Linux where a rename over an open file works', async () => {
    const root = fresh()
    const enoent = flaky('ENOENT', 1000, async () => undefined)
    await expect(new LocalBlobStore(root, { platform: 'win32', rename: enoent.rename, retryDelayMs: 1 }).put('a/b', new Uint8Array([1]))).rejects.toThrow(/ENOENT/)
    expect(enoent.calls()).toBe(1)
    const perm = flaky('EPERM', 1000, async () => undefined)
    await expect(new LocalBlobStore(root, { platform: 'darwin', rename: perm.rename, retryDelayMs: 1 }).put('a/c', new Uint8Array([1]))).rejects.toThrow(/EPERM/)
    expect(perm.calls()).toBe(1)
    expect(existsSync(join(root, 'a')) ? readdirSync(join(root, 'a')) : []).toEqual([])
  })

  it('putFile retries the same way and leaves the upload where it was', async () => {
    const { rename, writeFile } = await import('node:fs/promises')
    const root = fresh()
    const upload = join(fresh(), 'upload.bin')
    await writeFile(upload, new Uint8Array([7, 7]))
    const f = flaky('EBUSY', 1, rename)
    await new LocalBlobStore(root, { platform: 'win32', rename: f.rename, retryDelayMs: 1 }).putFile('u/v', upload)
    expect([...readFileSync(join(root, 'u', 'v'))]).toEqual([7, 7])
    expect(existsSync(upload)).toBe(true)
  })
})
