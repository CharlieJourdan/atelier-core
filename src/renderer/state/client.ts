// Typed renderer client over window.atelier, plus small hooks to load data and refresh on change events.
import { useCallback, useEffect, useState } from 'react'
import type { ApiArgs, ApiMethod, ApiResult, ChangeTopic, EventContract, EventName } from '../../shared/api'

export function call<M extends ApiMethod>(method: M, ...args: ApiArgs<M>): Promise<ApiResult<M>> {
  return window.atelier.call(method, ...args)
}

export function useEvent<E extends EventName>(event: E, listener: (payload: EventContract[E]) => void): void {
  useEffect(() => window.atelier.on(event, listener), [event, listener])
}

/** Methods that take no arguments (the ones a view can simply load). */
export type LoadMethod = { [M in ApiMethod]: ApiArgs<M> extends [] ? M : never }[ApiMethod]

export interface Loaded<T> {
  data: T | null
  error: string | null
  reload: () => void
}

/** Calls a no-argument method, and again whenever main reports a change on one of `topics`. */
export function useApi<M extends LoadMethod>(method: M, topics: readonly ChangeTopic[] = []): Loaded<ApiResult<M>> {
  const [data, setData] = useState<ApiResult<M> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])
  const topicKey = topics.join(',')

  useEffect(() => {
    let live = true
    const load = window.atelier.call as (m: M) => Promise<ApiResult<M>>
    load(method).then(
      (value) => {
        if (!live) return
        setData(value)
        setError(null)
      },
      (err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err))
      }
    )
    return () => {
      live = false
    }
  }, [method, tick])

  const onChanged = useCallback(
    (p: EventContract['atelier:changed']) => {
      if (topicKey.split(',').includes(p.topic)) reload()
    },
    [topicKey, reload]
  )
  useEvent('atelier:changed', onChanged)

  return { data, error, reload }
}

/** Runs `load` on mount, when `key` changes, and whenever main reports a change on one of `topics`. */
export function useLoader<T>(
  load: () => Promise<T>,
  key: string,
  topics: readonly ChangeTopic[]
): Loaded<T> & { setError: (e: string | null) => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])
  const topicKey = topics.join(',')

  useEffect(() => {
    let live = true
    load().then(
      (value) => {
        if (!live) return
        setData(value)
        setError(null)
      },
      (err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err))
      }
    )
    return () => {
      live = false
    }
    // `load` is a fresh closure each render; `key` says when its inputs changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick])

  const onChanged = useCallback(
    (p: EventContract['atelier:changed']) => {
      if (topicKey.split(',').includes(p.topic)) reload()
    },
    [topicKey, reload]
  )
  useEvent('atelier:changed', onChanged)
  return { data, error, reload, setError }
}

export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
