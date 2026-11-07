// Text for Discord: splitting to the 2000-character limit, and how an Atelier chat message looks in a channel.
import type { MessageRow } from '../../shared/chat'
import { t } from '../../shared/fr'
import { roleName } from '../../shared/roles'

/** Discord refuses a message over 2000 characters: stay under it. */
export const MAX_CHARS = 1900

export function chunk(text: string, max = MAX_CHARS): string[] {
  const out: string[] = []
  let rest = text.trim()
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max)
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max)
    if (cut < max / 2) cut = max
    out.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  if (rest) out.push(rest)
  return out
}

export function excerpt(text: string, max: number): string {
  const s = text.trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Display name of a chat author id (`orch:<slug>` agents of the runtime, role ids of the older agents). */
export type NameOf = (authorId: string | null) => string

export function nameResolver(agents: readonly { slug: string; name: string }[]): NameOf {
  const bySlug = new Map(agents.map((a) => [a.slug, a.name]))
  return (id) => {
    if (!id) return 'Atelier'
    if (id.startsWith('orch:')) return bySlug.get(id.slice(5)) ?? id.slice(5)
    return roleName(id)
  }
}

/** What a chat message becomes on Discord; null = not worth posting (empty, or a card with nothing to say). */
export function mirrorText(m: MessageRow, nameOf: NameOf): string | null {
  const body = m.body.trim()
  if (m.authorType === 'owner') return body ? `**${t('discord.msg.fromApp')}** : ${body}` : null
  if (m.authorType === 'system') return body ? `*${body}*` : null
  if (body) return `**${nameOf(m.authorId)}**\n${body}`
  const card = m.card
  if (card && card.type === 'handoff') return `↪ **${nameOf(card.from)}** → **${nameOf(card.to)}** : ${excerpt(card.ask, 300)}`
  return null
}
