// « Ajouter une chaîne » from anywhere (Accueil, the sidebar's channel menu): asks Chaînes to open its add-a-channel flow,
// whether Chaînes is already on screen (its listener) or about to mount (it reads the pending request, then clears it).
import type { Route } from '../../../shared/sections'

type Listener = () => void

let pending = false
const listeners = new Set<Listener>()

export function requestAddChannel(): void {
  pending = true
  for (const l of listeners) l()
}

export function hasAddChannelRequest(): boolean {
  return pending
}

export function clearAddChannelRequest(): void {
  pending = false
}

export function onAddChannelRequest(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Opens Chaînes with its add-a-channel flow. */
export function addChannel(onRoute: (r: Route) => void): void {
  requestAddChannel()
  onRoute({ section: 'chaines' })
}
