// « Les yeux » in the channel sheet: the profile form renders what the profile says, in French and English, and the panel only
// appears in real mode for a channel of the database (a demo channel keeps the demo Styles tab as it was).
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { en } from '../../src/shared/en'
import { fr, setLocale, t } from '../../src/shared/fr'
import { enEyes } from '../../src/shared/en-eyes'
import { frEyes } from '../../src/shared/fr-eyes'
import { buildStyleProfile } from '../../src/shared/style-profile'
import { TooltipProvider } from '../../src/renderer/components/ui/tooltip'
import { createProtoStore, initialState, ProtoProvider, type ProtoState } from '../../src/renderer/proto/store'
import { ProfileForm } from '../../src/renderer/screens/channels/ProfileForm'
import { StylesTab } from '../../src/renderer/screens/channels/StylesTab'
import { fixtureVideos } from './fixtures/eyes-analyses'

const noop = (): void => undefined
const PROFILE = buildStyleProfile(fixtureVideos(), { now: '2026-10-25T10:00:00.000Z', thumbnail: { traits: ['fond jaune', 'visage surpris'], face: true, layout: 'band' } })!

function withStore(el: ReactElement, overrides: Partial<ProtoState> = {}): string {
  const store = createProtoStore(initialState(overrides))
  return renderToStaticMarkup(
    <ProtoProvider store={store}>
      <TooltipProvider>{el}</TooltipProvider>
    </ProtoProvider>
  )
}

beforeEach(() => setLocale('fr'))

describe('the catalogues', () => {
  it('every French key of the eyes has an English one with the same placeholders, and none is empty', () => {
    for (const [key, text] of Object.entries(frEyes)) {
      expect(text.trim(), key).not.toBe('')
      const english = (en as Record<string, string | undefined>)[key]
      expect(english?.trim(), `en ${key}`).toBeTruthy()
      const holes = (s: string): string => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(',')
      expect(holes(english ?? ''), key).toBe(holes(text))
    }
    expect(Object.keys(enEyes).every((k) => k in fr)).toBe(true)
  })
})

describe('the profile form', () => {
  const html = (disabled = false): string => renderToStaticMarkup(<ProfileForm profile={PROFILE} onChange={noop} disabled={disabled} />)

  it('shows every field the production reads, with the profile’s values', () => {
    const h = html()
    expect(h).toContain('data-testid="profile-form"')
    for (const k of ['cuts', 'tempo', 'mix.stock', 'mix.generated', 'mix.footage', 'shots', 'captions', 'captionsPosition', 'hookPattern', 'hookSeconds', 'hookExample', 'structure', 'cta', 'tone', 'length', 'music', 'thumbTraits', 'thumbLayout', 'thumbFace']) {
      expect(h, k).toContain(t(`eyes.f.${k}` as never))
    }
    expect(h).toContain('value="16"') // cuts per minute
    expect(h).toContain('value="50"') // stock share, in percent
    expect(h).toContain('stock footage, animation, b-roll')
    expect(h).toContain('value="question"')
    expect(h).toContain('hook, body, outro')
    expect(h).toContain('fond jaune, visage surpris')
    expect(h).not.toMatch(/undefined|NaN|\[object Object\]/)
  })

  it('is read in English too, and can be locked while saving', () => {
    setLocale('en')
    const h = html(true)
    expect(h).toContain('Cuts per minute')
    expect(h).toContain('Hook type')
    expect(h).toContain('disabled=""')
  })
})

describe('the Styles tab of a channel', () => {
  const channel = (id: string) => ({ ...initialState().channels[0]!, id })
  const tab = (id: string, overrides: Partial<ProtoState>): string =>
    withStore(<StylesTab channel={channel(id)} pipelines={[]} mix={{}} onMix={noop} onRoute={noop} />, overrides)

  it('is the demo tab in demo mode, even for a channel of the database', () => {
    const h = tab('db-3', { mode: 'demo' })
    expect(h).toContain('data-testid="styles-tab"')
    expect(h).not.toContain('aria-busy')
    expect(h).not.toContain(t('eyes.title'))
  })

  it('adds the eyes in real mode for a channel of the database, and only for those', () => {
    expect(tab('db-3', { mode: 'live' })).toContain('aria-busy="true"') // the panel is loading its data
    expect(tab('ch-enigmes', { mode: 'live' })).not.toContain('aria-busy')
    expect(tab('db-x', { mode: 'live' })).not.toContain('aria-busy')
  })
})
