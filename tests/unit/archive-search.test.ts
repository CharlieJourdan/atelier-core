/* eslint-disable @typescript-eslint/no-explicit-any -- recorded API answers are read loosely and edited into synthetic variants */
// Public-archive picture search (src/engine/archive): licence filter, the four sources on recorded answers (real API
// responses kept in tests/fixtures/archive/, trimmed), ranking, duplicates, a failing source, and the download guards.
// No network: every `fetch` is a fake. A few items are edited copies of recorded ones (marked « synthetic ») to cover a
// licence that the live APIs rarely return (NC, no licence).
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ARCHIVE_USER_AGENT,
  ArchiveDownloadError,
  ArchiveSearchError,
  downloadArchive,
  iaLicence,
  licenceFromName,
  licenceFromUrl,
  rankHits,
  searchArchives,
  type ArchiveHit
} from '../../src/engine/archive'
import { imageSize } from '../../src/engine/archive/image-size'
import { wikimediaHit, wikimediaSearchString } from '../../src/engine/archive/wikimedia'

const FIX = path.join(__dirname, '..', 'fixtures', 'archive')
const fixture = (name: string): any => JSON.parse(readFileSync(path.join(FIX, `${name}.json`), 'utf8'))

/** A JPEG header that says it is w x h (enough for `imageSize`). */
function jpegHeader(w: number, h: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(new ArrayBuffer(64))
  b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03])
  return b
}

const json = (v: unknown, status = 200): Response => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })

interface Call {
  url: string
  headers: Record<string, string>
}
/** A fake fetch: the first route whose key is contained in the URL answers; no route is a test failure (no network). */
function fakeFetch(routes: Array<[string, (url: string) => Response | Promise<Response>]>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const f = (async (input: any, init?: any): Promise<Response> => {
    const url = String(input)
    calls.push({ url, headers: { ...(init?.headers ?? {}) } })
    const route = routes.find(([key]) => url.includes(key))
    if (!route) throw new Error(`unexpected request: ${url}`)
    return route[1](url)
  }) as typeof fetch
  return { fetch: f, calls }
}

const iaRoutes = (sizes: Record<string, [number, number]>): Array<[string, (url: string) => Response]> => [
  ['archive.org/advancedsearch.php', () => json(fixture('ia-search-brooklyn'))],
  ...Object.keys(sizes).map((id): [string, () => Response] => [`archive.org/metadata/${encodeURIComponent(id)}`, () => json(fixture(`ia-metadata-${id}`))]),
  // the ranged probe of a file: its header only
  ...Object.entries(sizes).map(([id, [w, h]]): [string, () => Response] => [`archive.org/download/${encodeURIComponent(id)}/`, () => new Response(jpegHeader(w, h), { status: 206, headers: { 'content-type': 'image/jpeg' } })])
]

describe('licence filter', () => {
  it('keeps public domain, CC0, CC BY and CC BY-SA of any version', () => {
    expect(licenceFromName('Public domain')?.short).toBe('Public domain')
    expect(licenceFromName('PD-old-70')?.short).toBe('Public domain')
    expect(licenceFromName('CC0')?.attributionRequired).toBe(false)
    expect(licenceFromName('CC BY 4.0')).toMatchObject({ short: 'CC BY 4.0', attributionRequired: true })
    expect(licenceFromName('CC BY-SA 3.0')).toMatchObject({ short: 'CC BY-SA 3.0', attributionRequired: true })
    expect(licenceFromName('cc-by-sa-2.5')?.short).toBe('CC BY-SA 2.5')
  })

  it('refuses NC, ND, all rights reserved, and an unknown or empty licence', () => {
    for (const bad of ['CC BY-NC 4.0', 'CC BY-ND 2.0', 'CC BY-NC-SA 3.0', 'CC BY-NC-ND 4.0', 'All rights reserved', 'Copyrighted free use', 'GFDL', 'Fair use', '', '  ']) {
      expect(licenceFromName(bad), bad).toBeUndefined()
    }
  })

  it('reads Creative Commons URLs', () => {
    expect(licenceFromUrl('https://creativecommons.org/publicdomain/zero/1.0/')?.short).toBe('CC0 1.0')
    expect(licenceFromUrl('https://creativecommons.org/publicdomain/mark/1.0/')?.short).toBe('Public domain')
    expect(licenceFromUrl('http://creativecommons.org/licenses/by/2.0/')?.short).toBe('CC BY 2.0')
    expect(licenceFromUrl('https://creativecommons.org/licenses/by-sa/4.0/')?.short).toBe('CC BY-SA 4.0')
    expect(licenceFromUrl('https://creativecommons.org/licenses/by-nc-nd/4.0/')).toBeUndefined()
    expect(licenceFromUrl('https://creativecommons.org/licenses/by-nd/3.0/')).toBeUndefined()
    expect(licenceFromUrl('https://example.com/my-licence')).toBeUndefined()
  })

  it('Internet Archive: a licence URL, or a public-domain status / rights text; nothing else', () => {
    expect(iaLicence('https://creativecommons.org/publicdomain/zero/1.0/', undefined, undefined)?.short).toBe('CC0 1.0')
    expect(iaLicence(undefined, undefined, 'NOT_IN_COPYRIGHT')?.short).toBe('Public domain')
    expect(iaLicence(undefined, 'Public Domain', undefined)?.short).toBe('Public domain')
    expect(iaLicence(undefined, ['No known copyright restrictions'], undefined)?.short).toBe('Public domain')
    expect(iaLicence(undefined, undefined, undefined)).toBeUndefined()
    expect(iaLicence('', '', '')).toBeUndefined()
    expect(iaLicence(undefined, 'Images may be used following Creative Commons CC BY-NC-SA 3.0', undefined)).toBeUndefined()
    expect(iaLicence(undefined, 'Not in the public domain, all rights reserved', undefined)).toBeUndefined()
    // a refused licence URL wins over a public-domain looking status
    expect(iaLicence('http://creativecommons.org/licenses/by-nc-nd/4.0/', undefined, 'NOT_IN_COPYRIGHT')).toBeUndefined()
  })
})

describe('Wikimedia Commons', () => {
  const wall = fixture('wikimedia-wall-street').query.pages as any[]

  it('searches bitmap files with the kind and era hints', () => {
    expect(wikimediaSearchString('Potosi silver mine', {})).toBe('Potosi silver mine filetype:bitmap')
    expect(wikimediaSearchString('Potosi silver mine', { kind: 'painting', era: '17th century' })).toBe('Potosi silver mine 17th century AND (painting OR engraving) filetype:bitmap')
    expect(wikimediaSearchString('crash', { kind: 'document' })).toBe('crash AND (document OR newspaper OR letter) filetype:bitmap')
  })

  it('turns a recorded page into a hit: 2000 px rendition, licence, creator without HTML, credit line', () => {
    const page = wall.find((p) => p.title === 'File:Crowds gathering outside New York Stock Exchange.jpg')
    const hit = wikimediaHit(page, 1200, 0, 5)!
    expect(hit).toMatchObject({ source: 'wikimedia', licence: 'Public domain', mime: 'image/jpeg', attributionRequired: false, kind: 'photo' })
    expect(hit.width).toBe(2000) // the original is 3000 px: the thumbnail is handed out
    expect(hit.fileUrl).toMatch(/^https:\/\/upload\.wikimedia\.org\//)
    expect(hit.creator).not.toMatch(/[<>]/)
    expect(hit.attribution).toBe(`${hit.title} — ${hit.creator}, Public domain, via Wikimedia Commons`)
    expect(hit.pageUrl).toContain('commons.wikimedia.org/wiki/File:')
  })

  it('a picture narrower than 2000 px is handed out as it is, with its real size (not the requested thumbnail width)', () => {
    const page = wall.find((p) => p.title === 'File:Crowd outside nyse.jpg') // 718 x 1024, thumbwidth says 2000
    expect(wikimediaHit(page, 1200, 0, 5)).toBeUndefined() // too small for the default window
    const hit = wikimediaHit(page, 600, 0, 5)!
    expect([hit.width, hit.height]).toEqual([718, 1024])
    expect(hit.fileUrl).toContain('utm_content=original')
  })

  it('keeps CC BY-SA with its credit required, refuses a synthetic NC file and a file without licence', () => {
    const sa = wall.find((p) => p.title.includes('Harga Saham'))
    expect(wikimediaHit(sa, 1200, 0, 5)).toMatchObject({ licence: 'CC BY-SA 4.0', attributionRequired: true })
    const withLicence = (name: string | undefined): unknown => {
      const copy = structuredClone(wall.find((p) => p.title.includes('(2)')))
      if (name === undefined) delete copy.imageinfo[0].extmetadata.LicenseShortName
      else copy.imageinfo[0].extmetadata.LicenseShortName.value = name
      delete copy.imageinfo[0].extmetadata.UsageTerms
      return copy
    }
    expect(wikimediaHit(withLicence('CC BY-SA 4.0'), 1200, 0, 5)).toBeDefined()
    expect(wikimediaHit(withLicence('CC BY-NC 4.0'), 1200, 0, 5)).toBeUndefined()
    expect(wikimediaHit(withLicence('CC BY-ND 2.0'), 1200, 0, 5)).toBeUndefined()
    expect(wikimediaHit(withLicence('Copyrighted free use'), 1200, 0, 5)).toBeUndefined()
    expect(wikimediaHit(withLicence(undefined), 1200, 0, 5)).toBeUndefined()
  })

  it('refuses a non-image mime and a file hosted elsewhere', () => {
    const page = structuredClone(wall.find((p) => p.title.includes('(2)')))
    page.imageinfo[0].mime = 'image/svg+xml'
    expect(wikimediaHit(page, 1200, 0, 5)).toBeUndefined()
    const other = structuredClone(wall.find((p) => p.title.includes('(2)')))
    other.imageinfo[0].thumburl = 'https://evil.example.com/x.jpg'
    expect(wikimediaHit(other, 1200, 0, 5)).toBeUndefined()
  })

  it('searchArchives sends the descriptive User-Agent, one request, and ranks the recorded answer', async () => {
    const { fetch, calls } = fakeFetch([['commons.wikimedia.org/w/api.php', () => json(fixture('wikimedia-wall-street'))]])
    const { hits, errors } = await searchArchives('Wall Street crash 1929', { sources: ['wikimedia'], count: 3 }, { fetch })
    expect(errors).toEqual([])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.headers['user-agent']).toBe(ARCHIVE_USER_AGENT)
    const url = new URL(calls[0]!.url)
    expect(url.searchParams.get('gsrnamespace')).toBe('6')
    expect(url.searchParams.get('iiurlwidth')).toBe('2000')
    expect(url.searchParams.get('gsrsearch')).toBe('Wall Street crash 1929 filetype:bitmap')
    expect(url.searchParams.get('iiprop')).toBe('url|size|mime|extmetadata')
    expect(hits).toHaveLength(3)
    expect(hits.every((h) => h.licence === 'Public domain' || h.licence.startsWith('CC BY'))).toBe(true)
    expect(hits.map((h) => h.score)).toEqual([...hits.map((h) => h.score)].sort((a, b) => b - a))
  })

  it('hints that leave nothing cost one more request without them', async () => {
    let n = 0
    const { fetch, calls } = fakeFetch([
      ['commons.wikimedia.org/w/api.php', () => (n++ === 0 ? json({ batchcomplete: true }) : json(fixture('wikimedia-potosi')))]
    ])
    const { hits } = await searchArchives('Potosi silver mine', { sources: ['wikimedia'], kind: 'painting', era: '1650' }, { fetch })
    expect(calls).toHaveLength(2)
    expect(new URL(calls[0]!.url).searchParams.get('gsrsearch')).toContain('(painting OR engraving)')
    expect(new URL(calls[1]!.url).searchParams.get('gsrsearch')).toBe('Potosi silver mine filetype:bitmap')
    expect(hits.length).toBeGreaterThan(0)
  })
})

describe('Internet Archive', () => {
  const sizes = { 'the-bridge_202406': [1300, 975], 'flickr-ows-BrooklynBridgeOctober2011-6308759794': [2048, 1536], 'ISS015-E-5483': [1000, 750], 'sts102-349-014': [2972, 1984] } as Record<string, [number, number]>

  it('lists licensed items, measures their file, builds the credit; the licence URL decides', async () => {
    const { fetch, calls } = fakeFetch(iaRoutes(sizes))
    const { hits, errors } = await searchArchives('Brooklyn Bridge', { sources: ['internet-archive'], count: 4, minLongSide: 900 }, { fetch })
    expect(errors).toEqual([])
    const bridge = hits.find((h) => h.id === 'the-bridge_202406')!
    expect(bridge).toMatchObject({ licence: 'CC0 1.0', width: 1300, height: 975, mime: 'image/jpeg', attributionRequired: false })
    expect(bridge.fileUrl).toBe('https://archive.org/download/the-bridge_202406/Screenshot_20240615_235847_Wallpaper%20and%20style.jpg')
    const flickr = hits.find((h) => h.id.startsWith('flickr'))!
    expect(flickr).toMatchObject({ licence: 'CC BY 2.0', attributionRequired: true })
    expect(flickr.attribution).toBe(`${flickr.title} — ${flickr.creator}, CC BY 2.0, via Internet Archive`)
    expect(hits.find((h) => h.id === 'ISS015-E-5483')?.licence).toBe('Public domain') // « rights: Public Domain », no licence URL
    expect(calls.every((c) => c.headers['user-agent'] === ARCHIVE_USER_AGENT)).toBe(true)
    // the probe asked for the head of the file only
    expect(calls.some((c) => c.headers.range?.startsWith('bytes=0-'))).toBe(true)
  })

  it('refuses items without licence, NC/ND items, files over 25 MB and pictures outside the size window', async () => {
    const search = fixture('ia-search-brooklyn')
    const base = search.response.docs[0]
    search.response.docs.unshift(
      { identifier: 'no-licence-item', title: 'Brooklyn Bridge no licence' }, // synthetic: nothing says the item is free
      { ...base, identifier: 'nc-item', title: 'Brooklyn Bridge NC', licenseurl: 'http://creativecommons.org/licenses/by-nc-nd/4.0/' }, // synthetic
      { identifier: 'huge-item', title: 'Brooklyn Bridge huge', 'possible-copyright-status': 'NOT_IN_COPYRIGHT' } // synthetic
    )
    const { fetch, calls } = fakeFetch([
      ...iaRoutes(sizes).filter(([k]) => k !== 'archive.org/advancedsearch.php'),
      ['archive.org/advancedsearch.php', () => json(search)],
      ['archive.org/metadata/huge-item', () => json({ metadata: {}, files: [{ name: 'scan.jpg', format: 'JPEG', size: String(70 * 1024 * 1024), source: 'original' }] })]
    ])
    const { hits } = await searchArchives('Brooklyn Bridge', { sources: ['internet-archive'], count: 10, minLongSide: 1200 }, { fetch })
    const ids = hits.map((h) => h.id)
    expect(ids).not.toContain('no-licence-item')
    expect(ids).not.toContain('nc-item')
    expect(ids).not.toContain('huge-item') // only a 70 MB original: skipped
    expect(ids).not.toContain('ISS015-E-5483') // 1000 px < 1200 px
    expect(ids).toContain('the-bridge_202406')
    // the refused items cost no metadata request
    expect(calls.some((c) => c.url.includes('no-licence-item') || c.url.includes('nc-item'))).toBe(false)
  })

  it('an item whose metadata fails does not lose the others', async () => {
    const routes = iaRoutes(sizes)
    routes.unshift(['archive.org/metadata/the-bridge_202406', () => new Response('x', { status: 500 })])
    const { fetch } = fakeFetch(routes)
    const { hits, errors } = await searchArchives('Brooklyn Bridge', { sources: ['internet-archive'], minLongSide: 900 }, { fetch })
    expect(errors).toEqual([])
    expect(hits.map((h) => h.id)).not.toContain('the-bridge_202406')
    expect(hits.length).toBeGreaterThan(0)
  })
})

describe('NASA', () => {
  it('takes the rendition in the window, derives ~large.jpg for an original-only item, skips third-party copyright', async () => {
    const answer = fixture('nasa-apollo')
    answer.collection.items.push({
      // synthetic: a third party's picture hosted in the library
      data: [{ nasa_id: 'copyrighted-1', media_type: 'image', title: 'Apollo moon landing poster', description: 'Photo © Getty Images, used with permission' }],
      links: [{ href: 'https://images-assets.nasa.gov/image/copyrighted-1/copyrighted-1~large.jpg', render: 'image', width: 1920, height: 1280, size: 300000 }]
    })
    const { fetch, calls } = fakeFetch([['images-api.nasa.gov/search', () => json(answer)]])
    const { hits } = await searchArchives('Apollo 11 moon landing', { sources: ['nasa'], count: 10 }, { fetch })
    expect(new URL(calls[0]!.url).searchParams.get('media_type')).toBe('image')
    expect(hits.length).toBeGreaterThanOrEqual(3)
    expect(hits.map((h) => h.id)).not.toContain('copyrighted-1')
    for (const h of hits) {
      expect(h).toMatchObject({ source: 'nasa', licence: 'Public domain (NASA)', attributionRequired: false, mime: 'image/jpeg' })
      expect(h.fileUrl).toMatch(/^https:\/\/images-assets\.nasa\.gov\//)
      expect(Math.max(h.width, h.height)).toBeLessThanOrEqual(4096)
      expect(h.attribution).toContain('Public domain (NASA), via NASA')
    }
    const orig = hits.find((h) => h.id === 'GRC-2019-C-05975')! // only an 8256 x 5504 original is listed
    expect(orig.fileUrl).toBe('https://images-assets.nasa.gov/image/GRC-2019-C-05975/GRC-2019-C-05975~large.jpg')
    expect([orig.width, orig.height]).toEqual([1920, 1280])
  })
})

describe('The Met Open Access', () => {
  const metRoutes = (): Array<[string, (url: string) => Response]> => {
    const search = fixture('met-search-treaty')
    const objects: Record<number, any> = {}
    for (const id of [6521, 186729, 361519]) objects[id] = fixture(`met-object-${id}`)
    objects[361519] = { ...objects[361519], isPublicDomain: false } // synthetic: not open access
    return [
      ['/v1.1/search', () => json(search)],
      ...[6521, 186729, 361519].map((id): [string, () => Response] => [`/v1/objects/${id}`, () => json(objects[id])]),
      ['/v1/objects/', () => json({ message: 'Not Found' }, 404)],
      ['images.metmuseum.org', () => new Response(jpegHeader(3000, 2400), { status: 206, headers: { 'content-type': 'image/jpeg' } })]
    ]
  }

  it('uses the v1.1 search, keeps public-domain objects with an image, CC0 licence, measured size', async () => {
    const { fetch, calls } = fakeFetch(metRoutes())
    const { hits, errors } = await searchArchives('Treaty of Tordesillas Campo Formio', { sources: ['met'], count: 5 }, { fetch })
    expect(errors).toEqual([])
    expect(calls[0]!.url).toContain('/public/collection/v1.1/search?')
    expect(calls[0]!.url).toContain('isPublicDomain=true')
    expect(hits.map((h) => h.id)).toContain('186729')
    expect(hits.map((h) => h.id)).not.toContain('361519')
    const h = hits.find((x) => x.id === '186729')!
    expect(h).toMatchObject({ source: 'met', licence: 'CC0', width: 3000, height: 2400, attributionRequired: false })
    expect(h.attribution).toBe(`${h.title} — ${h.creator}, CC0, via The Metropolitan Museum of Art`)
  })

  it('the retired v1 search answer is reported as an error, not thrown', async () => {
    const { fetch } = fakeFetch([
      ['/v1.1/search', () => json({ message: '/public/collection/v1/search was retired on 2026-10-01' })],
      ['commons.wikimedia.org', () => json(fixture('wikimedia-potosi'))]
    ])
    const { hits, errors } = await searchArchives('Potosi silver mine', { sources: ['met', 'wikimedia'] }, { fetch })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.source).toBe('met')
    expect(hits.length).toBeGreaterThan(0)
  })
})

describe('ranking, duplicates and failures', () => {
  const hit = (over: Partial<ArchiveHit>): ArchiveHit => ({
    source: 'wikimedia',
    id: 'a',
    title: 'Stock exchange crowd 1929',
    pageUrl: 'https://commons.wikimedia.org/wiki/File:a.jpg',
    fileUrl: 'https://upload.wikimedia.org/a.jpg',
    width: 2000,
    height: 1300,
    mime: 'image/jpeg',
    licence: 'Public domain',
    attribution: 'x',
    attributionRequired: false,
    score: 10,
    ...over
  })

  it('orientation, kind, query words, size and licence move the order', () => {
    const land = hit({ id: 'land', title: 'Stock exchange crowd', width: 2000, height: 1300 })
    const port = hit({ id: 'port', title: 'Stock exchange crowd', width: 1300, height: 2000, fileUrl: 'https://upload.wikimedia.org/b.jpg' })
    expect(rankHits([port, land], { query: 'stock exchange crowd', orientation: 'landscape' })[0]!.id).toBe('land')
    expect(rankHits([land, port], { query: 'stock exchange crowd', orientation: 'portrait' })[0]!.id).toBe('port')

    const paint = hit({ id: 'paint', title: 'Silver mine', kind: 'painting', fileUrl: 'https://upload.wikimedia.org/c.jpg' })
    const photo = hit({ id: 'photo', title: 'Silver mine', kind: 'photo', fileUrl: 'https://upload.wikimedia.org/d.jpg' })
    expect(rankHits([photo, paint], { query: 'silver mine', orientation: 'any', kind: 'painting' })[0]!.id).toBe('paint')

    const pd = hit({ id: 'pd', title: 'Silver mine', licence: 'Public domain', fileUrl: 'https://upload.wikimedia.org/e.jpg' })
    const sa = hit({ id: 'sa', title: 'Silver mine', licence: 'CC BY-SA 3.0', fileUrl: 'https://upload.wikimedia.org/f.jpg' })
    expect(rankHits([sa, pd], { query: 'silver mine', orientation: 'any' }).map((h) => h.id)).toEqual(['pd', 'sa'])

    const off = hit({ id: 'off', title: 'Unrelated bracelet', fileUrl: 'https://upload.wikimedia.org/g.jpg' })
    const on = hit({ id: 'on', title: 'Silver mine of Potosi', fileUrl: 'https://upload.wikimedia.org/h.jpg' })
    expect(rankHits([off, on], { query: 'silver mine potosi', orientation: 'any' })[0]!.id).toBe('on')
  })

  it('a fuzzy source hit that shares few words with the query is dropped, a Commons one is kept', () => {
    const noise = hit({ source: 'met', id: '9', title: 'Bracelet', fileUrl: 'https://images.metmuseum.org/9.jpg' })
    const commons = hit({ id: 'c', title: 'Crowd', fileUrl: 'https://upload.wikimedia.org/z.jpg' })
    expect(rankHits([noise, commons], { query: '1929 stock market crash', orientation: 'any' }).map((h) => h.id)).toEqual(['c'])
  })

  it('removes duplicates: same file, or the same title from two sources, keeping the better one', () => {
    const a = hit({ id: 'one', title: 'Crowds gathering outside New York Stock Exchange', score: 30 })
    const b = hit({ source: 'internet-archive', id: 'two', title: 'Crowds gathering outside New York Stock Exchange', fileUrl: 'https://archive.org/download/two/x.jpg', score: 5 })
    const c = hit({ id: 'three', title: 'Another one', fileUrl: a.fileUrl })
    const out = rankHits([b, a, c], { query: 'crowds new york stock exchange', orientation: 'any' })
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe('one')
  })

  it('one failing source is reported in errors; the others still answer', async () => {
    const { fetch } = fakeFetch([
      ['commons.wikimedia.org', () => json(fixture('wikimedia-wall-street'))],
      ['archive.org', () => new Response('boom', { status: 503 })],
      ['images-api.nasa.gov', () => json(fixture('nasa-apollo'))],
      ['collectionapi.metmuseum.org', () => json({ total: 0, objectIDs: null })]
    ])
    const { hits, errors } = await searchArchives('Wall Street crash 1929', { count: 4 }, { fetch })
    expect(errors).toEqual([{ source: 'internet-archive', message: 'HTTP 503 from archive.org' }])
    expect(hits).toHaveLength(4)
    expect(hits.every((h) => h.source === 'wikimedia')).toBe(true)
  })

  it('throws only when every asked source failed', async () => {
    const { fetch } = fakeFetch([['', () => new Response('down', { status: 500 })]])
    const err = await searchArchives('anything', {}, { fetch }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ArchiveSearchError)
    expect((err as ArchiveSearchError).errors.map((e) => e.source)).toEqual(['wikimedia', 'internet-archive', 'nasa', 'met'])
    // a source asked alone and failing is « every source failed » too
    await expect(searchArchives('x', { sources: ['nasa'] }, { fetch })).rejects.toBeInstanceOf(ArchiveSearchError)
  })

  it('a slow source times out into errors without blocking the others', async () => {
    const { fetch } = fakeFetch([
      ['commons.wikimedia.org', () => json(fixture('wikimedia-wall-street'))],
      ['images-api.nasa.gov', () => new Promise<Response>(() => undefined)] // never answers
    ])
    // the fake ignores the abort signal, so only the source deadline can end it: check it is a race, not a hang
    const slow = (async (url: any, init: any) => {
      if (String(url).includes('nasa')) {
        return new Promise<Response>((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
      }
      return fetch(url, init)
    }) as typeof fetch
    const { hits, errors } = await searchArchives('Wall Street crash 1929', { sources: ['wikimedia', 'nasa'], count: 2 }, { fetch: slow, timeoutMs: 60 })
    expect(hits).toHaveLength(2)
    expect(errors.map((e) => e.source)).toEqual(['nasa'])
  })

  it('an empty query, or no source, returns nothing without a request', async () => {
    const { fetch, calls } = fakeFetch([])
    expect(await searchArchives('   ', {}, { fetch })).toEqual({ hits: [], errors: [] })
    expect(await searchArchives('x', { sources: [] }, { fetch })).toEqual({ hits: [], errors: [] })
    expect(calls).toHaveLength(0)
  })
})

describe('image size from the first bytes', () => {
  it('reads JPEG, PNG and WebP headers', () => {
    expect(imageSize(jpegHeader(3000, 2400))).toEqual({ width: 3000, height: 2400, mime: 'image/jpeg' })
    const png = new Uint8Array(32)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x07, 0xd0, 0, 0, 0x05, 0xdc])
    expect(imageSize(png)).toEqual({ width: 2000, height: 1500, mime: 'image/png' })
    const webp = new Uint8Array(40)
    webp.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0)
    webp.set([...'WEBPVP8X'].map((c) => c.charCodeAt(0)), 8)
    webp.set([0xcf, 0x07, 0, 0xdb, 0x05, 0], 24) // 1999 x 1499 (minus one)
    expect(imageSize(webp)).toEqual({ width: 2000, height: 1500, mime: 'image/webp' })
    expect(imageSize(new Uint8Array(40))).toBeUndefined()
  })
})

describe('downloadArchive', () => {
  const dirs: string[] = []
  const tmp = (): string => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'archive-dl-'))
    dirs.push(d)
    return d
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  const target: ArchiveHit = {
    source: 'wikimedia',
    id: 'Crowds gathering (2).jpg',
    title: 't',
    pageUrl: 'https://commons.wikimedia.org/wiki/File:x.jpg',
    fileUrl: 'https://upload.wikimedia.org/wikipedia/commons/x/x.jpg',
    width: 2000,
    height: 1500,
    mime: 'image/jpeg',
    licence: 'Public domain',
    attribution: 'a',
    attributionRequired: false,
    score: 1
  }
  const bytes = (n: number): Uint8Array<ArrayBuffer> => new Uint8Array(new ArrayBuffer(n)).fill(7)
  const stream = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(ch)
        c.close()
      }
    })

  it('streams the picture to <source>-<safe id>.<ext>, sending the User-Agent', async () => {
    const dir = tmp()
    const { fetch, calls } = fakeFetch([['upload.wikimedia.org', () => new Response(stream([bytes(1000), bytes(500)]), { headers: { 'content-type': 'image/jpeg' } })]])
    const r = await downloadArchive(target, path.join(dir, 'nested'), { fetch })
    expect(r.bytes).toBe(1500)
    expect(path.basename(r.file)).toBe('wikimedia-Crowds_gathering_2_.jpg')
    expect(readFileSync(r.file).length).toBe(1500)
    expect(calls[0]!.headers['user-agent']).toBe(ARCHIVE_USER_AGENT)
    expect(readdirSync(path.join(dir, 'nested'))).toEqual(['wikimedia-Crowds_gathering_2_.jpg']) // no .part left
  })

  it('refuses a content type that is not an image, without retrying and without leaving a file', async () => {
    const dir = tmp()
    const { fetch, calls } = fakeFetch([['upload.wikimedia.org', () => new Response('<html>blocked</html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })]])
    await expect(downloadArchive(target, dir, { fetch })).rejects.toThrow(/not an image/)
    expect(calls).toHaveLength(1)
    expect(readdirSync(dir)).toEqual([])
  })

  it('refuses a file over the limit: declared by Content-Length, or found while streaming', async () => {
    const dir = tmp()
    const declared = fakeFetch([['upload.wikimedia.org', () => new Response(bytes(10), { headers: { 'content-type': 'image/png', 'content-length': String(26 * 1024 * 1024) } })]])
    await expect(downloadArchive(target, dir, { fetch: declared.fetch })).rejects.toBeInstanceOf(ArchiveDownloadError)
    expect(declared.calls).toHaveLength(1)

    const streamed = fakeFetch([['upload.wikimedia.org', () => new Response(stream([bytes(600), bytes(600)]), { headers: { 'content-type': 'image/jpeg' } })]])
    await expect(downloadArchive(target, dir, { fetch: streamed.fetch, maxBytes: 1000 })).rejects.toThrow(/too big/)
    expect(streamed.calls).toHaveLength(1)
    expect(readdirSync(dir)).toEqual([]) // the partial file is removed
  })

  it('retries once on a server error, not on a 404', async () => {
    const dir = tmp()
    let n = 0
    const flaky = fakeFetch([['upload.wikimedia.org', () => (n++ === 0 ? new Response('busy', { status: 503 }) : new Response(bytes(100), { headers: { 'content-type': 'image/webp' } }))]])
    const r = await downloadArchive(target, dir, { fetch: flaky.fetch })
    expect(flaky.calls).toHaveLength(2)
    expect(path.extname(r.file)).toBe('.webp')

    const missing = fakeFetch([['upload.wikimedia.org', () => new Response('nope', { status: 404 })]])
    await expect(downloadArchive(target, dir, { fetch: missing.fetch })).rejects.toThrow(/404/)
    expect(missing.calls).toHaveLength(1)

    const down = fakeFetch([['upload.wikimedia.org', () => new Response('down', { status: 500 })]])
    await expect(downloadArchive(target, dir, { fetch: down.fetch })).rejects.toThrow(/500/)
    expect(down.calls).toHaveLength(2) // one retry, then give up
    expect(existsSync(path.join(dir, 'wikimedia-Crowds_gathering_2_.jpg.part'))).toBe(false)
  })
})

describe('archive titles and wider searches (style-markets real probe)', () => {
  it('cuts the Wikidata labels a template writes into the object name', async () => {
    const { cleanTitle } = await import('../../src/engine/archive/wikimedia')
    expect(cleanTitle('Portrait of Lucas de Clercq title QS:P1476,en:"Portrait of Lucas de Clercq " label QS:Len,"x"')).toBe('Portrait of Lucas de Clercq')
    expect(cleanTitle('Still life with flowers .')).toBe('Still life with flowers .')
  })
})
