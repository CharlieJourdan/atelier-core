// Contrast of the text tokens (review A #10): what is read as text keeps WCAG AA (4.5:1) on every surface, and
// --fg-4, kept for disabled and decorative marks, keeps the 3:1 of non-text elements; the green accent (decision 0041)
// keeps AA as text and under the text drawn on it. Values are read from tokens.css.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')
const css = readFileSync(path.join(ROOT, 'src/renderer/styles/tokens.css'), 'utf8')

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  const vars: Record<string, string> = {}
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) vars[m[1]!] = m[2]!
  return vars
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const THEMES = { dark: block("[data-theme='dark']"), light: block("[data-theme='light']") }
const SURFACES = ['bg', 'surface-1', 'surface-2', 'surface-pop']

describe('text token contrast (WCAG)', () => {
  for (const [name, vars] of Object.entries(THEMES)) {
    it(`${name}: --fg, --fg-2, --fg-3 reach 4.5:1 and --fg-4 reaches 3:1 on every surface`, () => {
      for (const surface of SURFACES) {
        const bg = vars[surface]
        expect(bg, surface).toBeDefined()
        for (const fg of ['fg', 'fg-2', 'fg-3']) expect(contrast(vars[fg]!, bg!), `${fg} on ${surface}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(vars['fg-4']!, bg!), `fg-4 on ${surface}`).toBeGreaterThanOrEqual(3)
      }
    })
  }

  for (const [name, vars] of Object.entries(THEMES)) {
    it(`${name}: the green accent reads as text (--brand-fg, --ok) on every surface and under --brand-ink on its fill`, () => {
      for (const surface of SURFACES) {
        for (const fg of ['brand-fg', 'ok']) expect(contrast(vars[fg]!, vars[surface]!), `${fg} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrast(vars['brand-ink']!, vars.brand!), 'brand-ink on brand').toBeGreaterThanOrEqual(4.5)
      // the older pairing `bg-brand text-ink-fg` must hold too
      expect(contrast(vars['ink-fg']!, vars.brand!), 'ink-fg on brand').toBeGreaterThanOrEqual(4.5)
    })
  }

  it('no placeholder text is drawn in --fg-4', () => {
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(tsx?|css)$/.test(f)) files.push(p)
      }
    }
    walk(path.join(ROOT, 'src/renderer'))
    expect(files.length).toBeGreaterThan(10)
    expect(files.filter((f) => readFileSync(f, 'utf8').includes('placeholder:text-fg-4'))).toEqual([])
  })
})
