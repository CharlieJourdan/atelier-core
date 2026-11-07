// reverse-pipeline: the thin loader that reads what a clone saved (src/main/production/clone/store.ts ARTEFACTS) for the pure
// builder (build.ts), plus the two files reverse-pipeline adds to a clone folder: the request it started from and, for a
// transformed pipeline, the pipeline and transform it derives from. An unreadable artefact counts as absent.
import { z } from 'zod'
import { Brief, Corpus, Example, Feasibility, PipelinePlan, Report, Round, StyleDefinition, VideoAnalysis } from '../../../../shared/clone'
import { ReverseRequest, ReverseTransform } from '../../../../shared/reverse/pipeline'
import { ARTEFACTS, type CloneStore } from '../store'
import { requestFromBrief } from './request'

/** Files reverse-pipeline keeps in a clone folder. */
export const REVERSE_FILES = {
  request: 'reverse-request.json',
  derived: 'reverse-derived.json',
  pipeline: 'reverse-pipeline.json'
} as const

export const DerivedFrom = z.object({ pipelineId: z.string().min(1), transform: ReverseTransform })
export type DerivedFrom = z.infer<typeof DerivedFrom>

/** Everything the builder reads, as saved. */
export interface ReverseInputs {
  cloneId: string
  request: ReverseRequest
  derivedFrom: DerivedFrom | null
  brief: Brief | null
  corpus: Corpus | null
  analyses: VideoAnalysis[]
  feasibility: Feasibility | null
  definition: StyleDefinition | null
  plan: PipelinePlan | null
  rounds: Round[]
  example: Example | null
  report: Report | null
  spentUsd: number
  /** The engine stopped on an error (not the budget): the pipeline failed. */
  failed: boolean
}

function safe<T>(f: () => T): T | null {
  try { return f() } catch { return null }
}

export function loadReverseInputs(store: CloneStore, o: { failed?: boolean } = {}): ReverseInputs {
  const brief = safe(() => store.load(ARTEFACTS.brief, Brief))
  const corpus = safe(() => store.load(ARTEFACTS.corpus, Corpus))
  const saved = safe(() => store.load(REVERSE_FILES.request, ReverseRequest))
  const answers = safe(() => (store.has('p0-answers.json') ? (store.load('p0-answers.json', z.unknown()) as Brief) : null))
  const from = brief ?? answers
  if (!saved && !from) throw new Error(`clone ${store.cloneId} has no request and no brief`)
  return {
    cloneId: store.cloneId,
    request: saved ?? requestFromBrief(from!),
    derivedFrom: safe(() => store.load(REVERSE_FILES.derived, DerivedFrom)),
    brief,
    corpus,
    analyses: (corpus?.videos ?? []).flatMap((v) => safe(() => store.load(ARTEFACTS.analysis(v.id), VideoAnalysis)) ?? []),
    feasibility: safe(() => store.load(ARTEFACTS.feasibility, Feasibility)),
    definition: safe(() => store.load(ARTEFACTS.definition, StyleDefinition)),
    plan: safe(() => store.load(ARTEFACTS.plan, PipelinePlan)),
    rounds: store.list('p6-round-').flatMap((f) => safe(() => store.load(f, Round)) ?? []),
    example: safe(() => store.load(ARTEFACTS.example, Example)),
    report: safe(() => store.load(ARTEFACTS.report, Report)),
    spentUsd: Math.round(store.spent() * 1000) / 1000,
    failed: o.failed ?? false
  }
}
