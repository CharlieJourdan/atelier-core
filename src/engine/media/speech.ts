// The operating system's own voice, the demo stand-in of `voice.tts` (docs/ENGINE-SPEC.md §19 Fake, plan §1.3): macOS
// `say`, Windows SAPI through Windows PowerShell. No shell is involved: the program is spawned directly, the text goes
// through a file and the settings through environment variables, so nothing the script says is ever interpreted.
// Word times are not taken from the OS (SAPI reports audio positions on a wrong time scale that depends on the output
// format, macOS reports none): the node aligns the words on the audio itself.
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AbortError, EngineError } from '../errors'
import type { SpeechService } from '../services'

/** Fixed PowerShell program (Windows): lists voices, or speaks the text file into a 48 kHz mono WAV. */
export const SAPI_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Speech',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  "if ($env:ATELIER_TTS_MODE -eq 'list') {",
  "  foreach ($v in $s.GetInstalledVoices()) { if ($v.Enabled) { [Console]::Out.WriteLine('V|' + $v.VoiceInfo.Name + '|' + $v.VoiceInfo.Culture.Name) } }",
  '  exit 0',
  '}',
  '$text = [System.IO.File]::ReadAllText($env:ATELIER_TTS_TEXT, [System.Text.Encoding]::UTF8)',
  '$s.SelectVoice($env:ATELIER_TTS_VOICE)',
  '$s.Rate = [int]$env:ATELIER_TTS_RATE',
  '$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
  '$s.SetOutputToWaveFile($env:ATELIER_TTS_OUT, $fmt)',
  '$s.Speak($text)',
  '$s.SetOutputToNull()',
  '$s.Dispose()'
].join('\n')

export interface SpeechPlatform {
  platform: NodeJS.Platform
  /** Windows: `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` by full path (no PATH lookup). */
  systemRoot?: string
  /** Runs a program without a shell; resolves stdout. */
  exec?: (file: string, args: string[], env: NodeJS.ProcessEnv, signal: AbortSignal) => Promise<string>
}

const defaultExec = (file: string, args: string[], env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<string> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortError())
      return
    }
    const child = spawn(file, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const onAbort = (): void => void child.kill('SIGKILL')
    signal.addEventListener('abort', onAbort, { once: true })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d))
    child.stderr.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-2000)))
    child.on('error', (e) => reject(e))
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) reject(new AbortError())
      else if (code === 0) resolve(out)
      else reject(new EngineError('internal', `${path.basename(file)} exited with ${String(code)}: ${err.trim()}`))
    })
  })

/** `fr-FR` / `fr_FR` → `fr`. */
const langOf = (culture: string): string => culture.slice(0, 2).toLowerCase()

/** macOS `say -v '?'` lines: `Thomas              fr_FR    # Bonjour…`; names may contain spaces and parentheses. */
export function parseSayVoices(stdout: string): { id: string; name: string; language: string }[] {
  const out: { id: string; name: string; language: string }[] = []
  for (const line of stdout.split('\n')) {
    const m = /^(.+?)\s+([a-z]{2,3}[_-][A-Za-z0-9]{2,4})\s+#/.exec(line.trimEnd())
    if (m) out.push({ id: (m[1] as string).trim(), name: (m[1] as string).trim(), language: langOf(m[2] as string) })
  }
  return out
}

/** `say` arguments: voice, words per minute (≈ 180 × speed), WAV 48 kHz 16-bit mono, text from a file. */
export function sayArgs(req: { voiceId: string; rate: number; out: string }, textFile: string): string[] {
  return ['-v', req.voiceId, '-r', String(Math.round(180 * req.rate)), '--file-format=WAVE', '--data-format=LEI16@48000', '-o', req.out, '-f', textFile]
}

/** SAPI rate (−10…10) for a speed factor: about +1 per 10 % faster. */
export const sapiRate = (speed: number): number => Math.max(-10, Math.min(10, Math.round((speed - 1) * 10)))

/** The system voice of this OS, or null where there is none (Linux hosts: Cloud, RunPod). */
export function systemSpeechService(sp: SpeechPlatform): SpeechService | null {
  const exec = sp.exec ?? defaultExec
  if (sp.platform === 'darwin') {
    return {
      async voices(signal) {
        return parseSayVoices(await exec('/usr/bin/say', ['-v', '?'], process.env, signal))
      },
      async speak(req, signal) {
        const textFile = `${req.out}.txt`
        await writeFile(textFile, req.text, 'utf8')
        await exec('/usr/bin/say', sayArgs(req, textFile), process.env, signal)
        return { marks: null }
      }
    }
  }
  if (sp.platform === 'win32') {
    const root = sp.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows'
    const ps = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const encoded = Buffer.from(SAPI_SCRIPT, 'utf16le').toString('base64')
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]
    return {
      async voices(signal) {
        const out = await exec(ps, args, { ...process.env, ATELIER_TTS_MODE: 'list' }, signal)
        return out
          .split(/\r?\n/)
          .filter((l) => l.startsWith('V|'))
          .map((l) => {
            const [, name = '', culture = ''] = l.split('|')
            return { id: name, name, language: langOf(culture) }
          })
      },
      async speak(req, signal) {
        const textFile = `${req.out}.txt`
        await writeFile(textFile, req.text, 'utf8')
        const env = { ...process.env, ATELIER_TTS_MODE: 'speak', ATELIER_TTS_TEXT: textFile, ATELIER_TTS_OUT: req.out, ATELIER_TTS_VOICE: req.voiceId, ATELIER_TTS_RATE: String(sapiRate(req.rate)) }
        await exec(ps, args, env, signal)
        return { marks: null }
      }
    }
  }
  return null
}
