// Lot Z1 review fixes (team): admin totals beyond 500 entries, the
// example's secrets leave with the example, and the Claude test button only exists on the CLI profile.
import { afterEach, describe, expect, it } from 'vitest'
import { memoryCore } from './helpers'

const cores: ReturnType<typeof memoryCore>[] = []
const core = () => {
  const c = memoryCore()
  cores.push(c)
  return c
}
afterEach(() => {
  for (const c of cores.splice(0)) c.close()
})

describe('admin overview', () => {
  it('sums grants in SQL: more than 500 entries are all counted, example grants apart', async () => {
    const c = core()
    for (let i = 0; i < 600; i++) c.context.credits.grant({ amount: 2, idempotencyKey: `g-${i}` })
    c.context.credits.grant({ amount: 70, idempotencyKey: 'ex', source: 'example', example: true })
    const o = await c.api['admin.overview']()
    expect(o.granted).toEqual({ local: 1200, simulated: 0, example: 70 })
  })
})

describe('example secrets', () => {
  it('deleting the example removes its tool secrets and profile keys', async () => {
    const c = core()
    await c.api['example.load']()
    const tool = c.db.prepare('SELECT slug, secrets_json FROM tools WHERE example = 1 AND secrets_json != ? LIMIT 1').get('[]') as { slug: string; secrets_json: string }
    const name = (JSON.parse(tool.secrets_json) as string[])[0]
    c.context.secrets.set(`tools.${tool.slug}.${name}`, 'tool-secret')
    const prof = c.db.prepare("SELECT id FROM claude_profiles WHERE example = 1 AND kind = 'api'").get() as { id: number }
    c.context.secrets.set(`claude.profile.${prof.id}.key`, 'sk-example')
    c.context.secrets.set('tools.mine.KEY', 'keep-me')
    await c.api['example.delete']()
    expect(c.context.secrets.has(`tools.${tool.slug}.${name}`)).toBe(false)
    expect(c.context.secrets.has(`claude.profile.${prof.id}.key`)).toBe(false)
    expect(c.context.secrets.has('tools.mine.KEY')).toBe(true)
  })
})
