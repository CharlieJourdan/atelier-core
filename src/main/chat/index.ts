// ChatService: owner messages in, streamed replies out. The messages of one conversation are answered one at a time,
// each by the group engine (group.ts); Stop aborts the one being answered and drops the ones still queued.
import type { AttachmentUpload, SendResult } from '../../shared/chat'
import { saveUploads } from './attachments'
import { GroupEngine, type GroupDeps } from './group'
import type { ChatStore } from './store'

export { ChatStore } from './store'
export { GroupEngine } from './group'
export { HandoffStore } from './handoffs'

export const MAX_MESSAGE_CHARS = 20_000

export interface ChatServiceDeps extends GroupDeps {
  store: ChatStore
  /** Where dropped files are stored. */
  attachmentsDir: string
}

export class ChatService {
  private readonly chains = new Map<number, Promise<unknown>>()
  /** The round being answered in each conversation, and a counter bumped by Stop (queued rounds of an older epoch are dropped). */
  private readonly active = new Map<number, AbortController>()
  private readonly epochs = new Map<number, number>()
  private readonly abort = new AbortController()
  private counter = 0
  readonly group: GroupEngine

  constructor(private readonly deps: ChatServiceDeps) {
    this.group = new GroupEngine(deps)
    deps.handoffs.closeInterrupted()
  }

  get store(): ChatStore {
    return this.deps.store
  }

  /** Saves the owner's message and starts the answer in the background (not awaited). */
  send(conversationId: number, body: string, uploads: AttachmentUpload[] = []): SendResult {
    if (typeof body !== 'string') throw new Error('A message must be text')
    const text = body.trim()
    if (!text && uploads.length === 0) throw new Error('Write a message or attach a file')
    if (text.length > MAX_MESSAGE_CHARS) throw new Error(`A message is limited to ${MAX_MESSAGE_CHARS} characters`)
    this.deps.store.get(conversationId)
    const attachments = uploads.length ? saveUploads(this.deps.attachmentsDir, conversationId, uploads) : []
    const message = this.deps.store.post(conversationId, { authorType: 'owner', body: text, attachments })
    const base = `chat-${conversationId}-${message.id}-${++this.counter}`
    const epoch = this.epochs.get(conversationId) ?? 0
    const previous = this.chains.get(conversationId) ?? Promise.resolve()
    const run = async (): Promise<void> => {
      if ((this.epochs.get(conversationId) ?? 0) !== epoch || this.abort.signal.aborted) {
        // Stopped while it waited: nobody answers it.
        this.deps.emit({ streamId: `${base}-1`, conversationId, done: true, error: 'Stopped' })
        return
      }
      const controller = new AbortController()
      this.active.set(conversationId, controller)
      try {
        await this.group.answer(conversationId, message, base, AbortSignal.any([this.abort.signal, controller.signal]))
      } finally {
        if (this.active.get(conversationId) === controller) this.active.delete(conversationId)
      }
    }
    // The group engine never rejects by design; the catch covers a database closed during shutdown.
    const next = previous.then(run).catch(() => null)
    this.chains.set(conversationId, next)
    void next.finally(() => {
      if (this.chains.get(conversationId) === next) this.chains.delete(conversationId)
    })
    return { message, streamId: `${base}-1` }
  }

  /**
   * Stop (PLAN-V2 §5.2): cuts the whole conversation — the turn in flight, its handoff, the mentions not reached yet
   * and the messages still waiting. Returns false when nothing was running or waiting.
   */
  stop(conversationId: number): boolean {
    this.deps.store.get(conversationId)
    const busy = this.chains.has(conversationId)
    this.epochs.set(conversationId, (this.epochs.get(conversationId) ?? 0) + 1)
    this.active.get(conversationId)?.abort()
    if (busy) this.deps.store.post(conversationId, { authorType: 'system', body: 'Arrêté : la conversation ne répond plus à ce message.' })
    return busy
  }

  /** True while a message of this conversation is being answered or waits for its turn. */
  busy(conversationId: number): boolean {
    return this.chains.has(conversationId)
  }

  /** Resolves when every reply in flight has finished (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.chains.size > 0) await Promise.allSettled([...this.chains.values()])
  }

  /** Stops replies in flight. */
  close(): void {
    this.abort.abort()
  }
}
