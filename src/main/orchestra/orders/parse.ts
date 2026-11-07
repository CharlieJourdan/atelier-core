// Charlie's order in one message (equipe-3-chaines): « lance-moi 3 vidéos, une par chaîne, avec ces scripts » followed by
// the scripts, each under a line naming its channel. The code reads his own message, never a copy the agent retyped, so a
// script reaches the pipeline word for word (its `[PUB]` marker included). Pure.

export interface OrderChannel {
  id: number
  name: string
}

export interface OrderItem {
  channelId: number
  channelName: string
  title: string | null
  script: string
}

const fold = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Words a heading may hold besides the channel's name (« Script 1 — chaîne marcel artisan : »). */
const FILLER = new Set([
  'chaine', 'channel', 'kanal', 'script', 'skript', 'texte', 'text', 'video', 'pour', 'for', 'fur', 'de', 'du', 'la', 'le', 'les', 'l',
  'the', 'die', 'der', 'das', 'von', 'vom', 'numero', 'no', 'n', 'nr', 'un', 'une', 'deux', 'trois', 'one', 'two', 'three', 'eins', 'zwei', 'drei'
])

const TITLE = /^\s*(?:titre|title|titel)\s*[:：]\s*(.+)$/iu

/** The channel a line names as a heading (every word of it is the channel's name or filler), or null. */
export function headingChannel(line: string, channels: readonly OrderChannel[]): OrderChannel | null {
  const raw = line.trim()
  if (raw.length === 0 || raw.length > 90) return null
  const words = fold(raw).split(' ').filter((w) => w && !/^\d+$/.test(w))
  if (words.length === 0) return null
  let best: { c: OrderChannel; n: number } | null = null
  for (const c of channels) {
    const name = new Set(fold(c.name).split(' '))
    const own = words.filter((w) => !FILLER.has(w) || name.has(w))
    if (own.length === 0 || !own.every((w) => name.has(w))) continue
    // the line must name the channel itself, not only a filler word it shares (« vom »)
    if (!own.some((w) => !FILLER.has(w))) continue
    if (!best || own.length > best.n) best = { c, n: own.length }
  }
  return best?.c ?? null
}

/** The scripts of the message, one per heading, in order; what came before the first heading is the request itself. */
export function parseOrder(text: string, channels: readonly OrderChannel[]): { items: OrderItem[]; problems: string[] } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const items: OrderItem[] = []
  const problems: string[] = []
  let cur: { c: OrderChannel; lines: string[] } | null = null
  const close = (): void => {
    if (!cur) return
    const body = [...cur.lines]
    while (body.length && !body[0]!.trim()) body.shift()
    let title: string | null = null
    const t = body[0] ? TITLE.exec(body[0]) : null
    if (t?.[1]) {
      title = t[1].trim().replace(/^[«"“]\s*|\s*[»"”]$/gu, '').slice(0, 200)
      body.shift()
    }
    const script = body.join('\n').replace(/^\s*(?:-{3,}|={3,}|\*{3,})\s*$/gmu, '').trim()
    if (script.length < 40) problems.push(`le script pour « ${cur.c.name} » est vide ou trop court`)
    else items.push({ channelId: cur.c.id, channelName: cur.c.name, title, script })
    cur = null
  }
  for (const line of lines) {
    const c = headingChannel(line, channels)
    if (c) {
      close()
      cur = { c, lines: [] }
    } else if (cur) cur.lines.push(line)
  }
  close()
  if (items.length === 0 && problems.length === 0) problems.push('aucun script sous le nom d’une chaîne : mets le nom de la chaîne seul sur une ligne au-dessus de chaque script')
  return { items, problems }
}

/** A title for a script without one: its first sentence, cut at a word under 80 characters. */
export function titleOf(script: string): string {
  const first = script.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s/u)[0] ?? ''
  if (first.length <= 80) return first.replace(/[.…]$/u, '')
  return `${first.slice(0, 80).replace(/\s+\S*$/u, '')}…`
}
