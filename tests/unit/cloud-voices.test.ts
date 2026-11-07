// The voices of Atelier Cloud in the app (IPC `cloud.voices`, `cloud.cloneVoice`) against an in-process Cloud on the loopback
// (fakes, nothing paid): not connected / unreachable say so instead of inventing voices, the list is the Cloud's, a clone
// is checked, uploaded, quoted, paid once and copied into the ledger, and a refused recording sends nothing.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkRequest, ffprobeDuration, CLONE_MAX_BYTES } from '../../src/main/cloud/voices'
import { handleCall } from '../../src/main/ipc'
import { t } from '../../src/shared/fr'
import { appCore, connect, startCloud } from './cloud-app-helpers'
import { hasFfmpeg, ROOT } from './engine-node-helpers'

const CLIP = readFileSync(path.join(ROOT, 'resources', 'fake-media', 'voice.mp3'))
const request = (o: Record<string, unknown> = {}) => ({ name: 'Marie', language: 'fr', fileName: 'ma-voix.mp3', bytes: new Uint8Array(CLIP), consent: true, ...o })
const jobsOf = (rig: Awaited<ReturnType<typeof startCloud>>): number => (rig.t.cloud as unknown as { db: { prepare(s: string): { get(): { n: number } } } }).db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n

describe('the list of voices', () => {
  it('says "not connected" when the app is not signed in, and invents nothing', async () => {
    const app = appCore()
    expect(await app.core.api['cloud.voices']()).toEqual({ status: 'not-connected', voices: [], clone: null })
    await expect(app.core.api['cloud.cloneVoice'](request())).rejects.toThrow(t('cloud.voices.notConnected'))
  })

  it('lists the Cloud’s voices when connected (the fake ones in demo) and says cloning is a demo', async () => {
    const rig = await startCloud(1000)
    const app = appCore()
    await connect(app, rig)
    const r = await app.core.api['cloud.voices']()
    expect(r.status).toBe('ok')
    expect(r.clone).toBe('demo')
    // the demonstration voices, then the default REAL voices of the catalogue (ai33 Pro, issue #95): a new channel has one to speak with
    expect(r.voices.filter((v) => v.demo).map((v) => v.id)).toEqual(['demo-claire', 'demo-hugo', 'demo-ava'])
    const defaults = r.voices.filter((v) => !v.demo)
    expect(defaults.map((v) => [v.language, v.default === true])).toEqual([['fr', true], ['en', true]])
    expect(r.voices.every((v) => !v.cloned)).toBe(true)
  })

  it('says the Cloud does not answer when it is down, and "not connected" once signed out', async () => {
    const rig = await startCloud(1000)
    const app = appCore()
    await connect(app, rig)
    app.net.down = true
    expect(await app.core.api['cloud.voices']()).toEqual({ status: 'unreachable', voices: [], clone: null })
    app.net.down = false
    await app.core.api['cloud.disconnect']()
    expect((await app.core.api['cloud.voices']()).status).toBe('not-connected')
  })
})

describe('cloning a voice', () => {
  it('uploads the recording, runs one cloneVoice job, lists the new voice, charges once and writes the ledger', async () => {
    const rig = await startCloud(1000)
    // priced with the grid's margin on voice.clone (decision 0015), not the beta's multiplier 1.0 (0040)
    rig.t.cloud.finance.setMultiplier(null, 'test')
    const app = appCore({ cloudVoiceDuration: async () => 12 })
    await connect(app, rig)
    const before = rig.t.cloud.wallet.state(rig.teamId).balance
    const voice = await app.core.api['cloud.cloneVoice'](request())
    expect(voice).toMatchObject({ name: 'Marie', language: 'fr', demo: true, cloned: true })
    expect(voice.id).toMatch(/^clone-[0-9a-f]{12}$/)
    expect(jobsOf(rig)).toBe(1)
    expect(before - rig.t.cloud.wallet.state(rig.teamId).balance).toBe(160)

    const list = await app.core.api['cloud.voices']()
    expect(list.voices.at(-1)).toEqual({ id: voice.id, name: 'Marie', language: 'fr', demo: true, cloned: true })

    // the same recording and name: the same voice, no second job, no second charge
    const again = await app.core.api['cloud.cloneVoice'](request())
    expect(again.id).toBe(voice.id)
    expect(jobsOf(rig)).toBe(1)
    expect(before - rig.t.cloud.wallet.state(rig.teamId).balance).toBe(160)

    // the spend ledger holds one settled row named after the voice
    const rows = app.core.db.prepare(`SELECT model, status, credits FROM ledger WHERE cloud_job_id IS NOT NULL`).all() as { model: string; status: string; credits: number }[]
    expect(rows).toEqual([{ model: t('cloud.clone.ledger', { name: 'Marie' }), status: 'settled', credits: 160 }])
    expect(app.core.api['cloud.spend']()).toMatchObject({ spentCredits: 160, jobs: 1 })

    // another name is another voice
    const second = await app.core.api['cloud.cloneVoice'](request({ name: 'Marie bis' }))
    expect(second.id).not.toBe(voice.id)
    expect(jobsOf(rig)).toBe(2)
  })

  it('refuses a bad recording with a French message and sends nothing to the Cloud', async () => {
    const rig = await startCloud(1000)
    const app = appCore({ cloudVoiceDuration: async (file) => (file.endsWith('court.mp3') ? 3.4 : file.endsWith('long.mp3') ? 400 : 12) })
    await connect(app, rig)
    const api = app.core.api
    await expect(api['cloud.cloneVoice'](request({ name: '   ' }))).rejects.toThrow(t('cloud.clone.name'))
    await expect(api['cloud.cloneVoice'](request({ name: 'x'.repeat(61) }))).rejects.toThrow(t('cloud.clone.name'))
    await expect(api['cloud.cloneVoice'](request({ fileName: 'voix.flac' }))).rejects.toThrow(t('cloud.clone.format'))
    await expect(api['cloud.cloneVoice'](request({ bytes: new Uint8Array(0) }))).rejects.toThrow(t('cloud.clone.unreadable'))
    await expect(api['cloud.cloneVoice'](request({ bytes: new Uint8Array(CLONE_MAX_BYTES + 1) }))).rejects.toThrow(t('cloud.clone.tooBig'))
    await expect(api['cloud.cloneVoice'](request({ fileName: 'court.mp3' }))).rejects.toThrow(t('cloud.clone.tooShort', { s: 3 }))
    await expect(api['cloud.cloneVoice'](request({ fileName: 'long.mp3' }))).rejects.toThrow(t('cloud.clone.tooLong'))
    await expect(api['cloud.cloneVoice']('not a request' as never)).rejects.toThrow(t('cloud.clone.name'))
    expect(jobsOf(rig)).toBe(0)
    expect(rig.t.cloud.wallet.state(rig.teamId).balance).toBe(1000)
    // what reaches the renderer is a plain error envelope with the French text
    const env = await handleCall(api, 'cloud.cloneVoice', [request({ fileName: 'voix.flac' })])
    expect(env).toEqual({ ok: false, error: { code: 'ERROR', message: t('cloud.clone.format') } })
  })

  it('a clone the Cloud cannot pay for fails without a voice', async () => {
    const rig = await startCloud(10) // a clone costs 160 credits
    const app = appCore({ cloudVoiceDuration: async () => 12 })
    await connect(app, rig)
    await expect(app.core.api['cloud.cloneVoice'](request())).rejects.toThrow()
    expect((await app.core.api['cloud.voices']()).voices.some((v) => v.cloned)).toBe(false)
    expect(rig.t.cloud.wallet.state(rig.teamId).balance).toBe(10)
  })
})

describe('checkRequest', () => {
  it('trims the name, defaults the language to French and keeps the bytes', () => {
    const r = checkRequest({ name: '  Léa ', language: 'xx-yy', fileName: 'a.M4A', bytes: new Uint8Array([1, 2, 3]), consent: true })
    expect(r).toMatchObject({ name: 'Léa', language: 'fr', fileName: 'a.M4A' })
    expect(r.bytes).toEqual(new Uint8Array([1, 2, 3]))
    expect(checkRequest({ name: 'x', language: 'en', fileName: 'a.wav', bytes: new Uint8Array(1), consent: true }).language).toBe('en')
  })

  it('refuses a clone without the consent tick (decision 0025), and keeps a valid engine id only', () => {
    expect(() => checkRequest({ name: 'x', language: 'en', fileName: 'a.wav', bytes: new Uint8Array(1) })).toThrow(/droits sur cette voix/)
    expect(() => checkRequest({ name: 'x', language: 'en', fileName: 'a.wav', bytes: new Uint8Array(1), consent: false })).toThrow(/droits sur cette voix/)
    expect(checkRequest({ name: 'x', language: 'fr', fileName: 'a.wav', bytes: new Uint8Array(1), consent: true, engine: 'voice:fish-s2' }).engine).toBe('voice:fish-s2')
    expect(checkRequest({ name: 'x', language: 'fr', fileName: 'a.wav', bytes: new Uint8Array(1), consent: true, engine: 'https://evil' }).engine).toBeUndefined()
  })
})

describe.skipIf(!hasFfmpeg)('measuring a recording', () => {
  it('ffprobe reads the length of the sample voice (about 10 s) and gives null for a file it cannot read', async () => {
    const signal = new AbortController().signal
    const s = await ffprobeDuration(path.join(ROOT, 'resources', 'fake-media', 'voice.mp3'), signal)
    expect(s).toBeGreaterThan(9)
    expect(s).toBeLessThan(11)
    expect(await ffprobeDuration(path.join(ROOT, 'package.json'), signal)).toBeNull()
  })
})
