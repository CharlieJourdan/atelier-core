// Every external service the cloning engine uses, injected (decision 0095): channel listing, eyes (whole-video analysis),
// the brick catalogue, presenters, voices, runs on the engines, frames, the review agent, the blind judge, the improver
// (LLM), the Cloud quote. Phases only see these interfaces, so the whole P0→P10 runs on fakes (fakes/). The assembler
// wires the real ones (eyes 0085, brain-run, Cloud) in create.ts later.
import type { Folder } from './store'
import type { ReadyBase } from './definition/base-registry'
import type { JudgeOptions } from './compare/judge'
import type { Brief, CorpusVideo, Defect, FramePair, PipelinePlan, Production, Round, StyleDefinition, Synthesis, VideoAnalysis, BlindItem, BlindVerdict, Change, FeasibilityElement, FeasibilityAlternative } from '../../../shared/clone'

/** A public video of a channel, as listed (read-only: RSS / Data API read endpoints). */
export interface ChannelVideo { url: string; title: string; publishedAt: string | null; views: number | null; durationS: number | null }

export interface CloneServices {
  channel: { videos(url: string): Promise<ChannelVideo[]> }
  /** Whole-video analysis of one corpus video; frames are written under `dir.abs`, returned as paths under `dir.rel`. */
  eyes: {
    analyse(video: CorpusVideo, dir: Folder): Promise<VideoAnalysis>
    /** The most this video's analysis may bill (P2 quotes it against the budget left before spending). */
    quoteUsd?(video: CorpusVideo): Promise<number>
  }
  /** Cross-video synthesis (an LLM pass over the analyses + measured frequencies). */
  synthesiser: { synthesise(analyses: readonly VideoAnalysis[], brief: Brief): Promise<Omit<Synthesis, 'schema' | 'cloneId' | 'createdAt'>> }
  /** The feasibility of each style element: which brick makes it, which needs a human, which is impossible. */
  bricks: {
    map(synthesis: Synthesis, analyses: readonly VideoAnalysis[], brief: Brief): Promise<FeasibilityElement[]>
    /** Alternatives faithful to THIS channel for the impossible elements. */
    alternatives(elements: readonly FeasibilityElement[], synthesis: Synthesis): Promise<FeasibilityAlternative[]>
  }
  /** The user's own presenter (own channel) or a look-alike placeholder of the same type. */
  presenters: {
    own(channelUrl: string): Promise<string | null>
    lookAlike(identity: Record<string, string>): Promise<{ ref: string; description: string }>
  }
  voices: {
    own(channelUrl: string): Promise<string | null>
    /** A voice of the same kind in the target language (BCP-47). */
    sameKind(descriptors: readonly string[], language: string): Promise<{ ref: string; description: string }>
  }
  /** Produce a passage (P6) or a full example (P9) with a plan on the engines; files under `dir.abs`, paths under `dir.rel`. */
  runs: { produce(plan: PipelinePlan, definition: StyleDefinition, passage: Production['passage'], dir: Folder, maxUsd: number): Promise<Production> }
  /** A FREE demo render of a plan (decision 0102: demo engines, 0 $), the style judged on it before anything is paid; absent: no gate. */
  demo?: {
    produce(plan: PipelinePlan, definition: StyleDefinition, passage: Production['passage'], dir: Folder): Promise<Production>
    /** The same demo without its « DÉMO » mark, for the gate's judge only (only the assembly re-runs); never shown to the user. */
    unmarked?(plan: PipelinePlan, definition: StyleDefinition, passage: Production['passage'], dir: Folder): Promise<Production>
  }
  /** Matched frames of reference and ours at the same moments, plus side-by-side images, saved under `dir.abs`, paths under `dir.rel`. */
  frames: { matched(reference: CorpusVideo, production: Production, dir: Folder): Promise<FramePair[]> }
  /** The review agent (decision 0086): defects of a render against its transcript and the reference. */
  review: { defects(production: Production, definition: StyleDefinition): Promise<Defect[]> }
  /** Measured curves compared (shot lengths, layout shares, presence, motion density, palette, pace, loudness). */
  curves: { compare(reference: VideoAnalysis, production: Production): Promise<{ axis: Defect['axis']; name: string; reference: number[]; ours: number[]; distance: number }[]> }
  /** The blind judge: sees reference and ours mixed, answers « same channel? » and scores each axis with defects. */
  judge: { blind(items: readonly BlindItem[], dir: Folder, o?: JudgeOptions): Promise<BlindVerdict> }
  /** Proposes fixes to the CAUSE of the defects (definition fields, bricks, rules, prompts). */
  improver: { propose(round: Round, definition: StyleDefinition): Promise<Change[]> }
  /** The Cloud's quote of a plan (dollars per minute), before spending. */
  cloud: { quoteUsdPerMinute(plan: PipelinePlan): Promise<number> }
  /** Free disk on the data drive, in GB (stop under 15). */
  disk: { freeGb(): Promise<number> }
  /** The ready bases P4 may start from (decision 0112); absent: the engine's own (definition/base-registry.ts READY_BASES). */
  readyBases?: readonly ReadyBase[]
  now(): string
}
