// Starts the brain's Atelier Cloud link (docs/BRAIN-HEADLESS.md §7) beside its local API: enrols with the enrolment
// file when there is one (retrying while the Cloud cannot be reached: the machine may boot before its network is up),
// else uses the stored credential, then keeps the relay running. Nothing here prints a token or a credential.
import { existsSync, readFileSync } from 'node:fs'
import type { Cipher } from '../secrets'
import {
  CloudLinkError,
  enrolMachine,
  forgetStoredLink,
  neutraliseEnrolFile,
  parseEnrolFile,
  readStoredLink,
  writeStoredLink,
  type CloudMachineLink
} from './cloud-link'
import type { EventHub } from './events'
import { BrainRelay, type BrainRelayOptions, type RelayState } from './relay'

export interface CloudStartOptions {
  dataDir: string
  cipher: Cipher
  enrolFile: string
  /** `--cloud-enrol`: refuse to start when there is neither a stored credential nor an enrolment file. */
  required: boolean
  dispatch: (method: unknown, args: unknown) => Promise<unknown>
  hub: EventHub
  fetchImpl?: typeof fetch
  log?: (line: string) => void
  retryMs?: (attempt: number) => number
  relay?: Partial<Pick<BrainRelayOptions, 'waitS' | 'maxReplyBytes' | 'eventFlushMs' | 'concurrency'>>
}

export interface CloudLinkHandle {
  state(): RelayState
  /** Resolves once the first enrolment / link attempt is settled (the relay may still be connecting). */
  ready: Promise<void>
  close(): Promise<void>
}

/** null when this brain has no Cloud link to make (no credential, no enrolment file, not required). */
export function startCloudLink(o: CloudStartOptions): CloudLinkHandle | null {
  const log = o.log ?? (() => undefined)
  const retryMs = o.retryMs ?? ((n: number) => Math.min(60_000, 1000 * 2 ** n))
  const stored = readStoredLink(o.dataDir, o.cipher)
  const hasFile = existsSync(o.enrolFile)
  if (!stored && !hasFile) {
    if (o.required) {
      throw new CloudLinkError('BAD_ENROL_FILE', `Pas d’inscription à Atelier Cloud : ni identifiant enregistré, ni fichier ${o.enrolFile}.`)
    }
    return null
  }
  let closed = false
  let relay: BrainRelay | null = null
  let error: string | null = null
  let wake: (() => void) | null = null
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      wake = () => {
        clearTimeout(timer)
        resolve()
      }
    })

  const enrolFromFile = async (): Promise<CloudMachineLink | null> => {
    if (!existsSync(o.enrolFile)) return null
    let target: { cloudUrl: string; token: string }
    try {
      target = parseEnrolFile(readFileSync(o.enrolFile, 'utf8'))
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      log(`Atelier Cloud : ${error}`)
      return null
    }
    for (let attempt = 0; !closed; attempt++) {
      try {
        const link = await enrolMachine(target.cloudUrl, target.token, o.fetchImpl)
        writeStoredLink(o.dataDir, o.cipher, link)
        if (!neutraliseEnrolFile(o.enrolFile)) log(`ATTENTION : le fichier d’inscription ${o.enrolFile} n’a pas pu être effacé ; supprime-le.`)
        log(`Atelier Cloud : machine inscrite (${link.machineId}).`)
        error = null
        return link
      } catch (err) {
        const e = err instanceof CloudLinkError ? err : new CloudLinkError('BAD_ANSWER', String(err))
        error = e.message
        if (e.code !== 'CLOUD_UNREACHABLE') {
          log(`Atelier Cloud : ${e.message}`)
          return null
        }
        if (attempt === 0) log(`Atelier Cloud : ${e.message} Nouvel essai…`)
        await sleep(retryMs(attempt))
      }
    }
    return null
  }

  const ready = (async () => {
    // A present enrolment file is a fresh intent (a new machine, or a new token after a lost credential).
    let link = hasFile ? await enrolFromFile() : null
    link ??= stored
    if (!link || closed) return
    relay = new BrainRelay({
      link,
      dispatch: o.dispatch,
      hub: o.hub,
      log,
      ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
      ...(o.retryMs ? { retryMs: o.retryMs } : {}),
      ...o.relay,
      onRevoked: async () => {
        forgetStoredLink(o.dataDir)
        return enrolFromFile()
      }
    })
    relay.start()
  })()

  return {
    state: () => relay?.state() ?? { online: false, machineId: stored?.machineId ?? null, error },
    ready,
    close: async () => {
      closed = true
      wake?.()
      await ready.catch(() => undefined)
      await relay?.close()
    }
  }
}
