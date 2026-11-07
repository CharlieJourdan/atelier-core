// The ad marker of an imported script (equipe-3-chaines): the owner writes `[PUB]` (or `[AD]`, `[WERBUNG]`…) where his channel's
// promo goes; the marker is never spoken, it cuts the paragraph there and names the slot `script.sponsor` puts the promo on.
// Pure: the caller gives the script cleaner (text/lint.ts `cleanScript`, which drops any other bracketed note).
import { anchorOf, parseScript } from './script'

/** One marker: brackets, braces or chevrons (once or twice) around a word for « ad » in French, English or German. */
export const AD_MARKER =
  /(?:\[\[?|\{\{?|<<?)\s*(?:pub|publicit[ée]|promo|annonce|ad|ads|advert|advertisement|werbung|anzeige|reklame|sponsor)(?:\s+(?:ici|here|hier))?\s*(?:\]\]?|\}\}?|>>?)/giu

/** Survives the cleaner (no bracket, no underscore, no Markdown) and is never a real word. */
const SLOT = 'ATELIERADSLOTQX'

export interface AdMarker {
  /** The promo goes before this paragraph of the clean text (its length: after the last one). */
  paragraph: number
  /** The first words of that paragraph (empty at the end), to find it again after a later step moved paragraphs. */
  anchor: string
}

/** The clean script without its ad markers, where the first one stood, and how many more were dropped. */
export function cleanWithAdMarker(raw: string, clean: (text: string) => string): { text: string; marker: AdMarker | null; extra: number } {
  let n = 0
  const marked = raw.replace(AD_MARKER, () => (n++ === 0 ? `\n\n${SLOT}\n\n` : '\n\n'))
  const text = clean(marked)
  if (n === 0) return { text, marker: null, extra: 0 }
  const paragraphs = text.split(/\n\s*\n/)
  const at = paragraphs.findIndex((p) => p.includes(SLOT))
  const kept = paragraphs.map((p) => p.replace(SLOT, '').replace(/\s+/g, ' ').trim()).filter((p) => p !== '')
  if (at < 0) return { text: kept.join('\n\n'), marker: null, extra: n - 1 }
  // paragraphs before the slot that were not empty: the slot's index in the kept list
  const before = paragraphs.slice(0, at).filter((p) => p.replace(SLOT, '').trim() !== '').length
  const next = kept[before] ?? ''
  const first = parseScript(next).sentences[0]?.text ?? ''
  return { text: kept.join('\n\n'), marker: { paragraph: before, anchor: first ? anchorOf(first) : '' }, extra: n - 1 }
}

const fold = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** The paragraph the marker named (pure): the one that starts with its anchor, else its index (clamped to the end). */
export function findAdParagraph(paragraphs: readonly string[], m: AdMarker): number {
  if (m.anchor) {
    const a = fold(m.anchor)
    const i = paragraphs.findIndex((p) => fold(p).startsWith(a))
    if (i >= 0) return i
  }
  return Math.min(Math.max(0, m.paragraph), paragraphs.length)
}

/** The marker as script meta (`adMarker`), or null from anything else. */
export function readAdMarker(v: unknown): AdMarker | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  return typeof o.paragraph === 'number' && typeof o.anchor === 'string' ? { paragraph: o.paragraph, anchor: o.anchor } : null
}
