// Founder console › Versions: the how-to, what the testers receive, the release table with its actions, the mock-up data, and
// that the page reads what the real Atelier Cloud answers (the answers are parsed with the shared contract, then rendered).
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Admin } from '../../web/src/admin/Admin'
import { VersionsView, HowTo } from '../../web/src/admin/Versions'
import { DEMO_RELEASES, compareVersions, dateLabel, feedUrl, latestOf, sizeLabel, sortReleases, type ReleaseRow } from '../../web/src/admin/releases'
import { setAdmin } from '../../web/src/auth'
import { Router } from '../../web/src/router'
import { ReleaseListResponse, compareVersions as cloudCompare } from '../../src/shared/cloud-releases'
import { cloudHelpers, startCloud, type CloudRig } from './cloud-app-helpers'

const textOf = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')

const render = (path: string): string =>
  renderToStaticMarkup(
    <Router initialPath={path}>
      <Admin />
    </Router>
  )
const view = (releases: ReleaseRow[], o: { demo?: boolean; cloud?: string | null } = {}): string =>
  renderToStaticMarkup(<VersionsView releases={releases} cloud={o.cloud === undefined ? 'http://127.0.0.1:8787' : o.cloud} demo={o.demo ?? false} busy={null} onAction={() => undefined} />)

describe('console › Versions (mock-up)', () => {
  beforeEach(() => setAdmin(true))

  it('is in the left nav and shows the loop « modifier → npm run release → les testeurs reçoivent la MAJ »', () => {
    const html = render('/admin/versions')
    const t = textOf(html)
    expect(t).toContain('Versions')
    expect(html).toContain('aria-current="page"')
    expect(t).toContain('Comment pousser une mise à jour')
    expect(t).toContain('Modifier → npm run release → les testeurs reçoivent la MAJ')
    expect(t).toContain('npm run dev')
    expect(t).toContain('npm version patch')
    expect(t).toContain('npm run release -- --channel beta')
    expect(t).toContain('toutes les 4 heures')
  })

  it('lists the invented releases with their state, files and actions, and says it is a demonstration', () => {
    const html = render('/admin/versions')
    const t = textOf(html)
    for (const h of ['Version', 'Canal', 'Plateforme', 'État', 'Fichiers', 'Publiée le', 'Notes']) expect(t).toContain(h)
    expect(t).toContain('Brouillon')
    expect(t).toContain('Publiée')
    expect(t).toContain('Retirée')
    expect(html).toContain('aria-label="Publier la version 0.3.0"')
    expect(html).toContain('aria-label="Retirer la version 0.2.0"')
    expect(html).toContain('aria-label="Supprimer le brouillon 0.3.0"')
    expect(html).toContain('aria-label="Republier la version 0.1.0"')
    expect(html).toContain('data-testid="versions-demo"')
    expect(html).not.toContain('admin-mock')
  })
})

describe('console › Versions (view)', () => {
  it('shows the latest published version of each channel and platform, and its feed link', () => {
    const html = view(DEMO_RELEASES)
    const latest = html.slice(html.indexOf('data-testid="versions-latest"'), html.indexOf('Toutes les versions'))
    expect(textOf(latest)).toContain('Bêta · Windows 0.2.0')
    expect(textOf(latest)).toContain('Stable · Windows Rien de publié')
    expect(textOf(latest)).toContain('Bêta · macOS Rien de publié')
    expect(latest).toContain('http://127.0.0.1:8787/v1/updates/beta/win/latest.yml')
    expect(latest).not.toContain('/stable/win/latest.yml')
    // the newest version first, and the one the testers get is marked
    const table = html.slice(html.indexOf('Toutes les versions'))
    expect(table.indexOf('0.3.0')).toBeLessThan(table.indexOf('0.2.0'))
    expect(textOf(html)).toMatch(/0\.2\.0 dernière/)
    expect(textOf(html)).not.toMatch(/0\.3\.0 dernière/)
    expect(html).not.toMatch(/undefined|NaN|\[object/)
  })

  it('has an empty state and no demo note on the real Cloud', () => {
    const html = view([], { cloud: 'https://api.example.org' })
    expect(textOf(html)).toContain('Aucune version pour l’instant')
    expect(html).not.toContain('versions-demo')
    expect(html).toContain('Rien de publié')
    expect(HowTo().props.title).toBe('Comment pousser une mise à jour')
  })

  it('sizes, dates and links', () => {
    expect(sizeLabel(512)).toBe('512 o')
    expect(sizeLabel(2048)).toMatch(/^2 Ko$/)
    expect(sizeLabel(130 * 1024 * 1024)).toMatch(/^130 Mo$/)
    expect(dateLabel(null)).toBe('–')
    expect(dateLabel('not a date')).toBe('not a date')
    expect(feedUrl('https://api.example.org/', 'stable', 'mac')).toBe('https://api.example.org/v1/updates/stable/mac/latest-mac.yml')
    expect(latestOf(DEMO_RELEASES, 'beta', 'win')?.version).toBe('0.2.0')
    expect(latestOf(DEMO_RELEASES, 'stable', 'win')).toBeNull()
    expect(sortReleases(DEMO_RELEASES)[0]?.version).toBe('0.3.0')
  })

  it('orders versions like the Cloud does', () => {
    const order = ['0.1.0', '0.2.0-beta.1', '0.2.0-beta.2', '0.2.0-beta.10', '0.2.0', '0.10.0', '1.0.0']
    for (const a of order) for (const b of order) expect(Math.sign(compareVersions(a, b)), `${a} vs ${b}`).toBe(Math.sign(cloudCompare(a, b)))
  })
})

describe('console › Versions (what the real Cloud answers)', () => {
  let rig: CloudRig
  beforeEach(async () => {
    rig = await startCloud(0)
  })
  afterEach(async () => {
    const app = rig.t.app as unknown as { close(): Promise<void>; server: { closeAllConnections(): void } }
    app.server.closeAllConnections()
    await app.close()
  })

  it('parses with the shared contract, renders, and agrees with the Cloud on which release is the latest', async () => {
    const helpers = cloudHelpers as unknown as { signUpAndIn(t: CloudRig['t'], p: { platformAdmin?: boolean; email?: string }): Promise<{ accessToken: string }> }
    const admin = await helpers.signUpAndIn(rig.t, { platformAdmin: true, email: 'founder@example.com' })
    const releases = (rig.t.cloud as unknown as { releases: { create(r: object, by: string): { id: string }; addBytes(id: string, name: string, b: Uint8Array): Promise<unknown>; publish(id: string, by: string): unknown; withdraw(id: string, by: string): unknown } }).releases
    for (const [version, state] of [['0.2.0', 'published'], ['0.3.0', 'published'], ['0.4.0', 'draft'], ['0.5.0', 'withdrawn']] as const) {
      const r = releases.create({ version, channel: 'beta', platform: 'win', notes: `Notes ${version}` }, 'test')
      await releases.addBytes(r.id, `Atelier-Setup-${version}.exe`, new Uint8Array(2048))
      if (state !== 'draft') releases.publish(r.id, 'test')
      if (state === 'withdrawn') releases.withdraw(r.id, 'test')
    }
    const res = await fetch(`${rig.baseUrl}/v1/admin/releases`, { headers: { authorization: `Bearer ${admin.accessToken}` } })
    const parsed = ReleaseListResponse.parse(await res.json())
    const rows = parsed.releases as ReleaseRow[]
    expect(latestOf(rows, 'beta', 'win')?.id).toBe(parsed.latest[0]?.releaseId)
    expect(latestOf(rows, 'beta', 'win')?.version).toBe('0.3.0')
    const html = view(rows, { cloud: rig.baseUrl })
    const t = textOf(html)
    expect(t).toMatch(/0\.3\.0 dernière/)
    for (const v of ['0.2.0', '0.3.0', '0.4.0', '0.5.0']) expect(t).toContain(v)
    expect(html).toContain('aria-label="Publier la version 0.4.0"')
    expect(html).toContain('aria-label="Republier la version 0.5.0"')
    expect(html).toContain('aria-label="Retirer la version 0.3.0"')
    expect(t).toContain('Notes 0.3.0')
  })
})
