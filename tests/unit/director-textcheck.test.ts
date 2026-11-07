// The on-screen text check (src/engine/nodes/director-textcheck.ts): the rules (numbers said in digits or words, names,
// quotations in the script's own words), what each failure does (a label removed, a frame's caption blanked, a card left out), and the
// evidence pass (a supported text must quote the script; a doubt gets a second look; a rewrite must pass the rules).
import { describe, expect, it } from 'vitest'
import type { Directive } from '../../src/engine/formats/directives'
import { checkScreenTexts, copiedFromSource, numbersOf, ruleProblems, screenTexts, textSource } from '../../src/engine/nodes/director-textcheck'
import { makeCtx } from './engine-node-helpers'

const SCRIPT =
  'Jeudi 24 octobre 1929, à Wall Street. Ce jour-là, près de 13 millions d’actions changent de main. Un record. ' +
  'Leur émissaire, Richard Whitney, achète des actions U.S. Steel. Il faudra attendre 1954, vingt-cinq ans, pour qu’il retrouve son sommet. ' +
  'L’indice Dow Jones perd 89 % de sa valeur.'
const src = textSource(SCRIPT)
const d = (over: Partial<Directive>): Directive => ({ sentence: 1, anchor: 'Wall Street', kind: 'imageAi', subject: 'the stock exchange', why: 'named', ...over })

describe('the rules', () => {
  it('reads numbers as written: groups, decimals, scales', () => {
    expect(numbersOf('13 000 000 actions')).toEqual([13000000])
    expect(numbersOf(`13${String.fromCharCode(0x202f)}000${String.fromCharCode(0xa0)}000 actions`)).toEqual([13000000])
    expect(numbersOf('13 millions')).toEqual([13, 13000000])
    expect(numbersOf('1,5 million')).toEqual([1.5, 1500000])
    expect(numbersOf('89 %')).toEqual([89])
  })

  it('a number is said in digits, in words, or with its scale', () => {
    expect(ruleProblems({ text: '13 000 000 actions', quote: false }, src)).toEqual([])
    expect(ruleProblems({ text: '25 ans', quote: false }, src)).toEqual([])
    expect(ruleProblems({ text: '−89 %', quote: false }, src)).toEqual([])
    expect(ruleProblems({ text: '16 millions', quote: false }, src)).toEqual(['the number 16 is not in the script', 'the number 16000000 is not in the script'])
    expect(ruleProblems({ text: 'Octobre 1930', quote: false }, src)).toEqual(['the number 1930 is not in the script'])
    // a chart of « perd 89 % » draws its whole and what is left
    expect(ruleProblems({ text: '100 %', quote: false }, src)).toEqual([])
    expect(ruleProblems({ text: '11 %', quote: false }, src)).toEqual([])
    expect(ruleProblems({ text: '12 %', quote: false }, src)).toEqual(['the number 12 is not in the script'])
  })

  it('a caption’s capital first word and a text in capitals are not names', () => {
    expect(ruleProblems({ text: 'Employés de bourse', quote: false }, src)).toEqual([])
    expect(ruleProblems({ text: 'LE DOW JONES EN CHUTE', quote: false }, src)).toEqual([])
    expect(ruleProblems({ text: 'Siège de J.P. Morgan', quote: false }, src)).toEqual(['« J.P » is not in the script', '« Morgan » is not in the script'])
  })

  it('a name must be in the script; a quotation must be its own words in order', () => {
    expect(ruleProblems({ text: 'Richard Whitney', quote: false }, src)).toEqual([])
    expect(ruleProblems({ text: 'Thomas Lamont', quote: false }, src)).toEqual(['« Thomas » is not in the script', '« Lamont » is not in the script'])
    expect(ruleProblems({ text: 'près de 13 millions d’actions changent de main', quote: true }, src)).toEqual([])
    expect(ruleProblems({ text: 'les actions changent de main', quote: true }, src)).toEqual(['a quotation that is not the script’s own words'])
    expect(ruleProblems({ text: 'Il a dit « un record absolu »', quote: false }, src)).toEqual(['a quotation that is not the script’s own words'])
    expect(copiedFromSource('Un record', src)).toBe(true)
    expect(copiedFromSource('Record historique', src)).toBe(false)
  })

  it('collects every on-screen text of the directives, but not an archive’s credit', () => {
    const texts = screenTexts([
      d({ text: '24 octobre 1929' }),
      d({ kind: 'archive', frame: { frame: 'board', label: 'Wall Street', lines: ['Panique'], source: 'Library of Congress' } }),
      d({ kind: 'motion.bars', card: { template: 'bars', props: { title: 'Le Dow Jones', bars: [{ label: '1929', value: 381, on: 'sommet' }, { label: '1932', value: 41 }] } } })
    ])
    expect(texts.map((t) => [t.key, t.text])).toEqual([
      ['0:text', '24 octobre 1929'],
      ['1:frame.label', 'Wall Street'],
      ['1:frame.lines.0', 'Panique'],
      ['2:card.props.title', 'Le Dow Jones'],
      ['2:card.props.bars.0.label', '1929'],
      ['2:card.props.bars.0.value', '381'],
      ['2:card.props.bars.1.label', '1932'],
      ['2:card.props.bars.1.value', '41']
    ])
  })
})

describe('what a failed text does', () => {
  it('rules mode: a label goes, a frame field goes, a card is left out; supported texts stay; the input is not changed', async () => {
    const input = [
      d({ text: '13 millions d’actions' }),
      d({ text: 'Octobre 1930' }),
      d({ kind: 'archive', frame: { frame: 'board', label: 'Wall Street', sub: 'Thomas Lamont' } }),
      d({ kind: 'motion.bars', card: { template: 'bars', props: { title: 'Le Dow Jones', bars: [{ label: '1929', value: 381 }] } } })
    ]
    const diag: string[] = []
    const r = await checkScreenTexts(null, input, { script: SCRIPT, mode: 'rules', useClaude: false }, diag)
    expect(r.directives[0]?.text).toBe('13 millions d’actions')
    expect(r.directives[1]?.text).toBeUndefined()
    expect(r.directives[2]?.frame).toEqual({ frame: 'board', label: 'Wall Street' })
    expect(r.directives[3]?.card).toBeUndefined()
    expect(r.directives[3]?.kind).toBe('motion.bars')
    expect(r.report).toMatchObject({ checked: 7, removed: 2, rewritten: 0, cardsDropped: 1, asked: 0 })
    expect(input[1]?.text).toBe('Octobre 1930')
    expect(diag[0]).toMatch(/^on-screen texts \(rules\): 7 checked/)
  })

  it('evidence mode: a text not copied from the script needs a quote that is really there; a correction needs a second look that confirms it; a rewrite must pass the rules', async () => {
    const asked: string[] = []
    const answers = [
      // first look
      {
        checks: [
          { k: '1:text', verdict: 'supported', evidence: 'un krach historique' },
          { k: '2:text', verdict: 'unsupported', evidence: '', rewrite: 'Un record' },
          { k: '3:text', verdict: 'doubt', evidence: '' },
          { k: '4:text', verdict: 'unsupported', evidence: '', rewrite: 'Record de 1930' },
          { k: '6:text', verdict: 'unsupported', evidence: '' },
          { k: '7:text', verdict: 'supported', evidence: 'les ordres de vente' }
        ]
      },
      // the second look at what the first did not prove
      {
        checks: [
          { k: '1:text', verdict: 'unsupported', evidence: '' },
          { k: '2:text', verdict: 'unsupported', evidence: '' },
          { k: '3:text', verdict: 'supported', evidence: 'Il faudra attendre 1954, vingt-cinq ans' },
          { k: '4:text', verdict: 'unsupported', evidence: '' },
          { k: '6:text', verdict: 'doubt', evidence: '' }
        ]
      }
    ]
    const ctx = makeCtx({
      claude: {
        async ask(req: { prompt: string }) {
          asked.push(req.prompt)
          return { text: JSON.stringify(answers[asked.length - 1]) }
        }
      }
    } as never)
    const input = [
      d({ text: '13 millions d’actions' }),
      d({ text: 'Krach historique' }),
      d({ text: 'Record absolu' }),
      d({ text: '25 ans d’attente' }),
      d({ text: 'Le pire jour' }),
      d({ text: 'Un record' }),
      d({ text: 'Panique générale' }),
      d({ text: 'Ventes en masse' })
    ]
    const SOURCE = `${SCRIPT} Les ordres de vente pleuvent.`
    const r = await checkScreenTexts(ctx, input, { script: SOURCE, mode: 'evidence', useClaude: true }, [])
    // removed when confirmed (1, 4: its rewrite breaks a rule), rewritten (2), kept when the second look proves it (3) or doubts (6),
    // kept when the first look proved it with a real quote (7)
    expect(r.directives.map((x) => x.text)).toEqual(['13 millions d’actions', undefined, 'Un record', '25 ans d’attente', undefined, 'Un record', 'Panique générale', 'Ventes en masse'])
    // « 13 millions d’actions » and « Un record » are the script's own words in order: never asked
    expect(r.report.asked).toBe(6)
    expect(asked).toHaveLength(2)
    expect(asked[1]).toContain('3:text · 25 ans d’attente')
    expect(asked[1]).not.toContain('7:text')
  })

  it('evidence mode never rewrites a card’s figure: its card is left out', async () => {
    const ctx = makeCtx({
      claude: { ask: async () => ({ text: JSON.stringify({ checks: [{ k: '0:card.props.bars.0.value', verdict: 'unsupported', evidence: '', rewrite: '89' }] }) }) }
    } as never)
    const r = await checkScreenTexts(ctx, [d({ kind: 'motion.bars', card: { template: 'bars', props: { bars: [{ value: 11 }] } } })], { script: SCRIPT, mode: 'evidence', useClaude: true }, [])
    expect(r.directives[0]?.card).toBeUndefined()
    expect(r.report).toMatchObject({ rewritten: 0, cardsDropped: 1 })
  })

  it('evidence mode never rewrites a picture’s caption: an unsupported one is removed', async () => {
    const ctx = makeCtx({
      // both looks say unsupported
      claude: { ask: async () => ({ text: JSON.stringify({ checks: [{ k: '0:frame.sub', verdict: 'unsupported', evidence: '', rewrite: 'Wall Street' }] }) }) }
    } as never)
    const r = await checkScreenTexts(ctx, [d({ kind: 'archive', frame: { frame: 'board', label: 'Richard Whitney', sub: 'Vice-président de la Bourse' } })], { script: SCRIPT, mode: 'evidence', useClaude: true }, [])
    expect(r.directives[0]?.frame).toEqual({ frame: 'board', label: 'Richard Whitney' })
    expect(r.report.rewritten).toBe(0)
  })
})
