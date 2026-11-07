// equipe-3-chaines: an imported script with `[PUB]` → script.write@2 keeps it verbatim (marker never spoken) → script.sponsor puts the
// channel's OWN promo exactly on the marker, in the channel's language, whatever its placement setting says.
import { afterEach, describe, expect, it } from 'vitest'
import { Outline } from '../../src/engine/formats/outline'
import { scriptSponsor } from '../../src/engine/nodes/script-sponsor'
import { scriptWrite2 } from '../../src/engine/nodes/script-write2'
import { art, makeCtx, tempDir, testServices } from './engine-node-helpers'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
})
const work = (label: string): string => {
  const t = tempDir(label)
  cleanups.push(t.cleanup)
  return t.dir
}

const MARCEL_PROMO = ['type : promo', 'nom : Le Carnet de l’Artisan', 'lien : https://exemple-artisan.fr/?v=l02', 'site : exemple-artisan.fr', 'place : après l’accroche'].join('\n')
const KLAUS_PROMO = ['type : promo', 'nom : Das Küchengeräte-Werkbuch', 'lien : https://klaus-kundendienst.de', 'site : klaus-kundendienst.de', 'place : fin'].join('\n')

const FR = [
  'Votre chaudière fait du bruit la nuit ? Ce n’est pas normal, et ça peut vous coûter cher.',
  'Je m’appelle Marcel, artisan depuis quarante ans, et je vais vous montrer trois gestes.',
  '[PUB]',
  'Premier geste : on purge les radiateurs, du haut vers le bas, chaudière coupée.',
  'Deuxième geste : on vérifie la pression, entre un et un et demi bar.',
  'Troisième geste : on écoute la pompe. Dites-moi en commentaire ce que vous entendez chez vous.'
].join('\n\n')
const DE = [
  'Ihr Backofen heizt nicht mehr richtig? Bevor Sie einen neuen kaufen, hören Sie mir zwei Minuten zu.',
  'Ich bin Klaus, einundvierzig Jahre Kundendienst. [Werbung] Erstens: prüfen Sie die Sicherung im Sicherungskasten.',
  'Zweitens: das Heizelement. Drittens: der Temperaturfühler. Schreiben Sie mir, was bei Ihnen kaputt war.'
].join('\n\n')

async function run(script: string, promo: string, language: string) {
  const c = makeCtx(testServices(work('ad-marker')), { node: scriptWrite2 as never, minutes: 2 })
  const w = await scriptWrite2.fake(c, { pasted: art('text.input', { value: script }) }, scriptWrite2.params.parse({ language }) as never)
  const c2 = makeCtx(testServices(work('ad-marker-2')), { node: scriptSponsor as never, minutes: 2 })
  const r = await scriptSponsor.fake(c2, { script: art('text.script', w.text! as never), outline: art('json.outline', w.outline! as never), sponsor: art('text.input', { value: promo }) }, scriptSponsor.params.parse({ language, wpm: 170 }) as never)
  return { written: w.text!.value as string, text: r.text!.value as string, meta: r.text!.meta ?? {}, outline: Outline.parse(r.outline!.value) }
}

describe('the ad marker reaches the promo', () => {
  it('French: the marker is never spoken; the promo mention goes exactly where it stood (not after the hook setting)', async () => {
    const r = await run(FR, MARCEL_PROMO, 'fr')
    expect(r.written).not.toMatch(/PUB/u)
    const paras = r.text.split(/\n\s*\n/)
    expect(paras).toHaveLength(6)
    expect(paras[2]).toBe(r.outline.sponsor?.[0]?.text)
    expect(paras[2]).toContain('Le Carnet de l’Artisan')
    expect(paras[3]).toMatch(/^Premier geste/u)
    expect(r.outline.sponsor?.map((m) => m.kind)).toEqual(['mention'])
    expect(r.meta.promo).toBe('marker')
  })

  it('German, inline marker: the promo is written in German at the marker, the channel’s « end » setting ignored', async () => {
    const r = await run(DE, KLAUS_PROMO, 'de')
    const paras = r.text.split(/\n\s*\n/)
    const at = paras.findIndex((p) => p.includes('Küchengeräte-Werkbuch'))
    expect(paras[at - 1]).toMatch(/Kundendienst\.$/u)
    expect(paras[at + 1]).toMatch(/^Erstens/u)
    expect(paras[at]).toMatch(/Beschreibung/u)
    expect(r.text).not.toMatch(/Werbung\]/u)
  })

  it('his own words after the marker already name the offer: they are the slot, nothing is written', async () => {
    const own = FR.replace('[PUB]', '[PUB]\n\nPetite parenthèse : tout ça est dans Le Carnet de l’Artisan, sur exemple-artisan.fr.')
    const r = await run(own, MARCEL_PROMO, 'fr')
    expect(r.text.split(/\n\s*\n/)).toHaveLength(6)
    expect(r.outline.sponsor?.[0]?.text).toMatch(/^Petite parenthèse/u)
  })

  it('a marker on a channel with no promo: nothing placed, and a warning says why', async () => {
    const c = makeCtx(testServices(work('ad-marker-3')), { node: scriptWrite2 as never, minutes: 2 })
    const w = await scriptWrite2.fake(c, { pasted: art('text.input', { value: FR }) }, scriptWrite2.params.parse({ language: 'fr' }) as never)
    const r = await scriptSponsor.fake(c, { script: art('text.script', w.text! as never), outline: art('json.outline', w.outline! as never) }, scriptSponsor.params.parse({ language: 'fr' }) as never)
    expect(r.text!.value).toBe(w.text!.value)
    expect(JSON.stringify(r.text!.meta?.warnings)).toMatch(/marque une pub/u)
  })
})

describe('the promo card never stands still (a held card is a frozen picture, decision 0102)', () => {
  it('once landed, the whole card pushes in slowly to the end of its clip; a clip with no time left has no drift', async () => {
    const { promoHtml } = await import('../../src/engine/motion/promo')
    const { parseSponsor } = await import('../../src/engine/formats/sponsor')
    const card = parseSponsor(MARCEL_PROMO)!.promo!
    const long = promoHtml(card, { width: 1920, height: 1080, durationS: 20, fontCss: '' }, { visual: null, logo: null })
    const m = /class="drift" data-zoom data-at="([\d.]+)" data-dur="([\d.]+)" data-z0="1" data-z1="1.09"/u.exec(long)
    expect(m).not.toBeNull()
    expect(Number(m![1]) + Number(m![2])).toBeCloseTo(20, 1)
    expect(Number(m![1])).toBeLessThan(4)
    const short = promoHtml(card, { width: 1920, height: 1080, durationS: 3, fontCss: '' }, { visual: null, logo: null })
    expect(short).not.toMatch(/class="drift" data-zoom/u)
  })
})

describe('the promo card speaks the video’s language', () => {
  it('its two fixed lines follow the video when the channel left the French defaults; a line it wrote is kept', async () => {
    const { localCard } = await import('../../src/engine/formats/promo')
    const { parseSponsor } = await import('../../src/engine/formats/sponsor')
    const card = parseSponsor(KLAUS_PROMO)!.promo!
    expect(localCard(card, 'de')).toMatchObject({ qrCaption: 'Am Fernseher? Scannen Sie den Code mit dem Handy', linkLine: 'Link ganz oben in der Beschreibung' })
    expect(localCard(card, 'fr')).toEqual(card)
    const own = parseSponsor(`${KLAUS_PROMO}\nligne du lien : Link unten`)!.promo!
    expect(localCard(own, 'de').linkLine).toBe('Link unten')
  })
})
