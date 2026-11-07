// The only bridge to the renderer: window.atelier = { call, on }.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CALL_CHANNEL, EVENT_NAMES, type AtelierBridge, type CallEnvelope } from '../shared/api'

const bridge: AtelierBridge = {
  async call(method, ...args) {
    const envelope = (await ipcRenderer.invoke(CALL_CHANNEL, method, args)) as CallEnvelope<never>
    if (envelope.ok) return envelope.value
    const err = new Error(envelope.error.message)
    err.name = envelope.error.code
    throw err
  },
  on(event, listener) {
    if (!EVENT_NAMES.includes(event)) throw new Error(`Unknown event: ${String(event)}`)
    const wrapped = (_e: IpcRendererEvent, payload: unknown): void => listener(payload as never)
    ipcRenderer.on(event, wrapped)
    return () => {
      ipcRenderer.removeListener(event, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('atelier', bridge)
