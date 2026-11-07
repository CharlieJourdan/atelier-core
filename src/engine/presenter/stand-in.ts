// The presenter's found stand-in for a FREE demo (moteur-doublures, decision 0109): instead of the drawn silhouette, the demo
// shows a PHOTOGRAPH of a person of the planned presenter type — the look-alike placeholder's own picture for that framing when
// the pipeline has one (made from words only, never the reference's frames; the very picture a paid run animates), else a free
// stock photograph searched with the planned type (« man 35-45 black turtleneck studio microphone »), through the demo run's
// Cloud that reaches only the free usages. The photograph fills the call's frame in its framing (a close shot is a tighter crop
// of a picture that has no close angle of its own) and breathes slowly, so a long shot is never frozen; no text, no mark.
// `render.assemble` lays it out as the plan says (full, half, inset at the measured sizes), as it does a real presenter.
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { orientationOf } from '../../shared/cloud-api'
import type { Framing } from '../../shared/presenter-engines'
import { FPS, frameSizeOf, type Aspect } from '../formats/timing'
import type { RunCtx } from '../registry'
import type { MediaService } from '../services'
import { hashOf } from '../nodes/common'

/** Bumped when the stand-in's picture or motion changes (cache keys). */
export const STAND_IN_VERSION = 1

/** How tight each framing is cut from a picture that is not that framing's own (pure): 1 = the whole picture. */
export const STAND_IN_ZOOM: Record<Framing, number> = { wide: 1, medium: 1, close: 0.66 }

/** The demo's presenter stand-ins: the search words of a person of the planned type (used when the presenter has no picture). */
export interface StandIn {
  person?: string | undefined
}

/** The picture the stand-in speaks from: the presenter's own picture for that framing, else one free stock photo of the planned
 *  type (the same photo for every call of the run, so the presenter stays one person), else null (the demo draws it). */
export async function standInPicture(ctx: RunCtx, o: { picture: string | undefined; standIn: StandIn; aspect: Aspect; dir: string; memo: Map<string, Promise<string | null>> }): Promise<string | null> {
  if (o.picture && existsSync(o.picture)) return o.picture
  const person = (o.standIn.person ?? '').trim()
  const cloud = ctx.services.cloud
  if (!person || !cloud) return null
  const [w, h] = frameSizeOf(o.aspect)
  const orientation = orientationOf(w, h)
  const k = `${person}|${orientation}`
  let found = o.memo.get(k)
  if (!found) {
    const dir = path.join(o.dir, 'stand-in-person')
    found = mkdir(dir, { recursive: true })
      .then(() => cloud.searchStock({ query: person.slice(0, 80), orientation, kind: 'photo', count: 3 }, { idempotencyKey: `standin-person-${hashOf({ v: STAND_IN_VERSION, person, orientation })}`, signal: ctx.signal, dir }))
      .then((r) => r.results.find((x) => x.kind === 'photo')?.file ?? null)
      .catch((e: unknown) => {
        if (ctx.signal.aborted) throw e
        ctx.emit({ kind: 'log', level: 'warn', text: `presenter stand-in « ${person} »: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}` })
        return null
      })
    o.memo.set(k, found)
  }
  return found
}

/** The ffmpeg graph of a stand-in call (pure): the picture cover-cropped in its framing, breathing slowly, `n` frames. */
export function standInGraph(o: { w: number; h: number; zoom: number; n: number }): string {
  const z = Math.max(0.3, Math.min(1, o.zoom))
  // the crop keeps the face: centred across, the upper part of the picture down the frame
  const crop = z < 1 ? `crop=iw*${z}:ih*${z}:(iw-iw*${z})/2:(ih-ih*${z})*0.3,` : ''
  return (
    `[0:v]scale=${o.w}:${o.h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${o.w}:${o.h},${crop}scale=${o.w * 2}:${o.h * 2}:flags=lanczos,` +
    `zoompan=z='1.03+0.02*sin(2*PI*on/${FPS * 5})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2.4':d=1:s=${o.w}x${o.h}:fps=${FPS},format=yuv420p[v]`
  )
}

/** A presenter call made of the stand-in picture: as long as the call, silent, 30 fps, H.264. */
export async function standInCall(media: MediaService, o: { picture: string; out: string; seconds: number; aspect: Aspect; framing: Framing; ownPicture: boolean; signal: AbortSignal }): Promise<void> {
  const [w, h] = frameSizeOf(o.aspect)
  const n = Math.max(2, Math.round(o.seconds * FPS))
  const zoom = o.ownPicture ? 1 : STAND_IN_ZOOM[o.framing]
  await media.run(
    'ffmpeg',
    ['-v', 'error', '-y', '-loop', '1', '-framerate', String(FPS), '-i', o.picture, '-filter_complex', standInGraph({ w, h, zoom, n }), '-map', '[v]', '-frames:v', String(n), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', o.out],
    { signal: o.signal }
  )
}
