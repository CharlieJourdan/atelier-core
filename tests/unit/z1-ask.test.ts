// Lot Z1: ctx.ask, the one-shot model call of the new screens (route → provider, reserved and settled in the ledger).
import { describe, expect, it } from 'vitest'
import { FakeProvider } from '../../src/main/llm/fake'
import { memoryCore } from './helpers'

describe('ctx.ask', () => {
  it('calls the role route through the provider and books the call in the ledger', async () => {
    const provider = new FakeProvider(['Bonjour, je suis l’Analyste.'])
    const core = memoryCore({ chatProvider: () => provider })
    try {
      const deltas: string[] = []
      const r = await core.context.ask({ role: 'analyst', system: 'Tu es l’Analyste.', prompt: 'Salut', onText: (d) => deltas.push(d) })
      expect(r.text).toBe('Bonjour, je suis l’Analyste.')
      expect(deltas.join('')).toBe('Bonjour, je suis l’Analyste.')
      expect(provider.calls).toHaveLength(1)
      expect(provider.calls[0]).toMatchObject({ system: 'Tu es l’Analyste.', prompt: 'Salut' })
      const entries = await core.api['spend.entries']()
      expect(entries).toHaveLength(1)
      expect(entries[0]?.status).toBe('settled')
    } finally {
      core.close()
    }
  })

  it('a failing call releases its reservation and rethrows', async () => {
    const core = memoryCore({ chatProvider: () => new FakeProvider([]) })
    try {
      await expect(core.context.ask({ role: 'analyst', system: 's', prompt: 'p' })).rejects.toThrow('no reply')
      const entries = await core.api['spend.entries']()
      expect(entries.every((e) => e.status !== 'reserved')).toBe(true)
    } finally {
      core.close()
    }
  })
})
