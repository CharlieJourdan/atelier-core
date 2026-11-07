// Random identifiers and opaque tokens (crypto-random, base64url).
import { createHash, randomBytes } from 'node:crypto'

export const newId = (prefix: string): string => `${prefix}_${randomBytes(12).toString('base64url')}`
export const newSecret = (prefix: string, bytes = 32): string => `${prefix}_${randomBytes(bytes).toString('base64url')}`
export const sha256Hex = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
export const sha256Bytes = (value: string): Uint8Array => createHash('sha256').update(value).digest()
