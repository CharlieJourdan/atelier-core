// The clickable web demo (dist-demo/): window.atelier is the in-browser demo bridge (src/renderer/web/demo/). The hash
// router, the « Démo » banner and the onboarding's « Passer cette étape » key off this; the desktop app and the linked web
// app never see them.
export function isDemoWeb(): boolean {
  return (globalThis as { atelier?: { demo?: boolean } }).atelier?.demo === true
}
