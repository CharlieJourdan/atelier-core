// « Ajouter une chaîne » then « Annuler » creates nothing (Charlie 01/11: it still made the channel). Real mode makes the
// channel when the flow leaves the channel question (its analysis and pipeline need it), so cancelling deletes it: the
// session's `discard` (even while the creation is on the way) and main's `channels.discard` (the channel, its team and its
// pipelines go; a channel with a published video is never deleted).
import { describe, expect, it } from 'vitest'
import { LiveOnboardingSession, type Call, type LiveDraft } from '../../src/renderer/proto/live/onboarding-live'
import { memoryCore } from './helpers'

const DRAFT: LiveDraft = { kind: 'niche', name: 'Affaires non résolues', niche: 'Affaires non résolues', standards: '', link: '', hint: 'niche-cold', versionNote: 'v2' }

/** A session on the real API of an in-memory core (nothing reaches a provider). */
function onCore() {
  const core = memoryCore()
  const calls: string[] = []
  let hold: Promise<void> | null = null
  const call = (async (method: string, ...args: unknown[]) => {
    calls.push(method)
    if (method === 'channels.create' && hold) await hold
    return (core.api as unknown as Record<string, (...a: unknown[]) => unknown>)[method]!(...args)
  }) as unknown as Call
  const session = new LiveOnboardingSession({ call, startRun: async () => ({ libraryId: null, notes: [], runId: null }) as never })
  return { core, calls, session, holdCreate: (p: Promise<void>) => (hold = p) }
}

describe('Ajouter une chaîne › Annuler', () => {
  it('cancel before the channel question creates nothing and calls nothing', async () => {
    const { core, calls, session } = onCore()
    await session.discard()
    expect(calls).toEqual([])
    expect(await core.api['channels.list'](true)).toHaveLength(0)
  })

  it('cancel after the channel question deletes the channel, its team and does not leave it in the archives', async () => {
    const { core, session } = onCore()
    const id = await session.ensureChannel(DRAFT)
    expect((await core.api['channels.list']()).map((c) => c.id)).toEqual([id])
    expect((await core.api['orchestra.agents']()).some((a) => a.channelId === id)).toBe(true)
    await session.discard()
    expect(await core.api['channels.list'](true)).toHaveLength(0)
    expect((await core.api['orchestra.agents']()).some((a) => a.channelId === id)).toBe(false)
    expect(session.getState().channelId).toBeNull()
    // the flow makes nothing after a cancel
    await expect(session.ensureChannel(DRAFT)).rejects.toThrow(/annulé/)
    expect(await core.api['channels.list'](true)).toHaveLength(0)
  })

  it('cancel while the channel is being created waits for it, then deletes it', async () => {
    const { core, session, holdCreate } = onCore()
    let release = (): void => undefined
    holdCreate(new Promise<void>((r) => (release = r)))
    const creating = session.ensureChannel(DRAFT)
    const cancelled = session.discard()
    release()
    await creating
    await cancelled
    expect(await core.api['channels.list'](true)).toHaveLength(0)
  })

  it('keeps the other channels, and never deletes a channel with a published video', async () => {
    const { api, context } = memoryCore()
    const keep = await api['channels.create']({ name: 'Gardée' })
    const gone = await api['channels.create']({ name: 'Annulée' })
    await api['channels.discard'](gone.id)
    expect((await api['channels.list'](true)).map((c) => c.id)).toEqual([keep.id])
    const v = context.workflow.createVideo(keep.id, { title: 'Publiée' })
    context.db.prepare(`UPDATE videos SET status = 'published' WHERE id = ?`).run(v.video.id)
    await expect(Promise.resolve().then(() => api['channels.discard'](keep.id))).rejects.toThrow(/published/)
    expect(await api['channels.list']()).toHaveLength(1)
  })
})
