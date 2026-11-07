// A resumed session does not get its system prompt again, so what it believed about its tools or the balance would outlive
// the fix of the cause (#110, production-equipe). Every resumed turn starts with the state as it is now.
import { describe, expect, it } from 'vitest'
import { stateNow } from '../../src/main/orchestra/assemble'

describe('stateNow: what a resumed session re-reads', () => {
  it('says the tools are reachable again, and that earlier beliefs about balance and budget are void', () => {
    const s = stateNow(['eyes.look', 'team.delegate'], true)
    expect(s).toContain('STATE NOW')
    expect(s).toContain('reachable')
    expect(s).toContain('balance')
    expect(s).toContain('read it again')
  })

  it('says so when they are not', () => {
    expect(stateNow(['eyes.look'], false)).toContain('cannot be reached')
  })

  it('an agent with no tool of its own is told nothing about tools', () => {
    expect(stateNow(['team.delegate', 'inbox.ask'], false)).not.toMatch(/reachable|reached/)
  })
})
