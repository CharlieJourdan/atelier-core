// P7 — the review agent's defect list on a finished render (decision 0086's checks that apply to a file: held shots,
// frozen pictures, slow hook, voice holes, loudness, pace, length), measured with ffmpeg and judged against the Style
// Definition the render had to follow. Each defect names its axis, its moment and a weight (≥ 0.8 blocks an example).
// Pure except the ffmpeg runs of `measureHoles`.
import type { Defect, StyleDefinition } from '../../../../shared/clone'
import type { RunFn } from '../../../../engine/sourcing/types'
import { lengthsFromCuts, mean, type FileMeasures } from './curves'

export interface Holes { silences: { fromS: number; toS: number }[]; freezes: { fromS: number; toS: number }[] }

/** ffmpeg arguments: silences of ≥ 1 s at -40 dB and frozen pictures of ≥ 2 s, both reported on stderr. */
export const holesArgs = (file: string): string[] =>
  ['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=noise=-40dB:d=1', '-vf', 'freezedetect=n=0.003:d=2', '-f', 'null', '-']

/** Silences and freezes in ffmpeg's stderr (pure). */
export function parseHoles(stderr: string): Holes {
  const pairs = (startRe: RegExp, endRe: RegExp): { fromS: number; toS: number }[] => {
    const starts = [...stderr.matchAll(startRe)].map((m) => Number(m[1]))
    const ends = [...stderr.matchAll(endRe)].map((m) => Number(m[1]))
    return starts.map((s, i) => ({ fromS: s, toS: ends[i] ?? s })).filter((x) => Number.isFinite(x.fromS) && x.toS >= x.fromS)
  }
  return {
    silences: pairs(/silence_start:\s*(-?[\d.]+)/g, /silence_end:\s*(-?[\d.]+)/g),
    freezes: pairs(/freeze_start:\s*(-?[\d.]+)/g, /freeze_end:\s*(-?[\d.]+)/g)
  }
}

export async function measureHoles(file: string, run: RunFn): Promise<Holes> {
  const { stderr } = await run('ffmpeg', holesArgs(file), { timeoutMs: 600_000 })
  return parseHoles(stderr)
}

const r1 = (x: number): number => Math.round(x * 10) / 10

/** The defects of a render against its definition (pure). `passageS` is the length of the reference passage it stands for. */
export function renderDefects(m: FileMeasures, holes: Holes, def: StyleDefinition, passageS: number): Defect[] {
  const out: Defect[] = []
  const holdMax = def.editing.holdMaxS.value
  let t = 0
  for (const l of lengthsFromCuts(m.cutsS, m.durationS)) {
    if (holdMax > 0 && l > holdMax * 1.25) out.push({ axis: 'cadence', atS: r1(t), description: `shot held ${r1(l)} s (the style holds at most ${holdMax} s)`, weight: l > holdMax * 2 ? 0.8 : 0.5 })
    t += l
  }
  for (const f of holes.freezes) if (f.toS - f.fromS > Math.max(2, holdMax)) out.push({ axis: 'cadence', atS: r1(f.fromS), description: `picture frozen ${r1(f.toS - f.fromS)} s`, weight: 0.7 })
  const hookS = def.script.hookWindowS.value || 15
  const hookCuts = m.cutsS.filter((c) => c < hookS)
  const hookMean = hookCuts.length ? hookS / (hookCuts.length + 1) : hookS
  const wantHook = def.editing.hookMeanShotS.value
  if (wantHook > 0 && hookMean > wantHook * 1.3) out.push({ axis: 'cadence', atS: 0, description: `hook cuts every ${r1(hookMean)} s, the style every ${wantHook} s`, weight: 0.6 })
  const meanShot = mean(lengthsFromCuts(m.cutsS, m.durationS))
  const wantShot = def.editing.meanShotS.value
  if (wantShot > 0 && meanShot > 0 && Math.abs(meanShot - wantShot) / wantShot > 0.25) out.push({ axis: 'cadence', atS: null, description: `mean shot ${r1(meanShot)} s, the style ${wantShot} s`, weight: 0.5 })
  for (const s of holes.silences) if (s.toS - s.fromS > 1.5 && s.fromS > 0.5 && s.toS < m.durationS - 0.5) out.push({ axis: 'voice', atS: r1(s.fromS), description: `voice hole of ${r1(s.toS - s.fromS)} s`, weight: s.toS - s.fromS > 3 ? 0.8 : 0.5 })
  const wantLufs = def.sound.loudnessLufs.value
  if (m.loudnessLufs !== null && Math.abs(m.loudnessLufs - wantLufs) > 3) out.push({ axis: 'sound', atS: null, description: `loudness ${r1(m.loudnessLufs)} LUFS, the style ${wantLufs} LUFS`, weight: 0.4 })
  if (m.loudnessLufs === null) out.push({ axis: 'sound', atS: null, description: 'no audio could be measured', weight: 0.9 })
  const wantWpm = def.voice.wordsPerMinute.value
  if (m.wordsPerMinute !== null && wantWpm > 0 && Math.abs(m.wordsPerMinute - wantWpm) / wantWpm > 0.12) out.push({ axis: 'voice', atS: null, description: `voice at ${r1(m.wordsPerMinute)} words/min, the style ${wantWpm}`, weight: 0.5 })
  if (passageS > 0 && Math.abs(m.durationS - passageS) / passageS > 0.25) out.push({ axis: 'script', atS: null, description: `render lasts ${r1(m.durationS)} s for a ${r1(passageS)} s passage`, weight: 0.5 })
  return out
}
