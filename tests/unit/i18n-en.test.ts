import { afterEach, describe, expect, it } from 'vitest'
import { en } from '../../src/shared/en'
import { fr, getLocale, setLocale, t } from '../../src/shared/fr'
import { frPBrain } from '../../src/shared/fr-p-brain'
import { frPHome } from '../../src/shared/fr-p-home'
import { frPOnboarding } from '../../src/shared/fr-p-onboarding'
import { frPPlanning } from '../../src/shared/fr-p-planning'
import { frPProduction } from '../../src/shared/fr-p-production'
import { frPShell } from '../../src/shared/fr-p-shell'
import { frPTeam } from '../../src/shared/fr-p-team'

const frStrings = fr as Record<string, string>
const enStrings = en as Record<string, string | undefined>

/** Keys owned by the parallel proto files: their English side is written by other engineers. */
const protoKeys = new Set<string>(
  [frPBrain, frPHome, frPOnboarding, frPPlanning, frPProduction, frPShell, frPTeam].flatMap((o) => Object.keys(o))
)

/** The sorted, de-duplicated `{name}` placeholders of a message. */
function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? ''))].sort()
}

describe('English catalogue', () => {
  afterEach(() => setLocale('fr'))

  it('only has keys that exist in French', () => {
    const unknown = Object.keys(en).filter((key) => !(key in fr))
    expect(unknown, `English keys without a French key: ${unknown.join(', ')}`).toEqual([])
  })

  it('keeps the same placeholders as the French message', () => {
    const mismatches: string[] = []
    for (const [key, text] of Object.entries(enStrings)) {
      if (text === undefined || !(key in frStrings)) continue
      const wanted = placeholders(frStrings[key] ?? '')
      const got = placeholders(text)
      if (wanted.join(',') !== got.join(',')) mismatches.push(`${key}: fr {${wanted.join(', ')}} vs en {${got.join(', ')}}`)
    }
    expect(mismatches, mismatches.join('\n')).toEqual([])
  })

  it('translates every French key, except the proto files', () => {
    const missing = Object.keys(fr).filter((key) => !protoKeys.has(key) && !(enStrings[key] ?? '').trim())
    expect(missing, `Missing English for ${missing.length} key(s):\n${missing.join('\n')}`).toEqual([])
  })

  it('switches t() between English and French', () => {
    setLocale('en')
    expect(getLocale()).toBe('en')
    expect(t('section.accueil')).toBe('Home')
    setLocale('fr')
    expect(getLocale()).toBe('fr')
    expect(t('section.accueil')).toBe('Accueil')
  })
})
