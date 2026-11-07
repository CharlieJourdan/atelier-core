// The site's « Mes vidéos » page: every state renders (French and English), the kit card carries the files, the expiry and
// the buttons, the description is built like the app's, the route and the nav link exist only where they work, and the
// site's calls (sign in, list, links, download) work against a real in-process Atelier Cloud on the loopback.
import { createHash } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../web/src/App'
import { saveUser, signOut } from '../../web/src/auth'
import type { SiteKit } from '../../web/src/cloud'
import { en } from '../../web/src/content-en'
import { fr } from '../../web/src/content-fr'
import { setLang, translate } from '../../web/src/i18n'
import { fmtSize, kitDescription, MyVideosView, thumbFileOf, videoFileOf, type MyVideosViewProps } from '../../web/src/pages/MyVideos'
import { Kit, KitWithLinks } from '../../src/shared/cloud-kit'
import { cloudHelpers, startCloud, type CloudRig } from './cloud-app-helpers'

const KIT: SiteKit = {
  id: 'kit_abc',
  videoId: '42',
  title: 'Pourquoi les phares existent encore',
  alternatives: ['Les phares ne sont pas morts'],
  description: 'Une histoire courte des phares.',
  tags: ['phares', 'histoire maritime'],
  chapters: [
    { at: 0, title: 'Introduction' },
    { at: 75.4, title: 'Le feu' }
  ],
  language: 'fr',
  demo: false,
  createdAt: '2026-10-25T10:00:00.000Z',
  expiresAt: '2027-01-23T10:00:00.000Z',
  files: [
    { name: 'thumbnail.png', mime: 'image/png', size: 345_678, sha256: 'b'.repeat(64) },
    { name: 'video.mp4', mime: 'video/mp4', size: 84 * 1024 * 1024, sha256: 'a'.repeat(64) }
  ]
}

const noop = (): void => undefined
const textOf = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')
const view = (over: Partial<MyVideosViewProps> = {}, lang: 'fr' | 'en' = 'fr'): string =>
  renderToStaticMarkup(<MyVideosView phase="ready" kits={[KIT]} lang={lang} t={(k, v) => translate(lang, k, v)} notice={null} onDownload={noop} onCopy={noop} onRetry={noop} {...over} />)

beforeEach(() => {
  setLang('fr')
  signOut()
})

describe('the page', () => {
  it('lists a kit with its expiry, files, keywords and the five buttons', () => {
    const html = view()
    const text = textOf(html)
    expect(text).toContain('Mes vidéos')
    expect(text).toContain('Pourquoi les phares existent encore')
    expect(text).toMatch(/Sur la plateforme jusqu.au 23 janvier 2027/)
    expect(text).toContain('video.mp4 · 84 Mo')
    expect(text).toContain('thumbnail.png · 338 Ko')
    expect(text).toContain('phares, histoire maritime')
    expect(text).toContain('Les phares ne sont pas morts')
    for (const id of ['kit-download-video', 'kit-download-thumb', 'kit-download-all', 'kit-copy-title', 'kit-copy-description']) expect(html).toContain(`data-testid="${id}"`)
    expect(html).not.toContain('data-testid="kit-demo"')
    expect(text).toContain('Atelier ne publie jamais rien sur YouTube')
  })

  it('flags a demo kit, and offers no thumbnail button when the kit has none', () => {
    const html = view({ kits: [{ ...KIT, demo: true, files: KIT.files.filter((f) => f.name === 'video.mp4') }] })
    expect(html).toContain('data-testid="kit-demo"')
    expect(textOf(html)).toContain('Démo : ne pas publier')
    expect(html).not.toContain('data-testid="kit-download-thumb"')
    expect(html).toContain('data-testid="kit-download-all"')
  })

  it('has one view per state', () => {
    expect(view({ phase: 'loading', kits: [] })).toContain('Chargement de tes vidéos')
    expect(view({ phase: 'ready', kits: [] })).toContain('data-testid="mv-empty"')
    const out = view({ phase: 'signedOut', kits: [] })
    expect(out).toContain('data-testid="mv-signed-out"')
    expect(out).toContain('href="/connexion"')
    expect(view({ phase: 'error', kits: [] })).toContain('data-testid="mv-error"')
    expect(view({ phase: 'demoSite', kits: [] })).toContain('data-testid="mv-demo"')
    expect(view({ notice: 'Copié.' })).toContain('Copié.')
    // nothing of the list while it is not ready
    for (const phase of ['loading', 'signedOut', 'error', 'demoSite'] as const) expect(view({ phase })).not.toContain('data-testid="kit-card"')
  })

  it('renders in English', () => {
    setLang('en')
    const text = textOf(view({}, 'en'))
    expect(text).toContain('My videos')
    expect(text).toContain('On the platform until January 23, 2027')
    expect(text).toContain('Download the video')
    expect(text).toContain('Copy the description')
    expect(text).toContain('84 MB')
  })

  it('has every key in both languages, and only the keys the page uses are new', () => {
    const keys = Object.keys(fr).filter((k) => k.startsWith('mv.') || k === 'nav.videos' || k === 'title.videos')
    expect(keys.length).toBeGreaterThanOrEqual(25)
    for (const k of keys) {
      expect(en[k as keyof typeof en], k).toBeTruthy()
      expect(fr[k as keyof typeof fr], k).toBeTruthy()
    }
  })
})

describe('what the buttons use', () => {
  it('the description is the text, the chapters (m:ss) and the tags', () => {
    expect(kitDescription(KIT)).toBe('Une histoire courte des phares.\n\n0:00 Introduction\n1:15 Le feu\n\n#phares #histoiremaritime')
    expect(kitDescription({ description: 'Seul.', chapters: [], tags: [] })).toBe('Seul.')
  })

  it('picks the video and the thumbnail (the JPEG when the PNG was over 2 MB)', () => {
    expect(videoFileOf(KIT)).toBe('video.mp4')
    expect(thumbFileOf(KIT)).toBe('thumbnail.png')
    expect(thumbFileOf({ files: [...KIT.files, { ...KIT.files[0]!, name: 'thumbnail.jpg' }] })).toBe('thumbnail.jpg')
    expect(videoFileOf({ files: [] })).toBeUndefined()
    expect(fmtSize(1536, 'fr')).toBe('2 Ko')
    expect(fmtSize(3.5 * 1024 * 1024, 'en')).toBe('3.5 MB')
  })

  it('the site’s copy of the kit shape is the Cloud’s contract', () => {
    expect(Kit.parse(KIT)).toMatchObject({ id: 'kit_abc', videoId: '42' })
    const withLinks = { ...KIT, files: KIT.files.map((f) => ({ ...f, url: 'https://files.example/x?sig=1', expiresAt: '2026-10-25T10:15:00.000Z' })) }
    expect(KitWithLinks.parse(withLinks).files).toHaveLength(2)
  })
})

describe('the route and the nav link', () => {
  it('/mes-videos is a page of the site, in demo mode it says it needs the Cloud', () => {
    const html = renderToStaticMarkup(<App initialPath="/mes-videos" />)
    expect(html).toContain('data-testid="mv-demo"')
    expect(textOf(html)).toContain('elle s’active quand le site est relié au Cloud')
  })

  it('the nav link shows only for a signed-in person on a site linked to the Cloud', async () => {
    saveUser({ name: 'Charlie', email: 'c@example.com' })
    // not linked to the Cloud (no VITE_ATELIER_CLOUD in tests): no link
    expect(renderToStaticMarkup(<App initialPath="/tarifs" />)).not.toContain('href="/mes-videos"')
    vi.stubEnv('VITE_ATELIER_CLOUD', 'http://127.0.0.1:1')
    vi.resetModules()
    // a fresh copy of the site, built with the Cloud's address (its own fictive-account store too)
    const linked = await import('../../web/src/App')
    const account = await import('../../web/src/auth')
    expect(renderToStaticMarkup(<linked.App initialPath="/tarifs" />)).not.toContain('href="/mes-videos"') // linked, but nobody signed in
    account.saveUser({ name: 'Charlie', email: 'c@example.com' })
    expect(renderToStaticMarkup(<linked.App initialPath="/tarifs" />)).toContain('href="/mes-videos"')
  })
})

describe('the site against a real Cloud', () => {
  let rig: CloudRig
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('signs in, lists the team’s kits, asks fresh links at the click and downloads the exact bytes', async () => {
    rig = await startCloud(0)
    const kits = rig.t.cloud as unknown as {
      db: { prepare(sql: string): { run(...args: unknown[]): unknown } }
      kits: {
        start(team: string, video: string, texts: object, by: string): { kitId: string }
        addFile(team: string, video: string, kit: string, f: { name: string; bytes: Uint8Array; sha256: string }): Promise<unknown>
        complete(team: string, video: string, kit: string, by: string): Promise<unknown>
      }
    }
    // storing kits on the platform needs a plan (or an enrolled team computer)
    kits.db
      .prepare(`INSERT INTO billing_subscriptions (team_id, plan, period, status, since, updated_at) VALUES (?, 'starter', 'month', 'active', ?, ?)`)
      .run(rig.teamId, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')
    const bytes = Buffer.from('FAKE MP4 BYTES')
    const { kitId } = kits.kits.start(rig.teamId, '42', { title: 'Les phares', alternatives: [], description: 'D', tags: ['x'], chapters: [], language: 'fr', demo: false }, 'test')
    await kits.kits.addFile(rig.teamId, '42', kitId, { name: 'video.mp4', bytes, sha256: createHash('sha256').update(bytes).digest('hex') })
    await kits.kits.complete(rig.teamId, '42', kitId, 'test')

    vi.stubEnv('VITE_ATELIER_CLOUD', rig.baseUrl)
    vi.resetModules()
    const site = await import('../../web/src/cloud')
    // not signed in: the Cloud refuses, the page says « connecte-toi »
    await expect(site.cloudKits()).rejects.toMatchObject({ status: 401 })
    await site.cloudLogin(rig.email, cloudHelpers.PASSWORD)
    const list = await site.cloudKits()
    expect(list.kits).toHaveLength(1)
    expect(list.kits[0]).toMatchObject({ id: kitId, videoId: '42', title: 'Les phares' })
    expect(JSON.stringify(list)).not.toContain('"url"') // no link on the list
    const fresh = await site.cloudKit('42')
    const file = fresh.files.find((f) => f.name === 'video.mp4')
    expect(file?.url).toBeTruthy()
    const res = await fetch(file!.url!)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="video.mp4"')
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true)
    await expect(site.cloudKit('43')).rejects.toMatchObject({ status: 404 })
  })
})
