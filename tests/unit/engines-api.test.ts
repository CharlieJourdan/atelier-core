// `engines.list` (decision 0021): signed out, signed in against an in-process Cloud (fakes, nothing paid), and a Cloud
// that stops answering.
import { describe, expect, it } from 'vitest'
import { ENGINE_FAMILIES } from '../../src/shared/cloud-engines'
import { appCore, connect, startCloud } from './cloud-app-helpers'

describe('engines.list', () => {
  it('says to connect Atelier Cloud when the app is not connected', async () => {
    const app = appCore()
    expect(await app.core.api['engines.list']()).toEqual({ available: false, reason: 'Connecte Atelier Cloud pour voir les moteurs.', engines: [] })
  })

  it('lists the Cloud engines once connected, every family present and every one served by a fake', async () => {
    const rig = await startCloud(1000)
    const app = appCore()
    await connect(app, rig)
    const view = await app.core.api['engines.list']()
    expect(view.available).toBe(true)
    expect(view.reason).toBeNull()
    for (const family of ENGINE_FAMILIES) expect(view.engines.some((e) => e.family === family), family).toBe(true)
    expect(view.engines.find((e) => e.id === 'presenter:heygen-avatar4')).toMatchObject({ unit: 'second', needs: ['reference-image'], status: 'draft' })
    expect(view.engines.filter((e) => e.usage !== null).every((e) => e.served === 'demo')).toBe(true)
  })

  it('answers « unavailable » with a French reason when the Cloud does not respond', async () => {
    const rig = await startCloud(1000)
    const app = appCore()
    await connect(app, rig)
    app.net.down = true
    expect(await app.core.api['engines.list']()).toEqual({ available: false, reason: 'Atelier Cloud ne répond pas : moteurs indisponibles.', engines: [] })
  })
})
