import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createCore, type CoreOptions } from '../../src/main/core'
import type { ProviderTester } from '../../src/main/llm/tester'
import type { Cipher } from '../../src/main/secrets'

/** Reversible, obviously-not-plaintext cipher for tests (safeStorage stand-in). */
export function testCipher(available = true): Cipher & { encrypted: number } {
  const c = {
    encrypted: 0,
    isAvailable: () => available,
    encrypt(plain: string): Uint8Array {
      c.encrypted++
      const bytes = Buffer.from(plain, 'utf8').map((b) => b ^ 0x5a)
      return Buffer.concat([Buffer.from('TEST1:'), bytes])
    },
    decrypt(cipher: Uint8Array): string {
      const buf = Buffer.from(cipher)
      if (buf.subarray(0, 6).toString() !== 'TEST1:') throw new Error('bad ciphertext')
      return Buffer.from(buf.subarray(6).map((b) => b ^ 0x5a)).toString('utf8')
    }
  }
  return c
}

export const okTester: ProviderTester = {
  test: async (id) => ({ ok: true, message: `tested ${id}`, latencyMs: 0 })
}

export function memoryCore(extra: Partial<CoreOptions> = {}) {
  return createCore({
    paths: { dbPath: ':memory:' },
    cipher: testCipher(),
    tester: okTester,
    ...extra
  })
}

export function fixture(name: string): string {
  return readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8')
}
