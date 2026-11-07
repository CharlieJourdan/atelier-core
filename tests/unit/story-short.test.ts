// clone-reddit-shorts, the story-short base: `story-short@1` ships with its options declared and every choice compiling, its measured
// settings reaching the bricks (the voice stretched to 310 words a minute, one-word captions in the middle from the second sentence,
// the post card popping in and out, clips cut on the measured log-normal lengths, each clip once); the one-word cue rule and its ASS
// style; references read fast land on it; the pop card's filter scales every frame; the Commons transcode chosen is the tallest WebM.
import { describe, expect, it } from 'vitest'
import type { EditPlan } from '../../src/engine/formats/editplan'
import type { Word } from '../../src/engine/formats/timing'
import { planPieces } from '../../src/engine/nodes/background-clips'
import { cardSeconds } from '../../src/engine/nodes/card-intro'
import { seededRandom } from '../../src/engine/errors'
import { postCardHtml } from '../../src/engine/motion/post-card'
import { cardGraph } from '../../src/engine/render/final'
import { checkDeclarations, compileRecipe, fromBase, STORY_SHORT_PROFILE, storyShortBase, technologyRegistry } from '../../src/engine/technologies'
import type { VideoMeasure } from '../../src/engine/technologies/fit'
import { baseForReferences, isStoryShort } from '../../src/engine/technologies/style-propose'
import { proposePipelines } from '../../src/engine/technologies/propose'
import { buildAss, makeCues, WORD_FONT, wordCues } from '../../src/engine/text/captions'
import { pickDerivative } from '../../src/main/production/clips/commons'

const reg = technologyRegistry()

const plan: EditPlan = {
  $schema: 'atelier.editplan/1',
  fps: 30,
  frames: 300,
  size: [1080, 1920],
  shots: [],
  tracks: { base: [], overlay: [], labels: [] }
} as unknown as EditPlan

const word = (w: string, start: number, end: number, sentence: number): Word => ({ w, start, end, sentence, paragraph: 0 })

describe('story-short@1', () => {
  it('ships with its options declared and every choice compiling', () => {
    expect(checkDeclarations(storyShortBase.options)).toEqual([])
    const doc = fromBase(storyShortBase)
    expect(compileRecipe(doc, reg, { id: 't' }).ok).toBe(true)
    for (const decl of storyShortBase.options) {
      const values = decl.kind === 'slider' ? [decl.min, decl.max] : decl.choices.filter((c) => !c.soon).map((c) => c.value)
      for (const value of values) expect(compileRecipe({ ...doc, options: { [decl.id]: value } }, reg, { id: 't' }).ok, `${decl.id}=${String(value)}`).toBe(true)
    }
  })

  it('passes its measured settings to the bricks: no picture to make, the clips are the picture', () => {
    const r = compileRecipe(fromBase(storyShortBase), reg, { id: 't', project: { minutes: 2.5 } })
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
    const p = r.pipeline
    const node = (id: string) => p.nodes.find((n) => n.id === id)
    expect(p.format).toMatchObject({ kind: 'youtube_short', aspect: '9:16' })
    expect(p.nodes.map((n) => n.id)).toEqual(['idea', 'script', 'translate', 'voice', 'timing', 'beats', 'director', 'background', 'card', 'captions', 'sound', 'render', 'qc', 'package'])
    expect(p.nodes.some((n) => n.type === 'visuals.fulfil@1' || n.type === 'avatar.speak@1')).toBe(false)
    expect(node('voice')?.params).toMatchObject({ wpm: STORY_SHORT_PROFILE.wpm, maxPauseS: 0.2 })
    expect(node('director')?.params).toMatchObject({ scenePass: false, labelsPerMin: 0, aspect: '9:16' })
    expect(node('background')?.params).toMatchObject({ medianS: 2.3, spread: 2.2, fresh: true, minPieceS: 0.7, aspect: '9:16', folder: '$inputs.gameplay' })
    expect(node('card')?.params).toMatchObject({ look: 'post', afterS: 0.35, aspect: '9:16' })
    expect(node('card')?.in).toMatchObject({ avatar: '$inputs.channelAvatar' })
    expect(node('captions')?.params).toMatchObject({ preset: 'word', position: 'middle', minWordS: 0.12, fromSentence: 1 })
    expect(p.inputs.map((i) => i.id)).toEqual(expect.arrayContaining(['script', 'gameplay', 'channel', 'channelAvatar']))
  })
})

describe('the options a user asked for (Charlie, 02/11)', () => {
  it('sets the voice speed and the clips rhythm with their sliders, the card picture and the music with their choices', () => {
    const doc = { ...fromBase(storyShortBase), options: { script: 'import', voicePace: 260, clipCadence: 4, cardPicture: 'initial', music: 'library' } }
    const r = compileRecipe(doc, reg, { id: 't' })
    if (!r.ok) throw new Error(JSON.stringify(r.errors))
    const node = (id: string) => r.pipeline.nodes.find((n) => n.id === id)
    expect(node('voice')?.params).toMatchObject({ wpm: 260 })
    expect(node('background')?.params).toMatchObject({ medianS: 4 })
    expect(node('card')?.params).toMatchObject({ avatarMode: 'initial' })
    expect(node('sound')?.params).toMatchObject({ source: 'library' })
    expect(node('sound')?.in).toMatchObject({ track: '$inputs.channelMusic' })
    const none = compileRecipe({ ...doc, options: { ...doc.options, cardPicture: 'none', music: 'none' } }, reg, { id: 't' })
    expect(none.ok && none.pipeline.nodes.some((n) => n.id === 'card' || n.id === 'sound')).toBe(false)
  })

  it('are settings, not questions of their own: « Créer une pipeline » asks the script, nothing about a presenter', () => {
    const p = proposePipelines({ baseId: 'story-short@1', videos: [] }, reg)
    expect(p.questions.map((q) => q.id)).toEqual(['script'])
    expect(p.questions.find((q) => q.id === 'script')?.default).toBe('import')
    const ids = storyShortBase.options.map((o) => o.id)
    expect(ids).toEqual(expect.arrayContaining(['voicePace', 'clipSource', 'clipCadence', 'cardPicture', 'music']))
    const perVideo = compileRecipe({ ...fromBase(storyShortBase), options: { script: 'import', clipSource: 'video' } }, reg, { id: 't' })
    expect(perVideo.ok && perVideo.pipeline.inputs.find((i) => i.id === 'gameplay')?.required).toBe(true)
  })
})

describe('one word at a time', () => {
  const words = [word('Mes', 0, 0.3, 0), word('parents.', 0.3, 0.8, 0), word('Il', 0.8, 0.9, 1), word('me', 0.9, 0.98, 1), word('disait', 0.98, 1.3, 1), word('non.', 1.3, 1.6, 1)]

  it('gives each word its cue and puts a word said in under 0.12 s with the next one (never across a sentence)', () => {
    expect(wordCues(words, 0.12).map((c) => c.lines[0]?.map((w) => w.text).join(' '))).toEqual(['Mes', 'parents.', 'Il me', 'disait', 'non.'])
  })

  it('starts after the title sentence when asked, and writes Montserrat ExtraBold in the middle, popping from 94 %', () => {
    const s = { preset: 'word' as const, maxChars: 42, lines: 1, leadMs: 50, minWordS: 0.12, fromSentence: 1 }
    const cues = makeCues(words, plan, s)
    expect(cues[0]?.lines[0]?.[0]?.text).toBe('Il')
    const ass = buildAss(cues, [], { ...s, position: 'middle', burn: true, accent: '#FFD84D', size: [1080, 1920] })
    const style = ass.split('\n').find((l) => l.startsWith('Style: Cap')) ?? ''
    const f = style.slice('Style: '.length).split(',')
    expect(f[1]).toBe(WORD_FONT)
    expect(Number(f[2])).toBe(130)
    expect(f[18]).toBe('5')
    expect(ass).toContain('\\fscx94\\fscy94\\t(0,100,\\fscx100\\fscy100)}Il me')
  })
})

describe('the clips', () => {
  const clips = Array.from({ length: 90 }, (_, i) => ({ file: `c${i}.mp4`, durationS: 14 }))

  it('cuts on the measured lengths (median ≈ 2.3 s) and shows each clip once before any comes back', () => {
    const pieces = planPieces(clips, 30 * 150, seededRandom(7), 0.7, 7, { medianS: 2.3, spread: 2.2, fresh: true })
    const lengths = pieces.map((p) => p.frames / 30).sort((a, b) => a - b)
    const median = lengths[Math.floor(lengths.length / 2)] as number
    expect(median).toBeGreaterThan(1.8)
    expect(median).toBeLessThan(2.9)
    expect(pieces.reduce((n, p) => n + p.frames, 0)).toBe(30 * 150)
    const files = pieces.map((p) => p.file)
    expect(new Set(files).size).toBe(files.length)
  })
})

describe('the post card', () => {
  it('stays for the title plus its margin, and pops in and out frame by frame', () => {
    const words = [word('Un', 0, 0.4, 0), word('titre.', 0.4, 1.9, 0), word('Puis', 2, 2.3, 1)]
    expect(cardSeconds(words, undefined, 0.35, 1.2)).toBe(2.25)
    const g = cardGraph({ startS: 0, endS: 2.25, anim: 'pop', y: 286, boxH: 358 }, 3, [1080, 1920])
    expect(g).toContain('scale=w=')
    expect(g).toContain('eval=frame')
    expect(g).toContain("y='286+(358-358*w/1080)/2'")
  })

  it('draws the name, the title and the reactions, escaped', () => {
    const html = postCardHtml({ title: 'Mon <voisin>', channel: 'Histoires', accent: '#3B82F6', likes: '69+', comments: '420+', share: 'Share', verified: true, awards: 8, fontCss: '' })
    expect(html).toContain('Mon &lt;voisin&gt;')
    expect(html).toContain('420+')
    expect((html.match(/class="aw"/g) ?? []).length).toBe(8)
  })
})

describe('choosing the base', () => {
  it('lands on story-short@1 for a voice read far faster than a narrator, and keeps the others', () => {
    const story: VideoMeasure = { presenterShare: 0, wordsPerMinute: 310, minutes: 2.6, captions: true, kinds: { stock: 1 } }
    expect(isStoryShort([story])).toBe(true)
    expect(baseForReferences([story, story])).toEqual({ baseId: 'story-short@1', reason: 'story' })
    expect(baseForReferences([{ presenterShare: 0, wordsPerMinute: 165, minutes: 12, kinds: { imageAi: 0.7, stock: 0.3 } }]).baseId).toBe('voiceover@1')
    // the eyes' real reading of two Reddit Chroniques Shorts (02/11): 142 wpm and half « AI clips », but vertical and captioned
    const read: VideoMeasure = { presenterShare: 0, wordsPerMinute: 142.5, minutes: null, captions: true, kinds: { clipAi: 0.5, stock: 0.25, motion: 0.25 }, vertical: true }
    expect(baseForReferences([read, read]).baseId).toBe('story-short@1')
    expect(baseForReferences([{ presenterShare: 0.3, wordsPerMinute: 320 }]).baseId).toBe('avatar@1')
  })

  it('reads the tallest WebM transcode of a Commons video, up to 1080 px', () => {
    const d = [
      { src: 'a.240p.webm', height: 240, type: 'video/webm; codecs="vp9"' },
      { src: 'a.1080p.webm', height: 1080, type: 'video/webm; codecs="vp9"' },
      { src: 'a.2160p.webm', height: 2160, type: 'video/webm; codecs="vp9"' },
      { src: 'a.360p.mov', height: 360, type: 'video/quicktime' }
    ]
    expect(pickDerivative('a.webm', d)).toBe('a.1080p.webm')
    expect(pickDerivative('a.webm', [])).toBe('a.webm')
  })
})
