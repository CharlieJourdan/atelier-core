// Desktop notification when a deliverable enters "awaiting approval"; clicking it opens the Approvals view.
import { Notification } from 'electron'
import { DELIVERABLE_GRAPH, type DeliverableRow, type VideoRow } from '../../shared/workflow'

export function approvalNotificationText(d: DeliverableRow, video: VideoRow): { title: string; body: string } {
  const what = DELIVERABLE_GRAPH.find((g) => g.type === d.type)?.title ?? d.type
  return { title: 'Approval needed', body: `${what} · ${video.title || `Video ${video.id}`}` }
}

// Windows can garbage-collect a Notification that nothing references, which silently drops its click handler.
const live = new Set<Notification>()

export function notifyApprovalRequest(d: DeliverableRow, video: VideoRow, onClick: () => void): void {
  if (!Notification.isSupported()) return
  const n = new Notification(approvalNotificationText(d, video))
  live.add(n)
  n.on('click', () => {
    live.delete(n)
    onClick()
  })
  n.on('close', () => live.delete(n))
  n.show()
}
