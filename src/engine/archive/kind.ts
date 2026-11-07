// Best guess of what a picture is, from the words an archive gives (categories, title, subjects, classification).
import type { ArchiveKind } from './types.ts'

const MAP = /\b(maps?|atlas(es)?|cartograph\w*|nautical charts?|plan of)\b/i
const PAINTING = /\b(paintings?|oil on|engravings?|etchings?|lithographs?|woodcuts?|drawings?|watercolou?rs?|illustrations?|prints?|frescos?|portraits? of)\b/i
const DOCUMENT = /\b(documents?|newspapers?|letters?|manuscripts?|posters?|certificates?|front pages?|banknotes?|stock certificates?|treaties|pamphlets?|broadsides?)\b/i
const PHOTO = /\b(photographs?|photos?|photography|daguerreotypes?|snapshots?|stereographs?)\b/i

export function guessKind(...texts: Array<string | undefined>): ArchiveKind {
  const t = texts.filter(Boolean).join(' | ')
  if (MAP.test(t)) return 'map'
  if (PAINTING.test(t)) return 'painting'
  if (DOCUMENT.test(t)) return 'document'
  if (PHOTO.test(t)) return 'photo'
  return 'other'
}
