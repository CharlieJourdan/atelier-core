// equipe-3-chaines: the owner marks where the ad goes in his own script; the marker is never spoken and names the slot.
import { describe, expect, it } from 'vitest'
import { cleanWithAdMarker, findAdParagraph } from '../../src/engine/text/ad-marker'
import { cleanScript } from '../../src/engine/text/lint'

const SCRIPT = [
  'Votre chaudière fait du bruit la nuit ? Ce n’est pas normal.',
  'Je m’appelle Marcel, artisan depuis quarante ans.',
  '[PUB]',
  'Premier geste : on purge les radiateurs, du haut vers le bas.',
  'Deuxième geste : on vérifie la pression, entre un et un et demi.'
].join('\n\n')

describe('ad marker in an imported script', () => {
  it('takes the marker out of the spoken text and names the paragraph it stood before', () => {
    const r = cleanWithAdMarker(SCRIPT, cleanScript)
    expect(r.text).not.toMatch(/PUB|ATELIER/u)
    expect(r.text.split('\n\n')).toHaveLength(4)
    expect(r.marker).toEqual({ paragraph: 2, anchor: 'Premier geste : on purge les radiateurs, du' })
    expect(r.extra).toBe(0)
  })

  it('reads the usual spellings in French, English and German, inline too (the paragraph is cut there)', () => {
    for (const m of ['[PUB]', '[pub ici]', '[[promo]]', '{AD}', '<<WERBUNG>>', '[Werbung hier]', '[publicité]', '[SPONSOR]', '[ad here]', '[Anzeige]']) {
      const r = cleanWithAdMarker(`Erster Satz der Einleitung. ${m} Zweiter Satz nach der Werbung.`, cleanScript)
      expect(r.marker?.paragraph, m).toBe(1)
      expect(r.text).toBe('Erster Satz der Einleitung.\n\nZweiter Satz nach der Werbung.')
    }
  })

  it('keeps the first marker only and counts the others (they are never spoken)', () => {
    const r = cleanWithAdMarker('Un. Deux.\n\n[PUB]\n\nTrois quatre.\n\n[PUB]\n\nCinq six.', cleanScript)
    expect(r.marker?.paragraph).toBe(1)
    expect(r.extra).toBe(1)
    expect(r.text).toBe('Un. Deux.\n\nTrois quatre.\n\nCinq six.')
  })

  it('a marker at the very end puts the ad after the last paragraph', () => {
    const r = cleanWithAdMarker('Un. Deux.\n\nTrois quatre.\n\n[PUB]', cleanScript)
    expect(r.marker).toEqual({ paragraph: 2, anchor: '' })
    expect(r.text).toBe('Un. Deux.\n\nTrois quatre.')
  })

  it('no marker: the text is the plain clean script', () => {
    const r = cleanWithAdMarker('Un texte [note] sans pub.\n\nFin.', cleanScript)
    expect(r.marker).toBeNull()
    expect(r.text).toBe(cleanScript('Un texte [note] sans pub.\n\nFin.'))
  })

  it('finds the marked paragraph again from its anchor after the text moved, else by its index', () => {
    const paragraphs = ['Intro ajoutée.', 'Votre chaudière fait du bruit.', 'Premier geste : on purge les radiateurs, du haut vers le bas.']
    expect(findAdParagraph(paragraphs, { paragraph: 1, anchor: 'Premier geste : on purge les radiateurs, du' })).toBe(2)
    expect(findAdParagraph(paragraphs, { paragraph: 1, anchor: 'Une phrase disparue' })).toBe(1)
    expect(findAdParagraph(paragraphs, { paragraph: 9, anchor: '' })).toBe(3)
  })
})
