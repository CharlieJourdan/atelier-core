// French labels of nodes and errors (keys `runs.*` in src/shared/fr-runs.ts).
import { fr, t, type MessageKey } from '../../../shared/fr'

/** Labels by node type family, used when the node id has no label of its own. */
const BY_TYPE: Record<string, string> = {
  'research.topic': 'runs.node.research',
  'script.write': 'runs.node.script',
  'voice.tts': 'runs.node.voice',
  'voice.own': 'runs.node.voice',
  'beats.split': 'runs.node.beats',
  'director.plan': 'runs.node.director',
  'director.pov': 'runs.node.director',
  'visuals.fulfil': 'runs.node.visuals',
  'captions.make': 'runs.node.captions',
  'sound.music': 'runs.node.sound',
  'render.assemble': 'runs.node.render',
  'package.youtube': 'runs.node.package',
  'background.clips': 'runs.node.background',
  'card.intro': 'runs.node.card',
  'qc.check': 'runs.node.qc',
  'thumbnail.make': 'runs.node.thumbnails',
  'script.translate': 'runs.node.translate'
}

const has = (k: string): k is MessageKey => Object.hasOwn(fr, k)

export function nodeLabel(nodeId: string, type: string): string {
  const byId = `runs.node.${nodeId}`
  if (has(byId)) return t(byId)
  const byType = BY_TYPE[type.split('@')[0] ?? '']
  if (byType && has(byType)) return t(byType)
  return nodeId
}

/**
 * The user's sentence for a node error. A `missing_tool` message is already French and precise (ffmpeg introuvable,
 * Claude non connecté…): it is kept as is; other codes get their phrase, the engine's text stays as a detail.
 */
/** A node error that stops the whole run at once: the Claude sign-in is dead, every other Claude step would fail the same way. */
export const stopsTheRun = (code: string | undefined, raw: string): boolean => code === 'missing_tool' && raw === t('runs.error.claudeLogin')

export function errorMessage(code: string, raw: string): string {
  if (code === 'missing_tool' && raw) return raw
  const key = `runs.error.${code}`
  return has(key) ? t(key) : t('runs.error.internal')
}
