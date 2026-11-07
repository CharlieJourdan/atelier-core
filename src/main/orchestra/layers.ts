// The shared memory layers (orch_context, migration 022), above each agent's own memory (memory.ts):
//   - the WORKSPACE block: who the owner is, goals, rules, tone. Written by the first onboarding (or the first seed when the
//     onboarding wrote nothing), edited in Réglages › « Mémoire de l'espace », and by Atlas (`memory.workspace`).
//   - one CHANNEL block per channel: niche, audience, language, style profile summary, rules, sponsors/products,
//     competitors. Written when the channel is added, updated by its analyses (a new style profile replaces its « Style »
//     line), edited on the channel sheet (« Mémoire de la chaîne ») and by the lead / analyst (`memory.channel`). Archived
//     with the channel (its agents too, runtime.ts), restored when the channel comes back. Never deleted.
// Both are plain text the owner can read and change: every line is shown as is in « Ce que l'agent sait ».
import type { OrchContextBlock } from '../../shared/api/orchestra'
import type { StyleProfile } from '../../shared/style-profile'
import type { Db } from '../db'
import { iso, truncate, type Clock, type EventLog } from './util'

export const MAX_BLOCK_CHARS = 8000
/** Lines starting with these prefixes are the ones the app keeps up to date (replaced, never duplicated). */
export const STYLE_PREFIX = 'Style :'
export const COMPETITORS_PREFIX = 'Concurrents suivis :'

interface BlockDb {
  id: number
  scope: 'workspace' | 'channel'
  channel_id: number | null
  text: string
  source: string
  updated_at: string
  archived_at: string | null
}

interface ChannelFacts {
  name: string
  niche: string
  standards: string
  script_style: string
  thumbnail_style: string
  youtube_channel_id: string | null
}

const toBlock = (r: BlockDb | undefined, scope: 'workspace' | 'channel', channelId: number | null): OrchContextBlock =>
  r
    ? { scope: r.scope, channelId: r.channel_id, text: r.text, source: r.source, updatedAt: r.updated_at, archived: r.archived_at !== null }
    : { scope, channelId, text: '', source: '', updatedAt: null, archived: false }

/** Replaces the line that starts with `prefix` (or appends it). */
export function upsertLine(text: string, prefix: string, line: string): string {
  const lines = text.split('\n')
  const at = lines.findIndex((l) => l.trim().startsWith(prefix))
  if (at >= 0) lines[at] = line
  else lines.push(line)
  return lines.join('\n').replace(/^\n+/, '')
}

/** A style profile in one line (what agents need to write and judge like the channel). */
export function styleLine(p: StyleProfile, version: number | null): string {
  const parts = [
    `rythme ${p.pace.tempo} (${p.pace.cutsPerMinute} plans/min)`,
    p.hook.pattern ? `accroche « ${truncate(p.hook.pattern, 60)} » en ${p.hook.seconds} s` : '',
    `structure ${p.script.structure.join(' → ')}`,
    p.script.tone ? `ton ${truncate(p.script.tone, 80)}` : '',
    `${p.length.minutes} min`,
    p.thumbnail.traits.length ? `miniature : ${p.thumbnail.traits.slice(0, 4).join(', ')}` : '',
    p.source.demo ? '(exemple de démonstration)' : ''
  ].filter(Boolean)
  return `${STYLE_PREFIX} ${version !== null ? `v${version} · ` : ''}${parts.join(' · ')}`
}

export class ContextStore {
  constructor(
    private readonly db: Db,
    private readonly now: Clock,
    private readonly events: EventLog
  ) {}

  workspace(): OrchContextBlock {
    return toBlock(this.db.prepare(`SELECT * FROM orch_context WHERE scope = 'workspace'`).get() as unknown as BlockDb | undefined, 'workspace', null)
  }

  channel(channelId: number): OrchContextBlock {
    const r = this.db.prepare(`SELECT * FROM orch_context WHERE scope = 'channel' AND channel_id = ?`).get(channelId) as unknown as BlockDb | undefined
    return toBlock(r, 'channel', channelId)
  }

  /** Writes a block (the owner's edit, the onboarding, an agent). Text over 8 000 characters is refused. */
  save(scope: 'workspace' | 'channel', channelId: number | null, text: string, source: string): OrchContextBlock {
    if (typeof text !== 'string') throw new Error('A memory block is text')
    const clean = text.replace(/\r\n/g, '\n').trim()
    if (clean.length > MAX_BLOCK_CHARS) throw new Error(`A memory block holds ${MAX_BLOCK_CHARS} characters at most`)
    if (scope === 'channel') {
      if (channelId === null || !Number.isInteger(channelId) || !this.db.prepare('SELECT 1 FROM channels WHERE id = ?').get(channelId)) {
        throw new Error(`Unknown channel: ${String(channelId)}`)
      }
    } else if (scope !== 'workspace') throw new Error(`Unknown memory scope: ${String(scope)}`)
    const now = iso(this.now())
    const cid = scope === 'channel' ? channelId : null
    const existing = scope === 'workspace' ? this.workspace() : this.channel(cid as number)
    if (existing.updatedAt === null) {
      this.db.prepare('INSERT INTO orch_context (scope, channel_id, text, source, updated_at) VALUES (?, ?, ?, ?, ?)').run(scope, cid, clean, truncate(source, 60), now)
    } else if (scope === 'workspace') {
      this.db.prepare(`UPDATE orch_context SET text = ?, source = ?, updated_at = ? WHERE scope = 'workspace'`).run(clean, truncate(source, 60), now)
    } else {
      this.db.prepare(`UPDATE orch_context SET text = ?, source = ?, updated_at = ? WHERE scope = 'channel' AND channel_id = ?`).run(clean, truncate(source, 60), now, cid)
    }
    this.events.add('context', `${scope === 'workspace' ? 'workspace memory' : `channel #${String(cid)} memory`} written (${source})`)
    return scope === 'workspace' ? this.workspace() : this.channel(cid as number)
  }

  /** Appends one line (an agent's `memory.*` tool); an identical line is not added twice. */
  addLine(scope: 'workspace' | 'channel', channelId: number | null, line: string, source: string): OrchContextBlock {
    const text = line.replace(/\s+/g, ' ').trim()
    if (!text) throw new Error('A memory line needs text')
    const cur = scope === 'workspace' ? this.workspace() : this.channel(channelId as number)
    if (cur.text.split('\n').some((l) => l.trim() === `- ${text}` || l.trim() === text)) return cur
    return this.save(scope, channelId, `${cur.text}${cur.text ? '\n' : ''}- ${truncate(text, 400)}`, source)
  }

  /** The workspace block the first time a team is seeded (nothing is overwritten). */
  ensureWorkspace(): OrchContextBlock {
    const cur = this.workspace()
    if (cur.updatedAt !== null) return cur
    const lines = [
      'Propriétaire : la personne qui dirige des chaînes YouTube sans visage avec l’équipe d’agents d’Atelier.',
      'Objectifs : publier régulièrement des vidéos de qualité, garder les coûts sous contrôle.',
      'Règles : rien n’est publié, envoyé ni payé sans sa validation ; ne jamais écrire sur YouTube.',
      'Ton : direct, concret, en français avec lui.'
    ]
    return this.save('workspace', null, lines.join('\n'), 'seed')
  }

  /** The channel block when a channel is added: what its sheet says (nothing is overwritten). */
  ensureChannel(channelId: number, extra: { language?: string; translateFrom?: string; audience?: string; notes?: string } = {}): OrchContextBlock {
    const cur = this.channel(channelId)
    if (cur.updatedAt !== null) return cur
    const c = this.db.prepare('SELECT name, niche, standards, script_style, thumbnail_style, youtube_channel_id FROM channels WHERE id = ?').get(channelId) as unknown as ChannelFacts | undefined
    if (!c) throw new Error(`Unknown channel: ${channelId}`)
    const competitors = (this.db.prepare('SELECT url, name FROM channel_competitors WHERE channel_id = ? AND watched = 1 ORDER BY id').all(channelId) as { url: string; name: string }[])
      .map((r) => r.name || r.url)
      .slice(0, 8)
    const lines = [
      `Chaîne : ${c.name}${c.youtube_channel_id ? ` (${c.youtube_channel_id})` : ''}`,
      c.niche ? `Niche : ${c.niche}` : '',
      extra.audience ? `Public : ${extra.audience}` : '',
      extra.language ? `Langue : ${extra.language}` : '',
      extra.translateFrom ? `Traduit la chaîne : ${extra.translateFrom}` : '',
      c.standards ? `Règles : ${truncate(c.standards.replace(/\s+/g, ' '), 600)}` : '',
      c.script_style ? `Style d’écriture : ${truncate(c.script_style.replace(/\s+/g, ' '), 400)}` : '',
      c.thumbnail_style ? `Miniatures : ${truncate(c.thumbnail_style.replace(/\s+/g, ' '), 300)}` : '',
      competitors.length ? `${COMPETITORS_PREFIX} ${competitors.join(', ')}` : '',
      extra.notes ? truncate(extra.notes.trim(), 1500) : ''
    ].filter(Boolean)
    return this.save('channel', channelId, lines.join('\n'), 'channel')
  }

  /** A new style profile (the eyes' analysis): its summary replaces the « Style » line of the channel block. */
  noteProfile(channelId: number, profile: StyleProfile, version: number | null): void {
    const cur = this.channel(channelId).updatedAt === null ? this.ensureChannel(channelId) : this.channel(channelId)
    this.save('channel', channelId, upsertLine(cur.text, STYLE_PREFIX, styleLine(profile, version)), 'analysis')
  }

  setArchived(channelId: number, archived: boolean): void {
    this.db
      .prepare(`UPDATE orch_context SET archived_at = ? WHERE scope = 'channel' AND channel_id = ?`)
      .run(archived ? iso(this.now()) : null, channelId)
  }
}
