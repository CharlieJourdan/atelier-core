// Planning › publication kit, the platform side: which kit file a button stands for, what a download button does with
// the kit on the platform and without it (a fake client stands for the app), every state of the kit block, and the web
// page asking the Cloud for the kit itself.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { kitFileFor, runKitAction, type KitApi } from '../../src/renderer/screens/planning/cloudKit'
import { KitPanel, type KitPanelProps } from '../../src/renderer/screens/planning/KitPanel'
import type { CloudKitState } from '../../src/shared/api'
import type { KitWithLinks } from '../../src/shared/cloud-kit'
import { enPPlanning } from '../../src/shared/en-p-planning'
import { fetchKitState } from '../../src/shared/kit-client'
import { fr } from '../../src/shared/fr'

const file = (name: string, mime = 'application/octet-stream') => ({ name, mime, size: 10, sha256: 'a'.repeat(64), url: `https://files.example/${name}?sig=1`, expiresAt: '2026-10-25T10:15:00.000Z' })
const kitWith = (names: string[]): KitWithLinks => ({
  id: 'kit_1',
  videoId: '42',
  title: 'Pourquoi les phares existent encore',
  alternatives: [],
  description: 'D',
  tags: [],
  chapters: [],
  language: 'fr',
  demo: false,
  createdAt: '2026-10-25T10:00:00.000Z',
  expiresAt: '2027-01-23T10:00:00.000Z',
  files: names.map((n) => file(n))
})
const ok = (names: string[]): CloudKitState => ({ status: 'ok', kit: kitWith(names) })

function fakeApi(over: Partial<KitApi> = {}): KitApi & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    kit: async (v) => (calls.push(`kit ${v}`), ok(['video.mp4'])),
    publish: async (r) => (calls.push(`publish ${r}`), { files: 1, bytes: 10 }),
    download: async (v, n) => (calls.push(`download ${v} ${n ?? '*'}`), { saved: [n ?? 'video.mp4'], dir: '/Users/c/Downloads/Atelier/Titre' }),
    reveal: async (r) => void calls.push(`reveal ${r}`),
    ...over
  }
}
const ids = { videoId: 42, runId: 7 }

describe('which kit file a button stands for', () => {
  it('the video is video.*; the thumbnail is the JPEG when the PNG was too big for YouTube, else the PNG', () => {
    expect(kitFileFor(kitWith(['description.txt', 'video.mp4']), 'video')?.name).toBe('video.mp4')
    expect(kitFileFor(kitWith(['description.txt']), 'video')).toBeUndefined()
    expect(kitFileFor(kitWith(['thumbnail.png', 'video.mp4']), 'thumb')?.name).toBe('thumbnail.png')
    expect(kitFileFor(kitWith(['thumbnail.png', 'thumbnail.jpg', 'video.mp4']), 'thumb')?.name).toBe('thumbnail.jpg')
    expect(kitFileFor(kitWith(['thumbnail-2.png']), 'thumb')).toBeUndefined()
  })
})

describe('a download button', () => {
  it('saves from the platform when the kit is there, without touching the package folder', async () => {
    const api = fakeApi()
    const state = ok(['thumbnail.png', 'video.mp4'])
    expect(await runKitAction(api, ids, state, 'video')).toEqual({ via: 'cloud', saved: ['video.mp4'], dir: '/Users/c/Downloads/Atelier/Titre' })
    expect(await runKitAction(api, ids, state, 'thumb')).toMatchObject({ via: 'cloud', saved: ['thumbnail.png'] })
    expect(await runKitAction(api, ids, state, 'all')).toMatchObject({ via: 'cloud', saved: ['video.mp4'] })
    expect(api.calls).toEqual(['download 42 video.mp4', 'download 42 thumbnail.png', 'download 42 *'])
  })

  it('falls back to opening the package folder when the platform has no kit, is unreachable, or the app is not connected', async () => {
    for (const status of ['none', 'unreachable', 'not-connected'] as const) {
      const api = fakeApi()
      expect(await runKitAction(api, ids, { status }, 'video')).toEqual({ via: 'folder' })
      expect(api.calls).toEqual(['reveal 7'])
    }
    const api = fakeApi()
    expect(await runKitAction(api, ids, null, 'thumb')).toEqual({ via: 'folder' })
    expect(api.calls).toEqual(['reveal 7'])
  })

  it('does not hide a failure: a refused download or a team computer without a screen reaches the caller', async () => {
    const denied = fakeApi({ download: async () => Promise.reject(new Error('Le fichier video.mp4 n’a pas pu être téléchargé (HTTP 403).')) })
    await expect(runKitAction(denied, ids, ok(['video.mp4']), 'video')).rejects.toThrow('HTTP 403')
    const noScreen = fakeApi({ reveal: async () => Promise.reject(new Error('Indisponible sur l’ordinateur d’équipe : il n’y a pas d’écran pour ouvrir un dossier ; télécharge le kit depuis l’app.')) })
    await expect(runKitAction(noScreen, ids, { status: 'none' }, 'video')).rejects.toThrow('télécharge le kit depuis l’app')
    await expect(runKitAction(fakeApi(), ids, ok(['description.txt']), 'video')).rejects.toThrow()
  })
})

describe('the kit block', () => {
  const noop = (): void => undefined
  const base: KitPanelProps = {
    live: true,
    packageReady: true,
    localThumb: true,
    rendered: true,
    packaged: true,
    kit: null,
    sending: false,
    notice: null,
    onVideo: noop,
    onThumb: noop,
    onAll: noop,
    onFolder: noop,
    onSend: noop,
    onCopyTitle: noop,
    onCopyDescription: noop
  }
  const render = (p: Partial<KitPanelProps>): string => renderToStaticMarkup(<KitPanel {...base} {...p} />)
  const has = (html: string, id: string): boolean => html.includes(`data-testid="${id}"`)

  it('kit on the platform: the expiry, the three downloads, the folder; the local thumbnail button gives way', () => {
    const html = render({ kit: ok(['thumbnail.png', 'video.mp4']) })
    for (const id of ['kit-cloud-badge', 'kit-cloud-video', 'kit-cloud-thumb', 'kit-cloud-all', 'kit-folder']) expect(has(html, id), id).toBe(true)
    expect(has(html, 'kit-thumb')).toBe(false)
    expect(has(html, 'kit-cloud-send')).toBe(false)
    expect(html).toContain('Sur la plateforme jusqu’au')
    expect(html).toContain('2027')
    // without a thumbnail in the kit, only that button is off
    expect(render({ kit: ok(['video.mp4']) })).toMatch(/<button[^>]*disabled[^>]*data-testid="kit-cloud-thumb"/)
  })

  it('no kit yet: the invitation to send it; not connected: just the folder, as before', () => {
    const none = render({ kit: { status: 'none' } })
    expect(has(none, 'kit-cloud-send')).toBe(true)
    expect(none).toContain('Envoyer sur la plateforme')
    expect(render({ kit: { status: 'none' }, sending: true })).toContain('Envoi en cours…')
    expect(render({ kit: { status: 'none' }, packageReady: false })).not.toContain('kit-cloud-send')
    const off = render({ kit: { status: 'not-connected' } })
    for (const id of ['kit-cloud-send', 'kit-cloud-video', 'kit-cloud-badge']) expect(has(off, id)).toBe(false)
    expect(has(off, 'kit-folder')).toBe(true)
    expect(has(off, 'kit-thumb')).toBe(true)
  })

  it('unreachable Cloud: says so and keeps the folder', () => {
    const html = render({ kit: { status: 'unreachable' } })
    expect(html).toContain('Atelier Cloud est injoignable')
    expect(has(html, 'kit-folder')).toBe(true)
  })

  it('demo videos (no live run) never show the platform block', () => {
    const html = render({ live: false, kit: ok(['video.mp4']) })
    for (const id of ['kit-cloud-badge', 'kit-cloud-video', 'kit-cloud-send', 'kit-folder']) expect(has(html, id)).toBe(false)
  })

  it('shows the last action’s result, and a failure in the error colour', () => {
    expect(render({ notice: { text: 'Téléchargé dans /x.', error: false } })).toContain('Téléchargé dans /x.')
    expect(render({ notice: { text: 'Raté', error: true } })).toMatch(/text-err[^>]*data-testid="kit-notice"|data-testid="kit-notice"/)
  })

  it('has an English text for every string it uses', () => {
    const keys = Object.keys(fr).filter((k) => k.startsWith('planning.kit.cloud.') || k.startsWith('kit.err.'))
    expect(keys.length).toBeGreaterThanOrEqual(12)
    for (const k of keys) expect(enPPlanning[k as keyof typeof enPPlanning], k).toBeTruthy()
  })
})

describe('the web page asking the Cloud for the kit', () => {
  const kit = kitWith(['video.mp4'])
  const answer = (status: number, body: unknown = {}): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  it('maps the Cloud’s answers to a state, with the person’s token and no one else’s', async () => {
    const seen: { url: string; auth: string | null }[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: new Headers(init?.headers).get('authorization') })
      return new Response(JSON.stringify(kit), { status: 200 })
    }) as unknown as typeof fetch
    const ep = { baseUrl: 'https://api.atelier.test', token: async () => 'tok_abc', fetchImpl }
    expect(await fetchKitState(ep, 42)).toEqual({ status: 'ok', kit })
    expect(seen).toEqual([{ url: 'https://api.atelier.test/v1/team/videos/42/kit', auth: 'Bearer tok_abc' }])
    expect(await fetchKitState({ ...ep, fetchImpl: answer(404) }, 42)).toEqual({ status: 'none' })
    expect(await fetchKitState({ ...ep, fetchImpl: answer(500) }, 42)).toEqual({ status: 'unreachable' })
    expect(await fetchKitState({ ...ep, fetchImpl: answer(200, { surprise: true }) }, 42)).toEqual({ status: 'unreachable' })
    expect(await fetchKitState({ ...ep, fetchImpl: (async () => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch }, 42)).toEqual({ status: 'unreachable' })
  })

  it('asks by the brain’s reference first, and by the bare id (a kit sent before references) only when there is none', async () => {
    const seen: string[] = []
    const fetchImpl = (async (url: string) => {
      seen.push(url.replace('https://x/v1/team/videos/', ''))
      return url.includes('/abcdef0123456789-42/') ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(kit), { status: 200 })
    }) as unknown as typeof fetch
    const ep = { baseUrl: 'https://x', token: async () => 't', fetchImpl }
    expect(await fetchKitState(ep, 42, 'abcdef0123456789-42')).toEqual({ status: 'ok', kit })
    expect(seen).toEqual(['abcdef0123456789-42/kit', '42/kit'])
    seen.length = 0
    const found = (async (url: string) => (seen.push(url), new Response(JSON.stringify(kit), { status: 200 }))) as unknown as typeof fetch
    expect(await fetchKitState({ ...ep, fetchImpl: found }, 42, 'abcdef0123456789-42')).toEqual({ status: 'ok', kit })
    expect(seen).toHaveLength(1) // found by its reference: the bare id is not asked
  })

  it('refreshes a refused token once, then gives up as signed out', async () => {
    const expire = vi.fn()
    let calls = 0
    const fetchImpl = (async () => (++calls === 1 ? new Response('{}', { status: 401 }) : new Response(JSON.stringify(kit), { status: 200 }))) as unknown as typeof fetch
    expect(await fetchKitState({ baseUrl: 'https://x', token: async () => 't', expire, fetchImpl }, 1)).toEqual({ status: 'ok', kit })
    expect(expire).toHaveBeenCalledTimes(1)
    expect(await fetchKitState({ baseUrl: 'https://x', token: async () => 't', expire, fetchImpl: answer(401) }, 1)).toEqual({ status: 'not-connected' })
  })
})
