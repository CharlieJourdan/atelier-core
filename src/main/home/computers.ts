// Ordinateurs (lot Z1): agent browser sessions and remote machines, stored in SQLite. The machine test is a plain TCP connect.
import net from 'node:net'
import type { BrowserSession, BrowserSessionInput, Machine, MachineInput, MachineOs, MachineTestResult } from '../../shared/api/home'
import { MACHINE_OSES } from '../../shared/api/home'
import type { Db } from '../db'

const TEST_TIMEOUT_MS = 4000

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label} : texte attendu.`)
  const v = value.trim()
  if (!v) throw new Error(`${label} : à renseigner.`)
  if (v.length > max) throw new Error(`${label} : ${max} caractères au plus.`)
  return v
}

function id(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error(`${label} : identifiant invalide.`)
  return value
}

/** http(s) address only; returns the normalised URL. */
export function checkStartUrl(raw: unknown): string {
  const v = text(raw, 'Adresse de départ', 2000)
  let url: URL
  try {
    url = new URL(v)
  } catch {
    throw new Error('Adresse de départ invalide : écris une adresse complète, par exemple https://exemple.fr.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Adresse de départ : seules les adresses http et https sont acceptées.')
  return url.toString()
}

const HOST_NAME = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

/** A host name or an IPv4 / IPv6 literal, no scheme, no path, no spaces. */
export function checkHost(raw: unknown): string {
  const v = text(raw, 'Adresse', 253)
  const bare = v.replace(/^\[(.*)\]$/, '$1')
  if (net.isIP(bare) === 0 && !HOST_NAME.test(v)) throw new Error('Adresse invalide : un nom de machine ou une adresse IP, sans « http:// » ni chemin.')
  return bare
}

function checkPort(raw: unknown): number {
  if (raw === undefined) return 22
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 65535) throw new Error('Port invalide : un nombre entre 1 et 65535.')
  return raw
}

interface BrowserDb {
  id: number
  role: string
  start_url: string
  status: 'open' | 'closed'
  screenshot_path: string | null
  created_at: string
  closed_at: string | null
  example: number
}

export class BrowsersStore {
  constructor(
    private readonly db: Db,
    private readonly agentName: (role: string) => string | null
  ) {}

  private toRow(r: BrowserDb): BrowserSession {
    return {
      id: r.id,
      role: r.role,
      agentName: this.agentName(r.role) ?? r.role,
      startUrl: r.start_url,
      status: r.status,
      screenshotPath: r.screenshot_path,
      createdAt: r.created_at,
      closedAt: r.closed_at,
      example: r.example === 1
    }
  }

  list(): BrowserSession[] {
    const rows = this.db.prepare("SELECT * FROM browser_sessions ORDER BY (status = 'open') DESC, id DESC").all() as unknown as BrowserDb[]
    return rows.map((r) => this.toRow(r))
  }

  get(rawId: unknown): BrowserSession {
    const row = this.db.prepare('SELECT * FROM browser_sessions WHERE id = ?').get(id(rawId, 'Session')) as unknown as BrowserDb | undefined
    if (!row) throw new Error('Session introuvable.')
    return this.toRow(row)
  }

  open(input: BrowserSessionInput): BrowserSession {
    if (!input || typeof input !== 'object') throw new Error('Session invalide.')
    const role = text(input.role, 'Agent', 60)
    if (this.agentName(role) === null) throw new Error('Cet agent n’existe pas.')
    const url = checkStartUrl(input.startUrl)
    const info = this.db.prepare('INSERT INTO browser_sessions (role, start_url) VALUES (?, ?)').run(role, url)
    return this.get(Number(info.lastInsertRowid))
  }

  close(rawId: unknown): BrowserSession {
    const s = this.get(rawId)
    if (s.status === 'closed') throw new Error('Cette session est déjà fermée.')
    this.db.prepare("UPDATE browser_sessions SET status = 'closed', closed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(s.id)
    return this.get(s.id)
  }

  remove(rawId: unknown): void {
    const s = this.get(rawId)
    if (s.status === 'open') throw new Error('Ferme la session avant de la retirer.')
    this.db.prepare('DELETE FROM browser_sessions WHERE id = ?').run(s.id)
  }
}

interface MachineDb {
  id: number
  name: string
  os: MachineOs
  host: string
  port: number
  status: Machine['status']
  last_seen_at: string | null
  last_checked_at: string | null
  last_error: string | null
  created_at: string
  example: number
}

function toMachine(r: MachineDb): Machine {
  return {
    id: r.id,
    name: r.name,
    os: r.os,
    host: r.host,
    port: r.port,
    status: r.status,
    lastSeenAt: r.last_seen_at,
    lastCheckedAt: r.last_checked_at,
    lastError: r.last_error,
    createdAt: r.created_at,
    example: r.example === 1
  }
}

type ProbeResult = { ok: true; ms: number } | { ok: false; error: string }
export type Probe = (host: string, port: number, timeoutMs: number) => Promise<ProbeResult>

function reasonOf(code: string | undefined): string {
  if (code === 'ECONNREFUSED') return 'Connexion refusée : la machine répond mais rien n’écoute sur ce port.'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Nom de machine introuvable.'
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'Machine injoignable depuis ce réseau.'
  return 'Connexion impossible.'
}

/** TCP connect, nothing sent. */
export const tcpProbe: Probe = (host, port, timeoutMs) =>
  new Promise((resolve) => {
    const started = Date.now()
    const socket = net.connect({ host, port })
    let done = false
    const finish = (r: ProbeResult): void => {
      if (done) return
      done = true
      socket.destroy()
      resolve(r)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish({ ok: true, ms: Date.now() - started }))
    socket.once('timeout', () => finish({ ok: false, error: `Aucune réponse au bout de ${Math.round(timeoutMs / 1000)} s.` }))
    socket.once('error', (err: NodeJS.ErrnoException) => finish({ ok: false, error: reasonOf(err.code) }))
  })

export class MachinesStore {
  constructor(
    private readonly db: Db,
    private readonly probe: Probe = tcpProbe,
    private readonly now: () => Date = () => new Date()
  ) {}

  list(): Machine[] {
    const rows = this.db.prepare('SELECT * FROM machines ORDER BY id').all() as unknown as MachineDb[]
    return rows.map(toMachine)
  }

  get(rawId: unknown): Machine {
    const row = this.db.prepare('SELECT * FROM machines WHERE id = ?').get(id(rawId, 'Machine')) as unknown as MachineDb | undefined
    if (!row) throw new Error('Machine introuvable.')
    return toMachine(row)
  }

  add(input: MachineInput): Machine {
    if (!input || typeof input !== 'object') throw new Error('Machine invalide.')
    const name = text(input.name, 'Nom', 80)
    if (!(MACHINE_OSES as readonly unknown[]).includes(input.os)) throw new Error('Système inconnu : Windows, macOS ou Linux.')
    const host = checkHost(input.host)
    const port = checkPort(input.port)
    const info = this.db.prepare('INSERT INTO machines (name, os, host, port) VALUES (?, ?, ?, ?)').run(name, input.os, host, port)
    return this.get(Number(info.lastInsertRowid))
  }

  rename(rawId: unknown, rawName: unknown): Machine {
    const m = this.get(rawId)
    this.db.prepare('UPDATE machines SET name = ? WHERE id = ?').run(text(rawName, 'Nom', 80), m.id)
    return this.get(m.id)
  }

  remove(rawId: unknown): void {
    const m = this.get(rawId)
    this.db.prepare('DELETE FROM machines WHERE id = ?').run(m.id)
  }

  async test(rawId: unknown): Promise<MachineTestResult> {
    const m = this.get(rawId)
    const r = await this.probe(m.host, m.port, TEST_TIMEOUT_MS)
    const at = this.now().toISOString()
    if (r.ok) {
      this.db.prepare("UPDATE machines SET status = 'reachable', last_seen_at = ?, last_checked_at = ?, last_error = NULL WHERE id = ?").run(at, at, m.id)
    } else {
      this.db.prepare("UPDATE machines SET status = 'unreachable', last_checked_at = ?, last_error = ? WHERE id = ?").run(at, r.error, m.id)
    }
    // The machine may have been removed while the test ran: report the result without a row then.
    const machine = this.db.prepare('SELECT id FROM machines WHERE id = ?').get(m.id) ? this.get(m.id) : { ...m, status: r.ok ? ('reachable' as const) : ('unreachable' as const) }
    return r.ok
      ? { machine, ok: true, ms: r.ms, message: `${machine.name} répond sur ${machine.host}:${machine.port} (${r.ms} ms).` }
      : { machine, ok: false, ms: null, message: `${machine.name} ne répond pas : ${r.error}` }
  }
}
