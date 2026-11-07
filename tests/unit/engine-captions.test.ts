import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EngineError } from '../../src/engine/errors'
import type { EditPlan } from '../../src/engine/formats/editplan'
import type { Word } from '../../src/engine/formats/timing'
import { captionsMake } from '../../src/engine/nodes/captions-make'
import {
  assColor,
  assFilterPath,
  assTime,
  buildAss,
  buildCues,
  buildSrt,
  CAPTION_PRESETS,
  cueText,
  cueWords,
  escapeAss,
  graphicWindows,
  labelsOf,
  makeCues,
  muteCues,
  srtTime,
  timeCues,
  type AssOptions,
  type Cue
} from '../../src/engine/text/captions'
import { endsSentence, normWord, parseScript, STOP_WORDS } from '../../src/engine/text/script'
import { art, hasFullFfmpeg, makeCtx, MEDIA, NO_FULL_FFMPEG, RESOURCES, tempDir, testServices } from './engine-node-helpers'

/** Words of a script, 0.3 s each, with extra silence (seconds) before the word indexes in `pauses`. */
function wordsOf(script: string, pauses: Record<number, number> = {}, per = 0.3): Word[] {
  let t = 0.5
  return parseScript(script).tokens.map((tok, i) => {
    t += pauses[i] ?? 0
    const w: Word = { w: tok.w, start: t, end: t + per - 0.05, sentence: tok.sentence, paragraph: tok.paragraph }
    t += per
    return w
  })
}

function planOf(shots: { id: string; track: 'base' | 'overlay' | 'labels'; a: number; b: number; kind: string; text?: string }[]): EditPlan {
  return {
    schema: 'atelier.editplan/1',
    fps: 30,
    size: [1920, 1080],
    frames: 3000,
    tracks: { base: [], overlay: [], labels: [] },
    captionsPreset: 'highlight',
    shots: shots.map((s) => ({
      id: s.id, track: s.track, startFrame: s.a, endFrame: s.b, kind: s.kind, role: 'scene', beat: 0, transitionIn: 'cut', ...(s.text ? { text: s.text } : {})
    })),
    chapters: [],
    diagnostics: []
  } as unknown as EditPlan
}

const EMPTY_PLAN = planOf([])

const CORPUS = [
  'Pendant la Première Guerre mondiale, des millions de soldats français sont partis au front avec confiance et espoir.',
  'En 1914 la guerre éclate. Personne ne sait encore combien de temps elle va durer, ni ce qu’elle va coûter aux familles.',
  'Le gouvernement a annoncé la construction de 2500 nouveaux logements pour les familles les plus modestes de la région.',
  'Les chercheurs ont découvert une nouvelle espèce d’insecte dans la forêt tropicale, et personne ne l’avait vue avant eux.',
  'Il a gagné 12 000 euros grâce à son travail. Et ce n’est que le début de cette histoire incroyable que je vais vous raconter.',
  'Non. Vraiment pas. Mais ensuite, après une longue nuit passée à réfléchir, il changea complètement d’avis sur la question.'
]

const lastWord = (line: { text: string }[]): string => line[line.length - 1]?.text ?? ''

describe('line building', () => {
  const cues = buildCues(wordsOf(CORPUS.join(' ')), { maxChars: 42, lines: 1 })

  it('keeps every line within 42 characters and one line per cue', () => {
    expect(cues.length).toBeGreaterThan(8)
    for (const c of cues) {
      expect(c.lines).toHaveLength(1)
      expect(cueText(c).length).toBeLessThanOrEqual(42)
    }
  })

  it('never ends a line on a function word unless the sentence ends there', () => {
    for (const c of cues) {
      for (const line of c.lines) {
        const t = lastWord(line)
        const wordCountInSentence = cueWords(c).length
        if (STOP_WORDS.has(normWord(t)) && !/[,;:.!?…]$/.test(t)) {
          // allowed only for a cue that is a whole sentence of one word
          expect(wordCountInSentence).toBe(1)
        }
      }
    }
  })

  it('does not end a line on a bare number when a word follows in the sentence', () => {
    const sentence = 'Le gouvernement a annoncé la construction de 2500 nouveaux logements pour les familles'
    const cs = buildCues(wordsOf(sentence), { maxChars: 42, lines: 1 })
    expect(cs.length).toBeGreaterThan(1)
    for (const c of cs.slice(0, -1)) expect(lastWord(c.lines[0] ?? [])).not.toBe('2500')
    // the number stays with the noun it counts
    const joined = cs.find((c) => cueText(c).includes('2500'))
    expect(cueText(joined as Cue)).toMatch(/2500 \S+/)
    for (const c of buildCues(wordsOf('Il a gagné 12 000 euros grâce à son travail de toute une vie passée là-bas.'), { maxChars: 20, lines: 1 })) {
      expect(lastWord(c.lines[0] ?? [])).not.toMatch(/^(12|000)$/)
    }
  })

  it('keeps tokens such as "1914," intact', () => {
    const all = buildCues(wordsOf('En 1914, la guerre éclate partout en Europe et le monde bascule.'), { maxChars: 42, lines: 1 })
    expect(all.flatMap((c) => cueWords(c).map((w) => w.text))).toContain('1914,')
  })

  it('joins a lone last word to the previous line', () => {
    const cs = buildCues(wordsOf('Les chercheurs ont découvert une nouvelle espèce rarissime hier.'), { maxChars: 42, lines: 1 })
    expect(cs.length).toBeGreaterThan(1)
    for (const c of cs) expect(cueWords(c).length).toBeGreaterThan(1)
    for (const c of buildCues(wordsOf(CORPUS.slice(0, 5).join(' ')), { maxChars: 42, lines: 1 })) {
      expect(cueWords(c).length).toBeGreaterThan(1)
    }
  })

  it('breaks at a sentence end first, never across sentences, and prefers clause marks', () => {
    const cs = buildCues(wordsOf('Il pleut. Nous restons à la maison, car la route est fermée.'), { maxChars: 42, lines: 1 })
    expect(cueText(cs[0] as Cue)).toBe('Il pleut.')
    for (const c of cs) {
      const ws = cueWords(c).map((w) => w.text)
      ws.slice(0, -1).forEach((w) => expect(endsSentence(w)).toBe(false))
    }
    expect(cs.some((c) => /maison,$/.test(cueText(c)))).toBe(true)
  })

  it('classic with 2 lines puts two lines in a cue, each within the limit', () => {
    const cs = buildCues(wordsOf(CORPUS[0] as string), { maxChars: 42, lines: 2 })
    expect(cs[0]?.lines.length).toBeGreaterThan(1)
    for (const c of cs) {
      expect(c.lines.length).toBeLessThanOrEqual(2)
      for (const l of c.lines) expect(l.map((w) => w.text).join(' ').length).toBeLessThanOrEqual(42)
    }
  })

  it('splits on the paragraph too, and keeps all words in order exactly once', () => {
    const script = 'Premier paragraphe sans point final\n\nSecond paragraphe tout court'
    const ws = wordsOf(script)
    const cs = buildCues(ws, { maxChars: 42, lines: 1 })
    expect(cs).toHaveLength(2)
    expect(cs.flatMap((c) => cueWords(c).map((w) => w.text))).toEqual(ws.map((w) => w.w))
  })
})

describe('timing', () => {
  const lead = 50
  it('appears 50 ms before the first word and leaves at the next cue start', () => {
    const ws = wordsOf('Il pleut beaucoup aujourd’hui. Nous restons à la maison tranquillement.')
    const cues = timeCues(buildCues(ws, { maxChars: 42, lines: 1 }), lead)
    expect(cues).toHaveLength(2)
    const [a, b] = cues as [Cue, Cue]
    expect(a.start).toBeCloseTo((ws[0]?.start ?? 0) - 0.05, 6)
    const nextFirst = cueWords(b)[0]?.start ?? 0
    expect(a.end).toBeCloseTo(nextFirst - 0.05, 6)
    expect(b.start).toBeCloseTo(a.end, 6)
  })

  it('leaves 0.3 s after the last word over a pause of 1.5 s or more', () => {
    const ws = wordsOf('Il pleut beaucoup. Nous restons ici.', { 3: 2 })
    const cues = timeCues(buildCues(ws, { maxChars: 42, lines: 1 }), lead)
    expect(cues[0]?.end).toBeCloseTo((ws[2]?.end ?? 0) + 0.3, 6)
    expect(cues[1]?.start).toBeGreaterThan((cues[0]?.end ?? 0) + 1)
  })

  it('keeps a pause just under 1.5 s on screen until the next cue', () => {
    const ws = wordsOf('Il pleut beaucoup. Nous restons ici.', { 3: 1.2 })
    const cues = timeCues(buildCues(ws, { maxChars: 42, lines: 1 }), lead)
    expect(cues[0]?.end).toBeCloseTo(cues[1]?.start ?? 0, 6)
  })

  it('holds a very short cue for 0.3 s and never leaves a flicker gap under 0.25 s', () => {
    const ws = wordsOf('Non. Nous restons ici pour toujours et à jamais.', { 1: 1.6 }, 0.2)
    const cues = timeCues(buildCues(ws, { maxChars: 42, lines: 1 }), lead)
    expect((cues[0]?.end ?? 0) - (cues[0]?.start ?? 0)).toBeGreaterThanOrEqual(0.3 - 1e-9)
    const dense = timeCues(buildCues(wordsOf(CORPUS.join(' ')), { maxChars: 42, lines: 1 }), lead)
    for (let i = 0; i + 1 < dense.length; i++) {
      const gap = (dense[i + 1]?.start ?? 0) - (dense[i]?.end ?? 0)
      expect(gap < 0.25 && gap > 1e-9).toBe(false)
      expect(dense[i]?.end ?? 0).toBeGreaterThan(dense[i]?.start ?? 0)
    }
  })
})

describe('muting around graphics', () => {
  const mk = (start: number, end: number): Cue => ({ start, end, lines: [[{ text: 'x', start, end }]] })
  const plan = planOf([
    { id: 'g', track: 'overlay', a: 300, b: 450, kind: 'graphic.x' },
    { id: 'o', track: 'overlay', a: 600, b: 700, kind: 'image.gen' },
    { id: 'l', track: 'labels', a: 0, b: 60, kind: 'label', text: 'Paris' }
  ])

  it('reads only overlay shots of a graphic.* kind', () => {
    expect(graphicWindows(plan)).toEqual([{ start: 10, end: 15 }])
  })

  it('removes a cue under the window, trims one that grazes it by 0.5 s or less', () => {
    const w = graphicWindows(plan)
    expect(muteCues([mk(11, 13)], w)).toEqual([])
    expect(muteCues([mk(9, 15.2)], w)).toEqual([])
    const tail = muteCues([mk(8, 10.4)], w)
    expect(tail).toHaveLength(1)
    expect(tail[0]?.end).toBeCloseTo(10, 9)
    const head = muteCues([mk(14.6, 17)], w)
    expect(head[0]?.start).toBeCloseTo(15, 9)
    expect(muteCues([mk(8, 10.8)], w)).toEqual([])
    expect(muteCues([mk(1, 3)], w)).toHaveLength(1)
  })

  it('applies to the whole pipeline', () => {
    const ws = wordsOf('Il pleut beaucoup aujourd’hui. Nous restons à la maison tranquillement.')
    const all = makeCues(ws, EMPTY_PLAN, { preset: 'highlight', maxChars: 42, lines: 1, leadMs: 50 })
    const muted = makeCues(ws, planOf([{ id: 'g', track: 'overlay', a: 0, b: 3000, kind: 'graphic.chart' }]), { preset: 'highlight', maxChars: 42, lines: 1, leadMs: 50 })
    expect(all.length).toBeGreaterThan(0)
    expect(muted).toEqual([])
  })
})

interface Parsed {
  sections: string[]
  info: Record<string, string>
  styles: Record<string, string[]>
  dialogues: { layer: number; start: string; end: string; style: string; text: string }[]
}

function parseAss(src: string): Parsed {
  const p: Parsed = { sections: [], info: {}, styles: {}, dialogues: [] }
  for (const line of src.split('\n')) {
    if (/^\[.+\]$/.test(line)) p.sections.push(line)
    else if (line.startsWith('Style: ')) {
      const f = line.slice(7).split(',')
      p.styles[f[0] ?? ''] = f
    } else if (line.startsWith('Dialogue: ')) {
      const f = line.slice(10).split(',')
      p.dialogues.push({ layer: Number(f[0]), start: f[1] ?? '', end: f[2] ?? '', style: f[3] ?? '', text: f.slice(9).join(',') })
    } else if (/^[A-Za-z ]+: /.test(line) && p.sections.length === 1) {
      const i = line.indexOf(': ')
      p.info[line.slice(0, i)] = line.slice(i + 2)
    }
  }
  return p
}

const SCRIPT = 'Il pleut beaucoup aujourd’hui. Nous restons à la maison, car la route est fermée par la neige depuis hier matin.'
const base = (preset: AssOptions['preset'], over: Partial<AssOptions> = {}): AssOptions => ({
  preset, maxChars: 42, lines: 1, position: 'bottom', leadMs: 50, accent: '#FFD84D', burn: true, ...over
})
const cuesFor = (preset: AssOptions['preset']): Cue[] => makeCues(wordsOf(SCRIPT), EMPTY_PLAN, base(preset))
/** Text without override blocks. */
const plain = (t: string): string => t.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n')

describe('ASS generation', () => {
  it('formats colours and times', () => {
    expect(assColor('#FFD84D')).toBe('&H004DD8FF')
    expect(assColor('#102030', 0x30)).toBe('&H30302010')
    expect(assTime(3725.456)).toBe('1:02:05.46')
    expect(assTime(0)).toBe('0:00:00.00')
  })

  // the long-form presets (size 60–90 at 1080p); `shorts` and `word` are shorts presets, bigger by design, with their own tests
  // (engine-shorts.test.ts, story-short.test.ts)
  it.each(CAPTION_PRESETS.filter((p) => p !== 'shorts' && p !== 'word'))('%s produces a parseable file', (preset) => {
    const labels = [{ text: 'Paris, 1914', start: 1, end: 4 }]
    const ass = parseAss(buildAss(cuesFor(preset), labels, base(preset)))
    expect(ass.sections).toEqual(['[Script Info]', '[V4+ Styles]', '[Events]'])
    expect(ass.info).toMatchObject({ PlayResX: '1920', PlayResY: '1080', ScaledBorderAndShadow: 'yes', WrapStyle: '2' })
    const cap = ass.styles.Cap ?? []
    expect(Number(cap[2])).toBeGreaterThanOrEqual(60)
    expect(Number(cap[2])).toBeLessThanOrEqual(90)
    expect(Number(cap[16])).toBeGreaterThanOrEqual(3)
    expect(Number(cap[21])).toBeGreaterThanOrEqual(90)
    expect(cap[1]).toBe('Inter')
    const lab = ass.styles.Label ?? []
    expect(lab[1]).toBe('Inter SemiBold')
    expect(lab[15]).toBe('3')
    expect(Number(lab[21])).toBeGreaterThanOrEqual(90)
    const caps = ass.dialogues.filter((d) => d.style === 'Cap')
    expect(caps.length).toBeGreaterThanOrEqual(cuesFor(preset).length)
    for (const d of ass.dialogues) expect(d.start <= d.end || d.start.length < d.end.length).toBe(true)
    expect(ass.dialogues.filter((d) => d.layer === 2)).toHaveLength(1)
    expect(ass.dialogues.every((d) => d.layer === 2 || d.style === 'Cap')).toBe(true)
  })

  it('classic: one plain Dialogue per cue, no highlight', () => {
    const cues = cuesFor('classic')
    const ass = parseAss(buildAss(cues, [], base('classic')))
    expect(ass.dialogues).toHaveLength(cues.length)
    expect(ass.dialogues.map((d) => d.text)).toEqual(cues.map((c) => c.lines.map((l) => l.map((w) => w.text).join(' ')).join('\\N')))
    expect(ass.styles.Cap?.[16]).toBe('4')
    expect(Number(ass.styles.Cap?.[17])).toBeGreaterThan(0)
  })

  it('highlight: one Dialogue per word window and exactly the current word coloured', () => {
    const cues = cuesFor('highlight')
    const ass = parseAss(buildAss(cues, [], base('highlight')))
    const words = cues.flatMap((c) => cueWords(c).map((w) => w.text))
    expect(ass.dialogues).toHaveLength(words.length)
    const accent = '&H4DD8FF&'
    const lineOf = words.map((_, i) => {
      let seen = 0
      const cue = cues.find((c) => (seen += cueWords(c).length) > i) as Cue
      return cue.lines.map((l) => l.map((w) => w.text).join(' ')).join('\n')
    })
    ass.dialogues.forEach((d, i) => {
      const coloured = [...d.text.matchAll(/\{\\1c(&H[0-9A-F]{6}&)\}([^{ ]*)/g)]
      expect(coloured).toHaveLength(1)
      expect(coloured[0]?.[1]).toBe(accent)
      expect(coloured[0]?.[2]).toBe(words[i])
      expect(plain(d.text)).toBe(lineOf[i])
    })
    // windows follow each other without gaps inside a cue
    const first = cues[0] as Cue
    const inCue = ass.dialogues.slice(0, cueWords(first).length)
    for (let k = 0; k + 1 < inCue.length; k++) expect(inCue[k]?.end).toBe(inCue[k + 1]?.start)
  })

  it('highlight: the accent starts 40 ms before the word', () => {
    const cues = cuesFor('highlight')
    const ass = parseAss(buildAss(cues, [], base('highlight')))
    const second = cueWords(cues[0] as Cue)[1] as { start: number }
    expect(ass.dialogues[1]?.start).toBe(assTime(second.start - 0.04))
  })

  it('pill: opaque box style, past white, current accent, future dimmed', () => {
    const cues = cuesFor('pill')
    const ass = parseAss(buildAss(cues, [], base('pill')))
    expect(ass.styles.Cap?.[15]).toBe('3')
    const n = cueWords(cues[0] as Cue).length
    const mid = ass.dialogues[Math.min(2, n - 1)]?.text ?? ''
    const colours = [...mid.matchAll(/\{\\1c(&H[0-9A-F]{6}&)\}/g)].map((m) => m[1])
    expect(n).toBeGreaterThanOrEqual(3)
    expect(colours).toEqual(['&HFFFFFF&', '&H4DD8FF&', '&HAAA09A&'])
    expect(colours).toContain('&H4DD8FF&')
    expect(colours).toContain('&HFFFFFF&')
    expect(colours).toContain('&HAAA09A&')
  })

  it('bold-center: 2 to 4 upper-case words, centred, with a pop-in', () => {
    const cues = cuesFor('bold-center')
    for (const c of cues) expect(cueWords(c).length).toBeLessThanOrEqual(4)
    expect(cues.filter((c) => cueWords(c).length >= 2).length).toBeGreaterThan(cues.length - 2)
    const ass = parseAss(buildAss(cues, [], base('bold-center')))
    expect(ass.dialogues).toHaveLength(cues.length)
    expect(ass.styles.Cap?.[18]).toBe('5')
    expect(Number(ass.styles.Cap?.[2])).toBeGreaterThanOrEqual(80)
    for (const d of ass.dialogues) {
      expect(d.text).toMatch(/\\fscx\d+\\fscy\d+\\t\(/)
      expect(plain(d.text)).toBe(plain(d.text).toUpperCase())
    }
  })

  it('word-by-word: words accumulate on their onsets, 1 to 6 per line, layout stays put', () => {
    const cues = cuesFor('word-by-word')
    for (const c of cues) expect(cueWords(c).length).toBeLessThanOrEqual(6)
    const ass = parseAss(buildAss(cues, [], base('word-by-word')))
    const c0 = cues[0] as Cue
    const w0 = cueWords(c0)
    expect(ass.dialogues.length).toBe(cues.reduce((n, c) => n + cueWords(c).length, 0))
    expect(ass.dialogues[0]?.text.startsWith(w0[0]?.text ?? '?')).toBe(true)
    expect(ass.dialogues[0]?.text).toContain('{\\alpha&HFF&}')
    const k = 2
    const visible = ass.dialogues[k]?.text.split('{\\alpha&HFF&}')[0] ?? ''
    expect(visible.trim()).toBe(w0.slice(0, k + 1).map((w) => w.text).join(' '))
    // the last window shows the whole line
    expect(ass.dialogues[w0.length - 1]?.text).toBe(w0.map((w) => w.text).join(' '))
  })

  it('position moves the captions: bottom 2, middle 5, top 8', () => {
    const al = (position: AssOptions['position']): string | undefined =>
      parseAss(buildAss(cuesFor('classic'), [], base('classic', { position }))).styles.Cap?.[18]
    expect([al('bottom'), al('middle'), al('top')]).toEqual(['2', '5', '8'])
  })

  it('escapes braces, backslashes and line breaks', () => {
    expect(escapeAss('a {b} c')).toBe('a \\{b\\} c')
    expect(escapeAss('x\\Ny')).toBe('x\\\u200bNy')
    expect(escapeAss('une\nligne\r\nnouvelle')).toBe('une ligne nouvelle')
    const words: Word[] = wordsOf('Il a écrit {sic} et \\N puis fin.')
    const ass = buildAss(makeCues(words, EMPTY_PLAN, base('classic')), [{ text: 'a {b}\nc', start: 0, end: 1 }], base('classic'))
    const d = parseAss(ass).dialogues
    expect(d[0]?.text).toContain('\\{sic\\}')
    expect(d[0]?.text).not.toMatch(/\\N(?!$)/)
    expect(d.find((x) => x.layer === 2)?.text).toContain('a \\{b\\} c')
  })
})

describe('labels layer', () => {
  const plan = planOf([
    { id: 'b', track: 'base', a: 0, b: 3000, kind: 'stock.video' },
    { id: 'l1', track: 'labels', a: 60, b: 150, kind: 'label', text: 'Verdun, 1916' },
    { id: 'l2', track: 'labels', a: 600, b: 690, kind: 'label', text: '  ' },
    { id: 'l3', track: 'labels', a: 900, b: 990, kind: 'label', text: 'Marne' }
  ])

  it('turns labels shots with text into Layer 2 Dialogues, with burn false too', () => {
    const labels = labelsOf(plan)
    expect(labels).toEqual([{ text: 'Verdun, 1916', start: 2, end: 5 }, { text: 'Marne', start: 30, end: 33 }])
    for (const burn of [true, false]) {
      const ass = parseAss(buildAss(cuesFor('highlight'), labels, base('highlight', { burn })))
      const l = ass.dialogues.filter((d) => d.layer === 2)
      expect(l.map((d) => [d.style, d.start, d.end])).toEqual([['Label', '0:00:02.00', '0:00:05.00'], ['Label', '0:00:30.00', '0:00:33.00']])
      expect(l[0]?.text).toContain('Verdun, 1916')
      expect(ass.dialogues.filter((d) => d.layer !== 2).length > 0).toBe(burn)
    }
  })

  it('places labels top-left with margins of 90 px or more', () => {
    const lab = parseAss(buildAss([], labelsOf(plan), base('classic'))).styles.Label ?? []
    expect(lab[18]).toBe('7')
    expect([lab[19], lab[20], lab[21]].map(Number).every((m) => m >= 90)).toBe(true)
  })
})

describe('SRT', () => {
  it('formats times and numbers the cues', () => {
    expect(srtTime(3725.4567)).toBe('01:02:05,457')
    expect(srtTime(-1)).toBe('00:00:00,000')
    const cues = cuesFor('classic')
    const srt = buildSrt(cues)
    const blocks = srt.trim().split('\n\n')
    expect(blocks).toHaveLength(cues.length)
    blocks.forEach((b, i) => {
      const [n, time, ...text] = b.split('\n')
      expect(n).toBe(String(i + 1))
      expect(time).toMatch(/^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$/)
      expect(text.join('\n')).toBe(cueText(cues[i] as Cue))
    })
  })

  it('keeps the original case (bold-center caps are an ASS styling only)', () => {
    expect(buildSrt(cuesFor('bold-center'))).toContain('Il pleut')
  })
})

describe('assFilterPath', () => {
  it('turns a Windows path into one the ass filter reads', () => {
    expect(assFilterPath('C:\\Users\\a b\\x.ass')).toBe("'C\\:/Users/a b/x.ass'")
    expect(assFilterPath('/tmp/a,b[1].ass')).toBe("'/tmp/a,b[1].ass'")
    expect(assFilterPath("/tmp/d'arc.ass")).toBe("'/tmp/d'\\\\\\''arc.ass'")
  })
})

describe('captions.make@1', () => {
  const script = SCRIPT
  const words = wordsOf(script)
  const plan = planOf([{ id: 'l', track: 'labels', a: 30, b: 120, kind: 'label', text: 'Paris' }])
  const inputs = (meta?: Record<string, never>): Record<string, ReturnType<typeof art>> => ({
    words: art('json.words', { value: words as never, ...(meta ? { meta } : {}) }),
    script: art('text.script', { value: script }),
    plan: art('json.editplan', { value: plan as never })
  })

  it('declares its contract', () => {
    expect(captionsMake.type).toBe('captions.make@1')
    expect(Object.keys(captionsMake.inputs)).toEqual(['words', 'script', 'plan'])
    expect(captionsMake.outputs).toEqual({ subs: 'subs.track' })
    expect(captionsMake.executors).toEqual(['local'])
    expect(captionsMake.params.parse({})).toEqual({ preset: 'highlight', maxChars: 42, lines: 1, position: 'bottom', burn: true, leadMs: 50, accent: '#FFD84D' })
    expect(() => captionsMake.params.parse({ preset: 'neon' })).toThrow()
  })

  it('writes captions.ass, captions.srt and captions.vtt (production-9: VTT always) with the right meta', async () => {
    const t = tempDir('captions')
    try {
      const params = captionsMake.params.parse({ burn: false })
      const out = await captionsMake.run(makeCtx(testServices(t.dir)), inputs(), params)
      const subs = out.subs
      expect(subs?.files?.map((f) => path.basename(f))).toEqual(['captions.ass', 'captions.srt', 'captions.vtt'])
      const cues = makeCues(words, plan, { preset: 'highlight', maxChars: 42, lines: 1, leadMs: 50 })
      expect(subs?.meta).toEqual({ preset: 'highlight', burn: false, cues: cues.length, labels: 1, font: 'Inter' })
      const ass = parseAss(readFileSync(subs?.files?.[0] ?? '', 'utf8'))
      expect(ass.dialogues.map((d) => d.layer)).toEqual([2])
      const srt = readFileSync(subs?.files?.[1] ?? '', 'utf8')
      expect(srt.trim().split('\n\n')).toHaveLength(cues.length)
      expect(srt).not.toContain('Paris')
      expect(await captionsMake.estimate({ where: 'local', budgetMode: 'usage_max', minutes: 1, inputs: {} }, params)).toEqual({ units: [], durationS: 1 })
    } finally {
      t.cleanup()
    }
  })

  it('burn true puts the captions in the ASS; fake equals run', async () => {
    const t = tempDir('captions')
    try {
      const params = captionsMake.params.parse({ preset: 'classic' })
      const ctx = makeCtx(testServices(t.dir))
      const out = await captionsMake.fake(ctx, inputs(), params)
      const ass = parseAss(readFileSync(out.subs?.files?.[0] ?? '', 'utf8'))
      expect(ass.dialogues.filter((d) => d.layer === 0).length).toBe(out.subs?.meta?.cues)
    } finally {
      t.cleanup()
    }
  })

  it('refuses words that do not match the script, and warns on weak alignment', async () => {
    const t = tempDir('captions')
    try {
      const ctx = makeCtx(testServices(t.dir))
      const bad = { ...inputs(), script: art('text.script', { value: `${script} un mot de trop` }) }
      await expect(captionsMake.run(ctx, bad, captionsMake.params.parse({}))).rejects.toMatchObject({ code: 'bad_input' })
      await expect(captionsMake.run(ctx, bad, captionsMake.params.parse({}))).rejects.toBeInstanceOf(EngineError)
      const weak = inputs({ durationS: 9, alignment: 'weak', matched: 0.5, language: 'fr' } as never)
      await captionsMake.run(ctx, weak, captionsMake.params.parse({}))
      expect(ctx.reports.some((r) => r.kind === 'log' && r.level === 'warn')).toBe(true)
      const ok = makeCtx(testServices(t.dir))
      await captionsMake.run(ok, inputs({ durationS: 9, alignment: 'provider', matched: 1, language: 'fr' } as never), captionsMake.params.parse({}))
      expect(ok.reports.some((r) => r.kind === 'log')).toBe(false)
    } finally {
      t.cleanup()
    }
  })
})

describe('burned with ffmpeg and libass', () => {
  it.skipIf(!hasFullFfmpeg)(`renders the bottom band and loads Inter (${hasFullFfmpeg ? 'ffmpeg found' : NO_FULL_FFMPEG})`, async () => {
    const media = MEDIA
    if (!media) return
    const t = tempDir('captions-burn')
    try {
      const ws = wordsOf(SCRIPT)
      const labels = [{ text: 'Paris, 1914', start: 0, end: 5 }]
      const cues = makeCues(ws, EMPTY_PLAN, base('classic'))
      const file = path.join(t.dir, 'with space', "d'arc,[x]", 'c.ass')
      const { mkdirSync, writeFileSync } = await import('node:fs')
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, buildAss(cues, labels, base('classic')), 'utf8')
      const fonts = path.join(RESOURCES, 'fonts')
      const frame = async (vf: string): Promise<{ pixels: Buffer; stderr: string }> => {
        const r = await media.run(
          'ffmpeg',
          ['-hide_banner', '-loglevel', 'verbose', '-f', 'lavfi', '-i', 'color=c=0x0a1a3a:s=1920x1080:r=30:d=3', '-vf', vf, '-ss', '1.0', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
          { signal: new AbortController().signal }
        )
        return { pixels: r.stdout, stderr: r.stderr }
      }
      const plainFrame = await frame('null')
      const burned = await frame(`ass=${assFilterPath(file)}:fontsdir=${assFilterPath(fonts)}`)
      expect(plainFrame.pixels.length).toBe(1920 * 1080)
      const band = (px: Buffer, y0: number, y1: number, x0 = 0, x1 = 1920): number => {
        let n = 0
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (px[y * 1920 + x] !== plainFrame.pixels[y * 1920 + x]) n++
        return n
      }
      expect(band(plainFrame.pixels, 0, 1080)).toBe(0)
      expect(band(burned.pixels, 880, 1000)).toBeGreaterThan(2000)
      expect(band(burned.pixels, 0, 300, 0, 900)).toBeGreaterThan(500)
      expect(band(burned.pixels, 400, 800)).toBe(0)
      expect(burned.stderr).toMatch(/fontselect: \(Inter, 700, 0\) -> Inter-Bold/)
      expect(burned.stderr).toMatch(/fontselect: \(Inter SemiBold, 400, 0\) -> Inter-SemiBold/)
      expect(burned.stderr).not.toMatch(/ArialMT|fallback/i)
    } finally {
      t.cleanup()
    }
  }, 60_000)
})
