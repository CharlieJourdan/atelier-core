// Tiny listener set for workflow events the shell reacts to (e.g. desktop notifications).
import type { DeliverableRow, VideoRow } from '../../shared/workflow'

export type AwaitingApprovalListener = (deliverable: DeliverableRow, video: VideoRow) => void

export class AwaitingApprovalEvents {
  private readonly listeners = new Set<AwaitingApprovalListener>()

  add(listener: AwaitingApprovalListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(deliverable: DeliverableRow, video: VideoRow): void {
    for (const l of this.listeners) {
      try {
        l(deliverable, video)
      } catch (err) {
        // a listener must never break the workflow
        console.error('awaiting-approval listener failed:', err instanceof Error ? err.message : String(err))
      }
    }
  }
}

/** Optional observer of workflow events (the chat posts cards from it). Called after the transaction commits;
 * a throwing listener never breaks the workflow. Other subscribers use `onAwaitingApproval`. */
export interface WorkflowListener {
  waitingApproval?(deliverable: DeliverableRow): void
  decided?(deliverable: DeliverableRow, decision: 'approved' | 'revision_requested', by: string, note: string): void
}
