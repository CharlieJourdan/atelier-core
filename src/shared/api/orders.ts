// IPC contract, module "orders" (equipe-3-chaines): Charlie's video orders — videos made from his own scripts, one per
// channel, checked and fixed before he is told. Made by Atlas (`videos.order`) or here; every method added here must also be
// listed in ORDER_METHODS.

export const ORDER_STATUSES = ['queued', 'producing', 'checking', 'fixing', 'ready', 'failed'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

/** A real error the final pass measured, and the step that makes it (the one a fix makes again). */
export interface BlockingError {
  kind: string
  atS: number | null
  what: string
  step: 'voice' | 'pictures' | 'render'
}

export interface FinalReport {
  /** Real errors measured by code (decision 0102): never delivered as « prête ». */
  blocking: BlockingError[]
  /** The render's checks were read (false: it left no report, nothing can be said about real errors). */
  checked: boolean
  /** What the edit review (decision 0086) left that is not an error: a style or picture remark. */
  review: string[]
  /** The blind judge against the channel's own video (decision 0097), or null with why it was skipped. */
  judge: { sameChannel: 'yes' | 'no'; score: number; reason: string; defects: string[] } | null
  judgeSkipped?: string
  costUsd: number
  film: string | null
  durationS: number | null
}

export interface OrderView {
  id: number
  batch: string
  channelId: number
  channelName: string
  title: string
  real: boolean
  status: OrderStatus
  videoId: number | null
  projectId: number | null
  runId: number | null
  /** Every run the order made (its first, then a fix), for its whole spend. */
  runs: number[]
  fixes: number
  report: FinalReport | null
  error: string | null
  notifiedAt: string | null
  createdAt: string
}

export interface OrderPlaceInput {
  /** Charlie's message: each script under a line naming its channel (a `[PUB]` marker = where the channel's promo goes). */
  message: string
  /** Real engine (default true); false = demo videos, nothing spent. */
  real?: boolean
  /** The most ONE video may cost, in dollars (required for a real order). */
  maxUsd?: number
}

export interface OrdersContract {
  'orders.list': { args: [batch?: string]; result: OrderView[] }
  'orders.place': { args: [input: OrderPlaceInput]; result: OrderView[] }
  /** The channel's own video the blind judge compares with (a local file), or null to forget it. */
  'orders.setReference': { args: [channelId: number, file: string | null]; result: { channelId: number; file: string | null } }
}

export const ORDER_METHODS = ['orders.list', 'orders.place', 'orders.setReference'] as const satisfies readonly (keyof OrdersContract)[]
