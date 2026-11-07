// Licence filter of the archive search. Kept: public domain (PD, PDM, « no known copyright »), CC0, CC BY, CC BY-SA, any
// version. Refused: NC (non-commercial), ND (no derivatives), « all rights reserved », anything unknown or empty: the
// videos are sold, so a doubtful licence is the same as no licence.
import { arr, str } from './util.ts'

export interface Licence {
  /** « Public domain », « CC0 », « CC BY 4.0 », « CC BY-SA 3.0 »… */
  short: string
  url?: string
  attributionRequired: boolean
}

const PD: Licence = { short: 'Public domain', attributionRequired: false }
const NC_ND = /(^|[\s\-_/(])(nc|nd)([\s\-_/)0-9]|$)|non-?commercial|no[\s-]?deriv|all rights reserved|copyrighted/i

/** A licence name as the archives write it (« CC BY-SA 4.0 », « Public domain », « PD-old-70 », « CC0 »), or undefined if refused. */
export function licenceFromName(name: string, url?: string): Licence | undefined {
  const l = name.trim()
  if (!l || NC_ND.test(l)) return undefined
  if (/^(public[\s-]domain|pd([\s-]|$)|pdm\b|cc-pd-mark|no known copyright|no restrictions|not in copyright)/i.test(l)) return { ...PD, ...(url ? { url } : {}) }
  if (/^cc[\s-]?0\b|^cc[\s-]zero/i.test(l)) {
    const v = /\b(\d\.\d)\b/.exec(l)?.[1]
    return { short: v ? `CC0 ${v}` : 'CC0', ...(url ? { url } : {}), attributionRequired: false }
  }
  const by = /^cc[\s-]by([\s-]sa)?\b/i.exec(l)
  if (by) {
    const v = /\b(\d\.\d)\b/.exec(l)?.[1]
    return { short: `CC BY${by[1] ? '-SA' : ''}${v ? ' ' + v : ''}`, ...(url ? { url } : {}), attributionRequired: true }
  }
  return undefined
}

/** A Creative Commons licence URL (Internet Archive `licenseurl`, Commons `LicenseUrl`), or undefined if refused. */
export function licenceFromUrl(rawUrl: string): Licence | undefined {
  const u = rawUrl.trim()
  const m = /creativecommons\.org\/(licenses|publicdomain)\/([a-z0-9-]+)(?:\/([0-9.]+))?/i.exec(u)
  if (!m) return undefined
  const kind = m[1]!.toLowerCase()
  const code = m[2]!.toLowerCase()
  const ver = m[3]
  if (kind === 'publicdomain') {
    if (code === 'zero') return { short: ver ? `CC0 ${ver}` : 'CC0', url: u, attributionRequired: false }
    return { ...PD, url: u }
  }
  if (code === 'publicdomain') return { ...PD, url: u }
  if (code === 'by') return { short: `CC BY${ver ? ' ' + ver : ''}`, url: u, attributionRequired: true }
  if (code === 'by-sa') return { short: `CC BY-SA${ver ? ' ' + ver : ''}`, url: u, attributionRequired: true }
  return undefined // by-nc, by-nd, by-nc-sa, by-nc-nd…
}

const flat = (v: unknown): string => (Array.isArray(v) ? arr(v).map(str).join(' ') : str(v)).trim()

/**
 * Internet Archive: an item is usable if its `licenseurl` is public domain / CC0 / CC BY(-SA), or, with no licence URL, if
 * `possible-copyright-status` or `rights` say public domain / no known copyright restrictions. A licence URL that is not
 * one of those (NC, ND, anything else) refuses the item even when other fields say public domain.
 */
export function iaLicence(licenseurl: unknown, rights: unknown, possibleStatus: unknown): Licence | undefined {
  const url = flat(licenseurl)
  if (url) return licenceFromUrl(url)
  if (/not[_\s]in[_\s]copyright|no[_\s]known[_\s]copyright|public[\s_]domain/i.test(flat(possibleStatus))) return { ...PD }
  const r = flat(rights)
  if (r && /public domain|no known copyright/i.test(r) && !/not (?:in the )?public domain|all rights reserved|©|\bcopyright(?:ed)?\s+\d{4}/i.test(r)) return { ...PD }
  return undefined
}
