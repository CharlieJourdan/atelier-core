// A long script is voiced in several calls (each provider caps the text of one request). The text is cut at paragraph,
// then sentence, then word boundaries so no word is split; the pieces joined with a space give back the same words.

const SENTENCE_END = /(?<=[.!?…。！？])\s+/u

/** Pieces of at most `max` characters, in order. Never returns an empty piece; a text of only blanks gives []. */
export function splitText(text: string, max: number): string[] {
  if (!(max >= 50)) throw new Error('max must be at least 50 characters')
  const pieces: string[] = []
  let current = ''
  const flush = (): void => {
    if (current.trim()) pieces.push(current.trim())
    current = ''
  }
  const add = (part: string): void => {
    if (current && current.length + 1 + part.length > max) flush()
    current = current ? `${current} ${part}` : part
  }
  for (const paragraph of text.split(/\n{2,}/)) {
    const p = paragraph.trim()
    if (!p) continue
    if (p.length <= max) {
      add(p)
      continue
    }
    for (const sentence of p.split(SENTENCE_END)) {
      if (sentence.length <= max) {
        add(sentence)
        continue
      }
      for (const word of sentence.split(/\s+/)) {
        // A single "word" longer than max (no blanks at all) is cut hard: it cannot be voiced anyway.
        for (let i = 0; i < word.length; i += max) add(word.slice(i, i + max))
      }
    }
  }
  flush()
  return pieces
}
