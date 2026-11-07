// The publication kit on the platform (archived note PLAN-COMPLEXITE (old repository) §E.5): when a run has built the upload package of a video,
// the team computer or the app sends it to Atelier Cloud as the video's KIT: the texts (title, description, tags, chapters)
// and the files (video, thumbnails, captions, metadata.json, description.txt). Any signed-in person of the team can then
// download them from anywhere. Atelier never uploads to YouTube: the kit is for publishing by hand.
//
// A separate file from cloud-api.ts (already large): it imports only zod, so the Cloud (type stripping, imports end in
// `.ts`) and the app (bundler) both read it as it is. Routes use the same shape as CLOUD_ROUTES (src/shared/cloud-api.ts).
import { z } from 'zod'

/** The app's id of a video as a string (a number in the app's database), stable across the team's devices. */
export const VideoRef = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, 'a video id')
export const KIT_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
/** A kit holds the video, up to 4 thumbnails, captions, description, metadata and checklist, with room to spare. */
export const MAX_KIT_FILES = 16
/** Default life of a kit on the platform (configurable per plan in the Cloud's config.json). */
export const DEFAULT_KIT_RETENTION_DAYS = 90

/** What the author of the package knows about the video: the texts are shown and copied as they are. */
export const KitTexts = z.object({
  title: z.string().min(1).max(200),
  alternatives: z.array(z.string().min(1).max(200)).max(6).default([]),
  description: z.string().max(5000),
  tags: z.array(z.string().min(1).max(60)).max(40).default([]),
  chapters: z.array(z.object({ at: z.number().min(0).max(1_000_000), title: z.string().min(1).max(120) })).max(80).default([]),
  language: z.string().min(2).max(12).default('fr'),
  /** Made with the fake providers: not to be published. */
  demo: z.boolean().default(false),
  /** The finished video's length in seconds (the founder console's finished minutes); null when unknown. */
  durationS: z.number().min(0).max(86_400).nullable().optional()
})
export type KitTexts = z.infer<typeof KitTexts>

export const KitFile = z.object({
  name: z.string().regex(KIT_FILE_NAME, 'a plain file name'),
  mime: z.string().max(100),
  size: z.number().int().min(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/)
})
export type KitFile = z.infer<typeof KitFile>

export const Kit = KitTexts.extend({
  id: z.string(),
  videoId: VideoRef,
  createdAt: z.string(),
  /** The kit is deleted from the platform after this date. */
  expiresAt: z.string(),
  files: z.array(KitFile)
})
export type Kit = z.infer<typeof Kit>

/** A kit with a short-lived download link per file (a presigned link to the bucket, or a signed Cloud link). */
export const KitWithLinks = Kit.extend({
  files: z.array(KitFile.extend({ url: z.string(), expiresAt: z.string() }))
})
export type KitWithLinks = z.infer<typeof KitWithLinks>

export const KitStartResponse = z.object({ kitId: z.string(), videoId: VideoRef })
export const KitListResponse = z.object({ kits: z.array(Kit) })
/** `POST …/files?name=…&sha256=…`, body = the raw bytes (`application/octet-stream`, at most 512 MiB); the hash is checked. */
export const KitFileQuery = z.object({
  name: z.string().regex(KIT_FILE_NAME, 'a plain file name'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'lowercase hex SHA-256')
})

export interface KitRoute {
  method: 'GET' | 'POST'
  path: string
  auth: 'user' | 'machine'
  body?: z.ZodType
  query?: z.ZodType
  response: z.ZodType | null
}

/**
 * Upload (three steps, so a failed upload never replaces a good kit): start → one call per file → complete. The `machine`
 * routes are the same calls with a team computer's own credential (the headless brain has no person's token).
 */
export const KIT_ROUTES = {
  kitStart: { method: 'POST', path: '/v1/team/videos/:id/kit', auth: 'user', body: KitTexts, response: KitStartResponse },
  kitFile: { method: 'POST', path: '/v1/team/videos/:id/kit/:kitId/files', auth: 'user', query: KitFileQuery, response: KitFile },
  kitComplete: { method: 'POST', path: '/v1/team/videos/:id/kit/:kitId/complete', auth: 'user', response: Kit },
  /** The video's current kit with fresh download links (404 when it has none or it expired). */
  kit: { method: 'GET', path: '/v1/team/videos/:id/kit', auth: 'user', response: KitWithLinks },
  /** The team's kits, newest first, without links (ask one kit for its links when a person clicks a download). */
  kits: { method: 'GET', path: '/v1/team/kits', auth: 'user', response: KitListResponse },
  machineKitStart: { method: 'POST', path: '/v1/relay/machine/videos/:id/kit', auth: 'machine', body: KitTexts, response: KitStartResponse },
  machineKitFile: { method: 'POST', path: '/v1/relay/machine/videos/:id/kit/:kitId/files', auth: 'machine', query: KitFileQuery, response: KitFile },
  machineKitComplete: { method: 'POST', path: '/v1/relay/machine/videos/:id/kit/:kitId/complete', auth: 'machine', response: Kit }
} as const satisfies Record<string, KitRoute>

/** The signed download link of a kit file when the files are in a local folder (outside /v1: the signature is the credential). */
export const KIT_FILE_PATH = '/kit-files/:kitId/:name'
