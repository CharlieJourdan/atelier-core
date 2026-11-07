// A local CC0 sound bank: a folder with `bank.json` and the audio files. Free, instant, offline, no key. `scripts/make-sfx-bank.mjs`
// synthesises a starter bank with ffmpeg (whooshes, hits, risers, clicks: our own synthesis, so CC0); a folder of downloaded
// Freesound CC0 sounds or the YouTube Audio Library works the same once listed in `bank.json`:
//   { "items": [ { "file": "whoosh-1.wav", "title": "Whoosh, short", "tags": ["whoosh","transition"], "kind": "sfx",
//                  "durationS": 0.6, "licence": "CC0", "creator": "Atelier synth" } ] }
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { queryWords } from '../../archive/rank.ts'
import { licenceFromText } from '../legal.ts'
import type { MediaCandidate, MediaKind, SourceQuery, SourcingProvider } from '../types.ts'
import { arr, candidate, num, rec, str } from './common.ts'

const MIME: Record<string, string> = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac' }

export function localBank(dir: string): SourcingProvider {
  return {
    id: 'local-bank',
    label: 'Atelier sound bank',
    kinds: ['sfx', 'music'],
    async search(q: SourceQuery): Promise<MediaCandidate[]> {
      let items: Record<string, unknown>[]
      try {
        items = arr(rec(JSON.parse(await readFile(path.join(dir, 'bank.json'), 'utf8'))).items).map(rec)
      } catch {
        return [] // no bank yet: nothing to offer, not an error
      }
      const words = queryWords(q.query)
      const out: MediaCandidate[] = []
      for (const it of items) {
        const kind: MediaKind = str(it.kind) === 'music' ? 'music' : 'sfx'
        const licence = licenceFromText(str(it.licence))
        const file = str(it.file)
        if (kind !== q.kind || !licence || !file) continue
        const tags = arr(it.tags).map(str)
        const hay = `${str(it.title)} ${tags.join(' ')}`.toLowerCase()
        const hits = words.filter((w) => hay.includes(w) || (w.endsWith('s') && hay.includes(w.slice(0, -1)))).length
        if (words.length && hits === 0) continue
        const durationS = num(it.durationS)
        if (q.maxDurationS !== undefined && durationS > q.maxDurationS) continue
        if (q.minDurationS !== undefined && durationS < q.minDurationS) continue
        const abs = path.resolve(dir, file)
        const url = pathToFileURL(abs).toString()
        out.push({ ...candidate({ provider: 'local-bank', label: 'Atelier sound bank', id: file, kind, title: str(it.title) || file, creator: str(it.creator) || undefined, tags, pageUrl: url, previewUrl: url, fileUrl: url, mime: MIME[path.extname(file).toLowerCase()], durationS, licence, rank: 0, total: 1 }), score: 20 * (hits / Math.max(words.length, 1)) })
      }
      return out.sort((a, b) => b.score - a.score).slice(0, q.want * 2)
    }
  }
}
