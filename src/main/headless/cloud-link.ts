// The team computer's own link to Atelier Cloud (docs/BRAIN-HEADLESS.md §7). On a machine the Cloud created, cloud-init
// wrote /etc/atelier/enrol (ATELIER_CLOUD_URL + a single-use ATELIER_ENROL_TOKEN). The brain trades the token, once,
// for the machine's long-lived credential (POST /v1/machines/enrol), keeps that credential encrypted with the machine
// key in `<dataDir>/cloud-machine.json` (0600), and deletes the enrolment file. Neither value is ever printed or logged.
import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { CLOUD_ROUTES, EnrolResponse } from '../../shared/cloud-api'
import type { Cipher } from '../secrets'

export const CLOUD_LINK_FILE = 'cloud-machine.json'
export const DEFAULT_ENROL_FILE = '/etc/atelier/enrol'

export interface CloudMachineLink {
  cloudUrl: string
  machineId: string
  teamId: string
  credential: string
}

interface LinkFile {
  v: 1
  cloudUrl: string
  machineId: string
  teamId: string
  /** base64 of the machine-key cipher's output. */
  credential: string
  enrolledAt: string
}

export class CloudLinkError extends Error {
  constructor(
    readonly code: 'BAD_ENROL_FILE' | 'ENROL_REFUSED' | 'CLOUD_UNREACHABLE' | 'BAD_ANSWER',
    message: string
  ) {
    super(message)
  }
}

/** https, or plain http on the loopback only (a test Cloud): the credential never crosses a network in clear. */
export function checkCloudUrl(raw: string): string {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new CloudLinkError('BAD_ENROL_FILE', 'Adresse d’Atelier Cloud invalide dans le fichier d’inscription.')
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) {
    throw new CloudLinkError('BAD_ENROL_FILE', 'Adresse d’Atelier Cloud invalide : seulement https://hôte[:port].')
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) {
    throw new CloudLinkError('BAD_ENROL_FILE', 'Atelier Cloud doit être en https (http seulement sur cette machine même).')
  }
  return u.origin
}

/** `KEY=VALUE` lines; only the two keys cloud-init writes. */
export function parseEnrolFile(text: string): { cloudUrl: string; token: string } {
  const values = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(\S*)\s*$/.exec(line)
    if (m?.[1]) values.set(m[1], m[2] ?? '')
  }
  const url = values.get('ATELIER_CLOUD_URL')
  const token = values.get('ATELIER_ENROL_TOKEN')
  if (!url || !token || !/^[A-Za-z0-9_-]{16,200}$/.test(token)) {
    throw new CloudLinkError('BAD_ENROL_FILE', 'Fichier d’inscription incomplet (ATELIER_CLOUD_URL et ATELIER_ENROL_TOKEN attendus).')
  }
  return { cloudUrl: checkCloudUrl(url), token }
}

export function readStoredLink(dataDir: string, cipher: Cipher): CloudMachineLink | null {
  const file = path.join(dataDir, CLOUD_LINK_FILE)
  if (!existsSync(file)) return null
  try {
    const body = JSON.parse(readFileSync(file, 'utf8')) as Partial<LinkFile>
    if (body.v !== 1 || typeof body.cloudUrl !== 'string' || typeof body.machineId !== 'string' || typeof body.teamId !== 'string' || typeof body.credential !== 'string') return null
    const credential = cipher.decrypt(Buffer.from(body.credential, 'base64'))
    return { cloudUrl: checkCloudUrl(body.cloudUrl), machineId: body.machineId, teamId: body.teamId, credential }
  } catch {
    return null
  }
}

export function writeStoredLink(dataDir: string, cipher: Cipher, link: CloudMachineLink, platform: NodeJS.Platform = process.platform): void {
  const file = path.join(dataDir, CLOUD_LINK_FILE)
  const body: LinkFile = {
    v: 1,
    cloudUrl: link.cloudUrl,
    machineId: link.machineId,
    teamId: link.teamId,
    credential: Buffer.from(cipher.encrypt(link.credential)).toString('base64'),
    enrolledAt: new Date().toISOString()
  }
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(body, null, 2) + '\n', { mode: 0o600 })
  if (platform !== 'win32') chmodSync(tmp, 0o600)
  renameSync(tmp, file)
}

export function forgetStoredLink(dataDir: string): void {
  const file = path.join(dataDir, CLOUD_LINK_FILE)
  if (existsSync(file)) unlinkSync(file)
}

/** Removes the used enrolment file; when it cannot be removed, empties it. Returns false when neither worked. */
export function neutraliseEnrolFile(file: string): boolean {
  try {
    unlinkSync(file)
    return true
  } catch {
    try {
      writeFileSync(file, '# used: this machine is enrolled with Atelier Cloud\n', { mode: 0o600 })
      return true
    } catch {
      return false
    }
  }
}

/** One enrolment call. 401 = the token is unknown or already used (no point retrying). */
export async function enrolMachine(cloudUrl: string, token: string, fetchImpl: typeof fetch = fetch): Promise<CloudMachineLink> {
  let res: Response
  try {
    res = await fetchImpl(`${cloudUrl}${CLOUD_ROUTES.machineEnrol.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enrolToken: token }),
      signal: AbortSignal.timeout(30_000)
    })
  } catch {
    throw new CloudLinkError('CLOUD_UNREACHABLE', `Atelier Cloud ne répond pas (${cloudUrl}).`)
  }
  if (res.status === 401 || res.status === 400) {
    throw new CloudLinkError('ENROL_REFUSED', 'Jeton d’inscription refusé par Atelier Cloud (déjà utilisé ou inconnu) : demande un nouveau jeton.')
  }
  if (!res.ok) throw new CloudLinkError('CLOUD_UNREACHABLE', `Atelier Cloud a répondu HTTP ${res.status} à l’inscription.`)
  const parsed = EnrolResponse.safeParse(await res.json().catch(() => null))
  if (!parsed.success) throw new CloudLinkError('BAD_ANSWER', 'Réponse inattendue d’Atelier Cloud à l’inscription.')
  return { cloudUrl, machineId: parsed.data.machineId, teamId: parsed.data.teamId, credential: parsed.data.credential }
}
