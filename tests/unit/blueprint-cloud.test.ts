// The blueprint through the app's IPC against an in-process Atelier Cloud (loopback, fakes, nothing paid): 404 before the first
// publish, the published version after, cached across an outage, forgotten on sign-out, and used by the next seed.
import { describe, expect, it, vi } from 'vitest'
import { CACHE_KEY } from '../../src/main/blueprint/service'
import { handleCall } from '../../src/main/ipc'
import { API_METHODS } from '../../src/shared/api'
import type { BlueprintStatus } from '../../src/shared/blueprint'
import { PUBLISHED_V3 } from '../../web/src/admin/blueprint'
import { appCore, connect, startCloud, type AppRig, type CloudRig } from './cloud-app-helpers'

/** The Cloud side of the test: the founder publishes (the console's call, minus HTTP). */
function publish(rig: CloudRig, edit: (bp: typeof PUBLISHED_V3) => void = () => undefined): { version: number } {
  const bp = structuredClone(PUBLISHED_V3)
  edit(bp)
  const blueprints = (rig.t.cloud as unknown as { blueprints: { publish(raw: unknown, note: string, actor: string): { version: number } } }).blueprints
  return blueprints.publish(bp, 'test', 'founder')
}

const blueprint = async (app: AppRig, refresh = true): Promise<BlueprintStatus> => {
  const res = await handleCall(app.core.api, 'cloud.blueprint', refresh ? [true] : [])
  if (!res.ok) throw new Error(res.error.message)
  return res.value as BlueprintStatus
}

describe('cloud.blueprint', () => {
  it('is part of the IPC contract with its two siblings', () => {
    for (const m of ['cloud.blueprint', 'cloud.blueprintPlan', 'cloud.blueprintApply']) expect(API_METHODS).toContain(m)
  })

  it('not connected: « not-connected », no request, nothing in the plan', async () => {
    const app = appCore()
    expect(await blueprint(app)).toMatchObject({ state: 'not-connected', version: null, agents: [], recruitable: [], pipelines: [] })
    expect(await app.core.api['cloud.blueprintPlan']()).toEqual({ version: null, changes: [], appliedVersion: null })
  })

  it('connected before any publish (404): « none »; after a publish: the version, mapped agents, pipelines with kinds', async () => {
    const rig = await startCloud()
    const app = appCore()
    await connect(app, rig)
    expect(await blueprint(app)).toMatchObject({ state: 'none', version: null })

    const { version } = publish(rig, (bp) => {
      bp.pipelines[0]!.nodes[0]!.kind = 'idea'
      bp.agents.push({ id: 'community', role: 'Community manager', tier: 'fast', routines: [], instructions: 'Tu réponds aux commentaires.' })
    })
    expect(version).toBe(1)
    const status = await blueprint(app)
    expect(status).toMatchObject({ state: 'ok', version: 1, stale: false })
    expect(status.agents).toHaveLength(9)
    expect(status.agents[0]).toMatchObject({ id: 'atlas', runtimeRole: 'principal', tier: 'deep' })
    expect(status.recruitable.map((a) => a.id)).toEqual(['community'])
    const docu = status.pipelines.find((p) => p.id === 'documentaire-narre')!
    expect(docu.steps[0]).toMatchObject({ kind: 'idea', kindSource: 'blueprint', gate: true })
    expect(docu.steps[1]).toMatchObject({ kind: 'script', kindSource: 'guessed' })
    // read-only and cached: the cheap read serves the same thing without asking the Cloud
    expect(await blueprint(app, false)).toEqual(status)
    expect(app.core.context.settings.get<{ version: number }>(CACHE_KEY)?.version).toBe(1)
  })

  it('connecting fetches on its own; a new version is picked up by the next refresh; no token ever travels in the answer', async () => {
    const rig = await startCloud()
    publish(rig)
    const app = appCore()
    await connect(app, rig)
    await vi.waitFor(async () => expect(await blueprint(app, false)).toMatchObject({ state: 'ok', version: 1 }), { timeout: 5000, interval: 20 })
    publish(rig, (bp) => void (bp.agents[0]!.tier = 'balanced'))
    expect(await blueprint(app, false)).toMatchObject({ version: 1 }) // not asked yet
    const fresh = await blueprint(app)
    expect(fresh).toMatchObject({ version: 2 })
    expect(fresh.agents[0]).toMatchObject({ tier: 'balanced' })
    const raw = JSON.stringify(fresh)
    expect(raw).not.toMatch(/accessToken|refreshToken|authorization/i)
  })

  it('an unreachable Cloud serves the cached version (stale); signing out goes back to the built-in defaults', async () => {
    const rig = await startCloud()
    publish(rig)
    const app = appCore()
    await connect(app, rig)
    expect(await blueprint(app)).toMatchObject({ version: 1, stale: false })
    app.net.down = true
    expect(await blueprint(app)).toMatchObject({ state: 'ok', version: 1, stale: true })
    app.net.down = false
    expect(await blueprint(app)).toMatchObject({ version: 1, stale: false })

    app.core.orchestra.seed()
    expect(app.core.orchestra.parts.tree.bySlug('principal')?.policy).toEqual({ tier: 'best' })

    await app.core.api['cloud.disconnect']()
    expect(await blueprint(app, false)).toMatchObject({ state: 'not-connected', version: null, agents: [] })
    expect(await app.core.api['cloud.blueprintPlan']()).toMatchObject({ version: null, changes: [] })
  })

  it('a different Cloud address never reads the previous Cloud’s cache', async () => {
    const rig = await startCloud()
    publish(rig)
    const app = appCore()
    await connect(app, rig)
    await blueprint(app)
    expect(app.core.cloud.blueprint.forSeed()?.version).toBe(1)
    await app.core.api['cloud.setBaseUrl']('http://127.0.0.1:9')
    expect(app.core.cloud.blueprint.forSeed()).toBeNull()
    expect(await blueprint(app, false)).toMatchObject({ state: 'not-connected' })
  })
})
