// The pixels overrule the look on ONE question (chantier rea-video, decision 0110): a picture made of a few flat colours
// was not made by an image or video model. When the look (or the shot log) calls such a shot « generated », it is a drawing
// or motion design (Finary's halftone cut-out collages, Le Monde en POV's vector scenes were read « generated »: they would
// have been routed to AI generation instead of motion.render). The palette is measured by src/engine/watch/forensics.ts;
// rea-video's principle (deterministic forensics decide what pixels can prove, the model the rest) is credited in VENDOR.md.
// Pure.
import type { MediaOrigin } from '../../../../shared/clone'
import type { LogShot } from '../../../../shared/shot-log'
import type { ShotForensics } from '../../../../engine/watch/forensics'

/** Shot kinds that are motion design (a flat-colour « generated » shot of these kinds is motion, else a drawing). */
const MOTION_KINDS = new Set<LogShot['kind']>(['map', 'chart', 'motion-graphic', 'title-card', 'document'])

/** The origin a shot keeps once its palette is known: a rendered « generated » picture becomes drawn (or motion). */
export function guardedOrigin(origin: MediaOrigin, kind: LogShot['kind'], fx: ShotForensics | undefined): MediaOrigin {
  if (!fx || fx.texture !== 'rendered') return origin
  if (origin !== 'generated') return origin
  return MOTION_KINDS.has(kind) ? 'motion' : 'drawn'
}

/** The forensics of a log's shots by shot number (the measure keeps the log's numbering). */
export const forensicsByShot = (fx: readonly ShotForensics[] | undefined): Map<number, ShotForensics> => new Map((fx ?? []).map((f) => [f.n, f]))
