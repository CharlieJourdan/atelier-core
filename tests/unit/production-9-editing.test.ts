// production-9 (editing): the QR code, the sponsor's slot on the mention's own words, the chapter marks, the layers of the final pass,
// the timeline's actions and the segment cache (changing the presenter's layout re-renders only the segments it touches, R7.6).
import { existsSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkEditPlan, type EditPlan, type GenList, type Shot } from '../../src/engine/formats/editplan'
import { Outline } from '../../src/engine/formats/outline'
import { parseSponsor } from '../../src/engine/formats/sponsor'
import { applyTimelineAction, TimelineEditError } from '../../src/engine/formats/timeline-edit'
import type { Word } from '../../src/engine/formats/timing'
import { qrBox } from '../../src/engine/media/marks'
import { qrMatrix, qrPng } from '../../src/engine/media/qr'
import { editChapters, numberedParts } from '../../src/engine/nodes/edit-chapters'
import { editSponsor, slotLayers } from '../../src/engine/nodes/edit-sponsor'
import { sponsorWindows } from '../../src/engine/nodes/sponsor-slots'
import { layerGraph } from '../../src/engine/render/layers'
import { renderSegment, segmentKey, segmentSpecs } from '../../src/engine/render/segments'
import type { MediaService } from '../../src/engine/services'
import { buildVtt } from '../../src/engine/text/captions'
import { MEDIA, art, hasFullFfmpeg, makeCtx, NO_FULL_FFMPEG, tempDir, testServices } from './engine-node-helpers'

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

/** Words of a few sentences, 0.3 s each, 0.5 s of silence between sentences. */
function wordsOf(sentences: string[]): Word[] {
  const out: Word[] = []
  let t = 0.2
  sentences.forEach((s, i) => {
    for (const w of s.split(' ')) {
      out.push({ w, start: t, end: t + 0.26, sentence: i, paragraph: i })
      t += 0.3
    }
    t += 0.5
  })
  return out
}

const SENTENCES = [
  'Une poêle brûlée se rattrape sans produit chimique.',
  'Il suffit de trois gestes simples.',
  'Avant d’aller plus loin, un mot sur Poêlo Clean.',
  'Leur spray au bicarbonate décape sans rayer.',
  'Le lien est en dessous.',
  'Revenons à notre poêle.',
  'Premier geste, le bicarbonate.'
]
const words = wordsOf(SENTENCES)
const D = (words.at(-1) as Word).end + 0.4
const outline = Outline.parse({
  language: 'fr',
  title: 'Rattraper une poêle',
  shape: 'howto',
  kind: 'lesson',
  promise: 'trois gestes',
  hook: SENTENCES[0],
  beats: [{ index: 0, purpose: 'tout', summary: 'tout', wordBudget: 50, tags: [] }],
  chapters: [],
  sponsor: [{ kind: 'mention', text: SENTENCES.slice(2, 5).join(' '), anchors: ['Avant d’aller plus loin, un mot', 'Leur spray au bicarbonate', 'Le lien est en dessous'], seconds: 6 }]
})
const SPONSOR = 'nom : Poêlo Clean\npitch : Le spray qui décape sans rayer.\nlien : https://poeloclean.example/atelier\nposition du qr : en haut à droite\ntaille du qr : 30 %'

const frames = Math.round(D * 30)
const holdPlan = (chapters: EditPlan['chapters'] = []): EditPlan => ({
  schema: 'atelier.editplan/1',
  fps: 30,
  size: [1920, 1080],
  frames,
  tracks: { base: ['s1'], overlay: [], labels: [] },
  captionsPreset: 'highlight',
  shots: [{ id: 's1', track: 'base', startFrame: 0, endFrame: frames, kind: 'hold', transitionIn: 'cut', role: 'base', beat: 0 }],
  chapters,
  diagnostics: []
})

describe('the QR code (our own encoder)', () => {
  it('picks the smallest version and is the same for the same link', () => {
    expect(qrMatrix('A')).toHaveLength(21)
    expect(qrMatrix('https://poeloclean.example/atelier')).toHaveLength(29)
    expect(qrMatrix('x'.repeat(200))).toHaveLength(57)
    expect(qrPng('https://a.example', 4)).toEqual(qrPng('https://a.example', 4))
    expect(() => qrMatrix('x'.repeat(300))).toThrow(/trop long/)
  })

  it('has its three finder patterns and its fixed dark module', () => {
    const m = qrMatrix('https://poeloclean.example/atelier')
    const n = m.length
    for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]] as const) {
      expect(m[y]?.[x]).toBe(true)
      expect(m[y + 1]?.[x + 1]).toBe(false)
      expect(m[y + 3]?.[x + 3]).toBe(true)
    }
    expect(m[n - 8]?.[8]).toBe(true)
  })

  it('sits in its box with whole pixels per module, inside the frame', () => {
    const modules = qrMatrix('https://poeloclean.example/atelier').length + 8
    for (const pos of ['bottom-right', 'top-right', 'bottom-left', 'top-left', 'center-right']) {
      const b = qrBox(pos, 0.28, [1920, 1080], modules)
      expect(b.w).toBe(b.scale * modules)
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y + b.h).toBeLessThanOrEqual(1080)
      expect(b.x + b.w).toBeLessThanOrEqual(1920)
    }
  })
})

describe('the sponsor (channel asset, pipeline-avatar §2.13)', () => {
  it('reads the QR and media lines of the asset', () => {
    const s = parseSponsor(`${SPONSOR}\nmédia : C:\\pubs\\poelo.mp4\nécran : vidéo`)
    expect(s).toMatchObject({ name: 'Poêlo Clean', link: 'https://poeloclean.example/atelier', media: 'C:\\pubs\\poelo.mp4', screen: 'media', qr: { show: true, position: 'top-right', size: 0.3 } })
    expect(parseSponsor('nom : X\nqr : non')?.qr.show).toBe(false)
    expect(parseSponsor('nom : X')).toMatchObject({ screen: 'card', media: '', qr: { show: true, position: 'bottom-right', size: 0.28 } })
  })

  it('the slot starts and ends on the mention’s words', () => {
    const [w] = sponsorWindows(outline, words, D)
    expect(w).toBeDefined()
    const first = words.findIndex((x) => x.sentence === 2)
    const last = words.findLastIndex((x) => x.sentence === 4)
    const after = words.findIndex((x) => x.sentence === 5)
    expect(w?.firstWord).toBe(first)
    expect(w?.lastWord).toBe(last)
    // from just before the first word of the mention…
    expect(w!.startS).toBeLessThanOrEqual(words[first]!.start)
    expect(w!.startS).toBeGreaterThan(words[first - 1]!.end)
    // …to after its last word, before the next sentence's first word
    expect(w!.endS).toBeGreaterThanOrEqual(words[last]!.end)
    expect(w!.endS).toBeLessThanOrEqual(words[after]!.start)
    // the card and the QR code take exactly those seconds (on the frame grid)
    const [slot] = slotLayers([w!], parseSponsor(SPONSOR)!, { media: null, qr: { x: 1, y: 1, w: 10, h: 10 } })
    expect(slot?.layers.map((l) => l.role)).toEqual(['sponsor-card', 'qr'])
    for (const l of slot!.layers) {
      expect(Math.abs(l.startS - w!.startS)).toBeLessThanOrEqual(1 / 60)
      expect(Math.abs(l.endS - w!.endS)).toBeLessThanOrEqual(1 / 60)
    }
  })

  it('a clip of the sponsor plays from the first word, and keeps its length so the render holds its last frame', () => {
    const [w] = sponsorWindows(outline, words, D)
    const [slot] = slotLayers([w!], { ...parseSponsor(SPONSOR)!, screen: 'media' }, { media: { video: true, durationS: 2 }, qr: null })
    expect(slot?.layers).toEqual([expect.objectContaining({ role: 'sponsor-media', video: true, durationS: 2 })])
    const g = layerGraph({ ...slot!.layers[0]!, file: 0, path: 'clip.mp4' }, 3, '[0:v]', '[o]', [1920, 1080])
    expect(g).toContain('tpad=stop_mode=clone')
    expect(g).toContain(`setpts=PTS+${slot!.layers[0]!.startS.toFixed(3)}/TB`)
    expect(g).not.toContain('loop')
  })

  it.skipIf(!hasFullFfmpeg)(`edit.sponsor draws the card and the QR code on the mention (${hasFullFfmpeg ? 'ffmpeg' : NO_FULL_FFMPEG})`, async () => {
    const t = tempDir('sponsor')
    cleanup = t.cleanup
    const out = await editSponsor.run(
      makeCtx(testServices(t.dir)),
      {
        plan: art('json.editplan', { value: holdPlan() as never }),
        outline: art('json.outline', { value: outline as never }),
        words: art('json.words', { value: words as never }),
        sponsor: art('text.input', { value: SPONSOR })
      },
      editSponsor.params.parse({})
    )
    const layers = out.slots?.value as { role: string; file: number; box?: { x: number; y: number } }[]
    expect(layers.map((l) => l.role)).toEqual(['sponsor-card', 'qr'])
    expect(layers[1]?.box?.y).toBeLessThan(300)
    expect(out.slots?.files?.every((f) => existsSync(f))).toBe(true)
    const qr = out.slots?.files?.[1] as string
    const filters = (await MEDIA!.run('ffmpeg', ['-hide_banner', '-filters'], { signal: new AbortController().signal })).stdout
    if (filters.includes('quirc')) {
      const { stderr } = await MEDIA!.run('ffmpeg', ['-v', 'info', '-i', qr, '-vf', 'format=gray,quirc', '-f', 'null', '-'], { signal: new AbortController().signal })
      expect(stderr).toContain('payload: https://poeloclean.example/atelier')
    }
  })

  it('without a sponsor, or without a mention, nothing shows', async () => {
    const t = tempDir('sponsor-none')
    cleanup = t.cleanup
    const run = (sponsor: string | null, o = outline) =>
      editSponsor.run(
        makeCtx(testServices(t.dir)),
        { plan: art('json.editplan', { value: holdPlan() as never }), outline: art('json.outline', { value: o as never }), words: art('json.words', { value: words as never }), ...(sponsor ? { sponsor: art('text.input', { value: sponsor }) } : {}) },
        editSponsor.params.parse({})
      )
    expect((await run(null)).slots?.value).toEqual([])
    expect((await run(SPONSOR, { ...outline, sponsor: undefined })).slots?.value).toEqual([])
  })
})

describe('the chapter marks (pipeline-avatar §2.12)', () => {
  it('number the parts after the opening, each for its seconds, never into the next one', () => {
    const plan = { frames: 3000, chapters: [{ title: 'Intro', startFrame: 0 }, { title: 'Premier geste', startFrame: 600 }, { title: 'Deuxième geste', startFrame: 660 }, { title: 'Fin', startFrame: 2985 }] }
    const parts = numberedParts(plan, 4)
    expect(parts.map((p) => [p.n, p.title])).toEqual([
      [1, 'Premier geste'],
      [2, 'Deuxième geste']
    ])
    expect(parts[0]?.endS).toBeCloseTo(22 - 0.2, 5)
    expect(parts[1]?.endS).toBeCloseTo(26, 5)
  })

  it.skipIf(!hasFullFfmpeg)('edit.chapters draws one mark per part, top right, that pops', async () => {
    const t = tempDir('chapters')
    cleanup = t.cleanup
    const out = await editChapters.run(makeCtx(testServices(t.dir)), { plan: art('json.editplan', { value: holdPlan([{ title: 'Premier geste', startFrame: 30 }]) as never }) }, editChapters.params.parse({ prefix: 'Astuce' }))
    const [mark] = out.marks?.value as { role: string; enter: string; box: { x: number; y: number; w: number } }[]
    expect(mark).toMatchObject({ role: 'chapter', enter: 'pop' })
    expect(mark!.box.x + mark!.box.w).toBeGreaterThan(1800)
    expect(mark!.box.y).toBeLessThan(120)
    expect(existsSync(out.marks?.files?.[0] as string)).toBe(true)
  })

  it('pops: the still grows from 60 % around its box centre, then holds', () => {
    const g = layerGraph({ file: 0, path: 'm.png', role: 'chapter', startS: 10, endS: 14, box: { x: 1400, y: 60, w: 400, h: 80 }, video: false, enter: 'pop', fadeS: 0.25 }, 4, '[a]', '[b]', [1920, 1080])
    expect(g).toContain('eval=frame')
    expect(g).toContain('0.6+0.4*min(1,max(0,(t-10.000)/0.18))')
    expect(g).toContain("x='1400+(400-overlay_w)/2'")
    expect(g).toContain("enable='between(t,10.000,14.000)'")
  })
})

describe('captions: SRT and WebVTT always', () => {
  it('writes WebVTT with its header and dotted milliseconds', () => {
    const vtt = buildVtt([{ start: 1.5, end: 3.25, lines: [[{ text: 'Bonjour', start: 1.5, end: 2 }]] }])
    expect(vtt.startsWith('WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.250\n')).toBe(true)
  })
})

// a small film: a picture, the presenter, a picture, the presenter (one second each)
function film(dir: string): { plan: EditPlan; list: GenList; files: Record<string, string> } {
  const files: Record<string, string> = {}
  for (const [id, bytes] of [['img1', 'one'], ['img2', 'two'], ['av1', 'clip-1'], ['av2', 'clip-2']] as const) {
    files[id] = path.join(dir, `${id}.${id.startsWith('av') ? 'mp4' : 'png'}`)
    writeFileSync(files[id] as string, bytes)
  }
  const shot = (id: string, kind: Shot['kind'], genItem: string, k: number): Shot => ({
    id,
    track: 'base',
    startFrame: k * 30,
    endFrame: (k + 1) * 30,
    kind,
    genItem,
    transitionIn: 'cut',
    role: 'scene',
    beat: 0,
    ...(kind === 'avatar' ? { layout: 'full' as const } : { motion: { kind: 'push' as const, from: 1.02, to: 1.1 } })
  })
  const shots = [shot('s1', 'image.gen', 'img1', 0), shot('s2', 'avatar', 'av1', 1), shot('s3', 'image.gen', 'img2', 2), shot('s4', 'avatar', 'av2', 3)]
  const item = (id: string, kind: 'image.gen' | 'avatar', shotId: string) => ({
    id,
    kind,
    prompt: `${id} prompt`,
    constraints: { durationS: 1, aspect: '16:9' as const },
    context: { beatText: '', subject: id, keyTerms: [] },
    unitPrice: kind === 'avatar' ? 2 : 3,
    units: 1,
    priority: 1,
    shotIds: [shotId],
    ...(kind === 'avatar' ? { layout: 'full' as const, voiceRange: { startFrame: 0, endFrame: 30 } } : {})
  })
  const items = [item('img1', 'image.gen', 's1'), item('av1', 'avatar', 's2'), item('img2', 'image.gen', 's3'), item('av2', 'avatar', 's4')]
  return {
    plan: { schema: 'atelier.editplan/1', fps: 30, size: [1920, 1080], frames: 120, tracks: { base: shots.map((s) => s.id), overlay: [], labels: [] }, captionsPreset: 'highlight', shots, chapters: [], diagnostics: [] },
    list: { items, totals: { credits: 10, items: 4, byKind: { 'image.gen': 2, avatar: 2 } }, budget: null },
    files
  }
}

function specsOf(plan: EditPlan, files: Record<string, string>) {
  const base = plan.tracks.base.map((id) => plan.shots.find((s) => s.id === id) as Shot)
  const img = (id: string | undefined): string => files[id ?? ''] ?? (files.img1 as string)
  return segmentSpecs(
    base,
    (s) => img(s.kind === 'avatar' ? undefined : s.genItem),
    'none',
    [1920, 1080],
    (s) => (s.kind === 'avatar' && s.genItem ? { file: files[s.genItem] as string, durationS: 1 } : undefined),
    (s) => (s.beside ? { image: img(s.beside.genItem) } : undefined)
  )
}

describe('the timeline’s actions (R7.2) and the segment cache (R7.6)', () => {
  it('changing the presenter’s layout re-renders only the segments it touches', async () => {
    const t = tempDir('layout-cache')
    cleanup = t.cleanup
    const { plan, list, files } = film(t.dir)
    const r = applyTimelineAction(plan, list, { op: 'layout', shot: 's4', layout: 'split' })
    expect(r.touched).toEqual(['s4'])
    expect(r.credits).toBe(0)
    expect(r.plan.shots.find((s) => s.id === 's4')).toMatchObject({ layout: 'split', beside: { genItem: 'img2', side: 'right' } })
    expect(checkEditPlan(r.plan, r.list, 120)).toEqual([])
    const before = specsOf(plan, files)
    const after = specsOf(r.plan, files)
    expect(after.find((s) => s.shotId === 's4')?.split).toMatchObject({ side: 'right', image: files.img2 })
    const kb = await Promise.all(before.map(segmentKey))
    const ka = await Promise.all(after.map(segmentKey))
    expect(before.map((s, i) => (kb[i] === ka[i] ? null : s.shotId)).filter(Boolean)).toEqual(['s4'])
    // a render with the cache: four segments made, then only the one the change touched
    let made = 0
    const media: MediaService = {
      run: async (_tool: string, args: string[]) => {
        made++
        await writeFile(args.at(-1) as string, 'segment')
        return { stdout: '', stderr: '' }
      }
    } as unknown as MediaService
    const signal = new AbortController().signal
    for (const s of before) await renderSegment(media, s, t.dir, signal)
    expect(made).toBe(4)
    const second = await Promise.all(after.map((s) => renderSegment(media, s, t.dir, signal)))
    expect(made).toBe(5)
    expect(second.map((x) => x.cached)).toEqual([true, true, true, false])
  })

  it('full → pip → full: the picture goes under the presenter, then the presenter comes back over its own frames', () => {
    const t = tempDir('layout-pip')
    cleanup = t.cleanup
    const { plan, list } = film(t.dir)
    const pip = applyTimelineAction(plan, list, { op: 'layout', shot: 's2', layout: 'pip' })
    expect(pip.touched).toEqual(['s2'])
    expect(pip.plan.shots.find((s) => s.id === 's2')).toMatchObject({ kind: 'image.gen', genItem: 'img1' })
    expect(pip.plan.tracks.overlay).toEqual(['s2p'])
    expect(pip.list.items.find((i) => i.id === 'av1')).toMatchObject({ layout: 'pip', shotIds: ['s2p'] })
    expect(checkEditPlan(pip.plan, pip.list, 120)).toEqual([])
    const back = applyTimelineAction(pip.plan, pip.list, { op: 'layout', shot: 's2p', layout: 'full' })
    expect(back.plan.tracks.overlay).toEqual([])
    expect(back.plan.shots.find((s) => s.id === 's2p')).toMatchObject({ track: 'base', layout: 'full', startFrame: 30, endFrame: 60 })
    expect(back.plan.tracks.base).toEqual(['s1', 's2p', 's3', 's4'])
    expect(checkEditPlan(back.plan, back.list, 120)).toEqual([])
  })

  it('delete: a picture neighbour stretches over it (never the presenter), and its item is no longer generated', () => {
    const t = tempDir('delete')
    cleanup = t.cleanup
    const { plan, list } = film(t.dir)
    // s3 sits between two presenter shots: stretching one would freeze the presenter while the voice goes on
    expect(() => applyTimelineAction(plan, list, { op: 'delete', shot: 's3' })).toThrow(TimelineEditError)
    // s4 a picture: deleting s3 stretches s4 back over it (s2 before it is the presenter)
    const pictureEnd: EditPlan = { ...plan, shots: plan.shots.map((s) => (s.id === 's4' ? { ...s, kind: 'image.gen' as const, genItem: 'img1', layout: undefined } : s)) }
    const r = applyTimelineAction(pictureEnd, list, { op: 'delete', shot: 's3' })
    expect(r.touched).toEqual(['s4'])
    expect(r.plan.shots.find((s) => s.id === 's4')).toMatchObject({ startFrame: 60, endFrame: 120 })
    expect(r.plan.shots.find((s) => s.id === 's2')).toMatchObject({ startFrame: 30, endFrame: 60 })
    expect(r.list.items.map((i) => i.id)).toEqual(['img1', 'av1'])
    expect(r.list.totals.credits).toBe(5)
    expect(checkEditPlan(r.plan, r.list, 120)).toEqual([])
    // the last shot: the one before stretches when it is a picture
    const first = applyTimelineAction(pictureEnd, list, { op: 'delete', shot: 's4' })
    expect(first.plan.shots.find((s) => s.id === 's3')).toMatchObject({ startFrame: 60, endFrame: 120 })
  })

  it('regenerate: a new item with the new prompt, priced before it runs', () => {
    const t = tempDir('regen')
    cleanup = t.cleanup
    const { plan, list } = film(t.dir)
    const r = applyTimelineAction(plan, list, { op: 'regenerate', shot: 's3', prompt: 'une poêle propre, gros plan' })
    expect(r.regenerate).toEqual(['img2-r2'])
    expect(r.credits).toBe(3)
    expect(r.touched).toEqual(['s3'])
    expect(r.list.items.find((i) => i.id === 'img2-r2')?.prompt).toBe('une poêle propre, gros plan')
    expect(applyTimelineAction(r.plan, r.list, { op: 'regenerate', shot: 's3' }).regenerate).toEqual(['img2-r3'])
    expect(() => applyTimelineAction(plan, list, { op: 'regenerate', shot: 's2' })).toThrow(TimelineEditError)
    expect(() => applyTimelineAction(plan, list, { op: 'layout', shot: 's1', layout: 'split' })).toThrow(/présentateur/)
  })
})
