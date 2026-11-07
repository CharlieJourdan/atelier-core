// equipe-3-chaines: Charlie's own message holds the order; each script sits under a line naming its channel.
import { describe, expect, it } from 'vitest'
import { headingChannel, parseOrder, titleOf } from '../../src/main/orchestra/orders/parse'

const CHANNELS = [
  { id: 1, name: 'marcel artisan' },
  { id: 2, name: 'Klaus vom Kundendienst' },
  { id: 3, name: 'Gaston le Compagnon' }
]

const MESSAGE = `@Atlas lance-moi 3 vidéos, une par chaîne, avec ces scripts.

## marcel artisan
Titre : « Purger ses radiateurs sans se tromper »
Votre radiateur est froid en haut ? Je m'appelle Marcel, et je vais vous montrer comment faire.
[PUB]
Premier geste : on coupe la chaudière.

**Script 2 — Klaus vom Kundendienst :**
Ihr Backofen heizt nicht mehr? Ich bin Klaus. [Werbung] Erstens: die Sicherung prüfen, bevor Sie etwas kaufen.

Gaston :
Une porte qui frotte, ça se répare en dix minutes. Je suis Gaston, compagnon charpentier. [PUB] D'abord on regarde les gonds.`

describe('the order in Charlie’s message', () => {
  it('finds one script per channel heading, word for word, markers kept; the title line is read', () => {
    const r = parseOrder(MESSAGE, CHANNELS)
    expect(r.problems).toEqual([])
    expect(r.items.map((i) => i.channelId)).toEqual([1, 2, 3])
    expect(r.items[0]!.title).toBe('Purger ses radiateurs sans se tromper')
    expect(r.items[0]!.script).toBe("Votre radiateur est froid en haut ? Je m'appelle Marcel, et je vais vous montrer comment faire.\n[PUB]\nPremier geste : on coupe la chaudière.")
    expect(r.items[1]!.script).toContain('[Werbung]')
    expect(r.items[2]!.title).toBeNull()
  })

  it('a sentence of the script that names the presenter is never a heading', () => {
    expect(headingChannel('Je m’appelle Marcel.', CHANNELS)).toBeNull()
    expect(headingChannel('Ich bin Klaus vom Kundendienst und heute zeige ich', CHANNELS)).toBeNull()
    expect(headingChannel('vom', CHANNELS)).toBeNull()
    expect(headingChannel('Chaîne : Gaston le Compagnon', CHANNELS)?.id).toBe(3)
    expect(headingChannel('### 1. MARCEL', CHANNELS)?.id).toBe(1)
  })

  it('says what is wrong instead of guessing', () => {
    expect(parseOrder('lance 3 vidéos', CHANNELS).problems[0]).toMatch(/aucun script/u)
    expect(parseOrder('Marcel\n\nok', CHANNELS).problems[0]).toMatch(/marcel artisan/u)
  })

  it('a title from the first sentence, without the marker', () => {
    expect(titleOf('[PUB] Votre radiateur est froid en haut ? Je vais vous montrer.')).toBe('Votre radiateur est froid en haut ?')
  })
})
