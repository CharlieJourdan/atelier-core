// The saved previews per technology (production-15, src/shared/previews.ts): a manifest per folder — the set the app ships
// (`resources/previews`, made on the fakes by `npm run previews:seed`) then the app's own (`<userData>/previews`, where the
// model tests save real samples with `save`) — the later folder winning per key. Reading them is free: nothing is made here.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PREVIEWS_SCHEMA, type PreviewItem, type PreviewManifest } from '../../../shared/previews'
import type { RunFile } from '../../../shared/runs'
import { readRunFile } from '../runs/files'

const MANIFEST = 'manifest.json'
const SAFE = /^[a-z0-9][a-z0-9.:-]{0,120}$/

/** A key as a folder name (`image:gpt-image-25-low` → `image-gpt-image-25-low`). */
export const folderOf = (key: string): string => key.replace(/[^a-z0-9.-]+/g, '-')

function readManifest(dir: string): PreviewItem[] {
  try {
    const m = JSON.parse(readFileSync(path.join(dir, MANIFEST), 'utf8')) as PreviewManifest
    return m.schema === PREVIEWS_SCHEMA && Array.isArray(m.items) ? m.items : []
  } catch {
    return []
  }
}

export class PreviewStore {
  private readonly dirs: readonly string[]

  /** `dirs`: the shipped set first, the app's own last (it wins). */
  constructor(dirs: readonly string[]) {
    this.dirs = dirs
  }

  private all(): Map<string, { item: PreviewItem; dir: string }> {
    const out = new Map<string, { item: PreviewItem; dir: string }>()
    for (const dir of this.dirs) for (const item of readManifest(dir)) out.set(item.key, { item, dir })
    return out
  }

  /** The previews of these keys (all of them without keys), in the order asked. */
  list(keys?: readonly string[]): PreviewItem[] {
    const all = this.all()
    if (!keys) return [...all.values()].map((x) => x.item)
    return keys.flatMap((k) => {
      const x = all.get(k)
      return x ? [x.item] : []
    })
  }

  /** One file of a preview (refused outside its set's folder). */
  async file(key: unknown, ref: unknown): Promise<RunFile> {
    if (typeof key !== 'string' || !SAFE.test(key)) throw new Error('Aperçu inconnu.')
    const x = this.all().get(key)
    if (!x || !x.item.files.some((f) => f.ref === ref)) throw new Error('Aperçu introuvable.')
    return readRunFile(x.dir, ref)
  }

  /** Saves a preview in the app's own set (the model tests' real samples): its files, then its manifest line. */
  save(item: Omit<PreviewItem, 'files'>, files: readonly { name: string; type: 'image' | 'video'; bytes: Uint8Array }[]): PreviewItem {
    if (!SAFE.test(item.key)) throw new Error('Clé d’aperçu invalide.')
    const dir = this.dirs[this.dirs.length - 1]
    if (!dir) throw new Error('Aucun dossier d’aperçus.')
    const sub = folderOf(item.key)
    mkdirSync(path.join(dir, sub), { recursive: true })
    const saved: PreviewItem = { ...item, files: [] }
    for (const f of files) {
      const name = path.basename(f.name).replace(/[^A-Za-z0-9._-]+/g, '-')
      writeFileSync(path.join(dir, sub, name), f.bytes)
      saved.files.push({ ref: `${sub}/${name}`, type: f.type })
    }
    const items = readManifest(dir).filter((i) => i.key !== item.key)
    items.push(saved)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, MANIFEST), JSON.stringify({ schema: PREVIEWS_SCHEMA, items } satisfies PreviewManifest, null, 2))
    return saved
  }
}
