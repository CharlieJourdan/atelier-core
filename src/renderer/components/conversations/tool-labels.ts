// French label of an agent's tool step: present tense while it runs, past tense once done, the tool's name when it
// failed (lot 13).
import { t, type MessageKey } from '../../../shared/fr'

const KNOWN = new Set([
  'get_brief', 'get_inputs', 'save_version', 'post_message', 'propose_action', 'remember', 'create_video', 'ask_agent',
  'list_videos', 'list_runs', 'run_status', 'estimate', 'analyse_channel', 'run_pipeline', 'retry_node', 'cancel_run'
])

export function toolLabel(name: string, state: 'running' | 'done' | 'error'): string {
  if (state === 'error') return t('tool.error', { name })
  const tense = state === 'running' ? 'run' : 'done'
  if (KNOWN.has(name)) return t(`tool.${tense}.${name}` as MessageKey)
  return t(state === 'running' ? 'tool.run.other' : 'tool.done.other', { name })
}
