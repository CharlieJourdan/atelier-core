// The bundled fonts (resources/fonts, OFL: Inter, and the promo's Oswald and Source Serif 4) as `@font-face` rules with the files
// embedded, so a motion page needs no file or network access.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type Face = [family: string, weight: number, file: string, style?: 'italic']
const INTER: Face[] = [
  ['Inter', 600, 'Inter-SemiBold.ttf'],
  ['Inter', 700, 'Inter-Bold.ttf']
]
/** The channel promo's faces (promo-motion): Oswald for the condensed titles, Source Serif 4 for its serif line, Inter beside. */
const PROMO: Face[] = [...INTER, ['Oswald', 600, 'Oswald-SemiBold.ttf'], ['Oswald', 700, 'Oswald-Bold.ttf'], ['Source Serif 4', 400, 'SourceSerif4-Regular.ttf']]
const cache = new Map<string, Promise<string>>()

function cssOf(libraryRoot: string, set: string, faces: readonly Face[], optional: readonly Face[] = []): Promise<string> {
  const key = `${set}:${libraryRoot}`
  let css = cache.get(key)
  if (!css) {
    // a face in `optional` that is not in the library is left out (the page then draws the nearest face it has)
    const rule = async ([family, weight, file, style]: Face, must: boolean): Promise<string> => {
      const data = await readFile(path.join(libraryRoot, 'fonts', file)).catch((e: unknown) => {
        if (must) throw e
        return null
      })
      return data ? `@font-face{font-family:'${family}';font-weight:${weight};font-style:${style ?? 'normal'};src:url(data:font/ttf;base64,${data.toString('base64')}) format('truetype')}` : ''
    }
    css = Promise.all([...faces.map((x) => rule(x, true)), ...optional.map((x) => rule(x, false))]).then((rules) => rules.filter(Boolean).join('\n'))
    cache.set(key, css)
    css.catch(() => cache.delete(key))
  }
  return css
}

/** The CSS of the bundled Inter under `<library>/fonts`; read once per library folder. */
export const fontCssOf = (libraryRoot: string): Promise<string> => cssOf(libraryRoot, 'inter', INTER)

/** The CSS of the promo's faces (Inter, Oswald, Source Serif 4); read once per library folder. */
export const promoFontCssOf = (libraryRoot: string): Promise<string> => cssOf(libraryRoot, 'promo', PROMO)

/**
 * The documentary cards' faces: Inter, Oswald (the condensed data titles) and Source Serif 4 (the serif of names, labels and punches).
 * The serif's italic and semibold files are optional: a library without them gets the browser's synthetic italic and the regular
 * weight, so the cards still draw (resources/fonts/README.md says where to fetch them).
 */
const DOC_SERIF: Face[] = [
  ['Source Serif 4', 400, 'SourceSerif4-Italic.ttf', 'italic'],
  ['Source Serif 4', 600, 'SourceSerif4-SemiBold.ttf'],
  // the POV cards' rounded geometric ExtraBold (formats/pov.ts; the captions of story-short@1 use the same file)
  ['Montserrat', 800, 'Montserrat-ExtraBold.ttf']
]
export const docFontCssOf = (libraryRoot: string): Promise<string> => cssOf(libraryRoot, 'doc', PROMO, DOC_SERIF)

// ---- the paper looks' display serif (motion look, look.ts) ------------------------------------------------------------------------------

/** The folder of an installed package (`node_modules/<name>` above this module or the process's folder), or null. */
function packageDir(name: string): string | null {
  for (const start of [path.dirname(fileURLToPath(import.meta.url)), process.cwd()]) {
    for (let dir = start; ; dir = path.dirname(dir)) {
      const at = path.join(dir, 'node_modules', ...name.split('/'))
      if (existsSync(path.join(at, 'package.json'))) return at
      if (path.dirname(dir) === dir) break
    }
  }
  return null
}
let serifCache: Promise<string> | null = null
/**
 * Instrument Serif (OFL, the `@fontsource/instrument-serif` dependency), upright and italic, as embedded `@font-face` rules: the display face
 * of the period look. '' when the package is not there (the page then draws Source Serif 4).
 */
export function lookFontCss(): Promise<string> {
  serifCache ??= (async () => {
    const dir = packageDir('@fontsource/instrument-serif')
    if (!dir) return ''
    const rules = await Promise.all(
      (['normal', 'italic'] as const).map(async (style) => {
        const data = await readFile(path.join(dir, 'files', `instrument-serif-latin-400-${style}.woff2`)).catch(() => null)
        return data ? `@font-face{font-family:'Instrument Serif';font-weight:400;font-style:${style};src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2')}` : ''
      })
    )
    return rules.filter(Boolean).join('\n')
  })()
  serifCache.catch(() => (serifCache = null))
  return serifCache
}
