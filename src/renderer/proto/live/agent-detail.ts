// Real mode, the agent sheet: what the runtime knows about one agent (its instructions, routines, memory items and its
// recent tasks as a journal) in the shape the sheet already shows, and the edits sent back (name, instructions, effort →
// model tier, routines on/off, forgetting a memory item). Name and instructions are sent after a short pause in typing.
import { useEffect, useRef, useState } from 'react'
import type { OrchTask } from '../../../shared/api/orchestra'
import type { AgentLook } from '../../../shared/mascot'
import type { AgentDetail, Effort, JournalEntry, MemoryItem, Routine } from '../data-team-agents'
import type { ProtoAgent } from '../types'
import { liveDriver } from './registry'

export interface LiveAgentDetail {
  routines: Routine[]
  memory: MemoryItem[]
  journal: JournalEntry[]
}

const TASK_LABEL: Partial<Record<OrchTask['status'], string>> = {
  done: 'Terminé',
  failed: 'Échec, relance prévue',
  dead: 'Arrêté après plusieurs échecs',
  waiting_human: 'Attend ta réponse',
  waiting: 'Attend ses sous-tâches',
  running: 'En cours',
  leased: 'En cours',
  queued: 'En file',
  cancelled: 'Annulé'
}

function minutesSince(iso: string | null): number {
  const at = iso ? Date.parse(iso) : NaN
  return Number.isFinite(at) ? Math.max(0, Math.round((Date.now() - at) / 60_000)) : 0
}

/** A five-field cron as a short French phrase (the common shapes; anything else is shown as is). */
export function cronLabel(cron: string): string {
  const [min, hour, dom, mon, dow] = cron.trim().split(/\s+/)
  const at = hour !== undefined && /^\d+$/.test(hour) && min !== undefined && /^\d+$/.test(min) ? `${hour.padStart(2, '0')} h ${min === '0' ? '' : min.padStart(2, '0')}`.trim() : null
  const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
  if (at && dom === '*' && mon === '*' && dow === '*') return `Chaque jour à ${at}`
  if (at && dom === '*' && mon === '*' && dow !== undefined && /^\d$/.test(dow)) return `Chaque ${days[Number(dow)]} à ${at}`
  return cron
}

export function useLiveAgentDetail(agent: Pick<ProtoAgent, 'liveId'>): LiveAgentDetail | null {
  const [detail, setDetail] = useState<LiveAgentDetail | null>(null)
  const id = agent.liveId
  useEffect(() => {
    const driver = liveDriver()
    if (id === undefined || !driver) return
    let live = true
    Promise.all([driver.routines(id), driver.memory(id), driver.tasks(id)])
      .then(([routines, memory, tasks]) => {
        if (!live) return
        setDetail({
          routines: routines.map((r) => ({ id: String(r.id), label: r.name, schedule: cronLabel(r.cron), on: r.enabled })),
          memory: memory.map((m) => ({ id: String(m.id), text: m.content, importance: (m.importance >= 4 ? 3 : m.importance >= 2 ? 2 : 1) as 1 | 2 | 3 })),
          journal: tasks.map((t) => ({
            id: String(t.id),
            minutesAgo: minutesSince(t.finishedAt ?? t.startedAt ?? t.createdAt),
            text: `${t.title} · ${TASK_LABEL[t.status] ?? t.status}`
          }))
        })
      })
      .catch(() => {
        if (live) setDetail({ routines: [], memory: [], journal: [] })
      })
    return () => {
      live = false
    }
  }, [id])
  return id === undefined ? null : detail
}

const TIER: Record<Effort, 'fast' | 'balanced' | 'best'> = { fast: 'fast', balanced: 'balanced', max: 'best' }

/** Sends an edit of the sheet to the runtime (text fields after 700 ms without typing). */
export function useLiveAgentEdits(agent: Pick<ProtoAgent, 'liveId'>): (patch: { name?: string; instructions?: string; effort?: Effort; routines?: Record<string, boolean>; deletedMemory?: string[]; look?: AgentLook | null }) => void {
  const timer = useRef<number | null>(null)
  const pending = useRef<{ name?: string; instructions?: string }>({})
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )
  return (patch) => {
    const driver = liveDriver()
    const id = agent.liveId
    if (id === undefined || !driver) return
    if (patch.effort) void driver.updateAgent(id, { policy: { tier: TIER[patch.effort] } })
    if (patch.look !== undefined) void driver.updateAgent(id, { look: patch.look })
    for (const [routineId, on] of Object.entries(patch.routines ?? {})) void driver.toggleRoutine(Number(routineId), on)
    for (const memoryId of patch.deletedMemory ?? []) void driver.deleteMemory(Number(memoryId))
    if (patch.name !== undefined || patch.instructions !== undefined) {
      pending.current = { ...pending.current, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}) }
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        const out = pending.current
        pending.current = {}
        timer.current = null
        if (out.name !== undefined && !out.name.trim()) delete out.name
        if (Object.keys(out).length) void driver.updateAgent(id, out)
      }, 700)
    }
  }
}

/** Merges the runtime's detail over the sheet's (instructions come with the agent itself). */
export function withLiveDetail(base: AgentDetail, live: LiveAgentDetail | null, instructions: string | undefined, edited: string | undefined): AgentDetail {
  if (!live) return base
  return { ...base, instructions: edited ?? instructions ?? base.instructions, routines: live.routines, memory: live.memory, journal: live.journal }
}
