// IPC contract, module "reverse" (reverse-pipeline, docs/METHODE-REVERSE-PIPELINE.md): a channel or video link goes
// in, a reverse-engineered production pipeline comes out (src/shared/reverse/pipeline.ts). Ids are clone ids: the pipeline is
// made by the cloning engine (`clone.*`). Every argument is checked with the zod schemas in main. Every method added here must
// also be listed in REVERSE_METHODS.
import type { z } from 'zod'
import type { ReversePipeline, ReverseRequest, ReverseStatus, ReverseTransform } from '../reverse/pipeline'

/** What a caller sends (the schemas' defaults filled in main). */
export type ReverseRequestInput = z.input<typeof ReverseRequest>
export type ReverseTransformInput = z.input<typeof ReverseTransform>

export interface ReverseSummary {
  id: string
  createdAt: string
  /** The reference link it was made from. */
  title: string
  state: ReverseStatus['state']
  spentUsd: number
  budgetUsd: number
  /** The pipeline it was transformed from, or null. */
  derivedFrom: string | null
}

export interface ReverseContract {
  /** Starts reverse-engineering the request's links (in the background, within its test budget). */
  'reverse.start': { args: [request: ReverseRequestInput]; result: { id: string } }
  'reverse.status': { args: [id: string]; result: ReverseStatus }
  /** The pipeline as its saved artefacts say now (null before the feasibility map). */
  'reverse.result': { args: [id: string]; result: ReversePipeline | null }
  /** Translate / adapt / bend / mix a pipeline into a new one (not proven unless the transform gives a test budget). */
  'reverse.transform': { args: [id: string, transform: ReverseTransformInput]; result: { id: string } }
  'reverse.list': { args: []; result: ReverseSummary[] }
  /** Proves a pipeline (test renders, blind judge) within `budgetUsd` more dollars. */
  'reverse.prove': { args: [id: string, budgetUsd: number]; result: ReverseStatus }
}

export const REVERSE_METHODS = [
  'reverse.start',
  'reverse.status',
  'reverse.result',
  'reverse.transform',
  'reverse.list',
  'reverse.prove'
] as const satisfies readonly (keyof ReverseContract)[]
