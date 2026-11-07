// Brick styles store (decision 0021, migration 029): the base styles pass the schema and are inserted once, a save is a
// new immutable version, `name` resolves to the latest and `name@n` to a given one, a style's family never changes,
// export / import round-trips, and an invalid document is refused with a French message.
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db'
import { BASE_STYLES, BrickStyleStore } from '../../src/main/production/styles'
import { SHIPPED_NOTE } from '../../src/main/production/styles/seeds'
import { BrickStyleSchema, type BrickStyle } from '../../src/shared/brick-styles'

function store(): { db: ReturnType<typeof openDatabase>; styles: BrickStyleStore } {
  const db = openDatabase(':memory:')
  return { db, styles: new BrickStyleStore(db) }
}

const custom = (over: Partial<BrickStyle> = {}): BrickStyle => ({
  $schema: 'atelier.brickstyle/1',
  id: 'night-desk',
  family: 'image',
  version: 1,
  label: 'Night desk',
  promptSuffix: 'Lit by a single desk lamp.',
  ...over
})

describe('base styles', () => {
  it('every seed passes the schema and carries version 1', () => {
    // style-markets ships the documentary's period archives style
    expect(BASE_STYLES.map((s) => s.id)).toEqual(['phone-real', 'clean-stock', 'presenter-studio', 'archive-real'])
    for (const s of BASE_STYLES) {
      expect(BrickStyleSchema.safeParse(s).success).toBe(true)
      expect(s.version).toBe(1)
    }
    expect(BASE_STYLES.find((s) => s.id === 'presenter-studio')?.references?.[0]).toMatchObject({ asset: 'presenter.portrait', use: 'always' })
  })

  it('are inserted once, as builtin version 1, and never touched again', () => {
    const { db, styles } = store()
    const first = styles.list()
    expect(first.map((s) => s.id).sort()).toEqual(['archive-real', 'clean-stock', 'phone-real', 'presenter-studio'])
    // vrais-tests (01/11): phone-real also ships a version 2 (the place of the sentence, indoors or outside) on top of version 1
    expect(first.every((s) => s.builtin && s.version === (s.id === 'phone-real' ? 2 : 1))).toBe(true)
    expect(first.find((s) => s.id === 'presenter-studio')?.family).toBe('presenter')
    styles.ensureBuiltins()
    styles.ensureBuiltins()
    styles.list()
    // four builtins (archive-real since style-markets) plus phone-real's version 2
    expect((db.prepare('SELECT COUNT(*) AS n FROM brick_style_versions').get() as { n: number }).n).toBe(5)
    expect(styles.get('phone-real').doc.promptSuffix).toMatch(/indoors or outside/)
    // An edited builtin keeps its new version; a re-run never rewrites version 1.
    styles.save({ doc: { ...BASE_STYLES[0], label: 'Mine' } })
    new BrickStyleStore(db).ensureBuiltins()
    expect(styles.get('phone-real').version).toBe(3)
    expect(styles.get('phone-real', 1).doc.label).toBe('Phone camera, real life')
  })

  it('a shipped update is added once, and never over an owner’s own version', () => {
    const { db, styles } = store()
    // reading applies the shipped updates: phone-real is at its shipped version 2
    expect(styles.get('phone-real').version).toBe(2)
    styles.save({ doc: { ...BASE_STYLES[0], label: 'Mine' } })
    const later = (base: BrickStyle) => ({ style: { ...base, promptSuffix: 'Later suffix.' }, note: `${SHIPPED_NOTE} (test)` })
    const fresh = new BrickStyleStore(db)
    fresh.ensureBuiltins(BASE_STYLES, [later(BASE_STYLES[0] as BrickStyle), later(BASE_STYLES[1] as BrickStyle)])
    fresh.ensureBuiltins(BASE_STYLES, [later(BASE_STYLES[0] as BrickStyle), later(BASE_STYLES[1] as BrickStyle)])
    // the owner's own version stays the latest; an untouched builtin takes the update, once
    expect(styles.get('phone-real')).toMatchObject({ version: 3, doc: { label: 'Mine' } })
    expect(styles.get('clean-stock')).toMatchObject({ version: 2, doc: { promptSuffix: 'Later suffix.', version: 2 } })
  })
})

describe('save and resolve', () => {
  it('a save makes a new version and the old one stays unchanged', () => {
    const { styles } = store()
    const v1 = styles.save({ doc: custom(), note: 'first' })
    expect(v1).toMatchObject({ id: 'night-desk', version: 1, builtin: false, docVersion: 1 })
    const v2 = styles.save({ doc: custom({ promptSuffix: 'Lit by two lamps.' }), note: 'second' })
    expect(v2.version).toBe(2)
    expect(v2.doc.version).toBe(2)
    expect(v2.versions.map((v) => [v.number, v.note])).toEqual([
      [2, 'second'],
      [1, 'first']
    ])
    const old = styles.get('night-desk', 1)
    expect(old.docVersion).toBe(1)
    expect(old.doc.promptSuffix).toBe('Lit by a single desk lamp.')
    expect(old.version).toBe(2)
  })

  it('resolves `name` to the latest version and `name@1` to the old one', () => {
    const { styles } = store()
    styles.save({ doc: custom() })
    styles.save({ doc: custom({ promptSuffix: 'Lit by two lamps.' }) })
    const latest = styles.resolve('night-desk')
    expect(latest).toMatchObject({ name: 'night-desk', version: 2, family: 'image' })
    expect(latest.doc.promptSuffix).toBe('Lit by two lamps.')
    expect(styles.resolve('night-desk@1').doc.promptSuffix).toBe('Lit by a single desk lamp.')
    expect(styles.resolve('phone-real@1').version).toBe(1)
  })

  it('refuses an unknown style, an unknown version and a bad reference in French', () => {
    const { styles } = store()
    expect(() => styles.resolve('nope')).toThrow(/Style introuvable/)
    expect(() => styles.resolve('phone-real@9')).toThrow(/Version de style introuvable/)
    expect(() => styles.resolve('Not A Ref')).toThrow(/Référence de style invalide/)
  })

  it('refuses a family change for an existing style', () => {
    const { styles } = store()
    styles.save({ doc: custom() })
    expect(() => styles.save({ doc: custom({ family: 'clip' }) })).toThrow(/sa famille ne change pas/)
    expect(() => styles.save({ doc: { ...BASE_STYLES[0], family: 'clip' } })).toThrow(/sa famille ne change pas/)
    expect(styles.get('night-desk').version).toBe(1)
  })

  it('refuses an invalid document with a French error', () => {
    const { styles } = store()
    expect(() => styles.save({ doc: { ...custom(), id: 'Bad Name' } })).toThrow(/Le style n’est pas valable/)
    expect(() => styles.save({ doc: { ...custom(), surprise: true } })).toThrow(/Le style n’est pas valable/)
    expect(() => styles.save({ doc: 'nope' })).toThrow(/Le style n’est pas valable/)
    expect(() => styles.save(null)).toThrow(/Style invalide/)
    expect(styles.list().some((s) => s.id === 'night-desk')).toBe(false)
  })
})

describe('export and import', () => {
  it('round-trips a style through its file', () => {
    const a = store()
    a.styles.save({ doc: custom() })
    a.styles.save({ doc: custom({ promptSuffix: 'Lit by two lamps.' }) })
    const file = a.styles.exportFile('night-desk')
    expect(file.fileName).toBe('night-desk.atelier-style.json')
    const b = store()
    const imported = b.styles.importFile(file.json)
    expect(imported).toMatchObject({ id: 'night-desk', version: 1, builtin: false })
    expect(imported.doc.promptSuffix).toBe('Lit by two lamps.')
    expect(b.styles.importFile(file.json).version).toBe(2)
    expect(a.styles.exportFile('night-desk', 1).json).toContain('single desk lamp')
  })

  it('refuses non-JSON, an oversized file and an invalid document', () => {
    const { styles } = store()
    expect(() => styles.importFile('{ not json')).toThrow(/pas du JSON/)
    expect(() => styles.importFile('x'.repeat(1_000_001))).toThrow(/Fichier de style invalide/)
    expect(() => styles.importFile(JSON.stringify({ id: 'x' }))).toThrow(/Le style n’est pas valable/)
  })
})

describe('migration 029', () => {
  it('adds the pins column to projects, empty by default', () => {
    const { db } = store()
    const cols = db.prepare('PRAGMA table_info(projects)').all() as { name: string; dflt_value: string | null }[]
    expect(cols.find((c) => c.name === 'pins_json')?.dflt_value).toBe("'{}'")
  })
})
