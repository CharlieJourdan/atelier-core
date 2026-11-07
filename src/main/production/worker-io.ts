// What the local worker's parent hands the child and reads from it (lot P5): an allow-listed environment (no secret
// ever reaches the worker) and a bounded line reader for the child's stdout (one huge line is dropped, never kept).

/**
 * Variables the worker may see: the search path, system folders, temp folders, home, locale, and what Electron as Node,
 * ffmpeg, macOS `say` and Windows SAPI need. Matched case-insensitively (Windows names vary: Path / PATH).
 */
const ALLOWED = new Set(
  [
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'SYSTEMDRIVE',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'TMPDIR',
    'HOME',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'USER',
    'USERNAME',
    'LOGNAME',
    'SHELL',
    'LANG',
    'LANGUAGE',
    'TZ',
    'APPDATA',
    'LOCALAPPDATA',
    'PROGRAMDATA',
    'PROGRAMFILES',
    'PROGRAMFILES(X86)',
    'PROGRAMW6432',
    'COMMONPROGRAMFILES',
    'COMMONPROGRAMFILES(X86)',
    'COMMONPROGRAMW6432',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
    'OS',
    'XDG_RUNTIME_DIR',
    '__CF_USER_TEXT_ENCODING',
    'ELECTRON_RUN_AS_NODE'
  ].map((k) => k.toUpperCase())
)
const SECRET = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH/i

/** The allow-listed part of `env` (LC_* included); a name that looks like a secret never passes. */
export function workerEnv(env: NodeJS.ProcessEnv = process.env, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries({ ...env, ...extra })) {
    if (v === undefined || SECRET.test(k)) continue
    const up = k.toUpperCase()
    if (ALLOWED.has(up) || up.startsWith('LC_')) out[k] = v
  }
  return out
}

/** Longest line kept from the child's stdout (a bigger one is dropped whole). */
export const MAX_LINE_CHARS = 8 * 1024 * 1024

/**
 * Splits a stream into lines (`\n`, an optional `\r` before it is removed) and calls `onLine` for each. A line longer
 * than `max` characters is dropped: its start is thrown away at once and the rest is skipped up to the next newline.
 */
export function boundedLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void, max = MAX_LINE_CHARS): () => void {
  let buf = ''
  let skipping = false
  stream.setEncoding('utf8')
  const onData = (chunk: string): void => {
    let start = 0
    for (let nl = chunk.indexOf('\n'); nl >= 0; nl = chunk.indexOf('\n', start)) {
      const piece = chunk.slice(start, nl)
      start = nl + 1
      if (skipping) {
        skipping = false
        buf = ''
        continue
      }
      const line = buf + piece
      buf = ''
      if (line.length <= max) onLine(line.endsWith('\r') ? line.slice(0, -1) : line)
    }
    if (skipping) return
    buf += chunk.slice(start)
    if (buf.length > max) {
      buf = ''
      skipping = true
    }
  }
  stream.on('data', onData)
  return () => {
    stream.off('data', onData)
    buf = ''
  }
}
