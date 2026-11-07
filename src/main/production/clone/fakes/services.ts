// Fake services for the cloning engine (decision 0095): every CloneServices member, deterministic, writing small
// placeholder files where a real service writes renders and frames. The fake judge and improver simulate a clone that
// gets better as the definition improves: v1 « not the same channel », v2 « same », v3 good enough (nothing left to fix).
// Tests and demos only; no network, no money.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { COMPARE_AXES, REQUIRED_CURVES, type AxisScore, type BlindVerdict, type FeasibilityElement, type MediaOrigin, type Production, type StyleDefinition } from '../../../../shared/clone'
import type { CloneServices } from '../services'
import type { Folder } from '../store'
import type { FakeChannel } from './channels'
import { deterministicSynthesis } from './synthesis'

export interface FakeOptions {
  /** The user's own presenter and voice exist (own channel). */
  ownClones?: boolean
  freeGb?: number
  /** Cost of producing one minute ($). */
  usdPerMinute?: number
  /** The judge never says « same channel » (to test the P9 refusal). */
  neverSame?: boolean
}

export interface FakeState { produced: number; lastVersion: number; judged: number }

/** Bricks that make each media origin; `3d` has none (impossible), a filmed presenter needs a human. */
const BRICK_OF: Partial<Record<MediaOrigin, string>> = { motion: 'motion.render', found: 'visuals.fulfil', generated: 'clip.make', drawn: 'visuals.fulfil', screen: 'visuals.fulfil' }

const touch = (dir: Folder, name: string, body = 'fake'): string => { writeFileSync(path.join(dir.abs, name), body); return `${dir.rel}/${name}` }

/** Score of an axis for a definition version (the fake clone improves with each version). */
const scoreFor = (version: number): number => Math.min(95, 60 + 16 * (version - 1))

export function fakeServices(ch: FakeChannel, o: FakeOptions = {}): { services: CloneServices; state: FakeState } {
  const state: FakeState = { produced: 0, lastVersion: 0, judged: 0 }
  const usdPerMinute = o.usdPerMinute ?? 0.5
  let clock = 0
  const services: CloneServices = {
    channel: { videos: async (url) => (url === ch.url ? ch.videos : []) },
    eyes: {
      analyse: async (video, dir) => {
        const a = ch.analyse(video, dir.rel)
        // the frames the analysis names exist on disk, as a real eyes service writes them (P2 checks them)
        for (const f of new Set([...a.shots.flatMap((x) => x.frames), ...a.denseFrames.map((d) => d.path)])) writeFileSync(path.join(dir.abs, path.relative(dir.rel, f)), 'frame')
        return a
      }
    },
    synthesiser: { synthesise: async (analyses) => deterministicSynthesis(analyses) },
    bricks: {
      map: async (synthesis) => {
        const shares = (synthesis.constants.find((c) => c.field === 'sourcing.originShares')?.value ?? {}) as Partial<Record<MediaOrigin, number>>
        const evidence = synthesis.constants.find((c) => c.field === 'sourcing.originShares')?.evidence ?? []
        return Object.entries(shares).map(([origin, share]): FeasibilityElement => {
          const o2 = origin as MediaOrigin
          const screenShare = { value: share ?? 0, evidence }
          if (o2 === 'presenter') return { id: 'presenter', axis: 'presenter', description: 'filmed presenter', screenShare, how: 'human-input', brick: null, slot: { kind: 'presenter-footage', what: 'the presenter filmed on camera' }, missing: null }
          const brick = BRICK_OF[o2]
          if (brick) return { id: o2, axis: 'visuals', description: `${o2} shots`, screenShare, how: 'brick', brick, slot: null, missing: null }
          return { id: o2, axis: 'visuals', description: `${o2} animation`, screenShare, how: 'impossible', brick: null, slot: null, missing: { technology: `${o2} scene generation`, buildCostUsd: 400, importCostUsd: null, note: 'no engine brick makes it' } }
        })
      },
      alternatives: async (elements) => [{
        title: 'Same story, the impossible part redrawn in the channel style',
        description: 'Keeps the subject, tone, structure and palette; replaces only the impossible shots with motion design in its own palette.',
        keeps: { topic: true, tone: true, structure: true, palette: true },
        replaces: elements.filter((e) => e.how === 'impossible').map((e) => e.id),
        borrowsLookFrom: null
      }]
    },
    presenters: {
      own: async () => (o.ownClones ? 'own-avatar-1' : null),
      lookAlike: async (identity) => ({ ref: 'lookalike-1', description: `placeholder look-alike: ${identity['gender'] ?? 'person'} ${identity['age'] ?? ''}, ${identity['wardrobe'] ?? ''}`.trim() })
    },
    voices: {
      own: async () => (o.ownClones ? 'own-voice-1' : null),
      sameKind: async (d, language) => ({ ref: 'voice-same-kind-1', description: `same kind of voice ${d.join(' ')} (${language})`.trim() })
    },
    runs: {
      produce: async (_plan, def: StyleDefinition, passage, dir, maxUsd): Promise<Production> => {
        state.produced++
        state.lastVersion = def.version
        const durationS = passage.toS - passage.fromS
        const costUsd = Math.min(maxUsd, Math.round(usdPerMinute * (durationS / 60) * 100) / 100)
        const makeSeconds = durationS * 4
        return {
          passage, videoPath: touch(dir, 'ours.mp4'), scriptPath: touch(dir, 'script.txt', 'our script'), durationS, costUsd, makeSeconds,
          usdPerMinute: costUsd / (durationS / 60), makeSecondsPerMinute: makeSeconds / (durationS / 60), runs: [`fake-run-${state.produced}`]
        }
      }
    },
    frames: {
      matched: async (_ref, production, dir) => Array.from({ length: 8 }, (_, i) => ({
        atS: production.passage.fromS + (i + 0.5) * ((production.passage.toS - production.passage.fromS) / 8),
        reference: touch(dir, `ref-${i}.jpg`), ours: touch(dir, `ours-${i}.jpg`), sideBySide: touch(dir, `pair-${i}.jpg`)
      }))
    },
    review: { defects: async (_p, def) => (scoreFor(def.version) < 90 ? [{ axis: 'cadence', atS: 12, description: 'hook cuts slower than the reference', weight: 0.4 }] : []) },
    curves: { compare: async (ref) => REQUIRED_CURVES.map((name) => ({ axis: 'cadence' as const, name, reference: [ref.editing.meanShotS.value], ours: [ref.editing.meanShotS.value + 1 / state.lastVersion], distance: 1 / state.lastVersion })) },
    judge: {
      blind: async () => {
        state.judged++
        const score = scoreFor(state.lastVersion)
        const scores: AxisScore[] = COMPARE_AXES.map((axis) => ({ axis, score, defects: score < 100 ? [`${axis}: differs from the reference (v${state.lastVersion})`] : [] }))
        const same = !o.neverSame && score >= 75
        const v: BlindVerdict = { blind: true, sameChannel: same ? 'yes' : 'no', scores, reason: same ? 'same palette, cadence and presenter layouts' : 'cadence and layouts differ', judge: 'fake-judge' }
        return v
      }
    },
    improver: {
      propose: async (round, def) => {
        const low = round.comparison?.verdict.scores.some((s) => s.score < 90) ?? false
        if (!low) return []
        return [{ cause: 'definition', target: 'editing.meanShotS', before: def.editing.meanShotS.value, after: Math.round((def.editing.meanShotS.value - 0.3) * 10) / 10, why: 'the reference hook cuts faster', fixes: ['cadence: hook cuts slower than the reference'] }]
      }
    },
    cloud: { quoteUsdPerMinute: async () => usdPerMinute },
    disk: { freeGb: async () => o.freeGb ?? 100 },
    now: () => new Date(Date.UTC(2026, 10, 4, 0, 0, clock++)).toISOString()
  }
  return { services, state }
}
