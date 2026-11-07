// P0 intake — real phrasings a new user types (found on the beta, 2026-11-04): every natural answer to each question must be
// understood, and when it cannot be, the agent asks again with simple choices (never a bare « ça ne change rien »).
import { describe, expect, it } from 'vitest'
import { intakeTurn, startIntake } from '../../src/main/production/clone/intake/conversation'
import { changeLines } from '../../src/main/production/clone/intake/change-lines'
import { budgetIn, understand } from '../../src/main/production/clone/intake/parse'
import { frClone, tc } from '../../src/shared/fr-clone'
import { enClone } from '../../src/shared/en-clone'
import type { IntakeField, IntakeState } from '../../src/shared/clone'

const NONE = { face: false, voice: false, footage: false }
const ALL = { face: true, voice: true, footage: true }
const inputs = (m: string) => ({ face: false, voice: false, footage: false, ...understand(m, 'humanInputs').humanInputs })
const said = (m: string) => Object.keys(understand(m, 'humanInputs').humanInputs).length

describe('what he can supply — the question « Peux-tu fournir ton visage, ta voix ou des images ? »', () => {
  const table: [string, { face: boolean; voice: boolean; footage: boolean }][] = [
    ['non', NONE], ['Non.', NONE], ['non merci', NONE], ['rien', NONE], ['aucun', NONE], ['pas encore', NONE], ['nope', NONE], ['nan', NONE],
    ['Je ne fournis rien : ni visage, ni voix, ni images.', NONE],
    ['Non, mets des provisoires.', NONE], ['mets des provisoires', NONE], ['des provisoires feront l’affaire', NONE],
    ['je n’ai rien', NONE], ['je n\'ai rien du tout', NONE], ['pas du tout', NONE], ['je ne peux rien fournir', NONE], ['ni l’un ni l’autre', NONE],
    ['ni visage ni voix ni images', NONE], ['tu choisis, je ne fournis rien', NONE], ['sans rien, tu mets ce que tu veux', NONE],
    ['j’ai ma voix mais pas mon visage', { face: false, voice: true, footage: false }],
    ['oui, j’ai des rushs', { face: false, voice: false, footage: true }],
    ['oui j’ai mes images', { face: false, voice: false, footage: true }],
    ['ma voix seulement', { face: false, voice: true, footage: false }],
    ['juste mon visage', { face: true, voice: false, footage: false }],
    ['mon visage et ma voix', { face: true, voice: true, footage: false }],
    ['mon visage et ma voix, mais pas d’images', { face: true, voice: true, footage: false }],
    ['je fournis ma voix et mes rushs, pas mon visage', { face: false, voice: true, footage: true }],
    ['oui, tout', ALL], ['oui', ALL], ['tout', ALL], ['les trois', ALL], ['je peux tout fournir', ALL],
    ['oui mais pas mon visage', { face: false, voice: true, footage: true }],
    ['tout sauf ma voix', { face: true, voice: false, footage: true }],
    ['rien sauf ma voix', { face: false, voice: true, footage: false }],
    ['no', NONE], ['nothing', NONE], ['none', NONE], ['I have nothing, use placeholders', NONE], ['I don’t provide anything', NONE],
    ['neither my face nor my voice', NONE], ['no face, no voice, no footage', NONE],
    ['yes, I have my own footage', { face: false, voice: false, footage: true }],
    ['I can give my voice but not my face', { face: false, voice: true, footage: false }],
    ['my voice only', { face: false, voice: true, footage: false }],
    ['yes, everything', ALL], ['all three', ALL], ['yes', ALL]
  ]
  it.each(table)('« %s »', (message, expected) => {
    expect(said(message), 'was it understood?').toBeGreaterThan(0)
    expect(inputs(message)).toEqual(expected)
  })

  it('an unrelated remark is NOT guessed: the agent asks again with choices', () => {
    for (const m of ['hmm', 'je ne sais pas trop', 'ça dépend du jour', 'merci !']) expect(said(m), m).toBe(0)
  })

  it('unprompted, only an input he clearly offers counts', () => {
    expect(understand('je peux fournir ma voix', null).humanInputs).toEqual({ voice: true })
    expect(understand('copie cette chaîne, rien de spécial', null).humanInputs).toEqual({})
    expect(understand('garde la voix de la chaîne', null).humanInputs).toEqual({})
  })
})

const at = (asked: IntakeField): IntakeState => ({ ...startIntake(), asked })
const ready = (): IntakeState => {
  let s = startIntake()
  for (const m of ['copie https://www.youtube.com/@finary', 'en français', '5 $']) s = intakeTurn(s, m).state
  return s
}

describe('through the conversation', () => {
  it('« Je ne fournis rien… » settles the question and the brief is ready', () => {
    const t = intakeTurn(ready(), 'Je ne fournis rien : ni visage, ni voix, ni images.')
    expect(t.state.draft.humanInputs).toEqual(NONE)
    expect(t.ready).toBe(true)
    expect(t.reply.map((r) => r.key)).not.toContain('clone.intake.reply.nochange')
  })
  it('« Non, mets des provisoires. » settles it too', () => {
    const t = intakeTurn(ready(), 'Non, mets des provisoires.')
    expect(t.state.draft.humanInputs).toEqual(NONE)
    expect(t.ready).toBe(true)
  })
  it('when it cannot tell, it asks again with simple choices — never « ça ne change rien » (and the start is not held)', () => {
    const t = intakeTurn(ready(), 'hmm je sais pas')
    // decision 0110: what he supplies has a safe default (placeholders), so the brief can start while the question stays open
    expect(t.ready).toBe(true)
    expect(t.reply[0]!.key).toBe('clone.intake.reply.unclear.humanInputs')
    const text = tc(t.reply[0]!.key)
    expect(text).toMatch(/provisoires/)
    expect(text).not.toMatch(/ne change rien/)
    expect(t.question).toBe('clone.intake.q.humanInputs')
  })
  it('every question has its own « I did not understand » with choices, in French and English', () => {
    for (const f of ['intent', 'references', 'language', 'sourceLanguage', 'testBudgetUsd', 'humanInputs'] as const) {
      expect(frClone[`clone.intake.reply.unclear.${f}`], f).toBeTruthy()
      expect(enClone[`clone.intake.reply.unclear.${f}`], f).toBeTruthy()
    }
  })
})

describe('no change line shows an internal name', () => {
  const lines = (from: IntakeState, m: string) => changeLines(intakeTurn(from, m).changes)
  it('what he supplies is said in plain French', () => {
    expect(lines(ready(), 'Je ne fournis rien : ni visage, ni voix, ni images.')).toEqual(['Tu ne fournis ni visage, ni voix, ni images : je mettrai des provisoires.'])
    expect(lines(ready(), 'ma voix mais pas mon visage')).toEqual(['Tu fournis ta voix ; pour le reste je mettrai des provisoires.'])
    expect(lines(ready(), 'oui, tout')).toEqual(['Tu fournis ton visage, ta voix et tes images.'])
  })
  it('across a whole conversation no line carries a field name, an enum or a raw code', () => {
    let s = startIntake()
    const out: string[] = []
    for (const m of ['je veux traduire https://www.youtube.com/@finary de l’anglais vers le français', '10 euros', 'ma voix mais pas mon visage', 'le style : documentaire sombre']) {
      const t = intakeTurn(s, m); s = t.state; out.push(...changeLines(t.changes))
    }
    const all = out.join('\n')
    for (const bad of ['humanInputs', 'testBudgetUsd', 'sourceLanguage', 'references', 'translate', 'copy-channel', '…', 'none']) expect(all, bad).not.toContain(bad)
    expect(out.length).toBeGreaterThanOrEqual(5)
  })
})

describe('the other questions of P0', () => {
  const intent = (m: string, asked: IntakeField | null = 'intent') => understand(m, asked).intent
  it.each<[string, string]>([
    ['je veux copier une chaîne', 'copy-channel'], ['clone cette chaîne', 'copy-channel'], ['une chaîne', 'copy-channel'], ['la chaîne', 'copy-channel'],
    ['juste cette vidéo', 'copy-video'], ['une seule vidéo', 'copy-video'], ['une vidéo', 'copy-video'],
    ['traduire', 'translate'], ['je veux la traduction', 'translate'], ['faire le doublage', 'translate'],
    ['m’inspirer', 'inspiration'], ['juste de l’inspiration', 'inspiration'], ['mélanger deux chaînes', 'mix'], ['je veux fusionner', 'mix'],
    ['c’est pour ma chaîne', 'own-channel'], ['ma propre chaîne', 'own-channel'],
    ['copy this channel', 'copy-channel'], ['I want to clone a channel', 'copy-channel'], ['one video only', 'copy-video'], ['just this video', 'copy-video'],
    ['translate it', 'translate'], ['dub it', 'translate'], ['I want inspiration', 'inspiration'], ['mix two channels', 'mix'], ['it is my own channel', 'own-channel'], ['my channel', 'own-channel']
  ])('intent « %s »', (m, want) => expect(intent(m)).toBe(want))

  it.each<[string, string]>([
    ['français', 'fr'], ['le français', 'fr'], ['en français', 'fr'], ['en francais svp', 'fr'], ['Anglais', 'en'], ['en anglais', 'en'], ['espagnol', 'es'], ['allemand', 'de'],
    ['french', 'fr'], ['in English', 'en'], ['Spanish please', 'es'], ['german', 'de'], ['FR', 'fr'], ['en', 'en'], ['japonais', 'ja'], ['portuguese', 'pt']
  ])('language « %s »', (m, want) => expect(understand(m, 'language').language).toBe(want))

  it('translation direction in French and English', () => {
    expect(understand('from English to French', null)).toMatchObject({ sourceLanguage: 'en', language: 'fr' })
    expect(understand('translate it into Spanish', null).language).toBe('es')
    expect(understand('anglais', 'sourceLanguage').sourceLanguage).toBe('en')
  })

  it.each<[string, number, boolean?]>([
    ['5 $', 5], ['8 dollars', 8], ['5 à 10 $', 10], ['5-10 $', 10], ['10 euros', 10.8, true], ['10€', 10.8, true], ['$5', 5], ['€10', 10.8, true], ['5 bucks', 5], ['cinq dollars', 5], ['dix euros', 10.8, true],
    ['pas plus de 20', 20], ['20 maximum', 20], ['environ 15', 15], ['7', 7], ['5,5 $', 5.5], ['up to 12', 12], ['ten dollars', 10], ['15 balles', 15]
  ])('budget « %s »', (m, usd, euro) => {
    const u = understand(m, 'testBudgetUsd')
    expect(u.budgetUsd).toBe(usd)
    expect(u.euro).toBe(!!euro)
  })
  it('a link’s digits and a bare number outside the question are not a budget', () => {
    expect(understand('https://www.youtube.com/watch?v=abc123 en 5 minutes', null).budgetUsd).toBeNull()
    expect(budgetIn('8', false)).toBeNull()
  })
  it('a budget he does not give is asked again with examples', () => {
    const t = intakeTurn({ ...ready(), draft: { ...ready().draft, testBudgetUsd: null }, asked: 'testBudgetUsd' }, 'je ne sais pas')
    expect(t.reply[0]!.key).toBe('clone.intake.reply.unclear.testBudgetUsd')
    expect(tc(t.reply[0]!.key)).toMatch(/\$/)
  })

  it('style: a pick, « you choose » in both languages', () => {
    expect(understand('le style : documentaire sombre', null).style).toBe('documentaire sombre')
    expect(understand('peu importe', 'style').style).toBeNull()
    expect(understand('you choose', 'style').style).toBeNull()
    expect(understand('no preference', 'style').style).toBeNull()
    expect(understand('garde le même style', null).style).toBeUndefined()
  })

  it('a wrong-field answer never wipes the draft', () => {
    const t = intakeTurn(at('language'), 'bof')
    expect(t.changes).toEqual([])
    expect(t.reply[0]!.key).toBe('clone.intake.reply.unclear.language')
  })
})

describe('review fixes: innocent sentences never flip a settled answer', () => {
  const settled = (): IntakeState => intakeTurn(ready(), 'mon visage et ma voix').state
  const keep = (m: string) => expect(intakeTurn(settled(), m).state.draft, m).toMatchObject({ humanInputs: { face: true, voice: true, footage: false }, language: 'fr' })
  it.each(['je n’ai pas de chaîne', 'je n’ai pas de budget', 'ma voix est en anglais', 'yes, my voice in English', 'I can redo the intro myself', 'no translation needed'])('« %s »', keep)
  it('asked: sentences that merely mention an item are not answers', () => {
    for (const m of ['la voix est trop robotique', 'Les vidéos de la chaîne sont en anglais', 'oui, aucun souci']) {
      const r = understand(m, 'humanInputs').humanInputs
      expect(m.startsWith('oui') ? r : r, m).toEqual(m.startsWith('oui') ? ALL : {})
    }
    expect(said('je préfère ne pas montrer mon visage')).toBe(0)
    expect(inputs('mes vidéos perso')).toEqual({ face: false, voice: false, footage: true })
  })
  it('budget does not read a stray digit, and a long message is capped', () => {
    for (const m of ['20 minutes max par vidéo', 'en 10 jours', 'la chaîne de 2 millions d’abonnés', '2024']) expect(understand(m, 'testBudgetUsd').budgetUsd, m).toBeNull()
    const t = Date.now(); understand(' '.repeat(50000) + 'x', 'humanInputs'); expect(Date.now() - t).toBeLessThan(1500)
  })
})
