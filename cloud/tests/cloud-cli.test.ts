// The admin tool (`atelier-cloud`): accounts from the keyboard, credits, caps, price grids, P&L and the audit log.
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { parseFlags, runCli } from '../src/cli.ts'
import { makeCloud, quoteAndRun, signIn } from './helpers.ts'

function io(input = '') {
  const stdin = Object.assign(new PassThrough(), { isTTY: false })
  const out: string[] = []
  const err: string[] = []
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  stdout.on('data', (d) => out.push(String(d)))
  stderr.on('data', (d) => err.push(String(d)))
  if (input) stdin.end(input)
  return { stdin, stdout, stderr, out, err, text: () => out.join(''), errors: () => err.join('') }
}

describe('atelier-cloud admin', () => {
  it('user add reads the password from stdin, never from argv, and the account can sign in', async () => {
    const t = makeCloud()
    const a = io('a very long password\n')
    expect(await runCli(['admin', 'user', 'add', '--from-stdin', '--email', 'charlie@example.com', '--name', 'Charlie', '--platform-admin', '--internal'], { ...a, env: {}, cloud: t.cloud })).toBe(0)
    expect(a.text()).toMatch(/account acc_\S+ \(charlie@example\.com\) platform admin/)
    expect(a.text()).toContain('internal (zero margin)')
    expect(a.text()).not.toContain('a very long password')
    const tokens = await signIn(t, 'charlie@example.com', 'a very long password')
    const me = (await t.app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${tokens.accessToken}` } })).json() as { account: { platformAdmin: boolean }; team: { internal: boolean }; role: string }
    expect(me).toMatchObject({ account: { platformAdmin: true }, team: { internal: true }, role: 'owner' })
    const short = io('short\n')
    expect(await runCli(['admin', 'user', 'add', '--from-stdin', '--email', 'x@example.com', '--name', 'X'], { ...short, env: {}, cloud: t.cloud })).toBe(1)
    expect(short.errors()).toContain('at least 10 characters')
    const dup = io('a very long password\n')
    expect(await runCli(['admin', 'user', 'add', '--from-stdin', '--email', 'CHARLIE@example.com', '--name', 'C'], { ...dup, env: {}, cloud: t.cloud })).toBe(1)
    expect(dup.errors()).toContain('already uses')
  })

  it('grant is idempotent with --key; team list shows the balance; caps; audit', async () => {
    const t = makeCloud()
    const add = io('a very long password\n')
    await runCli(['admin', 'user', 'add', '--from-stdin', '--email', 'm@example.com', '--name', 'M'], { ...add, env: {}, cloud: t.cloud })
    const teamId = /team (team_\S+)/.exec(add.text())?.[1] as string
    const g = () => runCli(['admin', 'grant', '--team', teamId, '--credits', '1000', '--key', 'grant-2026-10-19'], { ...io(), env: {}, cloud: t.cloud })
    expect(await g()).toBe(0)
    const again = io()
    expect(await runCli(['admin', 'grant', '--team', teamId, '--credits', '1000', '--key', 'grant-2026-10-19'], { ...again, env: {}, cloud: t.cloud })).toBe(0)
    expect(again.text()).toContain('already granted')
    expect(t.cloud.wallet.state(teamId).balance).toBe(1000)
    const list = io()
    await runCli(['admin', 'team', 'list'], { ...list, env: {}, cloud: t.cloud })
    expect(list.text()).toContain(`${teamId}\tÉquipe de M\tcustomer\tmembers 1\tbalance 1000\tavailable 1000`)
    const caps = io()
    expect(await runCli(['admin', 'caps', '--team', teamId, '--email', 'm@example.com', '--daily', '50'], { ...caps, env: {}, cloud: t.cloud })).toBe(0)
    expect(caps.text()).toContain('daily 50, monthly none')
    const audit = io()
    await runCli(['admin', 'audit'], { ...audit, env: {}, cloud: t.cloud })
    expect(audit.text()).toMatch(/cli\twallet\.grant\tteam_/)
    expect(audit.text()).toMatch(/cli\taccount\.create\tacc_/)
  })

  it('price set publishes a margin outside its tier anyway, with a warning line', async () => {
    const t = makeCloud()
    const x = io()
    const code = await runCli(['admin', 'price', 'set', 'avatar.seconds', '--margin', '60'], { ...x, env: {}, cloud: t.cloud })
    expect(code).toBe(0)
    expect(x.text()).toMatch(/price grid v2 published/)
    expect(x.text()).toMatch(/warning: avatar\.seconds margin 60 % is outside its tier \(\d+ %\)/)
  })

  it('price set publishes a new grid version (percent, fixed, suggested tier); credit-value too', async () => {
    const t = makeCloud()
    const run = async (...args: string[]) => {
      const x = io()
      const code = await runCli(['admin', 'price', ...args], { ...x, env: {}, cloud: t.cloud })
      return { code, text: x.text(), err: x.errors() }
    }
    expect((await run('show')).text).toContain('grid v1: 1 credit = €0.01')
    expect((await run('set', 'voice.chars', '--margin', '5')).text).toContain('price grid v2 published')
    expect(t.cloud.pricing.current().items.find((i) => i.item === 'voice.chars')?.pricing).toEqual({ mode: 'percent', marginPct: 5 })
    await run('set', 'video.seconds', '--fixed', '7', '--reference', 'none')
    expect(t.cloud.pricing.current().items.find((i) => i.item === 'video.seconds')).toMatchObject({ referenceEur: null, pricing: { mode: 'fixed', creditsPerUnit: 7 } })
    // $0.02 × 0.92 × 1.05 = €0.01932 against a €0.02 reference: nearly the same price → 5 %.
    await run('set', 'avatar.seconds', '--reference', '0.02', '--margin')
    expect(t.cloud.pricing.current().items.find((i) => i.item === 'avatar.seconds')?.pricing).toEqual({ mode: 'percent', marginPct: 5 })
    await run('credit-value', '0.02')
    expect(t.cloud.pricing.current()).toMatchObject({ version: 5, creditValueEur: 0.02 })
    expect((await run('set', 'nope.item', '--margin', '5')).code).toBe(1)
    expect(t.cloud.pricing.versions()).toHaveLength(5)
  })

  it('pnl counts settled jobs (demo only when asked) per day and provider', async () => {
    const t = makeCloud({ gridMargins: true })
    const add = io('a very long password\n')
    await runCli(['admin', 'user', 'add', '--from-stdin', '--email', 'p@example.com', '--name', 'P'], { ...add, env: {}, cloud: t.cloud })
    const teamId = /team (team_\S+)/.exec(add.text())?.[1] as string
    t.cloud.wallet.grant({ teamId, credits: 1000, idemKey: 'pnl-seed', actor: 'test' })
    const tok = await signIn(t, 'p@example.com', 'a very long password')
    const who = { accountId: '', teamId, email: 'p@example.com', ...tok, auth: { authorization: `Bearer ${tok.accessToken}` } }
    await quoteAndRun(t, who, 'synthesize', { text: 'a'.repeat(10_000), voiceId: 'demo-claire' })
    const real = io()
    await runCli(['admin', 'pnl', '--from', '2026-10-19', '--to', '2026-10-19'], { ...real, env: {}, cloud: t.cloud })
    expect(real.text()).toContain('(no settled job in this period)')
    const demo = io()
    await runCli(['admin', 'pnl', '--from', '2026-10-19', '--to', '2026-10-19', '--demo'], { ...demo, env: {}, cloud: t.cloud })
    // 192 credits = €1.92 sold; fake cost $1.80 × 0.92 × 1.05 = €1.74; margin €0.18.
    expect(demo.text()).toBe('2026-10-19\tfake-voice\tjobs 1\tcredits 192\trevenue €1.92\tcost €1.74\tmargin €0.18\tloss jobs 0\n')
  })

  it('admin margin and admin fx show and change the founder console’s settings (the beta starts at cost)', async () => {
    const t = makeCloud()
    const run = async (...args: string[]) => {
      const x = io()
      const code = await runCli(['admin', ...args], { ...x, env: {}, cloud: t.cloud })
      return { code, text: x.text() + x.errors() }
    }
    expect((await run('margin')).text).toBe('prices: real cost × 1 (at cost, margin 0 %)\n')
    expect((await run('margin', 'set', '1.3')).text).toBe('prices: real cost × 1.3\n')
    expect((await run('margin', 'set', 'grid')).text).toContain('each grid line’s own margin')
    expect(t.cloud.finance.multiplier()).toBeNull()
    expect((await run('margin', 'set', '0.5')).code).toBe(1)
    expect((await run('fx', 'set', '0.87', '--date', '2026-11-01')).text).toBe('$1 = €0.87 (rate of 2026-11-01)\n')
    expect((await run('fx', 'set', 'abc')).code).toBe(1)
  })

  it('unknown commands fail with a pointer; flags parse', async () => {
    const x = io()
    expect(await runCli(['nope'], { ...x, env: {}, cloud: makeCloud().cloud })).toBe(1)
    expect(x.errors()).toContain('unknown command')
    expect(parseFlags(['a', '--b', 'c', '--d', '--e', 'f'])).toEqual({ positional: ['a'], flags: new Map<string, string | true>([['b', 'c'], ['d', true], ['e', 'f']]) })
  })
})
