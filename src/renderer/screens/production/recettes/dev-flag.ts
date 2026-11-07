// Hand editing of pipelines (decision 0051, Charlie 01/11: « c'est mieux de passer par l'agent »): bricks, engines, styles, our
// internal options and building a pipeline from scratch are shown only behind the dev flag (`ATELIER_PIPELINE_DEV=1`, read by
// main in `app.info`). A user changes a pipeline through its options and « Parler à l'agent ».
import { useApi } from '@/state/client'

export function usePipelineDev(): boolean {
  return useApi('app.info').data?.pipelineDev === true
}

/** Pipeline codes (sharing, importing, the file export): built, off in the beta (`ATELIER_PIPELINE_CODES=1`, production-lab). */
export function usePipelineCodes(): boolean {
  return useApi('app.info').data?.pipelineCodes === true
}
