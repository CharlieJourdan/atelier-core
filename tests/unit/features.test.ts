// cloudStatus (PLAN-V2-PRODUCTION §4.12): a Cloud function is real only when the Cloud's catalogue says real AND the
// wallet holds credits; otherwise demo (or needs-credits). Until the client lot fetches the catalogue, the app passes none.
import { describe, expect, it } from 'vitest'
import { CLOUD_FUNCTIONS, FEATURES, NO_FEATURES, cloudStatus, featureState, type CloudCatalog, type FeatureContext } from '../../src/shared/features'

const ctx = (cloud: CloudCatalog | null): FeatureContext => ({ cloud, youtubeConnected: false })

describe('cloudStatus', () => {
  it('is real for a function the catalogue marks real when the wallet has credits', () => {
    const c = ctx({ functions: { 'voice-platform': 'real' }, hasCredits: true })
    expect(cloudStatus('voice-platform', c)).toBe('real')
    expect(featureState('voice-platform', c).status).toBe('real')
  })

  it('is needs-credits when the catalogue says real but the wallet is empty', () => {
    expect(cloudStatus('voice-platform', ctx({ functions: { 'voice-platform': 'real' }, hasCredits: false }))).toBe('needs-credits')
  })

  it('stays demo when the catalogue says demo or omits the function, whatever the credits', () => {
    const c = ctx({ functions: { 'voice-platform': 'demo' }, hasCredits: true })
    expect(cloudStatus('voice-platform', c)).toBe('demo')
    expect(cloudStatus('image-generation', c)).toBe('demo')
    expect(cloudStatus('voice-platform', ctx({ functions: {}, hasCredits: true }))).toBe('demo')
  })

  it('stays demo for every Cloud function while the app is not connected to a Cloud', () => {
    for (const id of CLOUD_FUNCTIONS) {
      expect(cloudStatus(id, NO_FEATURES), id).toBe('demo')
      expect(cloudStatus(id, ctx(null)), id).toBe('demo')
    }
  })

  it('only the functions the catalogue marks real change; the others stay demo', () => {
    const c = ctx({ functions: { avatar: 'real', 'gpu-render': 'real', 'stock-media': 'demo' }, hasCredits: true })
    const real = CLOUD_FUNCTIONS.filter((id) => cloudStatus(id, c) === 'real')
    expect(real).toEqual(['avatar', 'gpu-render'])
    // the registry entries for Cloud functions follow the same rule
    for (const id of CLOUD_FUNCTIONS) {
      const def = FEATURES.find((f) => f.id === id)
      expect(def, id).toBeDefined()
      expect(def!.status(c), id).toBe(cloudStatus(id, c))
    }
  })
})
