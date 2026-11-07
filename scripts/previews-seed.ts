// `npm run previews:seed` — the saved previews the app ships (production-15, src/shared/previews.ts), made on the fakes: for
// every engine and style the base pipelines can use, two stills (pictures), or two seconds of clip or presenter, drawn the
// way the demo providers draw them, small (640×360 stills, 480×270 clips) and labelled « démonstration ». Written to
// resources/previews (files + manifest.json). The real samples come later from the model tests (`PreviewStore.save`).
// Options: --out <dir> (default resources/previews).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { drawStill } from '../src/engine/media/draw'
import { drawClip, drawPresenter } from '../src/engine/media/draw-video'
import { FULL_FFMPEG_HINT, systemMediaService } from '../src/engine/media/tools'
import { previewCatalog, technologyRegistry } from '../src/engine/technologies'
import { folderOf } from '../src/main/production/previews'
import { BASE_STYLES } from '../src/main/production/styles/seeds'
import { PREVIEWS_SCHEMA, type PreviewItem, type PreviewManifest } from '../src/shared/previews'

const ROOT = path.resolve(import.meta.dirname, '..')
const i = process.argv.indexOf('--out')
const OUT = path.resolve(i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : path.join(ROOT, 'resources', 'previews'))
const FONT = path.join(ROOT, 'resources', 'fonts', 'Inter-SemiBold.ttf')
const signal = new AbortController().signal
const out = (s: string): void => void process.stdout.write(s + '\n')

const media = systemMediaService({ platform: process.platform, pathEnv: process.env.PATH ?? process.env.Path ?? '' })
if (!media) {
  out(`ffmpeg est introuvable : installe-le (${FULL_FFMPEG_HINT}) puis relance « npm run previews:seed ».`)
  process.exit(1)
}
const ff = (args: string[]): Promise<unknown> => media.run('ffmpeg', ['-v', 'error', '-y', ...args], { signal })
const hash = (s: string): string => createHash('sha256').update(s).digest('hex')
const tmp = path.join(os.tmpdir(), `atelier-previews-${process.pid}`)
const label = (key: string): string => key.replace(/^style:/, 'style ').replace(/^(image|clip|presenter):/, '$1 · ')

rmSync(OUT, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })
const items: PreviewItem[] = []
for (const k of previewCatalog(technologyRegistry(), BASE_STYLES)) {
  const dir = folderOf(k.key)
  mkdirSync(path.join(OUT, dir), { recursive: true })
  const files: PreviewItem['files'] = []
  const still = async (n: number): Promise<string> => {
    const big = path.join(tmp, `${dir}-${n}.png`)
    await drawStill(media, { out: big, hash: hash(`${k.key}#${n}`), title: label(k.key), detail: n === 1 ? 'Aperçu enregistré : gratuit à regarder' : 'Un deuxième plan du même choix', footer: 'Aperçu de démonstration', font: FONT, watermark: true }, signal)
    return big
  }
  if (k.family === 'image') {
    for (const n of [1, 2]) {
      const name = `still-${n}.jpg`
      await ff(['-i', await still(n), '-vf', 'scale=640:-2', '-q:v', '5', path.join(OUT, dir, name)])
      files.push({ ref: `${dir}/${name}`, type: 'image' })
    }
  } else {
    const clip = path.join(tmp, `${dir}.mp4`)
    if (k.family === 'clip') await drawClip(media, { still: await still(1), out: clip, seconds: 2, aspect: '16:9', signal })
    else {
      const audio = path.join(tmp, `${dir}.wav`)
      await ff(['-f', 'lavfi', '-i', 'sine=frequency=180:duration=2', '-af', 'volume=0.6,tremolo=f=5:d=0.8', audio])
      await drawPresenter(media, { audio, out: clip, seconds: 2, aspect: '16:9', hash: hash(k.key), font: FONT, label: label(k.key), signal })
    }
    await ff(['-i', clip, '-vf', 'scale=480:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', path.join(OUT, dir, 'clip.mp4')])
    files.push({ ref: `${dir}/clip.mp4`, type: 'video' })
  }
  items.push({ key: k.key, kind: k.kind, family: k.family, label: label(k.key), source: 'demo', madeAt: '2026-11-01', files })
  out(`${k.key}: ${files.length} file(s)`)
}
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ schema: PREVIEWS_SCHEMA, items } satisfies PreviewManifest, null, 2) + '\n')
writeFileSync(
  path.join(OUT, 'README.md'),
  '# Saved previews (made on the fakes)\n\nMade by `npm run previews:seed` (production-15): one gallery entry per engine and style the base pipelines can use, drawn ' +
    'like the demo providers draw. Real samples made by the model tests are saved in the app’s data folder and win over these.\n'
)
rmSync(tmp, { recursive: true, force: true })
out(`${items.length} aperçus dans ${path.relative(ROOT, OUT)}`)
