// French labels of the engine's nodes in the renderer (the same keys `runs.node.*` the main process uses for runs): by node
// id first, then by node type family; an unknown node shows its id, spaced and capitalised.
import { fr, t, type MessageKey } from '../../../shared/fr'

const BY_TYPE: Record<string, MessageKey> = {
  'research.topic': 'runs.node.research',
  'script.write': 'runs.node.script',
  'voice.tts': 'runs.node.voice',
  'voice.own': 'runs.node.voice',
  'beats.split': 'runs.node.beats',
  'director.plan': 'runs.node.director',
  'visuals.fulfil': 'runs.node.visuals',
  'captions.make': 'runs.node.captions',
  'sound.music': 'runs.node.sound',
  'render.assemble': 'runs.node.render',
  'package.youtube': 'runs.node.package',
  'thumbnail.make': 'runs.node.thumbnails'
}

const has = (k: string): k is MessageKey => Object.hasOwn(fr, k)

export function nodeLabelOf(nodeId: string, type: string): string {
  const byId = `runs.node.${nodeId}`
  if (has(byId)) return t(byId)
  const byType = BY_TYPE[type.split('@')[0] ?? '']
  if (byType) return t(byType)
  const s = nodeId.replace(/[_-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}
