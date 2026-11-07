// Building ffmpeg filter graphs safely. A file path inside a filter option goes through two parsers (the graph, then
// the filter's options): it is single-quoted for the graph (so `,` `;` `[` `]` and spaces are plain), `\` becomes `/`
// (ffmpeg accepts it on Windows), `:` is escaped for the options and an inner `'` is closed, escaped and reopened.
// Text drawn on screen always goes through a `textfile`, never inline.
// A filter opens its files itself (libass for `ass` and its `fontsdir`, FreeType for `fontfile`), through the C library:
// on Windows that stops at MAX_PATH (260 characters) where ffmpeg's own inputs (`-i`) do not, so a deep artefact path
// fails there (« Could not create a libass track »). Such a path is copied to a short temp folder first (withShortPaths).
import { cp, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EngineError } from '../errors'

/** A path usable as a filter option value (fontfile=, textfile=, ass=, fontsdir=), on Windows and POSIX. */
export function filterPath(p: string): string {
  const escaped = p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\\\\\''")
  return `'${escaped}'`
}

/** The longest path a filter gets as is: under MAX_PATH with room for the font names libass adds under a `fontsdir`. */
export const FILTER_PATH_MAX = 200

/**
 * Runs `use` with `short`, which gives each of `paths` (files or folders a filter will open) at a length every filter
 * opens: a path of at most `max` characters as is, a longer one as a copy in a fresh folder under the system's temp
 * folder, removed when `use` ends or fails. Same rule on every system (the copy is small and only for long paths, so
 * the Mac behaves like Windows). Null entries are skipped; asking `short` for a path not listed is a bug and throws.
 */
export async function withShortPaths<T>(
  paths: readonly (string | null | undefined)[],
  use: (short: (p: string) => string) => Promise<T>,
  o: { max?: number; tmpRoot?: string } = {}
): Promise<T> {
  const max = o.max ?? FILTER_PATH_MAX
  const short = new Map<string, string>()
  let tmp: string | null = null
  try {
    for (const p of paths) {
      if (!p || short.has(p)) continue
      if (p.length <= max) {
        short.set(p, p)
        continue
      }
      tmp ??= await mkdtemp(path.join(o.tmpRoot ?? os.tmpdir(), 'atelier-f-'))
      const copy = path.join(tmp, `${short.size}${path.extname(p)}`)
      await cp(p, copy, { recursive: true })
      short.set(p, copy)
    }
    return await use((p) => {
      const s = short.get(p)
      if (s === undefined) throw new EngineError('internal', `filter path not prepared: ${p}`)
      return s
    })
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true })
  }
}

/** Splits `text` into lines of at most `max` characters, at spaces (a longer word stays whole). */
export function wrapText(text: string, max: number, maxLines = 4): string[] {
  const lines: string[] = []
  let cur = ''
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + w.length > max) {
      lines.push(cur)
      cur = w
    } else cur = cur ? `${cur} ${w}` : w
  }
  if (cur) lines.push(cur)
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    kept[maxLines - 1] = `${(kept[maxLines - 1] as string).replace(/\s+\S*$/, '')} …`
    return kept
  }
  return lines
}

/** `#RRGGBB` → `0xRRGGBB` (ffmpeg colour). */
export const ffColour = (hex: string): string => `0x${hex.replace(/^#/, '')}`
