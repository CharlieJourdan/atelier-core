// Screens of lot Z1 owned by this area: production/chaines, analyser, pipeline, builder.
import type { ScreenMap } from '../registry'
import { AnalyserScreen } from './analyser/AnalyserScreen'
import { BuilderScreen } from './builder/BuilderScreen'
import { ChainesScreen } from './chaines/ChainesScreen'
import { PipelineScreen } from './pipeline/PipelineScreen'

export const ANALYSIS_SCREENS: ScreenMap = {
  'production/chaines': ChainesScreen,
  'production/analyser': AnalyserScreen,
  'production/pipeline': PipelineScreen,
  'production/builder': BuilderScreen
}
