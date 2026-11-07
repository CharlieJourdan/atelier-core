// Reads a secret from the keyboard without echo (§4.5: a key is never a command-line argument). On a terminal the
// input is read in raw mode and nothing is written back but the prompt; from a pipe (scripts, tests) one line is read.
// Ctrl-C aborts, Backspace edits, Enter ends.
import type { Readable, Writable } from 'node:stream'

export interface SecretStdin extends Readable {
  isTTY?: boolean
  setRawMode?: (mode: boolean) => unknown
}

export function readSecret(prompt: string, stdin: SecretStdin, stdout: Writable): Promise<string> {
  stdout.write(prompt)
  return stdin.isTTY && typeof stdin.setRawMode === 'function' ? readRaw(stdin, stdout) : readLine(stdin)
}

function readRaw(stdin: SecretStdin, stdout: Writable): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = ''
    const setRaw = stdin.setRawMode as (mode: boolean) => unknown
    const done = (err: Error | null): void => {
      stdin.off('data', onData)
      setRaw.call(stdin, false)
      stdin.pause()
      stdout.write('\n')
      if (err) reject(err)
      else resolve(value)
    }
    const onData = (chunk: Buffer | string): void => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\u0003') return done(new Error('cancelled'))
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return done(null)
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else if (ch >= ' ') value += ch
      }
    }
    setRaw.call(stdin, true)
    stdin.resume()
    stdin.on('data', onData)
  })
}

function readLine(stdin: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = ''
    const finish = (): void => {
      stdin.off('data', onData)
      stdin.off('end', finish)
      stdin.off('error', onError)
      stdin.pause()
      resolve(buf.split(/\r?\n/)[0] ?? '')
    }
    const onError = (err: Error): void => reject(err)
    const onData = (chunk: Buffer | string): void => {
      buf += chunk.toString()
      if (/\r?\n/.test(buf)) finish()
    }
    stdin.on('data', onData)
    stdin.on('end', finish)
    stdin.on('error', onError)
    stdin.resume()
  })
}
