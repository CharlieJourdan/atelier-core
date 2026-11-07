// The editing bricks' layers in the final pass (production-9, formats/layers.ts): a still or a video laid over the film for its seconds,
// over the whole frame (cover-cropped) or in its box. A still comes in with a fade or a « pop » (it grows from 60 % around its centre
// in 0.18 s while it fades in) and always leaves with a fade; a video plays from its first second, its last frame held to the end of
// its slot when it is shorter (never looped), its sound dropped (the voice goes on under it).
import type { Layer } from '../formats/layers'
import { FPS } from '../formats/timing'

export type LayerInput = Layer & { path: string }

/** The input arguments of one layer: a still loops for its slot (and a little more), a video is read as it is. */
export function layerArgs(l: LayerInput): string[] {
  return l.video ? ['-i', l.path] : ['-loop', '1', '-framerate', String(FPS), '-t', (l.endS + 0.5).toFixed(3), '-i', l.path]
}

/** The filters that lay one layer (input number `input`) over `from`, labelled `to`. */
export function layerGraph(l: LayerInput, input: number, from: string, to: string, size: readonly [number, number]): string {
  const [W, H] = size
  const S = l.startS.toFixed(3)
  const E = l.endS.toFixed(3)
  const len = l.endS - l.startS
  const f = Math.min(l.fadeS, len / 4)
  const fadeIn = l.enter === 'cut' ? '' : `fade=t=in:st=${S}:d=${(l.enter === 'pop' ? Math.min(f, 0.12) : f).toFixed(3)}:alpha=1,`
  const fades = `${fadeIn}fade=t=out:st=${(l.endS - f).toFixed(3)}:d=${f.toFixed(3)}:alpha=1`
  const cover = `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}`
  const tag = `ly${input}`
  let chain: string
  if (l.video) {
    // the clip starts at the slot's start; shorter than the slot, its last frame holds (tpad), longer, the slot's end cuts it
    chain = `setpts=PTS-STARTPTS,fps=${FPS},${l.box ? `scale=${l.box.w}:${l.box.h}:flags=lanczos` : cover},format=rgba,tpad=stop_mode=clone:stop_duration=${len.toFixed(3)},setpts=PTS+${S}/TB,${fades}`
  } else {
    const fit = l.box ? '' : `${cover},`
    const pop = l.enter === 'pop' ? `,scale=w='max(2,trunc(iw*(0.6+0.4*min(1,max(0,(t-${S})/0.18)))))':h='max(2,trunc(ih*(0.6+0.4*min(1,max(0,(t-${S})/0.18)))))':eval=frame:flags=bilinear` : ''
    chain = `${fit}format=rgba,${fades}${pop}`
  }
  const x = l.box ? `${l.box.x}+(${l.box.w}-overlay_w)/2` : '0'
  const y = l.box ? `${l.box.y}+(${l.box.h}-overlay_h)/2` : '0'
  return `[${input}:v]${chain}[${tag}];${from}[${tag}]overlay=x='${x}':y='${y}':eof_action=pass:enable='between(t,${S},${E})'${to}`
}
