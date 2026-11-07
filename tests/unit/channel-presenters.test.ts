// production-7: the channel presenter (`presenter.make`). A portrait is made from words and listed; a clone from the channel's
// own videos' frames needs the consent tick (`own-channel`) and is proposed until accepted; an angle that does not pass the
// face-similarity check is dropped (one retry per framing) while a same-person angle is kept; a registration needs a known
// presenter engine; the channel's default presenter becomes the run style's `presenter`. Stand-in pictures, nothing paid.
import { createHash } from 'node:crypto'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db'
import { ChannelPresenters, PORTRAIT_CLEAN_ENGINE, PRESENTER_STYLE_SUFFIX, fakePresenterPictures, portraitCleaner, type PresenterPictures } from '../../src/main/production/presenters'
import { NO_CONTEXT, contextOf, styleWithProfile } from '../../src/main/production/runs/profile'
import { drawPortrait } from '../../src/engine/media/draw-video'
import { ANGLE_SIMILARITY_MIN } from '../../src/engine/presenter/face'
import { PresenterRef } from '../../src/engine/presenter/talk'
import type { Framing } from '../../src/shared/presenter-engines'
import { MEDIA, NO_FULL_FFMPEG, hasFullFfmpeg, tempDir } from './engine-node-helpers'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})
function work(label: string): string {
  const t = tempDir(label)
  cleanups.push(t.cleanup)
  return t.dir
}

/** A picture port that records what it was asked and writes a placeholder file (no ffmpeg needed). */
function plainPictures(dir: string): PresenterPictures & { prompts: string[] } {
  const prompts: string[] = []
  let n = 0
  const make = (): { file: string; demo: boolean } => {
    const file = path.join(dir, `pic-${(n += 1)}.png`)
    writeFileSync(file, `picture ${n}`)
    return { file, demo: true }
  }
  return { prompts, portrait: async (r) => (prompts.push(r.prompt), make()), edit: async (r) => (prompts.push(r.prompt), make()) }
}

function setup(o: { pictures?: (dir: string) => PresenterPictures; media?: boolean } = {}) {
  const dir = work('presenters')
  const db = openDatabase(':memory:')
  const channelId = Number(db.prepare("INSERT INTO channels (name) VALUES ('Histoire')").run().lastInsertRowid)
  let t = Date.parse('2026-11-01T10:00:00Z')
  const pictures = o.pictures ? o.pictures(dir) : plainPictures(dir)
  const events: string[] = []
  const presenters = new ChannelPresenters({
    db,
    dir: path.join(dir, 'presenters'),
    pictures,
    media: o.media === false ? null : MEDIA,
    now: () => new Date((t += 1000)),
    notify: () => events.push('production')
  })
  return { db, dir, channelId, presenters, pictures, events }
}
const consent = { granted: true, statement: 'own-channel' as const, by: 'Charlie' }
const description = 'A woman in her thirties, short dark hair, a navy cardigan, in a book-lined study.'

function frame(dir: string, name = 'frame.png'): string {
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  writeFileSync(file, 'a frame of the channel’s own video')
  return file
}

describe('the presenter made from words', () => {
  it('a plain port: the prompt is the description and the presenter-studio suffix; the portrait is kept, listed, default', async () => {
    const s = setup()
    const v = await s.presenters.portrait({ channelId: s.channelId, name: 'Léa', description })
    expect(v).toMatchObject({ name: 'Léa', method: 'portrait', status: 'active', isDefault: true, hasPortrait: true, angles: [], registeredEngines: [], voiceId: null })
    expect(v.consent).toMatchObject({ statement: 'designed' })
    expect((s.pictures as ReturnType<typeof plainPictures>).prompts[0]).toBe(`${description}\n\n${PRESENTER_STYLE_SUFFIX}`)
    expect(s.presenters.list(s.channelId).map((p) => p.id)).toEqual([v.id])
    expect(s.events.length).toBeGreaterThan(0)
    await expect(s.presenters.portrait({ channelId: s.channelId, name: '', description })).rejects.toThrow(/nom du présentateur/)
    await expect(s.presenters.portrait({ channelId: s.channelId, name: 'x', description: 'short' })).rejects.toThrow(/description/)
    await expect(s.presenters.portrait({ channelId: 999, name: 'x', description })).rejects.toThrow(/Chaîne introuvable/)
  })

  it('the style store’s suffix replaces the built-in one; a failing port leaves no presenter behind', async () => {
    const s = setup()
    const dir = work('port')
    const custom = new ChannelPresenters({
      db: s.db,
      dir: path.join(dir, 'p'),
      pictures: plainPictures(dir),
      media: null,
      styleSuffix: () => 'STUDIO LIGHT.'
    })
    await custom.portrait({ channelId: s.channelId, name: 'Léa', description })
    expect(((custom as unknown as { o: { pictures: ReturnType<typeof plainPictures> } }).o.pictures).prompts[0]).toBe(`${description}\n\nSTUDIO LIGHT.`)
    const failing = new ChannelPresenters({ db: s.db, dir: path.join(dir, 'q'), pictures: { portrait: async () => Promise.reject(new Error('moteur en panne')), edit: async () => Promise.reject(new Error('x')) }, media: null })
    await expect(failing.portrait({ channelId: s.channelId, name: 'Zoé', description })).rejects.toThrow(/en panne/)
    expect(failing.list(s.channelId).map((p) => p.name)).toEqual(['Léa'])
  })

  it.skipIf(!hasFullFfmpeg)(`the stand-in drawing makes a real picture file${NO_FULL_FFMPEG}`, async () => {
    const s = setup({ pictures: (dir) => fakePresenterPictures(path.join(dir, 'drawn'), MEDIA) })
    const v = await s.presenters.portrait({ channelId: s.channelId, name: 'Léa', description })
    const ref = s.presenters.styleFor(s.channelId)
    expect(v.hasPortrait).toBe(true)
    expect(ref?.portrait && existsSync(ref.portrait)).toBe(true)
  })
})

describe('the consent of decision 0025: no clone without it', () => {
  it('a clone without the tick, unticked, or with another statement is refused and nothing is stored', async () => {
    const s = setup()
    const frames = [frame(s.dir)]
    await expect(s.presenters.clone({ channelId: s.channelId, name: 'Marie', frames, consent: undefined as never })).rejects.toThrow(/cette chaîne est à moi/)
    await expect(s.presenters.clone({ channelId: s.channelId, name: 'Marie', frames, consent: { granted: false, statement: 'own-channel' } })).rejects.toThrow(/cette chaîne est à moi/)
    await expect(s.presenters.clone({ channelId: s.channelId, name: 'Marie', frames, consent: { granted: true, statement: 'rights' as never } })).rejects.toThrow(/cette chaîne est à moi/)
    expect(s.presenters.list(s.channelId)).toEqual([])
  })

  it('with own-channel: who and when are stored, the presenter is proposed (not used by runs) until accepted', async () => {
    const s = setup()
    const v = await s.presenters.clone({ channelId: s.channelId, name: 'Marie', frames: ['/nope/missing.png', frame(s.dir)], consent })
    expect(v).toMatchObject({ method: 'clone', status: 'proposed', isDefault: false, hasPortrait: true })
    expect(v.consent).toEqual({ by: 'Charlie', at: expect.stringMatching(/^2026-11-01T10:00:/) as unknown as string, statement: 'own-channel' })
    expect(s.presenters.styleFor(s.channelId)).toBeNull()
    const accepted = s.presenters.accept(v.id)
    expect(accepted).toMatchObject({ status: 'active', isDefault: true })
    expect(s.presenters.styleFor(s.channelId)?.id).toBe(String(v.id))
    expect(() => s.presenters.accept(v.id)).toThrow(/pas une proposition/)
  })

  it('no readable frame: refused, nothing stored', async () => {
    const s = setup()
    await expect(s.presenters.clone({ channelId: s.channelId, name: 'Marie', frames: ['/nope/missing.png'], consent })).rejects.toThrow(/Aucune image lisible/)
    expect(s.presenters.list(s.channelId)).toEqual([])
  })
})

describe('the angles and the face-similarity check', () => {
  it.skipIf(!hasFullFfmpeg)(`an angle of another person is dropped after its retry; the same person's angles are kept${NO_FULL_FFMPEG}`, { timeout: 240_000 }, async () => {
    const media = MEDIA as NonNullable<typeof MEDIA>
    const signal = new AbortController().signal
    const calls: Framing[] = []
    // the portrait and the same-person angles show person A; the close-up comes out as person B
    const A = '0000000300000000'
    const B = '0000000700000004'
    let n = 0
    const pictures = (dir: string): PresenterPictures => ({
      portrait: async () => {
        const file = path.join(dir, `p-${(n += 1)}.png`)
        await drawPortrait(media, { out: file, hash: A, aspect: '16:9', framing: 'medium', signal })
        return { file, demo: true }
      },
      edit: async ({ framing }) => {
        calls.push(framing)
        const file = path.join(dir, `e-${(n += 1)}.png`)
        await drawPortrait(media, { out: file, hash: framing === 'close' ? B : A, aspect: '16:9', framing, signal })
        return { file, demo: true }
      }
    })
    const s = setup({ pictures })
    const p = await s.presenters.portrait({ channelId: s.channelId, name: 'Léa', description })
    const r = await s.presenters.angles(p.id)
    expect(r.dropped.map((d) => d.framing)).toEqual(['close'])
    expect(r.dropped[0]?.score).toBeLessThan(ANGLE_SIMILARITY_MIN)
    expect(calls.filter((f) => f === 'close')).toHaveLength(2)
    expect(r.kept.map((k) => k.framing)).toEqual(['wide', 'medium'])
    for (const k of r.kept) expect(k.score).toBeGreaterThanOrEqual(ANGLE_SIMILARITY_MIN)
    expect(r.presenter.angles.map((a) => a.framing)).toEqual(['wide', 'medium'])
    // the run style carries only the kept angles, as absolute files that exist
    const ref = s.presenters.styleFor(s.channelId)
    expect(ref?.angles.map((a) => a.framing)).toEqual(['wide', 'medium'])
    for (const a of ref?.angles ?? []) {
      expect(path.isAbsolute(a.file)).toBe(true)
      expect(existsSync(a.file)).toBe(true)
    }
    // asking again replaces the previous angles
    const again = await s.presenters.angles(p.id, { count: 4 })
    expect(again.kept.length + again.dropped.length).toBe(4)
  })

  it.skipIf(!hasFullFfmpeg)(`the stand-in port keeps the same person across framings${NO_FULL_FFMPEG}`, { timeout: 240_000 }, async () => {
    const s = setup({ pictures: (dir) => fakePresenterPictures(path.join(dir, 'drawn'), MEDIA) })
    const p = await s.presenters.portrait({ channelId: s.channelId, name: 'Léa', description })
    const r = await s.presenters.angles(p.id, { count: 3 })
    expect(r.kept.length).toBeGreaterThanOrEqual(2)
    expect(r.kept.length + r.dropped.length).toBe(3)
  })

  it('the count is 3 to 6; a presenter without portrait or without ffmpeg cannot have angles', async () => {
    const s = setup()
    const p = await s.presenters.portrait({ channelId: s.channelId, name: 'Léa', description })
    for (const count of [2, 7, 3.5]) await expect(s.presenters.angles(p.id, { count })).rejects.toThrow(/entre 3 et 6/)
    const noMedia = setup({ media: false })
    const q = await noMedia.presenters.portrait({ channelId: noMedia.channelId, name: 'Léa', description })
    await expect(noMedia.presenters.angles(q.id)).rejects.toThrow(/ffmpeg/)
    await expect(s.presenters.angles(999)).rejects.toThrow(/introuvable/)
  })
})

describe.skipIf(!hasFullFfmpeg)(`« nettoyer le portrait » (production-17)${NO_FULL_FFMPEG}`, () => {
  function withCleaner(cloud: Parameters<typeof portraitCleaner>[0]['cloud']) {
    const dir = work('presenters-clean')
    const db = openDatabase(':memory:')
    const channelId = Number(db.prepare("INSERT INTO channels (name) VALUES ('Histoire')").run().lastInsertRowid)
    const presenters = new ChannelPresenters({ db, dir: path.join(dir, 'presenters'), pictures: fakePresenterPictures(path.join(dir, 'drawn'), MEDIA), media: MEDIA, cleaner: portraitCleaner({ dir: path.join(dir, 'clean'), media: MEDIA, cloud }) })
    return { dir, channelId, presenters }
  }

  it('signed in: GPT Image medium edits the portrait (the portrait as reference); kept when it is the same face, the original beside it, the registrations reset', { timeout: 120_000 }, async () => {
    const asked: { engine?: string; references?: string[] }[] = []
    const s = withCleaner(() => ({
      generateImage: async (req, opts) => {
        asked.push({ ...(req.engine ? { engine: req.engine } : {}), ...(req.references ? { references: req.references } : {}) })
        // the « cleaned » portrait: the same picture, sharpened (the same person)
        const out = path.join(opts.dir, 'cleaned.png')
        await (MEDIA as NonNullable<typeof MEDIA>).run('ffmpeg', ['-v', 'error', '-y', '-i', req.references?.[0] as string, '-vf', 'unsharp=5:5:1.0', '-frames:v', '1', out], { signal: opts.signal })
        return { files: [out], demo: false, credits: 2 }
      }
    }))
    const p = await s.presenters.portrait({ channelId: s.channelId, name: 'Léa', description })
    s.presenters.register(p.id, 'presenter:heygen-mcp', 'heygen-look:as-1#0123456789abcdef')
    const before = s.presenters.styleFor(s.channelId)?.portrait as string
    const r = await s.presenters.clean(p.id)
    expect(asked).toEqual([{ engine: PORTRAIT_CLEAN_ENGINE, references: [before] }])
    expect(PORTRAIT_CLEAN_ENGINE).toBe('image:gpt-image-25-medium')
    expect(r.demo).toBe(false)
    expect(r.score).toBeGreaterThanOrEqual(ANGLE_SIMILARITY_MIN)
    const after = s.presenters.styleFor(s.channelId)
    expect(after?.portrait).toMatch(/portrait-clean\.png$/)
    expect(after?.registrations).toEqual({})
    expect(existsSync(path.join(path.dirname(before), 'portrait-original.png'))).toBe(true)
  })

  it('another face is refused (the portrait stays); signed out, a sharpened stand-in; a retired presenter is never touched', { timeout: 120_000 }, async () => {
    const other = withCleaner(() => ({
      generateImage: async (_req, opts) => {
        const out = path.join(opts.dir, 'someone-else.png')
        await drawPortrait(MEDIA as NonNullable<typeof MEDIA>, { out, hash: createHash('sha256').update('another person entirely').digest('hex'), aspect: '16:9', framing: 'medium', signal: opts.signal })
        return { files: [out], demo: false }
      }
    }))
    const p = await other.presenters.portrait({ channelId: other.channelId, name: 'Léa', description })
    const before = other.presenters.styleFor(other.channelId)?.portrait
    await expect(other.presenters.clean(p.id)).rejects.toThrow(/pas assez la même personne/)
    expect(other.presenters.styleFor(other.channelId)?.portrait).toBe(before)

    const out = withCleaner(() => null)
    const q = await out.presenters.portrait({ channelId: out.channelId, name: 'Léa', description })
    expect((await out.presenters.clean(q.id)).demo).toBe(true)
    out.presenters.retire(q.id)
    await expect(out.presenters.clean(q.id)).rejects.toThrow(/retiré/)
  })
})

describe('registrations, statuses, voice, and the run style', () => {
  it('register refuses an unknown engine and keeps the id per engine; a run’s ids go to the default presenter', async () => {
    const s = setup()
    const p = await s.presenters.portrait({ channelId: s.channelId, name: 'Léa', description })
    expect(() => s.presenters.register(p.id, 'presenter:nope', 'x')).toThrow(/Moteur de présentateur inconnu/)
    expect(() => s.presenters.register(p.id, 'presenter:heygen-avatar4', '')).toThrow(/identifiant/)
    expect(s.presenters.register(p.id, 'presenter:heygen-avatar4', 'look-1').registeredEngines).toEqual(['presenter:heygen-avatar4'])
    const viaRun = s.presenters.registrationsFromRun(s.channelId, { 'presenter:hedra-c3': 'h-9', 'presenter:unknown': 'zz', 'presenter:heygen-avatar4': 'look-2' })
    expect(viaRun?.registeredEngines.sort()).toEqual(['presenter:hedra-c3', 'presenter:heygen-avatar4'])
    expect(s.presenters.styleFor(s.channelId)?.registrations).toEqual({ 'presenter:heygen-avatar4': 'look-2', 'presenter:hedra-c3': 'h-9' })
    expect(s.presenters.registrationsFromRun(s.channelId + 1, { 'presenter:hedra-c3': 'x' })).toBeNull()
  })

  it('styleFor returns the default active presenter as a PresenterRef; a retired one is never used', async () => {
    const s = setup()
    expect(s.presenters.styleFor(s.channelId)).toBeNull()
    const a = await s.presenters.portrait({ channelId: s.channelId, name: 'Léa', description })
    const b = await s.presenters.portrait({ channelId: s.channelId, name: 'Max', description: `${description} A man.` })
    expect(b.isDefault).toBe(false)
    const ref = s.presenters.styleFor(s.channelId) as PresenterRef
    expect(PresenterRef.parse(ref)).toEqual({ id: String(a.id), portrait: expect.any(String) as unknown as string, angles: [], registrations: {} })
    expect(path.isAbsolute(ref.portrait as string)).toBe(true)
    expect(s.presenters.setDefault(b.id).isDefault).toBe(true)
    expect(s.presenters.styleFor(s.channelId)?.id).toBe(String(b.id))
    s.presenters.retire(b.id)
    expect(s.presenters.styleFor(s.channelId)).toBeNull()
    expect(() => s.presenters.setDefault(b.id)).toThrow(/actif/)
    expect(s.presenters.list(s.channelId).map((p) => p.id)).toEqual([a.id, b.id])
  })

  it('links a voice of the same channel, refuses another channel’s', async () => {
    const s = setup()
    const other = Number(s.db.prepare("INSERT INTO channels (name) VALUES ('Autre')").run().lastInsertRowid)
    const voice = (c: number): number =>
      Number(s.db.prepare("INSERT INTO channel_voices (channel_id, name, method, status, created_at, updated_at) VALUES (?, 'V', 'design', 'active', 'now', 'now')").run(c).lastInsertRowid)
    const mine = voice(s.channelId)
    const theirs = voice(other)
    const p = await s.presenters.portrait({ channelId: s.channelId, name: 'Léa', description })
    expect(s.presenters.linkVoice(p.id, mine).voiceId).toBe(mine)
    expect(() => s.presenters.linkVoice(p.id, theirs)).toThrow(/Voix introuvable/)
    expect(s.presenters.linkVoice(p.id, null).voiceId).toBeNull()
  })

  it('the run style gets `presenter`; with no presenter the context and the style are exactly as before', () => {
    const ref: PresenterRef = { id: '4', portrait: '/p/portrait.png', angles: [{ framing: 'wide', file: '/p/a.png' }], registrations: { 'presenter:heygen-avatar4': 'look-1' } }
    expect(contextOf(null, [], [], null)).toBe(NO_CONTEXT)
    expect(contextOf(null, [], [], null, null)).toBe(NO_CONTEXT)
    const ctx = contextOf(null, [], [], null, ref)
    expect(ctx).not.toBe(NO_CONTEXT)
    expect(ctx.presenter).toEqual(ref)
    expect(styleWithProfile({ captions: 'classic' }, ctx)).toEqual({ captions: 'classic', presenter: ref })
    const withVoice = contextOf(null, [], [], { voice: 'v1', voices: { 'voice:elevenlabs-v2': 'v1' } }, ref)
    expect(styleWithProfile({}, withVoice)).toEqual({ voice: 'v1', voices: { 'voice:elevenlabs-v2': 'v1' }, presenter: ref })
    const defaults = { captions: 'classic' }
    expect(styleWithProfile(defaults, NO_CONTEXT)).toBe(defaults)
  })
})
