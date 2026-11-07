// Lot P4, media layer without ffmpeg: tool lookup per OS, filter escaping, speech regions on a synthetic envelope,
// loudness gain, voice chunking (R19.1) and the system voice with an injected exec (no shell, no text in argv).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { gainFilter, gainFor } from '../../src/engine/media/audio'
import { filterPath, wrapText } from '../../src/engine/media/filters'
import { speechRegions } from '../../src/engine/media/probe'
import { SAPI_SCRIPT, parseSayVoices, sapiRate, sayArgs, systemSpeechService } from '../../src/engine/media/speech'
import { drawStill } from '../../src/engine/media/draw'
import { locateTool, parseCapabilityList, requireFilters, systemMediaService } from '../../src/engine/media/tools'
import type { MediaService } from '../../src/engine/services'
import { splitChunks } from '../../src/engine/nodes/voice-common'

describe('locateTool', () => {
  it('finds Homebrew on a simulated darwin when PATH does not hold ffmpeg', () => {
    const exists = (p: string): boolean => p === '/opt/homebrew/bin/ffmpeg'
    expect(locateTool('ffmpeg', { platform: 'darwin', pathEnv: '/usr/bin:/bin', exists })).toBe('/opt/homebrew/bin/ffmpeg')
  })

  it('prefers PATH order, then Apple Silicon Homebrew, then Intel', () => {
    const all = new Set(['/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/custom/ffmpeg'])
    const exists = (p: string): boolean => all.has(p)
    expect(locateTool('ffmpeg', { platform: 'darwin', pathEnv: '/usr/bin:/custom', exists })).toBe('/custom/ffmpeg')
    expect(locateTool('ffmpeg', { platform: 'darwin', pathEnv: '/usr/bin', exists })).toBe('/opt/homebrew/bin/ffmpeg')
    all.delete('/opt/homebrew/bin/ffmpeg')
    expect(locateTool('ffmpeg', { platform: 'darwin', pathEnv: '/usr/bin', exists })).toBe('/usr/local/bin/ffmpeg')
  })

  it('does not look in the Homebrew folders on Linux', () => {
    expect(locateTool('ffmpeg', { platform: 'linux', pathEnv: '/usr/bin', exists: (p) => p === '/opt/homebrew/bin/ffmpeg' })).toBeNull()
  })

  it('on win32 splits PATH on « ; » and adds .exe', () => {
    const exists = (p: string): boolean => p === 'C:\\ffmpeg\\bin\\ffmpeg.exe'
    expect(locateTool('ffmpeg', { platform: 'win32', pathEnv: 'C:\\Windows;C:\\ffmpeg\\bin;', exists })).toBe('C:\\ffmpeg\\bin\\ffmpeg.exe')
    expect(locateTool('ffmpeg.exe', { platform: 'win32', pathEnv: 'C:\\ffmpeg\\bin', exists })).toBe('C:\\ffmpeg\\bin\\ffmpeg.exe')
  })

  it('ignores relative and empty PATH entries (never the current folder)', () => {
    const seen: string[] = []
    const exists = (p: string): boolean => {
      seen.push(p)
      return true
    }
    expect(locateTool('ffmpeg', { platform: 'linux', pathEnv: ':bin:./tools:/abs', exists })).toBe('/abs/ffmpeg')
    expect(seen).toEqual(['/abs/ffmpeg'])
    expect(locateTool('ffmpeg', { platform: 'win32', pathEnv: 'tools;.\\bin', exists })).toBeNull()
  })

  it('returns null when the tool is nowhere', () => {
    expect(locateTool('ffmpeg', { platform: 'darwin', pathEnv: '/usr/bin', exists: () => false })).toBeNull()
  })

  it('on a simulated darwin, prefers the keg-only Homebrew ffmpeg-full to the slim ffmpeg on PATH (lot P4M)', () => {
    const all = new Set(['/opt/homebrew/bin/ffmpeg', '/opt/homebrew/bin/ffprobe', '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe', '/opt/homebrew/bin/claude', '/opt/homebrew/opt/ffmpeg-full/bin/claude'])
    const exists = (p: string): boolean => all.has(p)
    const env = { platform: 'darwin' as const, pathEnv: '/opt/homebrew/bin:/usr/bin', exists }
    expect(locateTool('ffmpeg', env)).toBe('/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg')
    expect(locateTool('ffprobe', env)).toBe('/opt/homebrew/opt/ffmpeg-full/bin/ffprobe')
    // only ffmpeg and ffprobe come from that folder
    expect(locateTool('claude', env)).toBe('/opt/homebrew/bin/claude')
    // Intel Homebrew
    const intel = new Set(['/usr/local/bin/ffmpeg', '/usr/local/opt/ffmpeg-full/bin/ffmpeg'])
    expect(locateTool('ffmpeg', { platform: 'darwin', pathEnv: '/usr/local/bin', exists: (p) => intel.has(p) })).toBe('/usr/local/opt/ffmpeg-full/bin/ffmpeg')
    // never on Linux or Windows
    expect(locateTool('ffmpeg', { platform: 'linux', pathEnv: '/opt/homebrew/bin', exists })).toBe('/opt/homebrew/bin/ffmpeg')
  })

  it('systemMediaService needs both ffmpeg and ffprobe', () => {
    const only = (names: string[]) => (p: string): boolean => names.some((n) => p === `/usr/bin/${n}`)
    expect(systemMediaService({ platform: 'linux', pathEnv: '/usr/bin', exists: only(['ffmpeg']) })).toBeNull()
    expect(systemMediaService({ platform: 'linux', pathEnv: '/usr/bin', exists: only(['ffmpeg', 'ffprobe']) })).not.toBeNull()
  })
})

describe('filterPath', () => {
  it('turns a Windows path with spaces into a single-quoted, slash path with the drive colon escaped', () => {
    expect(filterPath('C:\\Program Files\\Atelier\\fonts\\Inter Bold.ttf')).toBe("'C\\:/Program Files/Atelier/fonts/Inter Bold.ttf'")
  })

  it('keeps a POSIX path as is, inside quotes', () => {
    expect(filterPath('/Users/me/Atelier/fonts/a.ttf')).toBe("'/Users/me/Atelier/fonts/a.ttf'")
  })

  it('protects the graph separators by quoting', () => {
    expect(filterPath('/tmp/a,b;c[d].srt')).toBe("'/tmp/a,b;c[d].srt'")
  })

  it('closes, escapes and reopens the quote around an inner apostrophe', () => {
    expect(filterPath("/tmp/l'été.ttf")).toBe(String.raw`'/tmp/l'\\\''été.ttf'`)
  })
})

describe('wrapText', () => {
  it('breaks lines at spaces within the maximum width', () => {
    const lines = wrapText('un deux trois quatre cinq six sept huit', 12)
    expect(lines.every((l) => l.length <= 12)).toBe(true)
    expect(lines.join(' ')).toBe('un deux trois quatre cinq six sept huit')
  })

  it('keeps a word longer than the width whole', () => {
    expect(wrapText('anticonstitutionnellement ok', 10)).toEqual(['anticonstitutionnellement', 'ok'])
  })

  it('stops at the maximum number of lines with an ellipsis', () => {
    const lines = wrapText('mot mot mot mot mot mot mot mot mot mot', 7, 2)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('mot mot')
    expect(lines[1]).toBe('mot …')
  })

  it('returns nothing for blank text', () => {
    expect(wrapText('   ', 10)).toEqual([])
  })
})

describe('speechRegions on a synthetic energy envelope (R19.6)', () => {
  const frames = (n: number, db: number): number[] => new Array<number>(n).fill(db)
  const SIL = -60
  const SPEECH = -20
  const env = (...parts: number[][]): Float32Array => Float32Array.from(parts.flat())

  it('bridges gaps under 120 ms, keeps longer ones, drops blips under 50 ms', () => {
    const e = env(
      frames(100, SIL), // 0 - 1.00
      frames(100, SPEECH), // 1.00 - 2.00
      frames(8, SIL), // 80 ms gap: bridged
      frames(100, SPEECH), // 2.08 - 3.08
      frames(50, SIL),
      frames(3, SPEECH), // 30 ms blip: dropped
      frames(100, SIL),
      frames(100, SPEECH), // 4.61 - 5.61
      frames(20, SIL), // 200 ms gap: kept
      frames(100, SPEECH),
      frames(100, SIL)
    )
    const r = speechRegions(e)
    expect(r).toHaveLength(3)
    expect(r[0]?.start).toBeCloseTo(1, 6)
    expect(r[0]?.end).toBeCloseTo(3.08, 6)
    expect(r[1]?.start).toBeCloseTo(4.61, 6)
    expect(r[1]?.end).toBeCloseTo(5.61, 6)
    expect(r[2]?.start).toBeCloseTo(5.81, 6)
    expect(r[2]?.end).toBeCloseTo(6.81, 6)
  })

  it('puts the threshold above the noise floor: room noise is not speech', () => {
    const e = env(frames(100, SIL), frames(60, -52), frames(100, SPEECH), frames(60, -52), frames(100, SIL))
    const r = speechRegions(e)
    expect(r).toHaveLength(1)
    expect(r[0]?.start).toBeCloseTo(1.6, 6)
    expect(r[0]?.end).toBeCloseTo(2.6, 6)
  })

  it('adapts to a noisy recording (floor -40, speech -15)', () => {
    const e = env(frames(100, -40), frames(100, -15), frames(100, -40))
    const r = speechRegions(e)
    expect(r).toHaveLength(1)
    expect(r[0]?.start).toBeCloseTo(1, 6)
  })

  it('gives nothing for an empty envelope, and honours the options', () => {
    expect(speechRegions(new Float32Array(0))).toEqual([])
    const e = env(frames(100, SIL), frames(100, SPEECH), frames(30, SIL), frames(100, SPEECH), frames(100, SIL))
    expect(speechRegions(e)).toHaveLength(2)
    expect(speechRegions(e, { bridgeS: 0.5 })).toHaveLength(1)
  })
})

describe('gainFor / gainFilter (R28.5: one linear gain, limiter only when needed)', () => {
  it('brings the voice to the target loudness', () => {
    const g = gainFor({ integrated: -23, truePeak: -12 }, -16, -1.5)
    expect(g.gainDb).toBe(7)
    expect(g.limit).toBe(false) // -12 + 7 = -5 dBTP, under the ceiling
  })

  it('asks for the limiter only when peak + gain crosses the ceiling', () => {
    expect(gainFor({ integrated: -23, truePeak: -5 }, -16, -1.5).limit).toBe(true) // +2 dBTP
    expect(gainFor({ integrated: -23, truePeak: -8.5 }, -16, -1.5).limit).toBe(false) // exactly -1.5
    expect(gainFor({ integrated: -10, truePeak: 0 }, -16, -1).gainDb).toBe(-6)
  })

  it('clamps the gain to ±40 dB (silence measures very low)', () => {
    expect(gainFor({ integrated: -70, truePeak: -70 }, -16, -1).gainDb).toBe(40)
    expect(gainFor({ integrated: 20, truePeak: 0 }, -16, -1).gainDb).toBe(-36)
    expect(gainFor({ integrated: 40, truePeak: 0 }, -16, -1).gainDb).toBe(-40)
  })

  it('writes a plain volume, or volume + limiter just under the ceiling', () => {
    expect(gainFilter(7, false, -1.5)).toBe('volume=7.00dB')
    expect(gainFilter(-3.456, false, -1)).toBe('volume=-3.46dB')
    expect(gainFilter(7, true, -1.5)).toBe('volume=7.00dB,alimiter=limit=0.8128:attack=5:release=50:level=disabled')
    expect(gainFilter(0, true, -1)).toContain('limit=0.8610')
  })
})

describe('splitChunks (R19.1)', () => {
  const sentence = (n: number): string => `Phrase numéro ${String(n).padStart(3, '0')} qui raconte un petit morceau de l’histoire.`

  it('keeps a short text in one chunk', () => {
    expect(splitChunks('Un peu de texte.\n\nEt un autre paragraphe.')).toEqual(['Un peu de texte.\n\nEt un autre paragraphe.'])
    expect(splitChunks('   ')).toEqual([])
  })

  it('cuts at paragraph boundaries first', () => {
    const para = (k: number): string => `${'Mot '.repeat(120).trim()} ${k}.`
    const chunks = splitChunks([para(1), para(2), para(3)].join('\n\n'))
    expect(chunks).toEqual([para(1), para(2), para(3)])
    expect(chunks.every((c) => c.length <= 900)).toBe(true)
  })

  it('cuts a long paragraph at sentence ends, never past the maximum', () => {
    const text = Array.from({ length: 40 }, (_, i) => sentence(i)).join(' ')
    const chunks = splitChunks(text, 900, 200)
    expect(chunks.length).toBeGreaterThan(2)
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(900)
      expect(c.endsWith('.')).toBe(true)
    }
    expect(chunks.join(' ')).toBe(text)
  })

  it('merges a tail under 200 characters into the previous chunk', () => {
    const big = Array.from({ length: 8 }, (_, i) => sentence(i)).join(' ') // ~ 560 chars
    const text = `${big}\n\n${big}\n\n${sentence(99)}`
    const chunks = splitChunks(text, 900, 200)
    expect(chunks).toHaveLength(2)
    expect((chunks[1] as string).endsWith(sentence(99))).toBe(true)
    expect((chunks[1] as string).length).toBeLessThanOrEqual(900 + 2 + 200)
  })

  it('packs small paragraphs together up to the maximum and loses no word', () => {
    const paras = Array.from({ length: 30 }, (_, i) => sentence(i))
    const chunks = splitChunks(paras.join('\n\n'), 900, 200)
    expect(chunks.every((c) => c.length <= 1100)).toBe(true)
    expect(chunks.length).toBeLessThan(paras.length)
    expect(chunks.join('\n\n').split(/\s+/)).toEqual(paras.join('\n\n').split(/\s+/))
  })
})

const SAY_SAMPLE = [
  'Albert              en_US    # Hello! My name is Albert.',
  'Amélie              fr_CA    # Bonjour ! Je m’appelle Amélie.',
  'Eddy (French (France))  fr_FR    # Bonjour ! Je m’appelle Eddy.',
  'Flo (English (US))  en_US    # Hello! My name is Flo.',
  'Thomas              fr-FR    # Bonjour, je m’appelle Thomas.',
  'Bad Line without a locale',
  ''
].join('\n')

describe('parseSayVoices', () => {
  it('reads names with spaces and parentheses and maps the locale to its language', () => {
    const v = parseSayVoices(SAY_SAMPLE)
    expect(v.map((x) => x.id)).toEqual(['Albert', 'Amélie', 'Eddy (French (France))', 'Flo (English (US))', 'Thomas'])
    expect(v.map((x) => x.language)).toEqual(['en', 'fr', 'fr', 'en', 'fr'])
    expect(v[2]).toEqual({ id: 'Eddy (French (France))', name: 'Eddy (French (France))', language: 'fr' })
  })

  it('reads the longest name of the column, which is followed by one space only', () => {
    const v = parseSayVoices('Grandma (French (France)) fr_FR    # Bonjour !\nLilou              fr_FR    # Salut')
    expect(v.map((x) => x.id)).toEqual(['Grandma (French (France))', 'Lilou'])
  })
})

describe('sayArgs / sapiRate', () => {
  it('builds the say arguments with a text file, never the text', () => {
    expect(sayArgs({ voiceId: 'Thomas', rate: 1.1, out: '/tmp/o.wav' }, '/tmp/o.wav.txt')).toEqual([
      '-v', 'Thomas', '-r', '198', '--file-format=WAVE', '--data-format=LEI16@48000', '-o', '/tmp/o.wav', '-f', '/tmp/o.wav.txt'
    ])
  })

  it('maps a speed factor to a SAPI rate in -10…10', () => {
    expect(sapiRate(1)).toBe(0)
    expect(sapiRate(1.3)).toBe(3)
    expect(sapiRate(0.7)).toBe(-3)
    expect(sapiRate(5)).toBe(10)
    expect(sapiRate(0)).toBe(-10)
  })
})

describe('systemSpeechService with an injected exec', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'atelier-p4-speech-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))
  const secret = 'Le texte secret ; $(rm -rf /) `x` "q" \'s\' est lu depuis un fichier.'

  type Call = { file: string; args: string[]; env: NodeJS.ProcessEnv }
  const recorder = (stdout = ''): { calls: Call[]; exec: (f: string, a: string[], e: NodeJS.ProcessEnv) => Promise<string> } => {
    const calls: Call[] = []
    return {
      calls,
      exec: (file, args, env) => {
        calls.push({ file, args, env })
        return Promise.resolve(stdout)
      }
    }
  }
  const signal = new AbortController().signal

  it('darwin: spawns /usr/bin/say with the text in a file, no shell, text not in argv', async () => {
    const rec = recorder(SAY_SAMPLE)
    const svc = systemSpeechService({ platform: 'darwin', exec: rec.exec })
    expect(svc).not.toBeNull()
    const voices = await (svc as NonNullable<typeof svc>).voices(signal)
    expect(rec.calls[0]).toMatchObject({ file: '/usr/bin/say', args: ['-v', '?'] })
    expect(voices.length).toBeGreaterThanOrEqual(4)
    const out = path.join(tmp, 'a.wav')
    const r = await (svc as NonNullable<typeof svc>).speak({ text: secret, voiceId: 'Thomas', rate: 1, out }, signal)
    expect(r).toEqual({ marks: null })
    const call = rec.calls[1] as Call
    expect(call.file).toBe('/usr/bin/say')
    expect(call.args).toEqual(sayArgs({ voiceId: 'Thomas', rate: 1, out }, `${out}.txt`))
    expect(call.args[call.args.indexOf('-f') + 1]).toBe(`${out}.txt`)
    expect(call.args.join(' ')).not.toContain('secret')
    expect(readFileSync(`${out}.txt`, 'utf8')).toBe(secret)
  })

  it('win32: runs Windows PowerShell by full path with -EncodedCommand and passes settings by environment only', async () => {
    const rec = recorder('V|Microsoft Hortense Desktop|fr-FR\r\nV|Microsoft David Desktop|en-US\r\nnoise\r\n')
    const svc = systemSpeechService({ platform: 'win32', systemRoot: 'C:\\Windows', exec: rec.exec }) as NonNullable<ReturnType<typeof systemSpeechService>>
    const voices = await svc.voices(signal)
    expect(voices).toEqual([
      { id: 'Microsoft Hortense Desktop', name: 'Microsoft Hortense Desktop', language: 'fr' },
      { id: 'Microsoft David Desktop', name: 'Microsoft David Desktop', language: 'en' }
    ])
    expect(rec.calls[0]?.env.ATELIER_TTS_MODE).toBe('list')

    const out = path.join(tmp, 'b.wav')
    await svc.speak({ text: secret, voiceId: 'Microsoft Hortense Desktop', rate: 1.3, out }, signal)
    const call = rec.calls[1] as Call
    expect(call.file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(call.args.slice(0, 4)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'])
    const encoded = call.args[call.args.indexOf('-EncodedCommand') + 1] as string
    const script = Buffer.from(encoded, 'base64').toString('utf16le')
    expect(script).toBe(SAPI_SCRIPT)
    expect(script).not.toContain('${')
    expect(call.env).toMatchObject({
      ATELIER_TTS_MODE: 'speak',
      ATELIER_TTS_TEXT: `${out}.txt`,
      ATELIER_TTS_OUT: out,
      ATELIER_TTS_VOICE: 'Microsoft Hortense Desktop',
      ATELIER_TTS_RATE: '3'
    })
    // the text itself travels in the file only
    expect(JSON.stringify(call.args)).not.toContain('secret')
    expect(Object.values(call.env).some((v) => typeof v === 'string' && v.includes('secret'))).toBe(false)
    expect(readFileSync(`${out}.txt`, 'utf8')).toBe(secret)
  })

  it('has no system voice on Linux or other hosts', () => {
    expect(systemSpeechService({ platform: 'linux' })).toBeNull()
    expect(systemSpeechService({ platform: 'freebsd' })).toBeNull()
  })
})

describe('a slim ffmpeg fails early and clearly (lot P4M)', () => {
  // the listing format of `ffmpeg -filters` / `-encoders`; a slim build (Homebrew's plain ffmpeg) has no ass/drawtext
  const FILTERS = [
    ' T.. = Timeline support',
    ' ------',
    ' ... amix              N->A       Audio mixing.',
    ' ... gradients         |->V       Draw a gradients.',
    ' T.. vignette          V->V       Make or reverse a vignette effect.',
    ''
  ].join('\n')
  const ENCODERS = [' V..... = Video', ' ------', ' V....D libx264              libx264 H.264', ' A....D aac                  AAC (Advanced Audio Coding)', ''].join('\n')
  const fakeMedia = (calls: string[][]): MediaService => ({
    run: (_tool, args) => {
      calls.push(args)
      const out = args.includes('-filters') ? FILTERS : args.includes('-encoders') ? ENCODERS : ''
      return Promise.resolve({ stdout: Buffer.from(out), stderr: '' })
    },
    stream: () => {
      throw new Error('not used')
    }
  })
  const signal = new AbortController().signal

  it('parses the listings', () => {
    expect(parseCapabilityList(FILTERS)).toEqual(expect.arrayContaining(['amix', 'gradients', 'vignette']))
    expect(parseCapabilityList(ENCODERS)).toEqual(expect.arrayContaining(['libx264', 'aac']))
  })

  it('names what is missing, filters and encoders, and says to install ffmpeg-full', async () => {
    const calls: string[][] = []
    const media = fakeMedia(calls)
    await expect(requireFilters(media, ['amix', 'libx264'], signal)).resolves.toBeUndefined()
    const err = await requireFilters(media, ['ass', 'drawtext', 'flac'], signal).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'missing_tool' })
    expect((err as Error).message).toContain('(ass, drawtext, flac)')
    expect((err as Error).message).toContain('brew install ffmpeg-full')
    // listed once per media service
    expect(calls.filter((a) => a.includes('-filters'))).toHaveLength(1)
  })

  it('a drawing stops before running ffmpeg when drawtext is missing', async () => {
    const calls: string[][] = []
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'atelier-p4m-draw-'))
    try {
      const err = await drawStill(fakeMedia(calls), { out: path.join(tmp, 'a.jpg'), hash: 'ab12cd34ef', title: 't', detail: 'd', footer: 'f', font: '/f.ttf', watermark: true }, signal).catch((e: unknown) => e)
      expect(err).toMatchObject({ code: 'missing_tool' })
      expect((err as Error).message).toContain('drawtext')
      expect(calls.every((a) => a.includes('-filters') || a.includes('-encoders'))).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
