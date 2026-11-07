// Real mode, Planning › publication kit, the platform side: the video's kit on Atelier Cloud (texts + a link per file) is
// asked of the app (which holds the person's Cloud session, even when the brain is on a team computer), downloads go
// through it, and the local package folder stays the fallback when the Cloud is not connected, unreachable, or has no kit.
// The `KitApi` seam is what tests replace with a fake client.
import { useCallback, useEffect, useState } from 'react'
import type { CloudKitDownload, CloudKitPublished, CloudKitState } from '../../../shared/api'
import type { KitWithLinks } from '../../../shared/cloud-kit'
import { call, useEvent } from '@/state/client'

export interface KitApi {
  kit(videoId: number): Promise<CloudKitState>
  publish(runId: number): Promise<CloudKitPublished>
  download(videoId: number, name?: string): Promise<CloudKitDownload>
  /** Opens the package folder on this computer (refused by a team computer without a screen). */
  reveal(runId: number): Promise<unknown>
}

/**
 * The video's reference on the platform, asked of the brain that holds the video (this app's, or the team computer's
 * once one is connected: its « video 3 » is not ours). Unknown (an older brain): the kit is asked by the bare id.
 */
const refOf = (videoId: number): Promise<string | undefined> => call('cloud.kitRef', videoId).catch(() => undefined)

export const appKitApi: KitApi = {
  kit: async (videoId) => {
    const ref = await refOf(videoId)
    return ref === undefined ? call('cloud.kit', videoId) : call('cloud.kit', videoId, ref)
  },
  publish: (runId) => call('cloud.kitPublish', runId),
  download: async (videoId, name) => {
    const ref = await refOf(videoId)
    if (ref !== undefined) return call('cloud.kitDownload', videoId, name ?? null, ref)
    return name === undefined ? call('cloud.kitDownload', videoId) : call('cloud.kitDownload', videoId, name)
  },
  reveal: (runId) => call('production.revealPackage', runId)
}

export type KitFileAction = 'video' | 'thumb' | 'all'

/** The kit file a button stands for: the video, or the thumbnail (the JPEG when the PNG was too big for YouTube). */
export function kitFileFor(kit: KitWithLinks, action: Exclude<KitFileAction, 'all'>): KitWithLinks['files'][number] | undefined {
  if (action === 'video') return kit.files.find((f) => /^video\./.test(f.name))
  return kit.files.find((f) => f.name === 'thumbnail.jpg') ?? kit.files.find((f) => f.name === 'thumbnail.png')
}

export type KitOutcome = { via: 'cloud'; saved: string[]; dir: string | null } | { via: 'folder' }

/**
 * What a download button does: with the kit on the platform, the file(s) are saved from there (the Cloud answers from
 * anywhere, the package folder may be on another computer); otherwise the package folder is opened on this one.
 */
export async function runKitAction(api: KitApi, ids: { videoId: number; runId: number }, state: CloudKitState | null, action: KitFileAction): Promise<KitOutcome> {
  if (state?.status === 'ok') {
    if (action === 'all') return { via: 'cloud', ...(await api.download(ids.videoId)) }
    const file = kitFileFor(state.kit, action)
    if (!file) throw new Error('missing')
    return { via: 'cloud', ...(await api.download(ids.videoId, file.name)) }
  }
  await api.reveal(ids.runId)
  return { via: 'folder' }
}

export interface CloudKitView {
  /** null while it is being asked (or when there is nothing to ask yet). */
  state: CloudKitState | null
  sending: boolean
  /** Sends the package to the platform, then reloads the kit; resolves with the error text (French) or null. */
  send: () => Promise<string | null>
}

/** The video's kit on the platform once its package is built (`runId`), kept fresh when the Cloud connection changes. */
export function useCloudKit(ids: { videoId: number; runId: number } | null, api: KitApi = appKitApi): CloudKitView {
  const [state, setState] = useState<CloudKitState | null>(null)
  const [sending, setSending] = useState(false)
  const [tick, setTick] = useState(0)
  const videoId = ids?.videoId
  useEffect(() => {
    if (videoId === undefined) return
    let stop = false
    api
      .kit(videoId)
      .then((s) => !stop && setState(s))
      .catch(() => !stop && setState({ status: 'unreachable' }))
    return () => {
      stop = true
    }
  }, [api, videoId, tick])
  useEvent(
    'atelier:changed',
    useCallback((p: { topic: string }) => p.topic === 'cloud' && setTick((n) => n + 1), [])
  )
  const runId = ids?.runId
  const send = useCallback(async (): Promise<string | null> => {
    if (runId === undefined) return null
    setSending(true)
    try {
      await api.publish(runId)
      setTick((n) => n + 1)
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    } finally {
      setSending(false)
    }
  }, [api, runId])
  return { state: videoId === undefined ? null : state, sending, send }
}
