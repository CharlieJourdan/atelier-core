// `npm run cloud -- providers try synthesize|analyseVideo …`: ONE small real call, by hand, outside the wallet, to check
// that a key works before any user is exposed to it. It refuses unless the usage is really live (paidCalls on, provider
// picked in config.json, key in the vault, not a test run) and keeps the call tiny (at most 200 characters of text, at most
// 2 minutes of video). The cost it prints is the provider's, in dollars.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { USAGE_INPUTS, type Usage } from '../../../src/shared/cloud-api.ts'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import { runUsage } from './types.ts'

export const TRY_MAX_CHARS = 200
export const TRY_MAX_MINUTES = 2
export const TRY_TIMEOUT_MS = 120_000

export interface TryArgs {
  usage: Usage
  voice?: string
  /** A voice engine (`voice:ai33`): the try is served by that engine (listed in realEngines), not by the usage's provider. */
  engine?: string
  text?: string
  url?: string
  minutes?: number
  /** Where the audio is written (synthesize). */
  out?: string
}

export async function tryProvider(cloud: Cloud, a: TryArgs, actor: string): Promise<string[]> {
  if (a.usage !== 'synthesize' && a.usage !== 'analyseVideo') throw new CloudError('bad_request', 'try supports synthesize and analyseVideo')
  if (a.engine !== undefined && a.usage !== 'synthesize') throw new CloudError('bad_request', '--engine is for synthesize (a voice engine)')
  const text = a.text ?? 'Bonjour, ceci est un test de la voix.'
  if (a.usage === 'synthesize' && text.length > TRY_MAX_CHARS) throw new CloudError('bad_request', `try is limited to ${TRY_MAX_CHARS} characters`)
  if (a.usage === 'analyseVideo' && (a.minutes ?? 1) > TRY_MAX_MINUTES) throw new CloudError('bad_request', `try is limited to ${TRY_MAX_MINUTES} minutes of video`)
  const input =
    a.usage === 'synthesize'
      ? USAGE_INPUTS.synthesize.parse({ text, voiceId: a.voice, wordTimings: true, ...(a.engine ? { engine: a.engine } : {}) })
      : USAGE_INPUTS.analyseVideo.parse({ url: a.url, minutes: a.minutes ?? 1 })
  // an engine named: its own adapter (vrais-tests: `--engine voice:ai33` with a cloned voice), else the usage's provider
  const resolved = cloud.registry.resolveFor(a.usage, input)
  if (resolved.status !== 'real') throw new CloudError('bad_request', `${a.engine ?? a.usage} is not live: ${resolved.reason ?? 'unknown reason'} (see \`providers status\`)`)
  const adapter = resolved.adapter
  cloud.registry.assertCallable(adapter)
  cloud.audit.record(actor, 'provider.try', a.usage, { provider: adapter.id })
  const refuse = (): never => {
    throw new CloudError('bad_request', 'not available in a manual try')
  }
  const out = await runUsage(adapter, a.usage, input, {
    signal: AbortSignal.timeout(TRY_TIMEOUT_MS),
    progress: () => undefined,
    secret: () => cloud.vault.readForAdapter(adapter.secretName as string, adapter.id),
    jobId: 'cli-try',
    artefact: refuse,
    artefactUrl: refuse,
    callbackUrl: refuse,
    providerRef: () => null,
    setProviderRef: () => undefined
  })
  const lines = [`${adapter.id}: ok, provider cost $${out.costUsd.toFixed(6)}`]
  for (const f of out.files) {
    if (!a.out) {
      lines.push(`${f.name}: ${f.bytes.length} bytes (not saved: give --out FILE)`)
      continue
    }
    const path = resolve(a.out)
    writeFileSync(path, f.bytes)
    lines.push(`${f.name}: ${f.bytes.length} bytes written to ${path}`)
  }
  const d = out.data
  lines.push(
    a.usage === 'synthesize'
      ? `duration ${String(d.durationS)} s, ${Array.isArray(d.words) ? d.words.length : 0} timed words`
      : `summary: ${String(d.summary).slice(0, 300)}`
  )
  return lines.map((l) => cloud.vault.mask(l))
}
