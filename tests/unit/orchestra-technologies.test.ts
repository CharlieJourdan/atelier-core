// Agent runtime, the « technologies »: each role gets an explicit list of tools (editable per agent), offered to the model as
// the turn's tools (MCP for Claude Code, `req.tools` for the FakeProvider); a tool that was not granted is never offered and
// is refused when called anyway; the action rights (`team.delegate`, `inbox.ask`) gate the action block. The blueprint's
// roles land on these lists. Fake LLM only.
import { describe, expect, it } from 'vitest'
import { FakeProvider } from '../../src/main/llm/fake'
import type { CompletionRequest } from '../../src/main/llm/types'
import { runtimeRoleOf } from '../../src/main/blueprint/map'
import { catalogue, checkTechnologies, roleTechnologies, technologyLines, toolName, toolSpec } from '../../src/main/orchestra/technologies'
import { agentBySlug, drain, rig } from './orchestra-helpers'

const done = (text: string): string => `${text}\n\`\`\`atelier\n{"actions":[{"type":"done","result":${JSON.stringify(text)}}]}\n\`\`\``

describe('the technologies catalogue', () => {
  it('gives every role of the tree its explicit list, and every id has a tool spec or is an action right', () => {
    // beta-agents-llm: Atlas reads what is in production (production.list, read-only)
    expect(roleTechnologies('principal')).toEqual(['team.delegate', 'inbox.ask', 'dashboard.read', 'production.list', 'channel.create', 'memory.workspace', 'memory.channel', 'videos.order', 'videos.orders'])
    expect(roleTechnologies('competitor_analyst')).toContain('eyes.look')
    expect(roleTechnologies('qc_eye')).toEqual(expect.arrayContaining(['qc.check', 'eyes.look']))
    expect(roleTechnologies('scriptwriter')).toEqual(expect.arrayContaining(['script.brief', 'script.save', 'style.profile']))
    expect(roleTechnologies('production_supervisor')).toEqual(expect.arrayContaining(['production.quote', 'production.start', 'production.approve', 'production.cancel']))
    expect(roleTechnologies('packaging')).toContain('thumbnail.brief')
    expect(roleTechnologies('researcher')).toEqual(expect.arrayContaining(['channel.outliers', 'ideas.list', 'channel.read']))
    // the editor (Monteur) is the existing video_producer role; aliases resolve
    expect(roleTechnologies('editor')).toEqual(roleTechnologies('video_producer'))
    for (const t of catalogue()) {
      const spec = toolSpec(t.id)
      if (t.id === 'team.delegate' || t.id === 'inbox.ask') expect(spec).toBeNull()
      else {
        expect(spec?.name).toBe(toolName(t.id))
        expect(spec?.name).toMatch(/^[a-z_]{3,40}$/) // MCP tool names: no dot
      }
    }
    expect(() => checkTechnologies(['eyes.look', 'nope'])).toThrow(/Unknown technology: nope/)
    expect(checkTechnologies(['eyes.look', 'eyes.look', 'qc.check'])).toEqual(['eyes.look', 'qc.check'])
    expect(technologyLines(['eyes.look', 'team.delegate'])[1]).toMatch(/action delegate/)
  })

  it('maps the blueprint roles onto the runtime roles that carry the lists', () => {
    expect(runtimeRoleOf('atlas')).toBe('principal')
    expect(runtimeRoleOf('analyse')).toBe('competitor_analyst')
    expect(runtimeRoleOf('miniatures')).toBe('packaging')
    expect(runtimeRoleOf('qualite')).toBe('qc_eye')
    expect(roleTechnologies(runtimeRoleOf('analyse') as string)).toContain('eyes.look')
  })
})

describe('technologies on the agents', () => {
  it('shows each agent its list and tier, and offers exactly those tools to the model', async () => {
    const seen: CompletionRequest[] = []
    const r = rig({ providerFor: () => new FakeProvider((req) => (seen.push(req), done('ok'))) })
    const o = r.core.orchestra
    const analyst = o.agents().find((a) => a.slug === `competitor-analyst-${r.channels[0]}`)!
    expect(analyst.technologies).toEqual(roleTechnologies('competitor_analyst'))
    expect(analyst.technologiesCustom).toBe(false)
    expect(analyst.tier).toBe('balanced') // competitor_scan routes to balanced
    expect(o.agents().find((a) => a.role === 'scriptwriter')!.tier).toBe('best') // script routes to best
    o.enqueue({ assigneeId: analyst.id, kind: 'competitor_scan', title: 'Veille' })
    await drain(r)
    const req = seen.at(-1)!
    expect(req.tools?.specs.map((s) => s.name).sort()).toEqual(['channel_outliers', 'channel_read', 'eyes_look', 'ideas_list', 'memory_channel'])
    expect(req.system).toContain('Your technologies')
    expect(req.system).toContain('- eyes.look (tool eyes_look)')
    // an edited list replaces the role's defaults (and the sheet says it was edited)
    const edited = o.updateAgent(analyst.id, { technologies: ['eyes.look'] })
    expect(edited).toMatchObject({ technologies: ['eyes.look'], technologiesCustom: true })
    o.enqueue({ assigneeId: analyst.id, kind: 'competitor_scan', title: 'Veille 2' })
    await drain(r)
    expect(seen.at(-1)!.tools?.specs.map((s) => s.name)).toEqual(['eyes_look'])
    expect(() => o.updateAgent(analyst.id, { technologies: ['magic.wand'] })).toThrow(/Unknown technology/)
    expect(o.updateAgent(analyst.id, { technologies: null }).technologiesCustom).toBe(false)
  })

  it('refuses a tool the agent was not granted, even when the model calls it by name', async () => {
    const provider = new FakeProvider(() => ({ text: done('essayé'), toolCalls: [{ name: 'production_start', args: { title: 'x', topic: 'y' } }, { name: 'channel_outliers', args: {} }] }))
    const r = rig({ providerFor: () => provider })
    const o = r.core.orchestra
    const researcher = agentBySlug(r, `researcher-${r.channels[0]}`)
    const t = o.enqueue({ assigneeId: researcher.id, kind: 'research', title: 'Sujets' })
    await drain(r)
    expect(o.tasks().find((x) => x.id === t.id)?.status).toBe('done')
    expect(provider.toolResults[0]).toMatchObject({ name: 'production_start', isError: true })
    expect(provider.toolResults[0]!.text).toMatch(/Refused: production\.start is not one of Recherchiste · Histoire's technologies/)
    // a granted tool runs (no eyes service in this rig: it says so instead of failing the turn)
    expect(provider.toolResults[1]).toMatchObject({ name: 'channel_outliers' })
    expect(o.events(0, 1000).some((e) => e.type === 'refused' && e.text.includes('production.start'))).toBe(true)
    // the model was never offered it
    expect(provider.calls.at(-1)!.tools?.specs.some((s) => s.name === 'production_start')).toBe(false)
  })

  it('gates the action block: an agent without team.delegate cannot delegate, without inbox.ask cannot ask', async () => {
    const reply =
      'ok\n```atelier\n{"actions":[{"type":"delegate","to":"packaging-1","title":"miniature"},{"type":"ask_human","kind":"input","question":"?"},{"type":"done","result":"fini"}]}\n```'
    const r = rig({ providerFor: () => new FakeProvider(() => reply) })
    const o = r.core.orchestra
    const writer = agentBySlug(r, `scriptwriter-${r.channels[0]}`)
    const t = o.enqueue({ assigneeId: writer.id, kind: 'script', title: 'Script' })
    await drain(r)
    expect(o.tasks().find((x) => x.id === t.id)).toMatchObject({ status: 'done', result: 'fini' })
    expect(o.tasks().filter((x) => x.parentId === t.id)).toHaveLength(0)
    expect(o.inbox()).toHaveLength(0)
    const warnings = o.events(0, 1000).filter((e) => e.type === 'warning').map((e) => e.text)
    expect(warnings.some((w) => /team\.delegate is not one of/.test(w))).toBe(true)
    expect(warnings.some((w) => /inbox\.ask is not one of/.test(w))).toBe(true)
    // its system prompt never offered those actions
    const sys = (r.providers.get(1) as FakeProvider).calls[0]!.system ?? ''
    expect(sys).not.toContain('"type":"delegate"')
    expect(sys).not.toContain('"type":"ask_human"')
  })
})
