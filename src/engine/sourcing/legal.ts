// Legal status of a candidate: from a licence the source gave (archive/licence.ts) or fixed for a whole source (Pexels, NASA…),
// and the credit line printed in the video. A licence we cannot read is `forbidden`, never guessed.
import { licenceFromName, licenceFromUrl, type Licence } from '../archive/licence.ts'
import type { LegalStatus, MediaCandidate, MediaLicence } from './types.ts'

export function statusOf(l: Licence): LegalStatus {
  if (/^CC0/i.test(l.short)) return 'cc0'
  if (/^Public domain/i.test(l.short)) return 'public-domain'
  if (/^CC BY-SA/i.test(l.short)) return 'cc-by-sa'
  if (/^CC BY/i.test(l.short)) return 'cc-by'
  return 'forbidden'
}

export function fromArchiveLicence(l: Licence): MediaLicence {
  return { short: l.short, status: statusOf(l), ...(l.url ? { url: l.url } : {}), attributionRequired: l.attributionRequired }
}

export const licenceFromText = (name: string, url?: string): MediaLicence | undefined => {
  const l = licenceFromName(name, url)
  return l ? fromArchiveLicence(l) : undefined
}
export const licenceFromLink = (url: string): MediaLicence | undefined => {
  const l = licenceFromUrl(url)
  return l ? fromArchiveLicence(l) : undefined
}

/** A rights statement URL (Europeana): « no copyright » statements are public domain, the others are refused. */
export function licenceFromRights(url: string): MediaLicence | undefined {
  const cc = licenceFromLink(url)
  if (cc) return cc
  if (/rightsstatements\.org\/vocab\/NoC-/i.test(url)) return { short: 'No known copyright', status: 'public-domain', url, attributionRequired: false }
  return undefined
}

export const freeStockLicence = (name: string, url: string): MediaLicence => ({ short: name, status: 'free-licence', url, attributionRequired: false })

export const FAIR_USE_LICENCE: MediaLicence = { short: 'Fair-use excerpt (unlicensed)', status: 'fair-use-excerpt', attributionRequired: true }

/** « <title> — <creator>, <licence>, via <provider label> ». */
export function creditLine(title: string, creator: string | undefined, licence: string, via: string): string {
  return `${creator ? `${title} — ${creator}` : title}, ${licence}, via ${via}`
}

/** Candidates a person must clear before the video is published (fair-use excerpts, doubtful sources). */
export function publishBlockers(cs: readonly MediaCandidate[]): MediaCandidate[] {
  return cs.filter((c) => c.review === 'human-review' || c.licence.status === 'fair-use-excerpt' || c.licence.status === 'forbidden')
}

/** The credits block of a video: one line per candidate whose licence asks for it (or all when `all`). */
export function creditsText(cs: readonly MediaCandidate[], all = false): string {
  const lines = cs.filter((c) => all || c.licence.attributionRequired).map((c) => c.credit)
  return [...new Set(lines)].join('\n')
}
