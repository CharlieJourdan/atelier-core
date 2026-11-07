// IPC contract, module "analysis" (lot Z1): Channel analysis and the reproducibility gauge, channel styles, the pipeline library and the Builder.
// Every method added here must also be listed in ANALYSIS_METHODS and counted, with a comment, in its area's unit test.
import type { PipelineDrawing, SaveDrawingResult } from '../pipeline-drawing'
import type {
  AnalysisChatResult,
  AnalysisDetail,
  AnalysisSummary,
  BuilderDetail,
  BuilderSummary,
  CatalogNode,
  ChannelStyleDetail,
  DiffLine,
  LibraryPipelineDetail,
  LibraryPipelineRow,
  PipelineCheck,
  PipelineCostReport,
  PipelineProblem,
  ReferenceSummary,
  StartAnalysisResult,
  StyleSheet,
  SupportInput,
  SupportRequestRow,
  TemplateInfo
} from '../analysis'
import type { GaugeMode, InputId } from '../gauge'

export type SaveResult = { ok: true; pipeline: LibraryPipelineRow } | { ok: false; problems: PipelineProblem[] }

export type BuilderStart = { from: 'template'; templateId: string } | { from: 'pipeline'; pipelineId: number } | { from: 'analysis'; analysisId: number }

export type BuilderSaveTarget = { target: 'new'; name: string; channelId?: number | null } | { target: 'version'; pipelineId: number }

export interface AnalysisContract {
  'analysis.references': { args: []; result: ReferenceSummary[] }
  'analysis.list': { args: []; result: AnalysisSummary[] }
  'analysis.get': { args: [id: number]; result: AnalysisDetail }
  /** From a link (a real channel needs the Cloud: answered `unavailable`) or a reference channel id. */
  'analysis.start': { args: [input: { link?: string; referenceId?: string }]; result: StartAnalysisResult }
  'analysis.chooseExamples': { args: [id: number, videoIds: string[]]; result: AnalysisDetail }
  /** Answer a question (true / false), or clear it (null). The gauge is recomputed. */
  'analysis.answer': { args: [id: number, input: InputId, value: boolean | null]; result: AnalysisDetail }
  'analysis.setMode': { args: [id: number, mode: GaugeMode]; result: AnalysisDetail }
  'analysis.chat': { args: [id: number, text: string]; result: AnalysisChatResult }
  'analysis.createPipeline': { args: [id: number, channelId: number]; result: { pipeline: LibraryPipelineRow; styleVersion: number } }
  'analysis.delete': { args: [id: number]; result: void }

  'pipelines.templates': { args: []; result: TemplateInfo[] }
  'pipelines.catalog': { args: []; result: CatalogNode[] }
  'pipelines.list': { args: []; result: LibraryPipelineRow[] }
  'pipelines.get': { args: [id: number]; result: LibraryPipelineDetail }
  'pipelines.version': { args: [id: number, number: number]; result: string }
  'pipelines.diff': { args: [id: number, from: number, to: number]; result: DiffLine[] }
  'pipelines.check': { args: [json: string]; result: PipelineCheck }
  'pipelines.estimate': { args: [json: string]; result: PipelineCostReport }
  'pipelines.import': { args: [json: string, opts?: { name?: string; channelId?: number | null }]; result: SaveResult }
  'pipelines.createFromTemplate': { args: [templateId: string, name: string]; result: LibraryPipelineRow }
  'pipelines.saveVersion': { args: [id: number, json: string, note: string]; result: SaveResult }
  'pipelines.setDefault': { args: [id: number, channelId: number]; result: LibraryPipelineRow }
  'pipelines.rename': { args: [id: number, name: string, description: string]; result: LibraryPipelineRow }
  'pipelines.delete': { args: [id: number]; result: void }
  'pipelines.export': { args: [id: number, version?: number]; result: { fileName: string; json: string } }
  /** The editor's drawn pipeline → an executable pipeline of the library (new, or the next version of `pipelineId`). */
  'pipelines.saveDrawing': {
    args: [drawing: PipelineDrawing, opts?: { pipelineId?: number; channelId?: number | null; minutes?: number }]
    result: SaveDrawingResult
  }

  'styles.get': { args: [channelId: number]; result: ChannelStyleDetail }
  'styles.version': { args: [channelId: number, version: number]; result: StyleSheet }
  'styles.save': { args: [channelId: number, sheet: StyleSheet, note: string]; result: ChannelStyleDetail }
  'styles.diff': { args: [channelId: number, from: number, to: number]; result: DiffLine[] }

  'builder.list': { args: []; result: BuilderSummary[] }
  'builder.create': { args: [start: BuilderStart]; result: BuilderDetail }
  'builder.get': { args: [id: number]; result: BuilderDetail }
  'builder.send': { args: [id: number, text: string]; result: BuilderDetail }
  'builder.save': { args: [id: number, target: BuilderSaveTarget, note: string]; result: LibraryPipelineRow }
  'builder.delete': { args: [id: number]; result: void }

  'support.create': { args: [input: SupportInput]; result: SupportRequestRow }
  'support.list': { args: []; result: SupportRequestRow[] }
  'support.close': { args: [id: number]; result: SupportRequestRow }
}

export const ANALYSIS_METHODS = [
  'analysis.references',
  'analysis.list',
  'analysis.get',
  'analysis.start',
  'analysis.chooseExamples',
  'analysis.answer',
  'analysis.setMode',
  'analysis.chat',
  'analysis.createPipeline',
  'analysis.delete',
  'pipelines.templates',
  'pipelines.catalog',
  'pipelines.list',
  'pipelines.get',
  'pipelines.version',
  'pipelines.diff',
  'pipelines.check',
  'pipelines.estimate',
  'pipelines.import',
  'pipelines.createFromTemplate',
  'pipelines.saveVersion',
  'pipelines.setDefault',
  'pipelines.rename',
  'pipelines.delete',
  'pipelines.export',
  'pipelines.saveDrawing',
  'styles.get',
  'styles.version',
  'styles.save',
  'styles.diff',
  'builder.list',
  'builder.create',
  'builder.get',
  'builder.send',
  'builder.save',
  'builder.delete',
  'support.create',
  'support.list',
  'support.close'
] as const satisfies readonly (keyof AnalysisContract)[]
