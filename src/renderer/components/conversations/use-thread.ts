// Loads, streams and sends one conversation (the logic of the v1 chat pane, reused by the v2 screen). Since lot 13 a
// message of Charlie may set off several turns (each @mentioned agent, each handoff), each with its own stream, author
// and tool steps; Stop cuts them all.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeTopic, EventContract } from '../../../shared/api'
import type { AttachmentUpload, MessageRow } from '../../../shared/chat'
import { call, useEvent } from '@/state/client'
import type { CardActions } from './cards'
import type { StreamingReply, ToolStep } from './thread'
import { toolLabel } from './tool-labels'

const THREAD_TOPICS: readonly ChangeTopic[] = ['chat', 'videos']

export interface UseThread {
  messages: MessageRow[]
  /** Replies being written, oldest first. */
  streaming: StreamingReply[]
  /** True while a reply is being written (Stop is offered). */
  busy: boolean
  error: string | null
  loading: boolean
  send: (body: string, attachments: AttachmentUpload[]) => Promise<void>
  stop: () => Promise<void>
  actions: CardActions
}

type StreamEvent = EventContract['atelier:stream']

/** Applies one stream event to the replies being written (pure, unit-tested). */
export function applyStreamEvent(streams: readonly StreamingReply[], e: StreamEvent): StreamingReply[] {
  if (e.done) return streams.filter((s) => s.streamId !== e.streamId)
  const i = streams.findIndex((s) => s.streamId === e.streamId)
  const current: StreamingReply = i >= 0 ? (streams[i] as StreamingReply) : { streamId: e.streamId, text: '' }
  let next: StreamingReply = { ...current, ...(e.authorId ? { authorId: e.authorId } : {}) }
  if (e.delta) next = { ...next, text: next.text + e.delta }
  if (e.tool) {
    const step: ToolStep = { id: e.tool.id, label: toolLabel(e.tool.name, e.tool.state), state: e.tool.state }
    const steps = next.toolSteps ?? []
    next = { ...next, toolSteps: steps.some((s) => s.id === step.id) ? steps.map((s) => (s.id === step.id ? step : s)) : [...steps, step] }
  }
  return i >= 0 ? streams.map((s, j) => (j === i ? next : s)) : [...streams, next]
}

export function useThread(conversationId: number, unread: number): UseThread {
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [streaming, setStreaming] = useState<StreamingReply[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  // Streams that finished before chat.send returned (a fast failure): no placeholder for them.
  const finished = useRef(new Set<string>())
  const refresh = useCallback(() => setTick((n) => n + 1), [])
  const unreadRef = useRef(unread)
  useEffect(() => {
    unreadRef.current = unread
  }, [unread])
  // Newest message already marked read: replies arriving while the thread is open are marked read too.
  const marked = useRef(0)

  useEffect(() => {
    let live = true
    call('chat.messages', conversationId).then(
      (rows) => {
        if (!live) return
        setMessages(rows)
        setError(null)
        setLoading(false)
        // Reading the thread marks it read (the unread badge refreshes through the 'chat' topic).
        const newest = rows.at(-1)?.id ?? 0
        const fresh = rows.some((r) => r.id > marked.current && r.authorType !== 'owner')
        if (unreadRef.current > 0 || (marked.current > 0 && fresh)) void call('chat.markRead', conversationId)
        marked.current = Math.max(marked.current, newest)
      },
      (err: unknown) => {
        if (!live) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    )
    return () => {
      live = false
    }
  }, [conversationId, tick])

  const onChanged = useCallback(
    (p: EventContract['atelier:changed']) => {
      if (THREAD_TOPICS.includes(p.topic)) refresh()
    },
    [refresh]
  )
  useEvent('atelier:changed', onChanged)

  const onStream = useCallback(
    (e: StreamEvent) => {
      if (e.conversationId !== conversationId) return
      if (e.done) {
        finished.current.add(e.streamId)
        refresh()
      }
      setStreaming((s) => applyStreamEvent(s, e))
    },
    [conversationId, refresh]
  )
  useEvent('atelier:stream', onStream)

  const send = useCallback(
    async (body: string, attachments: AttachmentUpload[]): Promise<void> => {
      const sent = await call('chat.send', conversationId, body, attachments)
      setMessages((m) => (m.some((x) => x.id === sent.message.id) ? m : [...m, sent.message]))
      const id = sent.streamId
      if (id && !finished.current.has(id)) setStreaming((s) => (s.some((x) => x.streamId === id) ? s : [...s, { streamId: id, text: '' }]))
    },
    [conversationId]
  )

  const stop = useCallback(async (): Promise<void> => {
    await call('chat.stop', conversationId)
    refresh()
  }, [conversationId, refresh])

  const actions: CardActions = {
    approve: async (card) => {
      await call('approvals.approve', card.deliverableId, undefined, card.versionId ?? undefined)
      refresh()
    },
    requestRevision: async (card, note) => {
      await call('approvals.requestRevision', card.deliverableId, note, card.versionId ?? undefined)
      refresh()
    },
    decideProposal: async (card, accept) => {
      if (card.proposalId === null) return
      await call('proposals.decide', card.proposalId, accept)
      refresh()
    },
    resumeTask: async (taskId) => {
      await call('tasks.resume', taskId)
      refresh()
    }
  }
  return { messages, streaming, busy: streaming.length > 0, error, loading, send, stop, actions }
}
