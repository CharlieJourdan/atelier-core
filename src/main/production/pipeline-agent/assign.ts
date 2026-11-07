// A pipeline serves several channels (R6.15): a channel picks one pipeline per video type, and each `channel` input of the
// pipeline is pre-filled from what the channel has (R6.8): its default voice (production-5), its style profile (the eyes);
// the sponsor product from the channel's sponsor (production-9); the presenter comes with its chantier (production-7, the channel
// assets of decision 0025), so it is shown « à fournir » until then.
import { parseSponsor } from '../../../engine/formats/sponsor'
import type { AssignView, ChannelInputView } from '../../../shared/pipeline-agent'
import type { Db } from '../../db'
import type { RecipeStore } from '../recipes'

function channelValue(db: Db, channelId: number, input: string): string | null {
  if (input === 'voice') {
    const v = db.prepare(`SELECT name FROM channel_voices WHERE channel_id = ? AND status = 'active' ORDER BY is_default DESC, id LIMIT 1`).get(channelId) as { name: string } | undefined
    return v?.name ?? null
  }
  if (input === 'sponsor') {
    const s = db.prepare('SELECT text FROM channel_sponsors WHERE channel_id = ?').get(channelId) as { text: string } | undefined
    return s ? (parseSponsor(s.text)?.name ?? null) : null
  }
  if (input === 'style') {
    const p = db.prepare('SELECT MAX(version) AS v FROM style_profiles WHERE channel_id = ?').get(channelId) as { v: number | null }
    return p.v === null ? null : `profil v${p.v}`
  }
  return null
}

export function assignmentView(db: Db, recipes: RecipeStore, recipeId: number): AssignView {
  const r = recipes.get(recipeId)
  const ids = r.channels.filter((c) => c.videoType === r.videoType).map((c) => c.channelId)
  const channels = ids.flatMap((channelId) => {
    const row = db.prepare('SELECT name FROM channels WHERE id = ?').get(channelId) as { name: string } | undefined
    if (!row) return []
    const inputs: ChannelInputView[] = Object.entries(r.doc.inputs).map(([input, source]) =>
      typeof source === 'object' ? { input, source: 'fixed', value: source.fixed } : { input, source, value: source === 'channel' ? channelValue(db, channelId, input) : null }
    )
    return [{ channelId, name: row.name, inputs }]
  })
  return { recipeId, videoType: r.videoType, channels }
}

/** The pipeline serves exactly these channels for its video type: the others that used it stop using it. */
export function assignChannels(recipes: RecipeStore, recipeId: number, channelIds: readonly unknown[]): void {
  if (!Array.isArray(channelIds) || channelIds.length > 200) throw new Error('Chaînes invalides.')
  const r = recipes.get(recipeId)
  const wanted = new Set(channelIds.map((c) => Number(c)))
  for (const id of wanted) if (!Number.isInteger(id) || id <= 0) throw new Error('Chaîne invalide.')
  for (const c of r.channels) if (c.videoType === r.videoType && !wanted.has(c.channelId)) recipes.useForChannel(c.channelId, r.videoType, null)
  for (const id of wanted) recipes.useForChannel(id, r.videoType, recipeId)
}
