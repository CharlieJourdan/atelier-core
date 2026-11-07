// A temporary file name next to a cache entry that two writers never share (vps-rendu): one process (the team VPS's brain)
// runs several productions at once, and two of them may draw the same card into the same cache entry at the same moment.
// The process id alone collided (ffmpeg « Unable to re-open … for shifting data »); the random tag does not.
import { randomBytes } from 'node:crypto'

export const tempTag = (): string => `${process.pid}.${randomBytes(4).toString('hex')}`
