// The health of the providers' keys and engines (solidite, decision 0078): no key is ever silently broken. Every real job
// tells it: a failure that says the key, the account or the permission is wrong (401, 403, an invalid key, a quota) raises the
// engine's alert in the founder console (`providers status`), on the exact call the pipeline made (Gemini's model list once
// answered 200 while its video analysis answered 403); the engine's next success clears it. An engine with an alert is
// published `health: 'down'`, so a quote that relies on it says so before anything is spent.
import type { Usage } from '../../src/shared/cloud-api.ts'
import type { ProviderAlerts } from './provider-alerts.ts'

/** Alerts this module raised start with this (it clears only its own: a HeyGen sign-in alert stays until signed in). */
export const KEY_ALERT = 'Clé ou accès refusé'

const KEY_PROBLEM = /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid[ _-]?(api[ _-]?)?key|api key not valid|permission|not allowed to|quota|insufficient[ _-]?(credit|fund|balance)|billing|payment required|\b402\b|expired (key|token)|account (suspended|disabled)/i

/** True when a provider's error says its key, account or permission is the problem (not the content, not a busy server). */
export const isKeyProblem = (message: string): boolean => KEY_PROBLEM.test(message)

/** Notes one real job's end for its engine's health. */
export function noteJobHealth(alerts: ProviderAlerts | undefined, engine: string, usage: Usage, ok: boolean, message: string | null): void {
  if (!alerts) return
  if (!ok && message && isKeyProblem(message)) {
    alerts.set(engine, `${KEY_ALERT} (${usage}) : ${message}`)
    return
  }
  if (ok && alerts.list().some((a) => a.provider === engine && a.message.startsWith(KEY_ALERT))) alerts.set(engine, null)
}

/** The engines whose key or access is refused now (published `health: 'down'`). */
export function downEngines(alerts: ProviderAlerts | undefined): Set<string> {
  return new Set((alerts?.list() ?? []).filter((a) => a.message.startsWith(KEY_ALERT)).map((a) => a.provider))
}
