// A visitor's demo session, kept in this browser only: the first visit opens the onboarding; « Recommencer la démo » wipes
// what the demo remembered (store prefs, theme, demo state) and starts again from the onboarding.
const VISITED_KEY = 'atelier.demo.visited'
const PREFS_KEY = 'atelier.proto.prefs'

/** First visit: the store opens on the onboarding (its prefs say « not onboarded », in the demo workspace). */
export function prepareVisit(storage: Storage = localStorage): void {
  try {
    if (storage.getItem(VISITED_KEY)) return
    storage.setItem(VISITED_KEY, '1')
    storage.setItem(PREFS_KEY, JSON.stringify({ onboarded: false, presentation: true }))
  } catch {
    // storage blocked: the demo opens on the app, the onboarding stays reachable from Réglages
  }
}

export function restartDemo(): void {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('atelier.')) localStorage.removeItem(key)
    sessionStorage.clear()
  } catch {
    // nothing kept anyway
  }
  window.location.hash = ''
  window.location.reload()
}
