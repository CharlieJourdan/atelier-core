// Custom bricks, the contract (docs/ENGINE-SPEC.md §25.2): the brick's zod schema and the schema of its values built from its fields, the
// static checks that refuse a script, a handler or a web address before any drawing, the content hash of the render cache, the `custom:<id>`
// spec of the edit plan (and our templates' errors still naming their field), and the sandboxed page (CSP with a nonce on every script, values
// escaped where they land).
import { describe, expect, it } from 'vitest'
import { Brick, brickHash, placementOf, resolveValues, staticProblems, valuesSchema } from '../../src/engine/formats/brick'
import { EDITPLAN_SCHEMA, EditPlan } from '../../src/engine/formats/editplan'
import { checkMotion } from '../../src/engine/formats/motion'
import { brickCsp, brickPage, fillMarkup } from '../../src/engine/motion/brick-page'
import { CARD } from './brick-fixture'

const card = (over: Partial<typeof CARD> = {}): Brick => Brick.parse({ ...CARD, ...over, version: 1 })
const ctx = { width: 1920, height: 1080, durationS: 4, fontCss: '' }

describe('the brick schema', () => {
  it('takes our sample card and fills the field defaults', () => {
    const b = card()
    expect(b.fields.map((f) => f.name)).toEqual(['name', 'role', 'kicker', 'accent'])
    expect(resolveValues(b, { name: 'Jules Verne' })).toEqual({ ok: true, values: { name: 'Jules Verne', role: 'Témoin', kicker: 'Personnage', accent: '#F5B700' } })
    expect(placementOf(b)).toMatchObject({ template: 'custom:fiche-personnage', version: 1, use: { on: 'person', seconds: 4 } })
  })

  it('refuses a bad brick, naming the field: an id, a duplicate field, a sample that does not fit, a placement that cannot be filled', () => {
    const issues = (over: Record<string, unknown>): string[] => {
      const r = Brick.safeParse({ ...CARD, version: 1, ...over })
      return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    }
    expect(issues({ id: 'Fiche Perso' }).join()).toMatch(/^id:/)
    expect(issues({ fields: [...CARD.fields, { type: 'text', name: 'name', max: 10 }] }).join()).toMatch(/field name is declared twice/)
    expect(issues({ sample: { name: 'x'.repeat(41) } }).join()).toMatch(/sample\.name/)
    expect(issues({ sample: { name: 'Élise', extra: 'no' } }).join()).toMatch(/sample/)
    expect(issues({ use: { on: 'person', seconds: 4, bind: {} } }).join()).toMatch(/use\.bind\.name/)
    expect(issues({ use: { on: 'end', seconds: 4, bind: {} } }).join()).toMatch(/name needs a default/)
    expect(issues({ use: { on: 'person', seconds: 9, bind: { name: 'name' } } }).join()).toMatch(/use\.seconds/)
    expect(issues({ fields: [] }).join()).toMatch(/fields/)
  })

  it('checks every value against its field: text length, number range, colour, image only as a data: URI, no unknown key', () => {
    const s = valuesSchema([
      { type: 'text', name: 'title', max: 10, optional: false },
      { type: 'number', name: 'n', min: 0, max: 100, optional: false },
      { type: 'color', name: 'c', optional: false },
      { type: 'image', name: 'photo', optional: true }
    ])
    expect(s.safeParse({ title: 'Bonjour', n: 3, c: '#112233' }).success).toBe(true)
    expect(s.safeParse({ title: 'x'.repeat(11), n: 3, c: '#112233' }).success).toBe(false)
    expect(s.safeParse({ title: 'ok', n: 101, c: '#112233' }).success).toBe(false)
    expect(s.safeParse({ title: 'ok', n: 1, c: 'red' }).success).toBe(false)
    expect(s.safeParse({ title: 'ok', n: 1, c: '#112233', photo: 'https://example.com/a.png' }).success).toBe(false)
    expect(s.safeParse({ title: 'ok', n: 1, c: '#112233', photo: 'data:image/png;base64,iVBORw0KGgo=' }).success).toBe(true)
    expect(s.safeParse({ title: 'ok', n: 1, c: '#112233', other: 1 }).success).toBe(false)
    const bad = resolveValues(card(), { name: '' })
    expect(bad.ok).toBe(false)
    expect(bad.ok ? '' : bad.problems.join()).toMatch(/custom:fiche-personnage: name/)
  })

  it('refuses scripts, handlers, web addresses, imports, timers and randomness before anything is drawn', () => {
    const p = (over: Partial<Brick>): string => staticProblems({ ...card(), ...over }).join(' | ')
    expect(p({})).toBe('')
    expect(p({ html: '<div>{{name}}</div><script>alert(1)</script>' })).toMatch(/html: .*<script>/)
    expect(p({ html: '<img src="x" onerror="fetch(1)">' })).toMatch(/event handlers/)
    expect(p({ html: '<img src="https://example.com/a.png">' })).toMatch(/no network/)
    expect(p({ html: '<img src="//example.com/a.png">' })).toMatch(/no network/)
    expect(p({ html: '<a href="javascript:void(0)">x</a>' })).toMatch(/javascript:/)
    expect(p({ html: '<div>{{nope}}</div>' })).toMatch(/\{\{nope\}\} is not one of the fields/)
    expect(p({ css: '@import "x.css";' })).toMatch(/@import/)
    expect(p({ css: '.a{background:url(https://example.com/a.png)}' })).toMatch(/data: URLs/)
    expect(p({ css: '.a{background:url("data:image/png;base64,AAAA")}' })).toBe('')
    expect(p({ css: '</style><script>x()</script>' })).toMatch(/close its <style>/)
    expect(p({ script: "fetch('https://example.com')" })).toMatch(/no network/)
    expect(p({ script: 'eval("1")' })).toMatch(/no eval/)
    expect(p({ script: 'new Function("return 1")' })).toMatch(/no eval/)
    expect(p({ script: 'setTimeout(f, 10)' })).toMatch(/no timers/)
    expect(p({ script: 'var x = Date.now()' })).toMatch(/no timers/)
    expect(p({ script: 'var x = Math.random()' })).toMatch(/brick\.random/)
    expect(p({ script: 'var s = "</script><script>x()"' })).toMatch(/<script/)
    expect(p({ script: 'localStorage.x = 1' })).toMatch(/storage/)
  })

  it('hashes the content: a new version, markup, style, script or field changes the key; the sample does not', () => {
    const a = card()
    expect(brickHash(a)).toBe(brickHash(card()))
    expect(brickHash(a)).not.toBe(brickHash({ ...a, version: 2 }))
    expect(brickHash(a)).not.toBe(brickHash({ ...a, css: a.css + '.x{}' }))
    expect(brickHash(a)).not.toBe(brickHash({ ...a, script: '' }))
    expect(brickHash(a)).not.toBe(brickHash({ ...a, html: a.html.replace('card', 'card2') }))
    expect(brickHash(a)).toBe(brickHash(card({ sample: { name: 'Autre' } })))
  })
})

describe('custom:<id> in the edit plan', () => {
  it('a custom shot is checked as values (the brick checks them later); our templates keep naming their field', () => {
    expect(checkMotion({ template: 'custom:fiche-personnage', props: { name: 'Élise' } }, 4)).toEqual([])
    expect(checkMotion({ template: 'custom:Bad Id', props: {} }, 4).join()).toMatch(/custom:<id>/)
    expect(checkMotion({ template: 'custom:fiche-personnage', props: { name: 'Élise' } }, 45).join()).toMatch(/outside/)
    expect(checkMotion({ template: 'title', props: { title: 'x'.repeat(81) } }, 4).join()).toMatch(/props\.title/)
    const plan = {
      schema: EDITPLAN_SCHEMA,
      fps: 30,
      size: [1920, 1080],
      frames: 300,
      tracks: { base: ['s001'], overlay: ['b001'], labels: [] },
      captionsPreset: 'highlight',
      shots: [
        { id: 's001', track: 'base', startFrame: 0, endFrame: 300, kind: 'stock.photo', genItem: 'i', role: 'base', beat: 0 },
        { id: 'b001', track: 'overlay', startFrame: 30, endFrame: 150, kind: 'motion', role: 'scene', beat: 0, graphic: { template: 'custom:fiche-personnage', props: { name: 'Élise' } } }
      ],
      chapters: [],
      diagnostics: []
    }
    const parsed = EditPlan.parse(plan)
    expect(parsed.shots[1]?.graphic).toEqual({ template: 'custom:fiche-personnage', props: { name: 'Élise' }, accent: '#3B82F6', theme: 'dark' })
    const bad = EditPlan.safeParse({ ...plan, shots: [plan.shots[0], { ...plan.shots[1], graphic: { template: 'title', props: { title: '' } } }] })
    expect(bad.success ? '' : bad.error.issues.map((i) => i.path.join('.')).join()).toMatch(/shots\.1\.graphic\.props\.title/)
  })
})

describe('the sandboxed page of a brick', () => {
  it('carries a strict CSP whose nonce is on every script and nowhere else, and escapes the values where they land', () => {
    const b = card({ html: '<div class="name">{{name}}</div><img alt="{{role}}">' })
    const html = brickPage(b, { name: '<img src=x onerror=alert(1)>', role: '"><script>x()</script>', kicker: 'K', accent: '#F5B700' }, ctx, { accent: '#3B82F6', theme: 'dark' }, 'NONCE123')
    expect(html).toContain(`content="${brickCsp('NONCE123')}"`)
    expect(brickCsp('N')).toMatch(/default-src 'none'; script-src 'nonce-N'/)
    expect(brickCsp('N')).toMatch(/connect-src 'none'/)
    expect(brickCsp('N')).not.toMatch(/unsafe-eval|https?:/)
    const scripts = [...html.matchAll(/<script([^>]*)>/g)].map((m) => m[1])
    expect(scripts.length).toBe(4)
    for (const s of scripts) expect(s).toBe(' nonce="NONCE123"')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('alt="&quot;&gt;&lt;script&gt;x()&lt;/script&gt;"')
    // in the script, the values are JSON with every < escaped: nothing can close the <script>
    const config = /window\.__brickConfig = (.*?);\s*\(function/s.exec(html)?.[1] ?? ''
    expect(config).not.toContain('<')
    expect(JSON.parse(config).values.role).toBe('"><script>x()</script>')
    expect(html).toContain('--f-accent:#F5B700;')
    expect(html).toContain('atelierRenderAt')
    expect(html).toContain('window.atelierReady = true')
    expect(fillMarkup('<b>{{ n }}</b>', { n: 12000 })).toBe('<b>12000</b>')
  })
})
