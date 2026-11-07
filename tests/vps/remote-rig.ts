// The simulated VPS's remote renderer (vps-rendu): the fake remote provider the host started (scripts/vps-sim.mjs passes its
// address as VPS_REMOTE_URL / VPS_REMOTE_TOKEN, so its workers run in their own containers, outside the VPS box), or, without
// it, one started here in this process (quick checks only: its workers would share the VPS's cores).
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRemoteRenderer, type RemoteRenderer, type RenderJobRecord } from '../../src/engine/remote-render/executor'
import { captureRenderBackend } from '../../src/engine/remote-render/capture'
import { fakeRemoteBackend } from '../../src/engine/remote-render/fake-remote-client'
import { startFakeRemote } from '../../src/engine/remote-render/fake-remote'

export interface RemoteRig {
  options: RemoteRenderer
  ledger: RenderJobRecord[]
  close(): Promise<void>
}

export async function remoteSetup(o: { down: boolean; capture?: string }): Promise<RemoteRig> {
  const ledger: RenderJobRecord[] = []
  // capture: each kind of render job written once for `render try`, then made by the VPS (nothing sent)
  if (o.capture) {
    const renderer = createRemoteRenderer({ backends: [captureRenderBackend(o.capture, { once: true })], onJob: (r) => ledger.push(r) })
    return { options: renderer, ledger, close: async () => undefined }
  }
  let address = process.env.VPS_REMOTE_URL && process.env.VPS_REMOTE_TOKEN ? { url: process.env.VPS_REMOTE_URL, token: process.env.VPS_REMOTE_TOKEN } : null
  let close = async (): Promise<void> => undefined
  if (!address) {
    const fake = await startFakeRemote({ dir: mkdtempSync(path.join(tmpdir(), 'atelier-fake-remote-')), runner: 'process', root: path.join(__dirname, '..', '..'), down: o.down })
    address = { url: fake.url, token: fake.token }
    close = () => fake.close()
  }
  const renderer = createRemoteRenderer({
    backends: [fakeRemoteBackend({ ...address, pollMs: 500 })],
    maxRemote: Number(process.env.VPS_MAX_REMOTE ?? 10),
    maxLocal: Number(process.env.VPS_MAX_LOCAL ?? 1),
    onJob: (r) => ledger.push(r)
  })
  return { options: renderer, ledger, close }
}
