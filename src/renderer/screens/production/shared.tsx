// Bits shared by the Production screens (lot Z1): run status chips, durations, the run the composer hands to
// « En cours », blob URLs for files fetched over IPC (revoked on unmount) and a small line diff.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import type { RunNodeState, RunStatus } from '../../../shared/runs'
import { StatusDot, type Tone } from '@/components/atelier/primitives'
import { call, errText, useLoader } from '@/state/client'

export const RUN_TOPICS = ['production', 'credits', 'example'] as const

export const ACTIVE_STATUSES: readonly RunStatus[] = ['queued', 'running', 'waiting', 'interrupted']

const STATUS_TONE: Record<RunStatus, Tone> = {
  queued: 'info',
  running: 'info',
  waiting: 'warn',
  succeeded: 'ok',
  failed: 'err',
  cancelled: 'off',
  interrupted: 'warn'
}

export const NODE_TONE: Record<RunNodeState, Tone> = {
  pending: 'off',
  queued: 'info',
  running: 'info',
  waiting_gate: 'warn',
  done: 'ok',
  error: 'err',
  cancelled: 'off',
  cached: 'ok'
}

export function RunStatusChip({ status }: { status: RunStatus }) {
  return (
    <span data-testid="run-status" data-status={status} className="inline-flex items-center gap-1.5 text-[12px] text-fg-2">
      <StatusDot tone={STATUS_TONE[status]} pulse={status === 'running'} />
      {t(`runs.status.${status}` as MessageKey)}
    </span>
  )
}

/** 61.2 → « 1 min 01 s »; 42 → « 42 s ». */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—'
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m === 0) return `${r} s`
  return `${m} min ${String(r).padStart(2, '0')} s`
}

/** 75 → « 1:15 » (playhead clock). */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`
  if (n >= 1024) return `${Math.round(n / 1024)} Ko`
  return `${n} o`
}

// ---------------------------------------------------------------------------------------------- run handed over

let focused: number | null = null
const listeners = new Set<() => void>()

/** The composer (and the library's « Refaire pareil ») hand the new run to « En cours » through this tiny store. */
export function focusRun(id: number | null): void {
  focused = id
  for (const l of listeners) l()
}

export function useFocusedRun(): number | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => focused,
    () => null
  )
}

// ---------------------------------------------------------------------------------------------- files as blob URLs

export interface FileUrl {
  url: string | null
  error: string | null
  loading: boolean
}

/** Fetches one artefact file over IPC and exposes it as a `blob:` URL; revoked when the ref changes or on unmount. */
export function useFileUrl(runId: number | null, ref: string | null): FileUrl {
  const key = runId !== null && ref !== null ? `${runId}:${ref}` : null
  const [res, setRes] = useState<{ key: string; url: string | null; error: string | null } | null>(null)
  useEffect(() => {
    if (runId === null || ref === null) return
    const mine = `${runId}:${ref}`
    let live = true
    let made: string | null = null
    call('production.file', runId, ref).then(
      (f) => {
        if (!live) return
        made = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mime }))
        setRes({ key: mine, url: made, error: null })
      },
      (err: unknown) => {
        if (live) setRes({ key: mine, url: null, error: errText(err) })
      }
    )
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [runId, ref])
  if (key === null) return { url: null, error: null, loading: false }
  if (res?.key !== key) return { url: null, error: null, loading: true }
  return { url: res.url, error: res.error, loading: false }
}

// ---------------------------------------------------------------------------------------------- line diff

export interface DiffPart {
  kind: 'same' | 'add' | 'del'
  text: string
}

/** Line diff by longest common subsequence (scripts are a few hundred lines). */
export function diffLines(before: string, after: string): DiffPart[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const out: DiffPart[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: 'del', text: a[i++]! })
    } else {
      out.push({ kind: 'add', text: b[j++]! })
    }
  }
  while (i < n) out.push({ kind: 'del', text: a[i++]! })
  while (j < m) out.push({ kind: 'add', text: b[j++]! })
  return out
}

/** Active channels (archived ones cannot start a run). */
export function useChannelList() {
  return useLoader(() => call('channels.list'), 'channels', ['channels', 'example'])
}
