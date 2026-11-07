// Pipeline codes (production-lab, Charlie 01/11: « chaque pipeline aura un code… on pourra s'échanger des codes de pipeline
// qu'on pourra directement importer »). Every pipeline version has a short code, the fingerprint of its document
// (`7K2Q-9XPM`: 40 bits of SHA-256 over its canonical JSON, Crockford base 32). Sharing one is a text that carries the
// document itself (`ATL1.<code>.<deflated JSON, base64url>`), so a code works with no server; importing checks the
// fingerprint, then the document is validated like any saved pipeline. Sharing and importing are built but OFF in the beta
// (« on ne doit pas pouvoir, pour le moment, exporter les pipelines »): on only with `ATELIER_PIPELINE_CODES=1`.
import { createHash } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const PREFIX = 'ATL1'
/** The longest document a code may carry once inflated (a pipeline is a few kilobytes). */
const MAX_JSON = 1_000_000

/** Sharing and importing pipeline codes are on (never in the beta for now). */
export function pipelineCodesOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ATELIER_PIPELINE_CODES === '1'
}

/** The error a user sees while codes are off. */
export const CODES_OFF = 'Les codes de pipeline arrivent bientôt : on ne peut pas encore en partager ni en importer.'

/** JSON with every object's keys sorted, so one document always gives one text. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort)
    if (typeof v === 'object' && v !== null) {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .map((k) => [k, sort((v as Record<string, unknown>)[k])])
      )
    }
    return v
  }
  return JSON.stringify(sort(value))
}

function base32(bytes: Uint8Array, chars: number): string {
  let bits = 0
  let acc = 0
  let out = ''
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5 && out.length < chars) {
      out += ALPHABET[(acc >> (bits - 5)) & 31]
      bits -= 5
    }
    acc &= (1 << bits) - 1
  }
  return out
}

/** The code of a pipeline document: `7K2Q-9XPM`. */
export function pipelineCode(doc: unknown): string {
  const raw = base32(createHash('sha256').update(canonicalJson(doc)).digest().subarray(0, 5), 8)
  return `${raw.slice(0, 4)}-${raw.slice(4)}`
}

/** The text that shares a pipeline: its code and its document. */
export function shareText(doc: unknown): string {
  const payload = deflateRawSync(Buffer.from(canonicalJson(doc), 'utf8')).toString('base64url')
  return `${PREFIX}.${pipelineCode(doc).replace('-', '')}.${payload}`
}

/** The document a shared text carries; refused, in French, when the text is not a code or was cut or changed. */
export function readShareText(text: unknown): { code: string; doc: unknown } {
  const bad = new Error('Ce n’est pas un code de pipeline : recopie-le en entier (il commence par ATL1).')
  if (typeof text !== 'string' || text.length > MAX_JSON) throw bad
  const parts = text.replace(/\s+/g, '').split('.')
  if (parts.length !== 3 || parts[0] !== PREFIX || !/^[0-9A-Z]{8}$/.test(parts[1] ?? '') || !/^[A-Za-z0-9_-]+$/.test(parts[2] ?? '')) throw bad
  let doc: unknown
  try {
    doc = JSON.parse(inflateRawSync(Buffer.from(parts[2] ?? '', 'base64url'), { maxOutputLength: MAX_JSON }).toString('utf8'))
  } catch {
    throw new Error('Ce code de pipeline est abîmé : recopie-le en entier.')
  }
  const code = pipelineCode(doc)
  if (code.replace('-', '') !== parts[1]) throw new Error('Ce code de pipeline est abîmé : recopie-le en entier.')
  return { code, doc }
}
