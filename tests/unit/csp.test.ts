import { describe, expect, it } from 'vitest'
import { CSP_DEV, CSP_PROD } from '../../src/shared/csp'

describe('renderer CSP', () => {
  it('production is strict: no websocket, no inline styles, no plugins, base or forms', () => {
    expect(CSP_PROD).not.toMatch(/\bwss?:/)
    expect(CSP_PROD).not.toContain('unsafe-inline')
    expect(CSP_PROD).not.toContain('unsafe-eval')
    expect(CSP_PROD).toContain("object-src 'none'")
    expect(CSP_PROD).toContain("base-uri 'none'")
    expect(CSP_PROD).toContain("form-action 'none'")
    expect(CSP_PROD).toContain("default-src 'self'")
    expect(CSP_PROD).toContain("script-src 'self'")
  })

  it('only the dev policy keeps HMR and inline styles', () => {
    expect(CSP_DEV).toContain('ws://localhost:*')
    expect(CSP_DEV).toContain("style-src 'self' 'unsafe-inline'")
    expect(CSP_DEV).toContain("object-src 'none'")
  })
})
