// Drawn stand-in clips (docs/ENGINE-SPEC.md §23 Fake): what the demo mode makes where a provider would give a video, so the
// whole path (the clip file, its placement in the render) is exercised without a network call.
//   drawClip      a generated-video shot: the drawn still of the item, slowly zooming, with a marker sweeping along the bottom
//                 (a still with a camera move could not be told from an animated picture);
//   drawPresenter a talking avatar: a silhouette on a gradient whose « mouth » is the voice's own waveform, so the clip
//                 moves exactly when the voice speaks (the spec's « silhouette animated on the audio envelope »), and
//                 a slow breathing push in and out, so a long presenter shot is never a frozen picture (a real one moves).
// Both are silent, 30 fps, H.264, and carry the DÉMO mark of the other drawn pictures.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Framing } from '../../shared/presenter-engines'
import { FPS, frameSizeOf, type Aspect } from '../formats/timing'
import type { MediaService } from '../services'
import { filterPath, withShortPaths } from './filters'
import { PALETTE } from './draw'
import { requireFilters } from './tools'

export const DRAW_VIDEO_FILTERS = ['zoompan', 'geq', 'showwaves', 'drawtext', 'overlay']
/** Bumped when the drawing changes, so cached drawings are made again. */
export const DRAW_VIDEO_VERSION = 3

const ENCODE = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p', '-an']

/** A clip of `seconds` made from `still`: a slow push in with a sweeping marker. */
export async function drawClip(media: MediaService, o: { still: string; out: string; seconds: number; aspect: Aspect; signal: AbortSignal }): Promise<void> {
  await requireFilters(media, DRAW_VIDEO_FILTERS, o.signal)
  const [w, h] = frameSizeOf(o.aspect)
  const n = Math.max(2, Math.round(o.seconds * FPS))
  const graph =
    `[0:v]zoompan=z='1+0.16*on/${n - 1}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${w}x${h}:fps=${FPS}[z];` +
    `color=c=white@0.7:s=140x10:r=${FPS},format=rgba[bar];` +
    `[z][bar]overlay=x='mod(n*10,W)':y=H-46:shortest=1,format=yuv420p[v]`
  await media.run('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-framerate', String(FPS), '-i', o.still, '-filter_complex', graph, '-map', '[v]', '-frames:v', String(n), ...ENCODE, o.out], { signal: o.signal })
}

/** Stand-in people's skin tones, shirts and hair (the fake portrait: `person`). */
const SKIN = [[241, 194, 167], [224, 172, 135], [198, 134, 98], [161, 102, 70], [118, 74, 50], [232, 190, 160]]
const SHIRT = [[180, 40, 40], [40, 120, 70], [30, 110, 140], [90, 60, 150], [30, 30, 30], [235, 235, 235]]
const HAIR = [[40, 28, 20], [120, 80, 40], [220, 190, 120], [90, 90, 90]]
/** Eyes: height above the head's centre, half the distance between them, size (in head radii). */
const FACES: [number, number, number][] = [[0.18, 0.36, 0.075], [0.3, 0.26, 0.06], [0.08, 0.46, 0.09], [0.24, 0.3, 0.11], [0.12, 0.4, 0.05], [0.34, 0.42, 0.08], [0.02, 0.28, 0.07]]

/** How big the presenter is in each framing (an angle of the same person: `medium` is the portrait), and where the head sits. */
const FRAMING_SCALE: Record<Framing, { k: number; dx: number }> = { wide: { k: 0.62, dx: -0.16 }, medium: { k: 1, dx: 0 }, close: { k: 1.55, dx: 0.06 } }

/** The silhouette still of a presenter: a head and shoulders over a two-colour gradient (colours from `hash`), in a framing. */
async function silhouette(
  media: MediaService,
  o: { out: string; hash: string; aspect: Aspect; framing?: Framing; person?: boolean; signal: AbortSignal }
): Promise<{ w: number; h: number; mouth: { x: number; y: number; w: number; h: number } }> {
  const [w, h] = frameSizeOf(o.aspect)
  const pair = PALETTE[parseInt(o.hash.slice(0, 8), 16) % PALETTE.length] as [string, string]
  const rgb = (hex: string): number[] => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [a, b] = [rgb(pair[0]), rgb(pair[1])] as [number[], number[]]
  const f = FRAMING_SCALE[o.framing ?? 'medium']
  const cx = Math.round(w / 2 + w * f.dx)
  const short = Math.min(w, h)
  const R = Math.round(short * (o.aspect === '16:9' ? 0.17 : 0.2) * f.k)
  const cy = Math.round(h * (o.aspect === '16:9' ? 0.4 : 0.38) + (f.k - 1) * R * 0.35)
  // the shoulders: a wide ellipse under the head with a neck of background between them
  const rx = Math.round(short * (o.aspect === '16:9' ? 0.42 : 0.5) * f.k)
  const ry = Math.round(h * 0.3 * f.k)
  const ty = Math.round(cy + R + ry * 1.15)
  // a stand-in person's own face: where its eyes sit and how far apart (the presenter of the demo keeps the first)
  const face = o.person ? (FACES[parseInt(o.hash.slice(8, 16) || '0', 16) % FACES.length] as [number, number, number]) : ([0.18, 0.36, 0.075] as const)
  const eyeY = Math.round(cy - R * face[0])
  const eyeDx = Math.round(R * face[1])
  const eyeR = Math.max(3, Math.round(R * face[2]))
  const eyes = `gt(lt(hypot(X-${cx - eyeDx},Y-${eyeY}),${eyeR})+lt(hypot(X-${cx + eyeDx},Y-${eyeY}),${eyeR}),0)`
  const head = `lt(hypot(X-${cx},Y-${cy}),${R})`
  const torso = `lt(pow((X-${cx})/${rx},2)+pow((Y-${ty})/${ry},2),1)`
  // `person`: a stand-in PERSON (the fake portrait and angles): a skin tone, hair and a shirt of its own, from the hash
  const n = parseInt(o.hash.slice(8, 16) || '0', 16)
  const skin = o.person ? (SKIN[n % SKIN.length] as number[]) : [226, 232, 240]
  const shirt = o.person ? (SHIRT[Math.floor(n / 7) % SHIRT.length] as number[]) : [196, 206, 220]
  const hairY = Math.round(cy - R * (0.45 + 0.25 * ((Math.floor(n / 49) % 3) / 2)))
  const hair = o.person ? `lt(Y,${hairY})*${head}` : '0'
  const hairRgb = HAIR[Math.floor(n / 147) % HAIR.length] as number[]
  const channel = (k: number): string =>
    `if(${eyes},${[38, 42, 54][k]},if(${hair},${hairRgb[k]},if(${head},${skin[k]},if(${torso},${shirt[k]},${a[k]}+(${(b[k] as number) - (a[k] as number)})*Y/${h}))))`
  await media.run(
    'ffmpeg',
    ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=${w}x${h}:d=1,format=rgb24,geq=r='${channel(0)}':g='${channel(1)}':b='${channel(2)}'`, '-frames:v', '1', o.out],
    { signal: o.signal }
  )
  const mouthW = Math.round(R * 1.1)
  const mouthH = Math.round(R * 0.34)
  return { w, h, mouth: { x: Math.round(cx - mouthW / 2), y: Math.round(cy + R * 0.28), w: mouthW, h: mouthH } }
}

/** A talking-head stand-in as long as `audio` (`seconds`): the silhouette, its mouth drawn by the voice's waveform. */
export async function drawPresenter(
  media: MediaService,
  o: { audio: string; out: string; seconds: number; aspect: Aspect; hash: string; font: string; label: string; framing?: Framing; signal: AbortSignal }
): Promise<void> {
  await requireFilters(media, DRAW_VIDEO_FILTERS, o.signal)
  const dir = path.dirname(o.out)
  const base = path.basename(o.out, path.extname(o.out))
  const still = path.join(dir, `${base}.silhouette.png`)
  const { w, h, mouth } = await silhouette(media, { out: still, hash: o.hash, aspect: o.aspect, ...(o.framing ? { framing: o.framing } : {}), signal: o.signal })
  const labelFile = path.join(dir, `${base}.label.txt`)
  await writeFile(labelFile, o.label, 'utf8')
  await withShortPaths([o.font, labelFile], async (short) => {
    const font = filterPath(short(o.font))
    const graph =
      `[0:v]zoompan=z='1.03+0.03*sin(2*PI*on/${FPS * 4})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${w}x${h}:fps=${FPS}[still];` +
      `[1:a]aformat=channel_layouts=mono,showwaves=s=${mouth.w}x${mouth.h}:mode=cline:scale=sqrt:rate=${FPS}:colors=0x1b2230,format=rgba[wave];` +
      `[still][wave]overlay=${mouth.x}:${mouth.y}:format=auto,` +
      `drawtext=fontfile=${font}:textfile=${filterPath(short(labelFile))}:expansion=none:fontsize=${Math.round(h * 0.03)}:fontcolor=white@0.8:x=w*0.04:y=h*0.05,` +
      `drawtext=fontfile=${font}:text=DÉMO:expansion=none:fontsize=${Math.round(w * 0.07)}:fontcolor=white@0.16:x=w-text_w-${Math.round(w * 0.05)}:y=${Math.round(h * 0.05)}[v]`
    await media.run(
      'ffmpeg',
      ['-v', 'error', '-y', '-loop', '1', '-framerate', String(FPS), '-i', still, '-i', o.audio, '-filter_complex', graph, '-map', '[v]', '-t', o.seconds.toFixed(3), '-r', String(FPS), ...ENCODE, o.out],
      { signal: o.signal }
    )
  })
}

/** A still portrait of the stand-in presenter in a framing (the fake image engine's presenter pictures): `hash` is the person. */
export async function drawPortrait(media: MediaService, o: { out: string; hash: string; aspect: Aspect; framing?: Framing; signal: AbortSignal }): Promise<void> {
  await requireFilters(media, ['geq'], o.signal)
  await silhouette(media, { ...o, person: true })
}
