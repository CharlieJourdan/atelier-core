// What a pipeline can show in the saved previews (production-15): the engines its picture, clip and presenter bricks use
// (pinned, fallbacks, and every engine its options can pick) and the styles they wear. Pure: no I/O.
import { engineFamilyOf } from '../../shared/cloud-engines'
import type { PreviewFamily } from '../../shared/previews'
import { BASE_PIPELINES, basePipeline } from './bases'
import type { RecipeDoc } from './recipe'
import type { TechnologyRegistry } from './registry'

export interface PreviewKey {
  key: string
  kind: 'engine' | 'style'
  family: PreviewFamily
}

const FAMILY: Readonly<Record<string, PreviewFamily>> = { image: 'image', clip: 'clip', presenter: 'presenter' }

/** `style:phone-real` for a style reference (`phone-real@3` → its name). */
export const styleKey = (style: string): string => `style:${style.replace(/@\d+$/, '')}`

function add(out: Map<string, PreviewKey>, k: PreviewKey): void {
  if (!out.has(k.key)) out.set(k.key, k)
}

function engineKey(id: unknown): PreviewKey | null {
  if (typeof id !== 'string') return null
  const fam = FAMILY[engineFamilyOf(id) ?? '']
  return fam ? { key: id, kind: 'engine', family: fam } : null
}

/** The previews of one pipeline, its own choices first, then what its options can switch to. */
export function previewKeysOf(doc: RecipeDoc, reg: TechnologyRegistry): PreviewKey[] {
  const out = new Map<string, PreviewKey>()
  for (const b of doc.bricks) {
    const fam = FAMILY[reg.get(b.tech)?.engineFamily ?? '']
    if (!fam) continue
    if (b.style) add(out, { key: styleKey(b.style), kind: 'style', family: fam })
    for (const e of [b.engine, ...b.fallbacks].map(engineKey)) if (e) add(out, e)
  }
  for (const o of basePipeline(doc.base)?.options ?? []) {
    const effects = o.kind === 'slider' ? o.effects : o.choices.flatMap((c) => c.effects)
    for (const op of effects) {
      const e = 'engine' in op ? engineKey(op.engine) : null
      if (e) add(out, e)
      const fb = 'fallbacks' in op && Array.isArray(op.fallbacks) ? op.fallbacks : []
      for (const f of fb.map(engineKey)) if (f) add(out, f)
    }
  }
  return [...out.values()]
}

/** Every preview the base pipelines can ask for, plus the styles given (the gallery the app ships). */
export function previewCatalog(reg: TechnologyRegistry, styles: readonly { id: string; family: string }[]): PreviewKey[] {
  const out = new Map<string, PreviewKey>()
  for (const b of BASE_PIPELINES) for (const k of previewKeysOf({ ...b.doc, base: b.id }, reg)) add(out, k)
  for (const s of styles) {
    const fam = FAMILY[s.family]
    if (fam) add(out, { key: styleKey(s.id), kind: 'style', family: fam })
  }
  return [...out.values()]
}
