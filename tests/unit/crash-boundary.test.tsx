import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CrashBoundary } from '../../src/renderer/components/CrashBoundary'

describe('CrashBoundary', () => {
  it('turns a render error into a French screen with a way out, no stack, no English', () => {
    expect(CrashBoundary.getDerivedStateFromError()).toEqual({ crashed: true })
    const b = new CrashBoundary({ children: 'ok' })
    expect(renderToStaticMarkup(b.render() as never)).toBe('ok')
    b.state = { crashed: true }
    const html = renderToStaticMarkup(b.render() as never)
    expect(html).toContain('data-testid="crash-screen"')
    expect(html).toContain('Quelque chose s’est mal passé')
    expect(html).toContain('Recharger l’écran')
    expect(html).not.toMatch(/Error|undefined|at .*:\d+/)
  })
})
