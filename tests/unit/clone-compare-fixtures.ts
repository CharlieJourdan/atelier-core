// Fixtures of chantier D's tests: a Style Definition of the definition's own defaults with a few measured fields.
import { withAtPath, type Sourced, type StyleDefinition } from '../../src/shared/clone'
import { definitionDefaults } from '../../src/main/production/clone/definition-defaults'

const measured = <T>(value: T): Sourced<T> => ({ value, source: 'measured', evidence: [{ video: 'v1', atS: 10, frames: [], note: 'fixture' }] })

/** Measured fields every test definition carries (a « motion story » channel). */
const BASE: Record<string, unknown> = {
  'editing.meanShotS': 2.7, 'editing.hookMeanShotS': 2.4, 'editing.holdMaxS': 4.5, 'sound.loudnessLufs': -14, 'voice.wordsPerMinute': 165, 'script.wordsPerMinute': 165
}

export function DEFINITION_DEFAULTS_FOR_TESTS(over: Record<string, unknown> = {}): StyleDefinition {
  let def: StyleDefinition = {
    schema: 'atelier.clone.style-definition/1', cloneId: 'c1', createdAt: 'now', version: 1,
    channel: { name: 'Fake channel', url: 'https://www.youtube.com/@fake', ownChannel: false, language: 'fr', styleId: null },
    ...definitionDefaults(),
    analysisMeasures: []
  }
  for (const [p, v] of Object.entries({ ...BASE, ...over })) def = withAtPath(def, p, measured(v))
  return def
}
