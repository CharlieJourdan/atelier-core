// Free public-archive picture search with a licence per item (Wikimedia Commons, Internet Archive, NASA, the Met).
export { searchArchives, ArchiveSearchError } from './search.ts'
export { downloadArchive, ArchiveDownloadError, type DownloadDeps } from './download.ts'
export { licenceFromName, licenceFromUrl, iaLicence, type Licence } from './licence.ts'
export { rankHits, scoreHit, dedupe, queryWords } from './rank.ts'
export { ARCHIVE_USER_AGENT } from './http.ts'
export {
  ARCHIVE_SOURCES,
  MAX_DOWNLOAD_BYTES,
  type ArchiveDeps,
  type ArchiveHit,
  type ArchiveKind,
  type ArchiveKindHint,
  type ArchiveSearchOptions,
  type ArchiveSearchResult,
  type ArchiveSource,
  type ArchiveSourceError
} from './types.ts'
